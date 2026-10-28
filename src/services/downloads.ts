import type { DownloadTask } from '../domain/models.js';
import type { ItemRepository, SettingsService, TaskRepository } from '../db/repositories.js';
import { QbittorrentClient } from '../qbittorrent/client.js';

export interface StartResult {
  ok: boolean;
  error?: string;
}

export class DownloadService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly items: ItemRepository,
    private readonly settings: SettingsService,
  ) {}

  private client(): QbittorrentClient {
    const settings = this.settings.get();
    return new QbittorrentClient({
      url: settings.qbUrl,
      username: settings.qbUsername,
      password: settings.qbPassword,
    });
  }

  async startTask(task: DownloadTask): Promise<StartResult> {
    try {
      const settings = this.settings.get();
      const client = this.client();
      const hasCategory = await client.ensureCategory(settings.qbCategory);
      await client.addTorrent({
        urls: task.torrentUrl,
        tags: ['index', task.qbTag].join(','),
        category: hasCategory ? settings.qbCategory : undefined,
      });
      this.tasks.updateState(task.id, 'ADDED', null);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.tasks.updateState(task.id, 'FAILED', message);
      return { ok: false, error: message };
    }
  }

  async startPending(): Promise<{ started: number; failed: number }> {
    let started = 0;
    let failed = 0;
    for (const task of this.tasks.listPending()) {
      const result = await this.startTask(task);
      if (result.ok) started += 1;
      else failed += 1;
    }
    return { started, failed };
  }

  async retryTask(taskId: string): Promise<StartResult> {
    const task = this.tasks.get(taskId);
    if (!task) return { ok: false, error: '任务不存在' };
    return this.startTask(task);
  }

  async stop(hash: string): Promise<void> {
    await this.client().stop(hash);
  }

  async start(hash: string): Promise<void> {
    await this.client().start(hash);
  }

  async deleteTorrent(hash: string, deleteFiles: boolean): Promise<void> {
    await this.client().deleteTorrents(hash, deleteFiles);
    const task = this.tasks.list().find((item) => item.infoHash === hash);
    if (task) {
      this.items.deleteByTask(task.id);
      this.tasks.delete(task.id);
    }
  }

  async deleteTask(taskId: string, deleteFiles: boolean): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.infoHash) {
      try {
        await this.client().deleteTorrents(task.infoHash, deleteFiles);
      } catch {
        // The torrent may already be gone from qBittorrent; still remove the
        // local task so the UI does not get stuck.
      }
    } else {
      // The task was added but not polled yet: locate it by its tag.
      try {
        const torrent = (await this.client().torrents()).find((item) =>
          item.tags.split(',').map((tag) => tag.trim()).includes(task.qbTag),
        );
        if (torrent) await this.client().deleteTorrents(torrent.hash, deleteFiles);
      } catch {
        // qBittorrent offline: local cleanup still proceeds.
      }
    }
    this.items.deleteByTask(task.id);
    this.tasks.delete(task.id);
  }
}
