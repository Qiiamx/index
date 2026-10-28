import path from 'node:path';
import type { DownloadTask, TaskState } from '../domain/models.js';
import { matchFirst } from '../domain/rules.js';
import type { ItemRepository, RuleRepository, SettingsService, SourceRepository, TaskRepository } from '../db/repositories.js';
import { QbittorrentClient, type QbTorrent, type QbTorrentFile } from './client.js';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.ts', '.flv', '.wmv', '.mpg', '.mpeg', '.rmvb',
]);

function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function stateOf(torrent: QbTorrent): TaskState {
  const state = torrent.state.toLowerCase();
  if (state === 'error' || state === 'missingfiles') return 'FAILED';
  if (state.startsWith('paused') || state.startsWith('stopped')) {
    return state.endsWith('up') ? 'SEEDING' : 'PAUSED';
  }
  if (state.includes('up') || state === 'uploading' || state === 'stalledup') return 'SEEDING';
  if (state === 'metadl' || state === 'forcedmetadl') return 'DOWNLOADING';
  if (
    state.includes('dl') || state === 'downloading' || state === 'stalleddl' ||
    state === 'checkingdl' || state === 'queueddl' || state === 'allocating' ||
    state === 'checkingresumedata' || state === 'checkingfiles'
  ) {
    return 'DOWNLOADING';
  }
  return 'DOWNLOADING';
}

export class QbIndexer {
  private running = false;
  private lastError: string | null = null;

  constructor(
    private readonly tasks: TaskRepository,
    private readonly items: ItemRepository,
    private readonly sources: SourceRepository,
    private readonly rules: RuleRepository,
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

  async syncOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const client = this.client();
      const torrents = await client.torrents();
      if (this.lastError) {
        console.info('[qBittorrent] connection restored');
        this.lastError = null;
      }
      for (const torrent of torrents) {
        const tags = torrent.tags.split(',').map((tag) => tag.trim());
        if (!tags.includes('index')) continue;
        const taskTag = tags.find((tag) => tag.startsWith('index-'));
        if (!taskTag) continue;
        const task = this.tasks.findByQbTag(taskTag);
        if (!task) continue;

        if (task.infoHash !== torrent.hash) this.tasks.setInfoHash(task.id, torrent.hash);
        const nextState = stateOf(torrent);
        const completed = torrent.progress >= 0.999;
        if (!completed) {
          if (task.state !== nextState) this.tasks.updateState(task.id, nextState, null);
          continue;
        }

        const alreadyIndexed = task.state === 'COMPLETED';
        if (!alreadyIndexed) {
          await this.indexTorrent(client, task, torrent);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastError) {
        console.warn(`[qBittorrent] sync failed: ${message}`);
        this.lastError = message;
      }
    } finally {
      this.running = false;
    }
  }

  async reindexAll(): Promise<void> {
    for (const task of this.tasks.list()) {
      if (task.state === 'COMPLETED') {
        this.items.deleteByTask(task.id);
        this.tasks.updateState(task.id, 'SEEDING', null);
      }
    }
    await this.syncOnce();
  }

  private async indexTorrent(
    client: QbittorrentClient,
    task: DownloadTask,
    torrent: QbTorrent,
  ): Promise<void> {
    let files: QbTorrentFile[];
    try {
      files = await client.files(torrent.hash);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.tasks.updateState(task.id, 'FAILED', `读取文件列表失败：${message}`);
      return;
    }

    const source = this.sources.get(task.sourceId);
    if (!source) {
      this.tasks.updateState(task.id, 'FAILED', '片源已被删除');
      return;
    }
    const rules = this.rules.listBySource(source.id);
    const savePath = torrent.save_path || path.dirname(torrent.content_path || '');
    const indexedRelPaths: string[] = [];

    for (const file of files) {
      const relPath = file.name.replace(/\\/g, '/');
      if (!isVideoFile(relPath)) continue;
      if (file.progress < 0.999) continue;
      const matched = matchFirst(rules, relPath);
      if (!matched || !matched.rule.targetFolderId) continue;
      const folderId = matched.rule.targetFolderId;
      const title = matched.displayName;
      const absPath = path.resolve(savePath, relPath);
      this.items.upsert({
        folderId,
        taskId: task.id,
        itemKey: relPath,
        title,
        relPath,
        absPath,
        size: file.size,
      });
      indexedRelPaths.push(relPath);
    }

    this.items.deleteByTaskExcept(task.id, indexedRelPaths);
    this.tasks.updateState(task.id, 'COMPLETED', null, Date.now());
  }
}
