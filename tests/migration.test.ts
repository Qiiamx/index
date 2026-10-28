import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'index-migration-'));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('database migration', () => {
  it('removes the old unassigned folder and allows local sources', () => {
    const file = path.join(tempRoot, 'old.db');
    const db = new DatabaseSync(file);
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE folders (
        id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('HTTP_DIRECTORY', 'RSS')),
        enabled INTEGER NOT NULL DEFAULT 1, torrent_link_regex TEXT,
        last_error TEXT, last_fetched_at INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE rules (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        target_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        order_no INTEGER NOT NULL DEFAULT 0, match_regex TEXT NOT NULL,
        display_name_regex TEXT, display_name_replacement TEXT,
        folder_regexes TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        item_key TEXT NOT NULL, title TEXT NOT NULL, page_url TEXT, torrent_url TEXT NOT NULL,
        info_hash TEXT, qb_tag TEXT NOT NULL, rule_ids TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT 'PENDING', error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
        UNIQUE (source_id, item_key)
      );
      CREATE TABLE items (
        id TEXT PRIMARY KEY, folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        item_key TEXT NOT NULL, title TEXT NOT NULL, rel_path TEXT NOT NULL,
        abs_path TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL,
        UNIQUE (task_id, rel_path)
      );
      CREATE TABLE watch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, folder_id TEXT NOT NULL,
        item_key TEXT NOT NULL, title TEXT NOT NULL, target TEXT NOT NULL, played_at INTEGER NOT NULL
      );
      INSERT INTO folders VALUES ('folder-unassigned', NULL, '未分类', 0, 0);
      INSERT INTO folders VALUES ('real-folder', NULL, '真实文件夹', 0, 0);
      INSERT INTO sources VALUES ('source-1', 'Demo', 'http://example.com/', 'HTTP_DIRECTORY', 1, NULL, NULL, NULL, 0);
      INSERT INTO rules VALUES ('rule-old', 'source-1', 'folder-unassigned', 0, '.*', NULL, NULL, '[]', 1, 0);
      INSERT INTO rules VALUES ('rule-real', 'source-1', 'real-folder', 0, '.*', NULL, NULL, '[]', 1, 0);
      INSERT INTO tasks VALUES ('task-1', 'source-1', 'item', 'Demo', NULL, 'magnet:?xt=urn:btih:abc', NULL, 'index-task', '[]', 'COMPLETED', NULL, 0, 0, 0);
      INSERT INTO items VALUES ('item-1', 'folder-unassigned', 'task-1', 'x', 'X', 'X.mkv', 'C:/x.mkv', 1, 0);
      INSERT INTO watch_history VALUES (1, 'folder-unassigned', 'x', 'X', 'C:/x.mkv', 0);
    `);
    db.close();

    const migrated = openDatabase(file);
    const folders = migrated.prepare('SELECT id FROM folders ORDER BY id').all() as any[];
    expect(folders.map((row) => row.id)).toEqual(['real-folder']);

    const rules = migrated.prepare(
      `SELECT id, target_folder_id, enabled FROM rules ORDER BY id`,
    ).all() as any[];
    expect(rules).toEqual([
      { id: 'rule-old', target_folder_id: null, enabled: 0 },
      { id: 'rule-real', target_folder_id: 'real-folder', enabled: 1 },
    ]);

    const items = migrated.prepare('SELECT id FROM items').all() as any[];
    expect(items).toHaveLength(0);
    const history = migrated.prepare('SELECT id FROM watch_history').all() as any[];
    expect(history).toHaveLength(0);

    migrated.prepare(
      `INSERT INTO sources (id, name, base_url, type, created_at)
       VALUES ('local-1', 'Local', 'D:/Anime', 'LOCAL_DIRECTORY', 0)`,
    ).run();
    const local = migrated.prepare(
      `SELECT type FROM sources WHERE id = 'local-1'`,
    ).get() as any;
    expect(local.type).toBe('LOCAL_DIRECTORY');
    expect((migrated.prepare('PRAGMA user_version').get() as any).user_version).toBe(1);
    expect(migrated.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    migrated.close();
  });
});
