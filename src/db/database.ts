import { DatabaseSync } from 'node:sqlite';
import { SCHEMA, SOURCES_TABLE_SQL } from './schema.js';

const UNASSIGNED_FOLDER_ID = 'folder-unassigned';
const SCHEMA_VERSION = 1;

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as any;
  return Number(row?.user_version ?? 0);
}

function migrate(db: DatabaseSync): void {
  if (userVersion(db) >= SCHEMA_VERSION) return;

  rebuildSourcesWithoutTypeCheck(db);

  // The old build seeded a system folder for unmatched BT files. The new
  // model has no such folder: unmatched files are simply skipped.
  db.prepare(`DELETE FROM watch_history WHERE folder_id = ?`).run(UNASSIGNED_FOLDER_ID);
  db.prepare(`DELETE FROM folders WHERE id = ?`).run(UNASSIGNED_FOLDER_ID);

  // Deleting the folder sets rules.target_folder_id to NULL; those rules
  // cannot match anything anymore, so keep them visible but disabled.
  db.prepare(`UPDATE rules SET enabled = 0 WHERE target_folder_id IS NULL`).run();

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

function rebuildSourcesWithoutTypeCheck(db: DatabaseSync): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sources'`)
    .get() as any;
  const sql = String(row?.sql ?? '');
  if (!sql || !/CHECK\s*\(/i.test(sql)) return;

  const newTable = SOURCES_TABLE_SQL.replace(
    'CREATE TABLE IF NOT EXISTS sources',
    'CREATE TABLE sources_new',
  );
  const columns = [
    'id', 'name', 'base_url', 'type', 'enabled', 'torrent_link_regex',
    'last_error', 'last_fetched_at', 'created_at',
  ].join(', ');

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    db.exec(newTable);
    db.exec(
      `INSERT INTO sources_new (${columns}) SELECT ${columns} FROM sources;`,
    );
    db.exec('DROP TABLE sources;');
    db.exec('ALTER TABLE sources_new RENAME TO sources;');
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* ignore */ }
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all() as any[];
  if (violations.length > 0) {
    throw new Error(`sources migration left ${violations.length} foreign key violation(s)`);
  }
}
