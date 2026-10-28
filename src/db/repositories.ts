import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  type AppSettings,
  type DownloadTask,
  type Folder,
  type LibraryItem,
  type Rule,
  type Source,
  type SourceType,
  type Tag,
  type TaskState,
  type WatchEntry,
} from '../domain/models.js';

const now = () => Date.now();

function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

function cleanFolderName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('文件夹名称不能为空');
  if (/[\\/]/.test(name) || name === '.' || name === '..') {
    throw new Error('文件夹名称不能包含斜杠或 ..');
  }
  return name;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((it): it is string => typeof it === 'string') : [];
  } catch {
    return [];
  }
}

export class FolderRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Folder[] {
    return this.db
      .prepare(`SELECT id, parent_id, name, sort, created_at FROM folders ORDER BY sort, name`)
      .all()
      .map((row: any) => ({
        id: String(row.id),
        parentId: row.parent_id == null ? null : String(row.parent_id),
        name: String(row.name),
        sort: Number(row.sort),
        createdAt: Number(row.created_at),
      }));
  }

  get(id: string): Folder | null {
    const row = this.db
      .prepare(`SELECT id, parent_id, name, sort, created_at FROM folders WHERE id = ?`)
      .get(id) as any;
    if (!row) return null;
    return {
      id: String(row.id),
      parentId: row.parent_id == null ? null : String(row.parent_id),
      name: String(row.name),
      sort: Number(row.sort),
      createdAt: Number(row.created_at),
    };
  }

  create(input: { name: string; parentId: string | null; sort: number }): Folder {
    const name = cleanFolderName(input.name);
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO folders (id, parent_id, name, sort, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, input.parentId, name, input.sort, now());
    return this.get(id)!;
  }

  update(id: string, input: { name: string; parentId: string | null; sort: number }): void {
    if (input.parentId === id || (input.parentId && this.isDescendant(input.parentId, id))) {
      throw new Error('不能把文件夹移动到它自己或子文件夹下面');
    }
    this.db
      .prepare(`UPDATE folders SET parent_id = ?, name = ?, sort = ? WHERE id = ?`)
      .run(input.parentId, cleanFolderName(input.name), input.sort, id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM folders WHERE id = ?`).run(id);
  }

  descendants(id: string): string[] {
    const folders = this.list();
    const children = new Map<string, string[]>();
    for (const folder of folders) {
      if (!folder.parentId) continue;
      const list = children.get(folder.parentId) ?? [];
      list.push(folder.id);
      children.set(folder.parentId, list);
    }
    const output: string[] = [];
    const queue = [id];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      output.push(current);
      for (const child of children.get(current) ?? []) queue.push(child);
    }
    return output;
  }

  tagsFor(folderId: string): Tag[] {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.group_name FROM tags t
         JOIN folder_tags ft ON ft.tag_id = t.id
         WHERE ft.folder_id = ?
         ORDER BY t.group_name, t.name`,
      )
      .all(folderId)
      .map((row: any) => ({
        id: String(row.id),
        name: String(row.name),
        groupName: String(row.group_name ?? ''),
      }));
  }

  setTags(folderId: string, tagIds: string[]): void {
    this.db.prepare(`DELETE FROM folder_tags WHERE folder_id = ?`).run(folderId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO folder_tags (folder_id, tag_id) VALUES (?, ?)`,
    );
    for (const tagId of [...new Set(tagIds)]) insert.run(folderId, tagId);
  }

  private isDescendant(candidateId: string, ancestorId: string): boolean {
    let current: string | null = candidateId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      const row = this.db
        .prepare(`SELECT parent_id FROM folders WHERE id = ?`)
        .get(current) as any;
      current = row?.parent_id == null ? null : String(row.parent_id);
    }
    return false;
  }
}

export class TagRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Tag[] {
    return this.db
      .prepare(`SELECT id, name, group_name FROM tags ORDER BY group_name, name`)
      .all()
      .map((row: any) => ({
        id: String(row.id),
        name: String(row.name),
        groupName: String(row.group_name ?? ''),
      }));
  }

  get(id: string): Tag | null {
    const row = this.db
      .prepare(`SELECT id, name, group_name FROM tags WHERE id = ?`)
      .get(id) as any;
    return row
      ? { id: String(row.id), name: String(row.name), groupName: String(row.group_name ?? '') }
      : null;
  }

  create(name: string, groupName: string): Tag {
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO tags (id, name, group_name, created_at) VALUES (?, ?, ?, ?)`)
      .run(id, name.trim(), groupName.trim(), now());
    return this.get(id)!;
  }

  findOrCreate(name: string, groupName: string): Tag {
    const cleanName = name.trim();
    const cleanGroup = groupName.trim();
    const row = this.db
      .prepare(
        `SELECT id, name, group_name FROM tags
         WHERE name = ? AND group_name = ? LIMIT 1`,
      )
      .get(cleanName, cleanGroup) as any;
    if (row) {
      return { id: String(row.id), name: String(row.name), groupName: String(row.group_name ?? '') };
    }
    return this.create(cleanName, cleanGroup);
  }

  update(id: string, name: string, groupName: string): void {
    this.db
      .prepare(`UPDATE tags SET name = ?, group_name = ? WHERE id = ?`)
      .run(name.trim(), groupName.trim(), id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM tags WHERE id = ?`).run(id);
  }
}

export class SourceRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Source[] {
    return this.db
      .prepare(
        `SELECT id, name, base_url, type, enabled, torrent_link_regex, last_error,
                last_fetched_at, created_at
         FROM sources ORDER BY created_at`,
      )
      .all()
      .map(mapSource);
  }

  get(id: string): Source | null {
    const row = this.db
      .prepare(
        `SELECT id, name, base_url, type, enabled, torrent_link_regex, last_error,
                last_fetched_at, created_at
         FROM sources WHERE id = ?`,
      )
      .get(id) as any;
    return row ? mapSource(row) : null;
  }

  create(input: {
    name: string;
    baseUrl: string;
    type: SourceType;
    torrentLinkRegex: string | null;
  }): Source {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO sources (id, name, base_url, type, enabled, torrent_link_regex, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, input.name.trim(), input.baseUrl.trim(), input.type, input.torrentLinkRegex, now());
    return this.get(id)!;
  }

  update(
    id: string,
    input: {
      name: string;
      baseUrl: string;
      torrentLinkRegex: string | null;
      enabled: boolean;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE sources SET name = ?, base_url = ?, torrent_link_regex = ?, enabled = ? WHERE id = ?`,
      )
      .run(input.name.trim(), input.baseUrl.trim(), input.torrentLinkRegex,
        input.enabled ? 1 : 0, id);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare(`UPDATE sources SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM sources WHERE id = ?`).run(id);
  }

  markResult(id: string, error: string | null, fetchedAt: number): void {
    this.db
      .prepare(`UPDATE sources SET last_error = ?, last_fetched_at = ? WHERE id = ?`)
      .run(error, fetchedAt, id);
  }
}

function mapSource(row: any): Source {
  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.base_url),
    type: String(row.type) as SourceType,
    enabled: bool(row.enabled),
    torrentLinkRegex: row.torrent_link_regex == null ? null : String(row.torrent_link_regex),
    lastError: row.last_error == null ? null : String(row.last_error),
    lastFetchedAt: row.last_fetched_at == null ? null : Number(row.last_fetched_at),
    createdAt: Number(row.created_at),
  };
}

export class RuleRepository {
  constructor(private readonly db: DatabaseSync) {}

  listBySource(sourceId: string): Rule[] {
    return this.db
      .prepare(
        `SELECT id, source_id, target_folder_id, order_no, match_regex,
                display_name_regex, display_name_replacement, folder_regexes, enabled
         FROM rules WHERE source_id = ? ORDER BY order_no, created_at`,
      )
      .all(sourceId)
      .map(mapRule);
  }

  listEnabled(): Rule[] {
    return this.db
      .prepare(
        `SELECT id, source_id, target_folder_id, order_no, match_regex,
                display_name_regex, display_name_replacement, folder_regexes, enabled
         FROM rules WHERE enabled = 1 ORDER BY order_no, created_at`,
      )
      .all()
      .map(mapRule);
  }

  get(id: string): Rule | null {
    const row = this.db
      .prepare(
        `SELECT id, source_id, target_folder_id, order_no, match_regex,
                display_name_regex, display_name_replacement, folder_regexes, enabled
         FROM rules WHERE id = ?`,
      )
      .get(id) as any;
    return row ? mapRule(row) : null;
  }

  create(input: Omit<Rule, 'id'>): Rule {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO rules (id, source_id, target_folder_id, order_no, match_regex,
                            display_name_regex, display_name_replacement, folder_regexes,
                            enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sourceId,
        input.targetFolderId,
        input.orderNo,
        input.matchRegex,
        input.displayNameRegex,
        input.displayNameReplacement,
        JSON.stringify(input.folderRegexes),
        input.enabled ? 1 : 0,
        now(),
      );
    return this.get(id)!;
  }

  update(id: string, input: Omit<Rule, 'id' | 'sourceId'>): void {
    this.db
      .prepare(
        `UPDATE rules SET target_folder_id = ?, order_no = ?, match_regex = ?,
                          display_name_regex = ?, display_name_replacement = ?,
                          folder_regexes = ?, enabled = ?
         WHERE id = ?`,
      )
      .run(
        input.targetFolderId,
        input.orderNo,
        input.matchRegex,
        input.displayNameRegex,
        input.displayNameReplacement,
        JSON.stringify(input.folderRegexes),
        input.enabled ? 1 : 0,
        id,
      );
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare(`UPDATE rules SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
  }

  disableForFolders(folderIds: string[]): void {
    if (folderIds.length === 0) return;
    const placeholders = folderIds.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE rules SET enabled = 0 WHERE target_folder_id IN (${placeholders})`,
      )
      .run(...folderIds);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM rules WHERE id = ?`).run(id);
  }
}

function mapRule(row: any): Rule {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    targetFolderId: row.target_folder_id == null ? null : String(row.target_folder_id),
    orderNo: Number(row.order_no),
    matchRegex: String(row.match_regex),
    displayNameRegex: row.display_name_regex == null ? null : String(row.display_name_regex),
    displayNameReplacement:
      row.display_name_replacement == null ? null : String(row.display_name_replacement),
    folderRegexes: parseJsonArray(row.folder_regexes),
    enabled: bool(row.enabled),
  };
}

export class TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): DownloadTask[] {
    return this.db
      .prepare(`SELECT * FROM tasks ORDER BY created_at DESC`)
      .all()
      .map(mapTask);
  }

  listBySource(sourceId: string): DownloadTask[] {
    return this.db
      .prepare(`SELECT * FROM tasks WHERE source_id = ? ORDER BY created_at DESC`)
      .all(sourceId)
      .map(mapTask);
  }

  listPending(): DownloadTask[] {
    return this.db
      .prepare(`SELECT * FROM tasks WHERE state = 'PENDING' ORDER BY created_at`)
      .all()
      .map(mapTask);
  }

  get(id: string): DownloadTask | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;
    return row ? mapTask(row) : null;
  }

  findBySourceItem(sourceId: string, itemKey: string): DownloadTask | null {
    const row = this.db
      .prepare(`SELECT * FROM tasks WHERE source_id = ? AND item_key = ?`)
      .get(sourceId, itemKey) as any;
    return row ? mapTask(row) : null;
  }

  findByQbTag(tag: string): DownloadTask | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE qb_tag = ?`).get(tag) as any;
    return row ? mapTask(row) : null;
  }

  create(input: {
    sourceId: string;
    itemKey: string;
    title: string;
    pageUrl: string | null;
    torrentUrl: string;
    ruleIds?: string[];
  }): DownloadTask {
    const id = randomUUID();
    const qbTag = `index-${id}`;
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO tasks (id, source_id, item_key, title, page_url, torrent_url,
                            qb_tag, rule_ids, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      )
      .run(
        id,
        input.sourceId,
        input.itemKey,
        input.title,
        input.pageUrl,
        input.torrentUrl,
        qbTag,
        JSON.stringify(input.ruleIds ?? []),
        timestamp,
        timestamp,
      );
    return this.get(id)!;
  }

  updateState(id: string, state: TaskState, error: string | null, completedAt?: number | null): void {
    this.db
      .prepare(`UPDATE tasks SET state = ?, error = ?, completed_at = COALESCE(?, completed_at),
                                updated_at = ? WHERE id = ?`)
      .run(state, error, completedAt ?? null, now(), id);
  }

  setInfoHash(id: string, infoHash: string | null): void {
    this.db.prepare(`UPDATE tasks SET info_hash = ?, updated_at = ? WHERE id = ?`)
      .run(infoHash, now(), id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  }
}

function mapTask(row: any): DownloadTask {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    itemKey: String(row.item_key),
    title: String(row.title),
    pageUrl: row.page_url == null ? null : String(row.page_url),
    torrentUrl: String(row.torrent_url),
    infoHash: row.info_hash == null ? null : String(row.info_hash),
    qbTag: String(row.qb_tag),
    ruleIds: parseJsonArray(row.rule_ids),
    state: String(row.state) as TaskState,
    error: row.error == null ? null : String(row.error),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  };
}

export class ItemRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsert(input: {
    folderId: string;
    taskId: string;
    itemKey: string;
    title: string;
    relPath: string;
    absPath: string;
    size: number;
  }): void {
    const existing = this.db
      .prepare(`SELECT id FROM items WHERE task_id = ? AND rel_path = ?`)
      .get(input.taskId, input.relPath) as any;
    if (existing) {
      this.db
        .prepare(
          `UPDATE items SET folder_id = ?, item_key = ?, title = ?, abs_path = ?, size = ?
           WHERE id = ?`,
        )
        .run(input.folderId, input.itemKey, input.title, input.absPath, input.size,
          String(existing.id));
      return;
    }
    this.db
      .prepare(
        `INSERT INTO items (id, folder_id, task_id, item_key, title, rel_path, abs_path, size, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), input.folderId, input.taskId, input.itemKey, input.title,
        input.relPath, input.absPath, input.size, now());
  }

  listByFolder(folderId: string): LibraryItem[] {
    return this.db
      .prepare(`SELECT * FROM items WHERE folder_id = ? ORDER BY title`)
      .all(folderId)
      .map(mapItem);
  }

  listByTask(taskId: string): LibraryItem[] {
    return this.db
      .prepare(`SELECT * FROM items WHERE task_id = ? ORDER BY rel_path`)
      .all(taskId)
      .map(mapItem);
  }

  countByFolder(): Map<string, number> {
    const rows = this.db
      .prepare(`SELECT folder_id, COUNT(*) AS count FROM items GROUP BY folder_id`)
      .all() as any[];
    return new Map(rows.map((row) => [String(row.folder_id), Number(row.count)]));
  }

  countByTask(): Map<string, number> {
    const rows = this.db
      .prepare(`SELECT task_id, COUNT(*) AS count FROM items GROUP BY task_id`)
      .all() as any[];
    return new Map(rows.map((row) => [String(row.task_id), Number(row.count)]));
  }

  deleteByTaskExcept(taskId: string, keepRelPaths: string[]): void {
    const keep = new Set(keepRelPaths);
    const rows = this.db
      .prepare(`SELECT id, rel_path FROM items WHERE task_id = ?`)
      .all(taskId) as any[];
    const remove = this.db.prepare(`DELETE FROM items WHERE id = ?`);
    for (const row of rows) {
      if (!keep.has(String(row.rel_path))) remove.run(String(row.id));
    }
  }

  deleteByTask(taskId: string): void {
    this.db.prepare(`DELETE FROM items WHERE task_id = ?`).run(taskId);
  }

  deleteByFolder(folderId: string): void {
    this.db.prepare(`DELETE FROM items WHERE folder_id = ?`).run(folderId);
  }
}

function mapItem(row: any): LibraryItem {
  return {
    id: String(row.id),
    folderId: String(row.folder_id),
    taskId: String(row.task_id),
    itemKey: String(row.item_key),
    title: String(row.title),
    relPath: String(row.rel_path),
    absPath: String(row.abs_path),
    size: Number(row.size),
    addedAt: Number(row.added_at),
  };
}

export class WatchHistoryRepository {
  constructor(private readonly db: DatabaseSync) {}

  record(folderId: string, itemKey: string, title: string, target: string): void {
    this.db
      .prepare(
        `INSERT INTO watch_history (folder_id, item_key, title, target, played_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(folderId, itemKey, title, target, now());
    // Keep the history table small.
    this.db.exec(
      `DELETE FROM watch_history WHERE id NOT IN (
         SELECT id FROM watch_history ORDER BY played_at DESC LIMIT 500
       )`,
    );
  }

  latestGlobal(): WatchEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM watch_history ORDER BY played_at DESC LIMIT 1`)
      .get() as any;
    return row ? mapWatch(row) : null;
  }

  latestByFolder(folderId: string): WatchEntry | null {
    const row = this.db
      .prepare(
        `SELECT * FROM watch_history WHERE folder_id = ? ORDER BY played_at DESC LIMIT 1`,
      )
      .get(folderId) as any;
    return row ? mapWatch(row) : null;
  }

  deleteForFolders(folderIds: string[]): void {
    if (folderIds.length === 0) return;
    const placeholders = folderIds.map(() => '?').join(', ');
    this.db
      .prepare(`DELETE FROM watch_history WHERE folder_id IN (${placeholders})`)
      .run(...folderIds);
  }
}

function mapWatch(row: any): WatchEntry {
  return {
    id: Number(row.id),
    folderId: String(row.folder_id),
    itemKey: String(row.item_key),
    title: String(row.title),
    target: String(row.target),
    playedAt: Number(row.played_at),
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  qbUrl: 'http://127.0.0.1:8080',
  qbUsername: '',
  qbPassword: '',
  qbCategory: '',
  playerPath: '',
  playerArgs: '{file}',
  proxyUrl: '',
  rssIntervalMinutes: 60,
  autoDownload: false,
};

export class SettingsService {
  constructor(private readonly db: DatabaseSync) {}

  get(): AppSettings {
    const row = this.db
      .prepare(`SELECT value FROM settings WHERE key = 'app'`)
      .get() as any;
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(String(row.value)) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...patch };
    if (!Number.isFinite(next.rssIntervalMinutes) || next.rssIntervalMinutes < 1) {
      next.rssIntervalMinutes = 60;
    }
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('app', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(JSON.stringify(next));
    return next;
  }
}
