import { describe, expect, it } from 'vitest';
import type { RemoteEntry, Rule, Source } from '../src/domain/models.js';
import { compileRule, matchFirst, matchPath, resolveRemote, validateRule } from '../src/domain/rules.js';

const source: Source = {
  id: 'source-1',
  name: 'Demo',
  baseUrl: 'http://host/media/',
  type: 'HTTP_DIRECTORY',
  enabled: true,
  torrentLinkRegex: null,
  lastError: null,
  lastFetchedAt: null,
  createdAt: 0,
};

function rule(patch: Partial<Rule> = {}): Rule {
  return {
    id: 'rule-1',
    sourceId: 'source-1',
    targetFolderId: 'folder-1',
    orderNo: 0,
    matchRegex: '.*\\.mkv$',
    displayNameRegex: null,
    displayNameReplacement: null,
    folderRegexes: [],
    enabled: true,
    ...patch,
  };
}

describe('rule matching', () => {
  it('matches and renames with a capture group', () => {
    const compiled = compileRule(rule({
      displayNameRegex: '^(.*)\\.mkv$',
      displayNameReplacement: '$1',
    }));
    expect(compiled).not.toBeNull();
    const matched = matchPath(compiled!, 'Show S01E01.mkv');
    expect(matched?.displayName).toBe('Show S01E01');
  });

  it('keeps the original name when rename is absent', () => {
    const matched = matchPath(compileRule(rule())!, 'movie.mp4'.replace('.mp4', '.mkv'));
    expect(matched?.displayName).toBe('movie.mkv');
  });

  it('returns nothing when no file matches', () => {
    const matched = matchPath(compileRule(rule({ matchRegex: '.*\\.avi$' }))!, 'movie.mkv');
    expect(matched).toBeNull();
  });

  it('rejects unsafe or blank display names', () => {
    const anyMatch = compileRule(rule({ matchRegex: '.*' }))!;
    expect(matchPath(anyMatch, '..evil.mkv')).toBeNull();
    expect(matchPath(anyMatch, '   ')).toBeNull();
    const traversal = compileRule(rule({
      matchRegex: '.*',
      displayNameRegex: '^(.*)\\.mkv$',
      displayNameReplacement: 'bad/name',
    }))!;
    expect(matchPath(traversal, 'movie.mkv')).toBeNull();
  });

  it('rejects a rename result containing traversal', () => {
    const matched = matchPath(
      compileRule(rule({
        matchRegex: '.*',
        displayNameRegex: '^(.*)\\.mkv$',
        displayNameReplacement: '..',
      }))!,
      'movie.mkv',
    );
    expect(matched).toBeNull();
  });

  it('matches folder levels exactly', () => {
    const compiled = compileRule(rule({
      folderRegexes: ['^Season\\s+1$'],
      matchRegex: '.*\\.mkv$',
    }))!;
    expect(matchPath(compiled, 'Season 1/Show.S01E01.mkv')?.displayName)
      .toBe('Show.S01E01.mkv');
    expect(matchPath(compiled, 'Season 1/Extras/Show.S01E01.mkv')).toBeNull();
    expect(matchPath(compiled, 'Season 2/Show.S01E01.mkv')).toBeNull();
  });

  it('renames only the leaf file', () => {
    const compiled = compileRule(rule({
      folderRegexes: ['^S01$'],
      matchRegex: '.*E(\\d+)\\.mkv$',
      displayNameRegex: '.*E(\\d+)\\.mkv$',
      displayNameReplacement: '第$1集',
    }))!;
    expect(matchPath(compiled, 'S01/Show.S01E01.mkv')?.displayName).toBe('第01集');
  });

  it('uses the first matching rule in order', () => {
    const matched = matchFirst(
      [
        rule({ id: 'first', targetFolderId: 'folder-a' }),
        rule({ id: 'second', targetFolderId: 'folder-b' }),
      ],
      'Show/episode.mkv',
    );
    expect(matched?.rule.id).toBe('first');
  });
});

describe('rule validation', () => {
  it('rejects invalid regular expressions', () => {
    expect(validateRule({ matchRegex: '(', folderRegexes: [] })).toBeTruthy();
    expect(validateRule({ matchRegex: '.*', folderRegexes: ['['] })).toBeTruthy();
  });

  it('accepts a valid rule', () => {
    expect(validateRule({
      matchRegex: '.*\\.mkv$',
      displayNameRegex: '^(.*)\\.mkv$',
      folderRegexes: ['^S01$'],
    })).toBeNull();
  });
});

describe('remote resolution', () => {
  it('walks directories then matches the leaf file', async () => {
    const tree = new Map<string, RemoteEntry[]>([
      ['http://host/media/Season 1/', [
        { name: 'Show.S01E01.mkv', url: 'http://host/media/Season 1/Show.S01E01.mkv', isDirectory: false, relativePath: 'Season 1/Show.S01E01.mkv' },
      ]],
      ['http://host/media/', [
        { name: 'Season 1', url: 'http://host/media/Season 1/', isDirectory: true, relativePath: 'Season 1' },
        { name: 'ignored.mkv', url: 'http://host/media/ignored.mkv', isDirectory: false, relativePath: 'ignored.mkv' },
      ]],
    ]);
    const browser = { list: async (url: string) => tree.get(url) ?? [] };
    const items = await resolveRemote(
      rule({ folderRegexes: ['^Season\\s+1$'], matchRegex: '.*\\.mkv$' }),
      source,
      browser,
      'http://host/media/',
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Show.S01E01.mkv');
    expect(items[0].target).toBe('http://host/media/Season 1/Show.S01E01.mkv');
  });
});
