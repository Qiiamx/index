import { createHash } from 'node:crypto';
import type { HttpClient } from '../util/http.js';
import type { SettingsService, SourceRepository, TaskRepository } from '../db/repositories.js';
import type { Source } from '../domain/models.js';
import { RssClient } from '../sources/rss.js';
import type { DownloadService } from './downloads.js';

export class RssService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly sources: SourceRepository,
    private readonly tasks: TaskRepository,
    private readonly settings: SettingsService,
    private readonly httpFactory: (proxyUrl: string) => HttpClient,
    private readonly downloads: DownloadService,
  ) {}

  start(): void {
    this.reschedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reschedule(): void {
    this.stop();
    const minutes = Math.max(1, this.settings.get().rssIntervalMinutes);
    this.timer = setInterval(() => {
      void this.pollAll();
    }, minutes * 60_000);
  }

  async pollAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const source of this.sources.list()) {
        if (source.type !== 'RSS' || !source.enabled) continue;
        await this.refreshSource(source);
      }
    } finally {
      this.running = false;
    }
  }

  async refreshSource(source: Source): Promise<{ created: number; error: string | null }> {
    const settings = this.settings.get();
    const http = this.httpFactory(settings.proxyUrl);
    const client = new RssClient(http);
    try {
      const items = await client.fetch(source.baseUrl, source.torrentLinkRegex);
      let created = 0;
      for (const item of items) {
        const itemKey = item.guid?.trim() ||
          createHash('sha1').update(item.torrentUrl).digest('hex');
        if (this.tasks.findBySourceItem(source.id, itemKey)) continue;
        const task = this.tasks.create({
          sourceId: source.id,
          itemKey,
          title: item.title,
          pageUrl: item.pageUrl,
          torrentUrl: item.torrentUrl,
        });
        created += 1;
        if (settings.autoDownload) {
          await this.downloads.startTask(task);
        }
      }
      this.sources.markResult(source.id, null, Date.now());
      return { created, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sources.markResult(source.id, message, Date.now());
      return { created: 0, error: message };
    }
  }

  async refreshSourceById(sourceId: string): Promise<{ created: number; error: string | null }> {
    const source = this.sources.get(sourceId);
    if (!source) return { created: 0, error: '片源不存在' };
    if (source.type !== 'RSS') return { created: 0, error: '不是 RSS 源' };
    return this.refreshSource(source);
  }
}
