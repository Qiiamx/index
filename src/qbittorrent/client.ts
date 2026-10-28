export interface QbTorrent {
  hash: string;
  name: string;
  progress: number;
  state: string;
  save_path: string;
  content_path: string;
  size: number;
  total_size: number;
  completed: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  num_seeds: number;
  num_leechs: number;
  category: string;
  tags: string;
  ratio: number;
  seeding_time: number;
  added_on: number;
  completion_on: number;
  amount_left: number;
}

export interface QbTorrentFile {
  name: string;
  size: number;
  progress: number;
  priority: number;
  is_seed: boolean;
}

export interface QbConnection {
  url: string;
  username: string;
  password: string;
}

function compareVersion(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class QbittorrentClient {
  private readonly baseUrl: string;
  private cookie = '';
  private webApiVersionCache: string | null = null;

  constructor(private readonly connection: QbConnection) {
    this.baseUrl = connection.url.replace(/\/+$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...extra,
    };
  }

  private async raw(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init.headers as Record<string, string> | undefined),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 403 && !retried) {
      await this.login();
      return this.raw(path, init, true);
    }
    return response;
  }

  async login(): Promise<void> {
    const form = new FormData();
    form.set('username', this.connection.username);
    form.set('password', this.connection.password);
    const response = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      body: form,
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    const text = (await response.text()).trim();
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    if (cookies.length > 0) {
      this.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    }
    if (text !== 'Ok.' && cookies.length === 0) {
      throw new Error('qBittorrent 登录失败：检查设置里的用户名/密码，或在 Web UI 里允许 localhost 免登录');
    }
  }

  async webApiVersion(): Promise<string> {
    if (this.webApiVersionCache) return this.webApiVersionCache;
    const response = await this.raw('/api/v2/app/webapiVersion');
    if (!response.ok) {
      throw new Error(`qBittorrent Web API 不可用（HTTP ${response.status}）`);
    }
    this.webApiVersionCache = (await response.text()).trim();
    return this.webApiVersionCache;
  }

  private async usesStartStop(): Promise<boolean> {
    try {
      return compareVersion(await this.webApiVersion(), '2.11.0') >= 0;
    } catch {
      return true;
    }
  }

  async torrents(tag?: string): Promise<QbTorrent[]> {
    const query = tag ? `?tag=${encodeURIComponent(tag)}` : '';
    const response = await this.raw(`/api/v2/torrents/info${query}`);
    if (!response.ok) throw new Error(`qBittorrent 获取任务失败（HTTP ${response.status}）`);
    return (await response.json()) as QbTorrent[];
  }

  async files(hash: string): Promise<QbTorrentFile[]> {
    const response = await this.raw(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`);
    if (!response.ok) throw new Error(`qBittorrent 获取文件列表失败（HTTP ${response.status}）`);
    return (await response.json()) as QbTorrentFile[];
  }

  async addTorrent(input: {
    urls: string;
    tags: string;
    category?: string;
  }): Promise<void> {
    const form = new FormData();
    form.set('urls', input.urls);
    form.set('autoTMM', 'true');
    form.set('tags', input.tags);
    if (input.category) form.set('category', input.category);

    const response = await this.raw('/api/v2/torrents/add', { method: 'POST', body: form });
    const text = (await response.text()).trim();
    if (response.status === 409 || /fails/i.test(text)) {
      throw new Error('qBittorrent 拒绝添加：任务可能已存在');
    }
    if (!response.ok && response.status !== 200) {
      throw new Error(`qBittorrent 添加失败（HTTP ${response.status}）`);
    }
    if (text && !/^ok\.?$/i.test(text) && !text.startsWith('{') && !text.startsWith('[')) {
      throw new Error(`qBittorrent 添加失败：${text}`);
    }
  }

  async stop(hashes: string): Promise<void> {
    const action = (await this.usesStartStop()) ? 'stop' : 'pause';
    const form = new FormData();
    form.set('hashes', hashes);
    const response = await this.raw(`/api/v2/torrents/${action}`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`qBittorrent 停止任务失败（HTTP ${response.status}）`);
  }

  async start(hashes: string): Promise<void> {
    const action = (await this.usesStartStop()) ? 'start' : 'resume';
    const form = new FormData();
    form.set('hashes', hashes);
    const response = await this.raw(`/api/v2/torrents/${action}`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`qBittorrent 开始任务失败（HTTP ${response.status}）`);
  }

  async deleteTorrents(hashes: string, deleteFiles: boolean): Promise<void> {
    const form = new FormData();
    form.set('hashes', hashes);
    form.set('deleteFiles', deleteFiles ? 'true' : 'false');
    const response = await this.raw('/api/v2/torrents/delete', { method: 'POST', body: form });
    if (!response.ok) throw new Error(`qBittorrent 删除任务失败（HTTP ${response.status}）`);
  }

  async categories(): Promise<Record<string, { name: string; savePath: string }>> {
    const response = await this.raw('/api/v2/torrents/categories');
    if (!response.ok) return {};
    return (await response.json()) as Record<string, { name: string; savePath: string }>;
  }

  async preferences(): Promise<Record<string, unknown>> {
    const response = await this.raw('/api/v2/app/preferences');
    if (!response.ok) return {};
    return (await response.json()) as Record<string, unknown>;
  }

  async ensureCategory(name: string): Promise<boolean> {
    if (!name.trim()) return false;
    const categories = await this.categories();
    if (categories[name]) return true;
    const preferences = await this.preferences();
    const form = new FormData();
    form.set('category', name);
    form.set('savePath', String(preferences.save_path ?? ''));
    const response = await this.raw('/api/v2/torrents/createCategory', {
      method: 'POST',
      body: form,
    });
    return response.ok || response.status === 409;
  }

  async testConnection(): Promise<{ version: string; apiVersion: string; torrents: number }> {
    const apiVersion = await this.webApiVersion();
    const torrents = await this.torrents();
    return { version: 'qBittorrent', apiVersion, torrents: torrents.length };
  }
}
