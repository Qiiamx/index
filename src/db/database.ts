import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';
import { UNASSIGNED_FOLDER_ID, UNASSIGNED_FOLDER_NAME } from '../domain/models.js';

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db: DatabaseSync): void {
  db.prepare(
    `INSERT OR IGNORE INTO folders (id, parent_id, name, sort, created_at)
     VALUES (?, NULL, ?, 0, ?)`,
  ).run(UNASSIGNED_FOLDER_ID, UNASSIGNED_FOLDER_NAME, Date.now());
}
