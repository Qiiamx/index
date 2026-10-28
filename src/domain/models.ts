export type SourceType = 'HTTP_DIRECTORY' | 'RSS' | 'LOCAL_DIRECTORY';

export type TaskState =
  | 'PENDING'
  | 'ADDED'
  | 'DOWNLOADING'
  | 'SEEDING'
  | 'COMPLETED'
  | 'PAUSED'
  | 'FAILED';

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  sort: number;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  groupName: string;
}

export interface Source {
  id: string;
  name: string;
  baseUrl: string;
  type: SourceType;
  enabled: boolean;
  torrentLinkRegex: string | null;
  lastError: string | null;
  lastFetchedAt: number | null;
  createdAt: number;
}

export interface Rule {
  id: string;
  sourceId: string;
  targetFolderId: string | null;
  orderNo: number;
  matchRegex: string;
  displayNameRegex: string | null;
  displayNameReplacement: string | null;
  folderRegexes: string[];
  enabled: boolean;
}

export interface DownloadTask {
  id: string;
  sourceId: string;
  itemKey: string;
  title: string;
  pageUrl: string | null;
  torrentUrl: string;
  infoHash: string | null;
  qbTag: string;
  ruleIds: string[];
  state: TaskState;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface LibraryItem {
  id: string;
  folderId: string;
  taskId: string;
  itemKey: string;
  title: string;
  relPath: string;
  absPath: string;
  size: number;
  addedAt: number;
}

export interface WatchEntry {
  id: number;
  folderId: string;
  itemKey: string;
  title: string;
  target: string;
  playedAt: number;
}

export interface RemoteEntry {
  name: string;
  url: string;
  isDirectory: boolean;
  relativePath: string;
}

export interface PlayableItem {
  title: string;
  target: string;
  itemKey: string;
  folderId: string | null;
  ruleId: string | null;
  sourceId: string;
  sourceName: string;
  kind: 'bt' | 'http' | 'local';
  size?: number;
}

export interface AppSettings {
  qbUrl: string;
  qbUsername: string;
  qbPassword: string;
  qbCategory: string;
  playerPath: string;
  playerArgs: string;
  proxyUrl: string;
  rssIntervalMinutes: number;
  autoDownload: boolean;
}
