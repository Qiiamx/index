import type { PlayableItem, RemoteEntry, Rule, Source } from './models.js';

export interface CompiledRule {
  rule: Rule;
  folderRegexes: RegExp[];
  match: RegExp;
  rename: RegExp | null;
  replacement: string | null;
}

export interface RemoteBrowser {
  list(url: string): Promise<RemoteEntry[]>;
}

export interface PathMatch {
  rule: Rule;
  displayName: string;
}

export function compileRule(rule: Rule): CompiledRule | null {
  try {
    const folderRegexes = rule.folderRegexes.map((pattern) => new RegExp(pattern));
    const match = new RegExp(rule.matchRegex);
    const rename = rule.displayNameRegex ? new RegExp(rule.displayNameRegex) : null;
    return {
      rule,
      folderRegexes,
      match,
      rename,
      replacement: rule.displayNameReplacement,
    };
  } catch {
    return null;
  }
}

export function sanitizeDisplayName(value: string): string | null {
  const clean = value.trim();
  if (!clean) return null;
  if (clean.includes('/') || clean.includes('\\') || clean.includes('..')) return null;
  return clean;
}

export function renameForDisplay(compiled: CompiledRule, leaf: string): string | null {
  const renamed = compiled.rename && compiled.replacement != null
    ? leaf.replace(compiled.rename, compiled.replacement)
    : leaf;
  return sanitizeDisplayName(renamed);
}

/**
 * Matches a file path (relative to the download/source root) against a rule.
 * With folder regexes the depth must match exactly; without them the leaf
 * file name can sit at any depth.
 */
export function matchPath(compiled: CompiledRule, relativePath: string): PathMatch | null {
  const segments = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  if (compiled.folderRegexes.length > 0) {
    if (segments.length !== compiled.folderRegexes.length + 1) return null;
    for (let i = 0; i < compiled.folderRegexes.length; i += 1) {
      if (!compiled.folderRegexes[i].test(segments[i])) return null;
    }
  }

  const leaf = segments[segments.length - 1];
  if (!compiled.match.test(leaf)) return null;
  const displayName = renameForDisplay(compiled, leaf);
  if (!displayName) return null;
  return { rule: compiled.rule, displayName };
}

export function matchFirst(
  rules: Rule[],
  relativePath: string,
): PathMatch | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const compiled = compileRule(rule);
    if (!compiled) continue;
    const matched = matchPath(compiled, relativePath);
    if (matched) return matched;
  }
  return null;
}

export function validateRule(input: {
  matchRegex: string;
  displayNameRegex?: string | null;
  folderRegexes: string[];
}): string | null {
  const patterns = [...input.folderRegexes];
  if (patterns.length === 0 && !input.matchRegex.trim()) {
    return '最终文件正则不能为空';
  }
  for (const pattern of patterns) {
    if (!pattern.trim()) return '目录正则不能有空行';
    try {
      new RegExp(pattern);
    } catch {
      return `目录正则无效：${pattern}`;
    }
  }
  try {
    new RegExp(input.matchRegex);
  } catch {
    return `最终文件正则无效：${input.matchRegex}`;
  }
  if (input.displayNameRegex) {
    try {
      new RegExp(input.displayNameRegex);
    } catch {
      return `改名正则无效：${input.displayNameRegex}`;
    }
  }
  return null;
}

export function relativePathFromUrl(rootUrl: string, entryUrl: string): string {
  try {
    const root = new URL(rootUrl);
    const entry = new URL(entryUrl);
    let base = root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`;
    if (!entry.pathname.startsWith(base)) {
      base = base.slice(0, base.lastIndexOf('/') + 1);
    }
    const rest = entry.pathname.startsWith(base)
      ? entry.pathname.slice(base.length)
      : entry.pathname.slice(entry.pathname.lastIndexOf('/') + 1);
    return decodeURIComponent(rest);
  } catch {
    return entryUrl;
  }
}

const MAX_ENTRIES = 5000;
const MAX_REQUESTS = 200;

export async function resolveRemote(
  rule: Rule,
  source: Source,
  browser: RemoteBrowser,
  rootUrl: string,
  cache: Map<string, RemoteEntry[]> = new Map(),
): Promise<PlayableItem[]> {
  const compiled = compileRule(rule);
  if (!compiled || rule.targetFolderId == null) return [];
  const patterns = [...compiled.folderRegexes, compiled.match];
  const output = new Map<string, PlayableItem>();
  let visited = 0;
  let requests = 0;

  const walk = async (level: number, directory: string): Promise<void> => {
    if (level >= patterns.length || requests >= MAX_REQUESTS || visited >= MAX_ENTRIES) return;
    requests += 1;
    let entries = cache.get(directory);
    if (!entries) {
      entries = await browser.list(directory);
      cache.set(directory, entries);
    }
    if (entries.length > MAX_ENTRIES) return;
    const isLeaf = level === patterns.length - 1;
    for (const entry of entries) {
      if (visited >= MAX_ENTRIES) break;
      visited += 1;
      if (!patterns[level].test(entry.name)) continue;
      if (isLeaf) {
        if (entry.isDirectory) continue;
        const displayName = renameForDisplay(compiled, entry.name);
        if (!displayName) continue;
        if (output.has(entry.url)) continue;
        output.set(entry.url, {
          title: displayName,
          target: entry.url,
          itemKey: entry.url,
          folderId: rule.targetFolderId,
          ruleId: rule.id,
          sourceId: source.id,
          sourceName: source.name,
          kind: source.type === 'LOCAL_DIRECTORY' ? 'local' : 'http',
        });
      } else if (entry.isDirectory) {
        await walk(level + 1, entry.url);
      }
    }
  };

  await walk(0, rootUrl);
  return [...output.values()];
}
