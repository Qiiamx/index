import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RemoteEntry, Rule, Source } from '../src/domain/models.js';
import { resolveRemote } from '../src/domain/rules.js';
import { LocalDirectoryClient } from '../src/sources/localDirectory.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'index-local-'));
fs.mkdirSync(path.join(root, 'Season 1'), { recursive: true });
fs.mkdirSync(path.join(root, 'Other'), { recursive: true });
fs.writeFileSync(path.join(root, 'Season 1', 'Show.S01E01.mkv'), 'x');
fs.writeFileSync(path.join(root, 'Season 1', 'note.txt'), 'x');
fs.writeFileSync(path.join(root, 'Other', 'Extra.mp4'), 'x');

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const source: Source = {
  id: 'local-source',
  name: 'Local',
  baseUrl: root,
  type: 'LOCAL_DIRECTORY',
  enabled: true,
  torrentLinkRegex: null,
  lastError: null,
  lastFetchedAt: null,
  createdAt: 0,
};

const rule: Rule = {
  id: 'rule-1',
  sourceId: source.id,
  targetFolderId: 'folder-1',
  orderNo: 0,
  matchRegex: '.*\\.mkv$',
  displayNameRegex: '^(.*)\\.mkv$',
  displayNameReplacement: '$1',
  folderRegexes: ['^Season 1$'],
  enabled: true,
};

describe('local directory source', () => {
  it('lists directories and files without leaving the root', async () => {
    const client = new LocalDirectoryClient(root);
    const entries = await client.list(root);
    expect(entries.map((entry) => entry.name)).toEqual(['Other', 'Season 1']);
    expect(entries[1].isDirectory).toBe(true);
    await expect(client.list(path.join(root, '..'))).rejects.toThrow();
  });

  it('resolves files through rules and returns absolute targets', async () => {
    const browser = {
      list: async (directory: string): Promise<RemoteEntry[]> =>
        new LocalDirectoryClient(root).list(directory),
    };
    const items = await resolveRemote(rule, source, browser, root);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Show.S01E01');
    expect(items[0].kind).toBe('local');
    expect(items[0].target).toBe(path.join(root, 'Season 1', 'Show.S01E01.mkv'));
    expect(fs.existsSync(items[0].target)).toBe(true);
  });
});
