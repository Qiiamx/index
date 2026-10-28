import fs from 'node:fs';
import path from 'node:path';
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './db/database.js';
import {
  FolderRepository,
  ItemRepository,
  RuleRepository,
  SettingsService,
  SourceRepository,
  TagRepository,
  TaskRepository,
  WatchHistoryRepository,
} from './db/repositories.js';
import { UNASSIGNED_FOLDER_ID, type Folder, type PlayableItem, type Rule, type Source } from './domain/models.js';
import { resolveRemote, validateRule } from './domain/rules.js';
import { HttpClient } from './util/http.js';
import { HttpDirectoryClient } from './sources/httpDirectory.js';
import { QbittorrentClient, type QbTorrent } from './qbittorrent/client.js';
import { QbIndexer } from './qbittorrent/indexer.js';
import { DownloadService } from './services/downloads.js';
import { RssService } from './services/rss.js';
import { PlayerService } from './playback/player.js';

interface AppContext {
  config: AppConfig;
  folders: FolderRepository;
  tags: TagRepository;
  sources: SourceRepository;
  rules: RuleRepository;
  tasks: TaskRepository;
  items: ItemRepository;
  history: WatchHistoryRepository;
  settings: SettingsService;
  downloads: DownloadService;
  rss: RssService;
  indexer: QbIndexer;
  player: PlayerService;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redirectWith(reply: FastifyReply, target: string, notice?: string, error?: string): void {
  const url = new URL(target, 'http://localhost');
  if (notice) url.searchParams.set('notice', notice);
  if (error) url.searchParams.set('error', error);
  reply.redirect(`${url.pathname}${url.search}`);
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatSize(bytesPerSecond)}/s`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400 * 7) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    PENDING: '未开始',
    ADDED: '已添加',
    DOWNLOADING: '下载中',
    SEEDING: '做种中',
    COMPLETED: '已完成',
    PAUSED: '已暂停',
    FAILED: '失败',
  };
  return labels[state] ?? state;
}

function qbStateLabel(state: string): string {
  const key = state.toLowerCase();
  if (key.includes('error') || key === 'missingfiles') return '错误';
  if (key.startsWith('paused') || key.startsWith('stopped')) {
    return key.endsWith('up') ? '已停止（做种）' : '已停止';
  }
  if (key.includes('up')) return '做种中';
  if (key === 'metadl' || key === 'forcedmetadl') return '获取种子信息';
  if (key.includes('dl') || key === 'downloading' || key === 'allocating') return '下载中';
  if (key.includes('checking')) return '校验中';
  return state;
}

function flattenFolders(folders: Folder[]): Array<{ folder: Folder; depth: number }> {
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const key = folder.parentId;
    const list = children.get(key) ?? [];
    list.push(folder);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const output: Array<{ folder: Folder; depth: number }> = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const folder of children.get(parentId) ?? []) {
      output.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return output;
}

function breadcrumb(folders: Folder[], folder: Folder): Folder[] {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const chain: Folder[] = [];
  let current: Folder | undefined = folder;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const folders = new FolderRepository(db);
  const tags = new TagRepository(db);
  const sources = new SourceRepository(db);
  const rules = new RuleRepository(db);
  const tasks = new TaskRepository(db);
  const items = new ItemRepository(db);
  const history = new WatchHistoryRepository(db);
  const settings = new SettingsService(db);
  const downloads = new DownloadService(tasks, items, settings);
  const indexer = new QbIndexer(tasks, items, sources, rules, settings);
  const rss = new RssService(
    sources,
    tasks,
    settings,
    (proxyUrl) => new HttpClient(proxyUrl),
    downloads,
  );
  const player = new PlayerService(settings, history);

  const ctx: AppContext = {
    config, folders, tags, sources, rules, tasks, items, history, settings,
    downloads, rss, indexer, player,
  };

  const app = Fastify({
    logger: { level: 'info' },
    logController: new LogController({ disableRequestLogging: true }),
  });
  await app.register(formbody);
  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/assets/',
  });
  await app.register(fastifyView, {
    engine: { ejs },
    root: config.viewsDir,
    viewExt: 'ejs',
  });

  const htmxScript = fs.existsSync(config.htmxPath)
    ? fs.readFileSync(config.htmxPath, 'utf8')
    : '// htmx not installed';
  app.get('/vendor/htmx.js', async (_request, reply) => {
    reply.type('text/javascript').send(htmxScript);
  });

  const allowedOrigins = new Set([
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
  ]);
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST') return;
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      await reply.code(403).send('Forbidden origin');
      return;
    }
  });

  const baseLocals = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: 'Index',
    active: '',
    notice: null,
    error: null,
    folders: folders.list(),
    flatFolders: flattenFolders(folders.list()),
    tags: tags.list(),
    ...extra,
  });

  const folderPageData = async (folder: Folder): Promise<Record<string, unknown>> => {
    const allFolders = folders.list();
    const btItems = items.listByFolder(folder.id);
    const httpItems: PlayableItem[] = [];
    const httpErrors: string[] = [];
    const settingsValue = settings.get();
    const http = new HttpClient(settingsValue.proxyUrl);
    const browser = new HttpDirectoryClient(http);
    const cache = new Map<string, import('./domain/models.js').RemoteEntry[]>();
    for (const source of sources.list()) {
      if (source.type !== 'HTTP_DIRECTORY' || !source.enabled) continue;
      const sourceRules = rules.listBySource(source.id)
        .filter((rule) => rule.enabled && rule.targetFolderId === folder.id);
      for (const rule of sourceRules) {
        try {
          httpItems.push(...await resolveRemote(rule, source, browser, source.baseUrl, cache));
        } catch (error) {
          httpErrors.push(`${source.name}: ${messageOf(error)}`);
        }
      }
    }
    const seen = new Set<string>();
    const merged = [...httpItems.filter((item) => {
      if (seen.has(item.target)) return false;
      seen.add(item.target);
      return true;
    })];
    return baseLocals({
      title: folder.name,
      active: 'library',
      folder,
      breadcrumb: breadcrumb(allFolders, folder),
      btItems,
      httpItems: merged,
      httpErrors,
      folderTags: folders.tagsFor(folder.id),
      last: history.latestByFolder(folder.id),
      childFolders: allFolders.filter((item) => item.parentId === folder.id),
      stateLabel,
      formatSize,
      formatSpeed,
      formatEta,
      qbStateLabel,
    });
  };

  app.get('/', async (_request, reply) => reply.redirect('/library'));

  app.get('/library', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const tagFilter = asString(query.tag);
    const allFolders = folders.list();
    const counts = items.countByFolder();
    const folderTags = new Map(allFolders.map((folder) => [folder.id, folders.tagsFor(folder.id)]));
    const flat = flattenFolders(allFolders).filter(({ folder }) =>
      !tagFilter || (folderTags.get(folder.id) ?? []).some((tag) => tag.id === tagFilter),
    );
    return reply.view('library', baseLocals({
      title: '追番',
      active: 'library',
      flatFolders: flat,
      counts,
      folderTags,
      selectedTag: tagFilter || null,
      last: history.latestGlobal(),
      notice: asString(query.notice) || null,
      error: asString(query.error) || null,
      formatSize,
    }));
  });

  app.get('/folders/new', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    return reply.view('folder-form', baseLocals({
      title: '新建文件夹',
      active: 'library',
      mode: 'create',
      folder: null,
      selectedTagIds: [],
      parentId: asString(query.parent),
    }));
  });

  app.post('/folders', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const name = asString(body.name).trim();
    if (!name) {
      return reply.view('folder-form', baseLocals({
        title: '新建文件夹', active: 'library', mode: 'create', folder: null,
        selectedTagIds: asArray(body.tags), error: '文件夹名称不能为空',
      }));
    }
    try {
      const created = folders.create({
        name,
        parentId: asString(body.parentId) || null,
        sort: Number(body.sort) || 0,
      });
      folders.setTags(created.id, asArray(body.tags));
      return redirectWith(reply, `/folders/${created.id}`, '文件夹已创建');
    } catch (error) {
      return reply.view('folder-form', baseLocals({
        title: '新建文件夹', active: 'library', mode: 'create', folder: null,
        selectedTagIds: asArray(body.tags), error: messageOf(error),
      }));
    }
  });

  app.get('/folders/:id/edit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const folder = folders.get(id);
    if (!folder) return reply.code(404).send('文件夹不存在');
    return reply.view('folder-form', baseLocals({
      title: `编辑 ${folder.name}`,
      active: 'library',
      mode: 'edit',
      folder,
      selectedTagIds: folders.tagsFor(folder.id).map((tag) => tag.id),
    }));
  });

  app.post('/folders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const folder = folders.get(id);
    if (!folder) return reply.code(404).send('文件夹不存在');
    const body = request.body as Record<string, unknown>;
    const name = asString(body.name).trim();
    if (!name) {
      return reply.view('folder-form', baseLocals({
        title: `编辑 ${folder.name}`, active: 'library', mode: 'edit', folder,
        selectedTagIds: asArray(body.tags), error: '文件夹名称不能为空',
      }));
    }
    try {
      folders.update(id, {
        name,
        parentId: asString(body.parentId) || null,
        sort: Number(body.sort) || 0,
      });
      folders.setTags(id, asArray(body.tags));
      return redirectWith(reply, `/folders/${id}`, '文件夹已保存');
    } catch (error) {
      return reply.view('folder-form', baseLocals({
        title: `编辑 ${folder.name}`, active: 'library', mode: 'edit', folder,
        selectedTagIds: asArray(body.tags), error: messageOf(error),
      }));
    }
  });

  app.post('/folders/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === UNASSIGNED_FOLDER_ID) {
      return redirectWith(reply, '/library', undefined, '未分类文件夹不能删除');
    }
    folders.delete(id);
    return redirectWith(reply, '/library', '文件夹已删除（本地文件不会删除）');
  });

  app.get('/folders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const folder = folders.get(id);
    if (!folder) return reply.code(404).send('文件夹不存在');
    const query = request.query as Record<string, unknown>;
    const data = await folderPageData(folder);
    return reply.view('folder', {
      ...data,
      notice: asString(query.notice) || null,
      error: asString(query.error) || null,
    });
  });

  app.get('/sources', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const taskList = tasks.list();
    const pendingBySource = new Map<string, number>();
    for (const task of taskList) {
      if (task.state === 'PENDING') {
        pendingBySource.set(task.sourceId, (pendingBySource.get(task.sourceId) ?? 0) + 1);
      }
    }
    return reply.view('sources', baseLocals({
      title: '片源',
      active: 'sources',
      sources: sources.list(),
      pendingBySource,
      notice: asString(query.notice) || null,
      error: asString(query.error) || null,
    }));
  });

  app.get('/sources/new', async (request, reply) => {
    return reply.view('source-form', baseLocals({
      title: '新建片源',
      active: 'sources',
      mode: 'create',
      source: null,
      presetType: asString((request.query as Record<string, unknown>).type) || 'HTTP_DIRECTORY',
    }));
  });

  app.post('/sources', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const name = asString(body.name).trim();
    const baseUrl = asString(body.baseUrl).trim();
    const type = asString(body.type) === 'RSS' ? 'RSS' : 'HTTP_DIRECTORY';
    if (!name || !baseUrl) {
      return reply.view('source-form', baseLocals({
        title: '新建片源', active: 'sources', mode: 'create', source: null,
        presetType: type, error: '名称和地址不能为空',
      }));
    }
    try {
      const created = sources.create({
        name,
        baseUrl,
        type,
        torrentLinkRegex: asString(body.torrentLinkRegex).trim() || null,
      });
      return redirectWith(reply, `/sources/${created.id}/rules`, '片源已创建，接下来添加规则');
    } catch (error) {
      return reply.view('source-form', baseLocals({
        title: '新建片源', active: 'sources', mode: 'create', source: null,
        presetType: type, error: messageOf(error),
      }));
    }
  });

  app.get('/sources/:id/edit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = sources.get(id);
    if (!source) return reply.code(404).send('片源不存在');
    return reply.view('source-form', baseLocals({
      title: `编辑 ${source.name}`,
      active: 'sources',
      mode: 'edit',
      source,
    }));
  });

  app.post('/sources/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = sources.get(id);
    if (!source) return reply.code(404).send('片源不存在');
    const body = request.body as Record<string, unknown>;
    const name = asString(body.name).trim();
    const baseUrl = asString(body.baseUrl).trim();
    if (!name || !baseUrl) {
      return reply.view('source-form', baseLocals({
        title: `编辑 ${source.name}`, active: 'sources', mode: 'edit', source,
        error: '名称和地址不能为空',
      }));
    }
    sources.update(id, {
      name,
      baseUrl,
      torrentLinkRegex: asString(body.torrentLinkRegex).trim() || null,
      enabled: body.enabled === 'on' || body.enabled === 'true' || body.enabled === '1',
    });
    return redirectWith(reply, '/sources', '片源已保存');
  });

  app.post('/sources/:id/toggle', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = sources.get(id);
    if (!source) return reply.code(404).send('片源不存在');
    sources.setEnabled(id, !source.enabled);
    return redirectWith(reply, '/sources', source.enabled ? '片源已停用' : '片源已启用');
  });

  app.post('/sources/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    sources.delete(id);
    return redirectWith(reply, '/sources', '片源已删除（本地文件不会删除）');
  });

  app.post('/sources/:id/refresh', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = sources.get(id);
    if (!source) return reply.code(404).send('片源不存在');
    if (source.type !== 'RSS') {
      return redirectWith(reply, `/sources/${id}/rules`, undefined, 'HTTP 目录源不需要轮询');
    }
    const result = await rss.refreshSourceById(id);
    return redirectWith(
      reply,
      '/sources',
      result.error ? undefined : `刷新完成，新增 ${result.created} 个任务`,
      result.error ?? undefined,
    );
  });

  app.get('/sources/:id/rules', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = sources.get(id);
    if (!source) return reply.code(404).send('片源不存在');
    const query = request.query as Record<string, unknown>;
    return reply.view('rules', baseLocals({
      title: `${source.name} · 规则`,
      active: 'sources',
      source,
      rules: rules.listBySource(id),
      notice: asString(query.notice) || null,
      error: asString(query.error) || null,
    }));
  });

  app.get('/sources/:id/rules/new', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = sources.get(id);
    if (!source) return reply.code(404).send('片源不存在');
    return reply.view('rule-form', baseLocals({
      title: `新建规则 · ${source.name}`,
      active: 'sources',
      mode: 'create',
      source,
      rule: null,
    }));
  });

  app.post('/sources/:id/rules', async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = sources.get(id);
    if (!source) return reply.code(404).send('片源不存在');
    const body = request.body as Record<string, unknown>;
    const folderRegexes = asString(body.folderRegexes)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const matchRegex = asString(body.matchRegex).trim();
    const displayNameRegex = asString(body.displayNameRegex).trim() || null;
    const validation = validateRule({ matchRegex, displayNameRegex, folderRegexes });
    if (validation) {
      return reply.view('rule-form', baseLocals({
        title: `新建规则 · ${source.name}`, active: 'sources', mode: 'create',
        source, rule: null, error: validation,
      }));
    }
    rules.create({
      sourceId: id,
      targetFolderId: asString(body.targetFolderId) || null,
      orderNo: Number(body.orderNo) || 0,
      matchRegex,
      displayNameRegex,
      displayNameReplacement: asString(body.displayNameReplacement).trim() || null,
      folderRegexes,
      enabled: body.enabled === 'on' || body.enabled === 'true' || body.enabled === '1',
    });
    return redirectWith(reply, `/sources/${id}/rules`, '规则已创建');
  });

  app.get('/rules/:id/edit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = rules.get(id);
    if (!rule) return reply.code(404).send('规则不存在');
    const source = sources.get(rule.sourceId);
    if (!source) return reply.code(404).send('片源不存在');
    return reply.view('rule-form', baseLocals({
      title: `编辑规则 · ${source.name}`,
      active: 'sources',
      mode: 'edit',
      source,
      rule,
    }));
  });

  app.post('/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = rules.get(id);
    if (!rule) return reply.code(404).send('规则不存在');
    const source = sources.get(rule.sourceId);
    if (!source) return reply.code(404).send('片源不存在');
    const body = request.body as Record<string, unknown>;
    const folderRegexes = asString(body.folderRegexes)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const matchRegex = asString(body.matchRegex).trim();
    const displayNameRegex = asString(body.displayNameRegex).trim() || null;
    const validation = validateRule({ matchRegex, displayNameRegex, folderRegexes });
    if (validation) {
      return reply.view('rule-form', baseLocals({
        title: `编辑规则 · ${source.name}`, active: 'sources', mode: 'edit',
        source, rule, error: validation,
      }));
    }
    rules.update(id, {
      targetFolderId: asString(body.targetFolderId) || null,
      orderNo: Number(body.orderNo) || 0,
      matchRegex,
      displayNameRegex,
      displayNameReplacement: asString(body.displayNameReplacement).trim() || null,
      folderRegexes,
      enabled: body.enabled === 'on' || body.enabled === 'true' || body.enabled === '1',
    });
    return redirectWith(reply, `/sources/${source.id}/rules`, '规则已保存');
  });

  app.post('/rules/:id/toggle', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = rules.get(id);
    if (!rule) return reply.code(404).send('规则不存在');
    rules.setEnabled(id, !rule.enabled);
    return redirectWith(reply, `/sources/${rule.sourceId}/rules`, rule.enabled ? '规则已停用' : '规则已启用');
  });

  app.post('/rules/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rule = rules.get(id);
    if (!rule) return reply.code(404).send('规则不存在');
    rules.delete(id);
    return redirectWith(reply, `/sources/${rule.sourceId}/rules`, '规则已删除');
  });

  app.get('/tags', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    return reply.view('tags', baseLocals({
      title: '标签',
      active: 'library',
      notice: asString(query.notice) || null,
      error: asString(query.error) || null,
    }));
  });

  app.post('/tags', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const name = asString(body.name).trim();
    if (!name) return redirectWith(reply, '/tags', undefined, '标签名称不能为空');
    tags.create(name, asString(body.groupName));
    return redirectWith(reply, '/tags', '标签已创建');
  });

  app.post('/tags/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const name = asString(body.name).trim();
    if (!name) return redirectWith(reply, '/tags', undefined, '标签名称不能为空');
    tags.update(id, name, asString(body.groupName));
    return redirectWith(reply, '/tags', '标签已保存');
  });

  app.post('/tags/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    tags.delete(id);
    return redirectWith(reply, '/tags', '标签已删除');
  });

  const qbStatus = async (): Promise<{
    apiVersion: string | null;
    torrents: QbTorrent[];
    error: string | null;
  }> => {
    const settingsValue = settings.get();
    if (!settingsValue.qbUrl.trim()) {
      return { apiVersion: null, torrents: [], error: '尚未配置 qBittorrent 地址' };
    }
    const client = new QbittorrentClient({
      url: settingsValue.qbUrl,
      username: settingsValue.qbUsername,
      password: settingsValue.qbPassword,
    });
    try {
      const apiVersion = await client.webApiVersion();
      const torrents = (await client.torrents())
        .filter((torrent) => torrent.tags.split(',').map((tag) => tag.trim()).includes('index'));
      return { apiVersion, torrents, error: null };
    } catch (error) {
      return { apiVersion: null, torrents: [], error: messageOf(error) };
    }
  };

  const downloadData = async (request: FastifyRequest): Promise<Record<string, unknown>> => {
    const query = request.query as Record<string, unknown>;
    const status = await qbStatus();
    const taskList = tasks.list();
    return baseLocals({
      title: '下载',
      active: 'downloads',
      pending: taskList.filter((task) => task.state === 'PENDING' || task.state === 'FAILED'),
      taskList,
      apiVersion: status.apiVersion,
      torrents: status.torrents,
      qbError: status.error,
      notice: asString(query.notice) || null,
      error: asString(query.error) || null,
      stateLabel,
      qbStateLabel,
      formatSize,
      formatSpeed,
      formatEta,
    });
  };

  app.get('/downloads', async (request, reply) => {
    return reply.view('downloads', await downloadData(request));
  });

  app.get('/downloads/table', async (request, reply) => {
    const data = await downloadData(request);
    return reply.view('downloads-table', data);
  });

  app.post('/downloads/start-pending', async (_request, reply) => {
    const result = await downloads.startPending();
    return redirectWith(
      reply,
      '/downloads',
      `已提交 ${result.started} 个任务${result.failed ? `，失败 ${result.failed} 个` : ''}`,
    );
  });

  app.post('/downloads/reindex', async (_request, reply) => {
    await indexer.reindexAll();
    return redirectWith(reply, '/downloads', '已重新索引');
  });

  app.post('/downloads/torrents/:hash/stop', async (request, reply) => {
    const { hash } = request.params as { hash: string };
    try {
      await downloads.stop(hash);
      return redirectWith(reply, '/downloads', '任务已停止');
    } catch (error) {
      return redirectWith(reply, '/downloads', undefined, messageOf(error));
    }
  });

  app.post('/downloads/torrents/:hash/start', async (request, reply) => {
    const { hash } = request.params as { hash: string };
    try {
      await downloads.start(hash);
      return redirectWith(reply, '/downloads', '任务已开始');
    } catch (error) {
      return redirectWith(reply, '/downloads', undefined, messageOf(error));
    }
  });

  app.post('/downloads/torrents/:hash/delete', async (request, reply) => {
    const { hash } = request.params as { hash: string };
    const body = request.body as Record<string, unknown>;
    try {
      await downloads.deleteTorrent(hash, body.deleteFiles === 'on');
      return redirectWith(reply, '/downloads', '任务已删除');
    } catch (error) {
      return redirectWith(reply, '/downloads', undefined, messageOf(error));
    }
  });

  app.post('/downloads/tasks/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await downloads.retryTask(id);
    return redirectWith(reply, '/downloads', result.ok ? '已提交' : undefined, result.error);
  });

  app.post('/downloads/tasks/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    try {
      await downloads.deleteTask(id, body.deleteFiles === 'on');
      return redirectWith(reply, '/downloads', '任务已删除');
    } catch (error) {
      return redirectWith(reply, '/downloads', undefined, messageOf(error));
    }
  });

  app.get('/settings', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    return reply.view('settings', baseLocals({
      title: '设置',
      active: 'settings',
      settings: settings.get(),
      notice: asString(query.notice) || null,
      error: asString(query.error) || null,
    }));
  });

  app.post('/settings', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const proxyUrl = asString(body.proxyUrl).trim();
    if (proxyUrl && !/^https?:\/\//i.test(proxyUrl)) {
      return redirectWith(reply, '/settings', undefined, '抓取代理只支持 http:// 或 https:// 地址');
    }
    settings.update({
      qbUrl: asString(body.qbUrl).trim() || 'http://127.0.0.1:8080',
      qbUsername: asString(body.qbUsername).trim(),
      qbPassword: asString(body.qbPassword),
      qbCategory: asString(body.qbCategory).trim(),
      playerPath: asString(body.playerPath).trim(),
      playerArgs: asString(body.playerArgs).trim() || '{file}',
      proxyUrl,
      rssIntervalMinutes: Number(body.rssIntervalMinutes) || 60,
      autoDownload: body.autoDownload === 'on' || body.autoDownload === 'true',
    });
    rss.reschedule();
    return redirectWith(reply, '/settings', '设置已保存');
  });

  app.post('/settings/test', async (_request, reply) => {
    try {
      const settingsValue = settings.get();
      const client = new QbittorrentClient({
        url: settingsValue.qbUrl,
        username: settingsValue.qbUsername,
        password: settingsValue.qbPassword,
      });
      const result = await client.testConnection();
      return redirectWith(reply, '/settings', `qBittorrent 连接成功，API ${result.apiVersion}，共 ${result.torrents} 个任务`);
    } catch (error) {
      return redirectWith(reply, '/settings', undefined, `qBittorrent 连接失败：${messageOf(error)}`);
    }
  });

  app.post('/play', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const folderId = asString(body.folderId);
    const target = asString(body.target);
    const title = asString(body.title) || '未知条目';
    const itemKey = asString(body.itemKey) || target;
    let returnTo = asString(body.returnTo) || '/library';
    if (!returnTo.startsWith('/') || returnTo.startsWith('//')) returnTo = '/library';
    try {
      player.launch({ folderId, itemKey, title, target });
      return redirectWith(reply, returnTo, `已打开：${title}`);
    } catch (error) {
      return redirectWith(reply, returnTo, undefined, messageOf(error));
    }
  });

  app.get('/api/health', async () => ({ ok: true, version: '0.2.0' }));

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (reply.sent) return;
    reply.code(500).type('text/plain').send(`服务器错误：${messageOf(error)}`);
  });

  rss.start();
  setInterval(() => {
    void indexer.syncOnce();
  }, 5000).unref();

  app.addHook('onClose', async () => {
    rss.stop();
    db.close();
  });

  return app;
}
