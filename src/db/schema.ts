export const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folder_tags (
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (folder_id, tag_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('HTTP_DIRECTORY', 'RSS')),
  enabled INTEGER NOT NULL DEFAULT 1,
  torrent_link_regex TEXT,
  last_error TEXT,
  last_fetched_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  target_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  order_no INTEGER NOT NULL DEFAULT 0,
  match_regex TEXT NOT NULL,
  display_name_regex TEXT,
  display_name_replacement TEXT,
  folder_regexes TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  page_url TEXT,
  torrent_url TEXT NOT NULL,
  info_hash TEXT,
  qb_tag TEXT NOT NULL,
  rule_ids TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'PENDING',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (source_id, item_key)
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  abs_path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  UNIQUE (task_id, rel_path)
);

CREATE TABLE IF NOT EXISTS watch_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  target TEXT NOT NULL,
  played_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_folder ON items(folder_id);
CREATE INDEX IF NOT EXISTS idx_items_task ON items(task_id);
CREATE INDEX IF NOT EXISTS idx_watch_folder ON watch_history(folder_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
`;
