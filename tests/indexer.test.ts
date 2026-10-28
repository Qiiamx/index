import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import {
  FolderRepository,
  ItemRepository,
  RuleRepository,
  SettingsService,
  SourceRepository,
  TaskRepository,
} from '../src/db/repositories.js';
import { QbIndexer } from '../src/qbittorrent/indexer.js';

let server: http.Server;
let baseUrl = '';
let tempRoot = '';
let dbFile = '';
let taskTag = '';

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'index-test-'));
  dbFile = path.join(tempRoot, 'index.db');
  const db = openDatabase(dbFile);
  const folders = new FolderRepository(db);
  const sources = new SourceRepository(db);
  const rules = new RuleRepository(db);
  const tasks = new TaskRepository(db);
  const settings = new SettingsService(db);

  const folder = folders.create({ name: '测试番剧', parentId: null, sort: 0 });
  const source = sources.create({
    name: '测试 RSS',
    baseUrl: 'http://example.com/feed.xml',
    type: 'RSS',
    torrentLinkRegex: null,
  });
  rules.create({
    sourceId: source.id,
    targetFolderId: folder.id,
    orderNo: 0,
    matchRegex: 'S01E01\\.mkv$',
    displayNameRegex: '^(.*)\\.mkv$',
    displayNameReplacement: '第1集',
    folderRegexes: ['^Season 1$'],
    enabled: true,
  });
  const task = tasks.create({
    sourceId: source.id,
    itemKey: 'item-1',
    title: 'Demo S01E01',
    pageUrl: null,
    torrentUrl: 'magnet:?xt=urn:btih:abc',
  });
  taskTag = task.qbTag;
  db.close();

  server = http.createServer((request, response) => {
    const url = request.url ?? '';
    if (url.startsWith('/api/v2/app/webapiVersion')) {
      response.end('2.16.2');
      return;
    }
    if (url.startsWith('/api/v2/torrents/info')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{
        hash: 'abc', name: 'Demo', progress: 1, state: 'uploading',
        save_path: tempRoot, content_path: path.join(tempRoot, 'Demo'),
        size: 123, total_size: 123, completed: 123, dlspeed: 0, upspeed: 0,
        eta: 0, num_seeds: 0, num_leechs: 0, category: '', tags: `index,${taskTag}`,
        ratio: 0, seeding_time: 0, added_on: 0, completion_on: 0, amount_left: 0,
      }]));
      return;
    }
    if (url.startsWith('/api/v2/torrents/files')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([
        { name: 'Season 1/Show.S01E01.mkv', size: 123, progress: 1, priority: 1, is_seed: true },
        { name: 'Season 1/readme.txt', size: 10, progress: 1, priority: 1, is_seed: true },
      ]));
      return;
    }
    response.end('');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;

  const db2 = openDatabase(dbFile);
  new SettingsService(db2).update({ qbUrl: baseUrl, qbUsername: '', qbPassword: '' });
  db2.close();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('qBittorrent indexer', () => {
  it('indexes completed video files into the matched folder', async () => {
    const db = openDatabase(dbFile);
    const indexer = new QbIndexer(
      new TaskRepository(db),
      new ItemRepository(db),
      new SourceRepository(db),
      new RuleRepository(db),
      new SettingsService(db),
    );
    await indexer.syncOnce();

    const tasks = new TaskRepository(db);
    const task = tasks.findByQbTag(taskTag);
    expect(task?.state).toBe('COMPLETED');
    expect(task?.infoHash).toBe('abc');

    const items = new ItemRepository(db).listByFolder(
      new FolderRepository(db).list().find((folder) => folder.name === '测试番剧')!.id,
    );
    expect(items).toHaveLength(1);
    expect(items[0].relPath).toBe('Season 1/Show.S01E01.mkv');
    expect(items[0].title).toBe('第1集');
    expect(items[0].absPath).toBe(path.join(tempRoot, 'Season 1/Show.S01E01.mkv'));
    db.close();
  });
});
