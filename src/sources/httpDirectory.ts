import * as cheerio from 'cheerio';
import { relativePathFromUrl } from '../domain/rules.js';
import type { RemoteEntry } from '../domain/models.js';
import type { HttpClient } from '../util/http.js';

const MAX_FILES = 5000;

export function normalizeBaseUrl(baseUrl: string): string {
  const clean = baseUrl.trim().split('#')[0].split('?')[0];
  if (!clean) return clean;
  return clean.endsWith('/') ? clean : `${clean}/`;
}

export function parseEntries(html: string, baseUrl: string): RemoteEntry[] {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const base = new URL(normalizedBase);
  const found = new Map<string, RemoteEntry>();
  const $ = cheerio.load(html);

  $('a[href]').each((_, element) => {
    if (found.size >= MAX_FILES) return false;
    const raw = $(element).attr('href')?.trim() ?? '';
    if (!raw) return;
    if (raw.startsWith('#') || raw.includes('#') || raw.includes('?')) return;
    if (raw === '.' || raw === '..' || raw.endsWith('/.') || raw.endsWith('/..')) return;

    let resolved: URL;
    try {
      resolved = new URL(raw, base);
    } catch {
      return;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    if (resolved.host.toLowerCase() !== base.host.toLowerCase()) return;
    resolved.search = '';
    resolved.hash = '';

    const rawPath = resolved.pathname;
    if (!rawPath || rawPath === '/') return;
    const isDirectory = rawPath.endsWith('/');
    const segment = isDirectory
      ? rawPath.slice(0, -1).split('/').pop() ?? ''
      : rawPath.split('/').pop() ?? '';
    if (!segment) return;

    let name: string;
    try {
      name = decodeURIComponent(segment);
    } catch {
      name = segment;
    }
    if (!name || name === '.' || name === '..') return;

    let entryUrl = resolved.toString();
    if (isDirectory && !entryUrl.endsWith('/')) entryUrl = `${entryUrl}/`;
    if (normalizeBaseUrl(entryUrl) === normalizedBase) return;

    found.set(entryUrl, {
      name,
      url: entryUrl,
      isDirectory,
      relativePath: relativePathFromUrl(normalizedBase, entryUrl),
    });
    return;
  });

  return [...found.values()]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (byName !== 0) return byName;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_FILES);
}

export class HttpDirectoryClient {
  constructor(private readonly http: HttpClient) {}

  async list(url: string): Promise<RemoteEntry[]> {
    const response = await this.http.getText(url, {
      Accept: 'text/html,application/xhtml+xml,*/*',
    });
    return parseEntries(response.text, response.url);
  }
}
