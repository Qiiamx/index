import * as cheerio from 'cheerio';
import type { HttpClient } from '../util/http.js';

export interface RssItem {
  title: string;
  pageUrl: string | null;
  guid: string | null;
  pubDate: string | null;
  torrentUrl: string;
  rawText: string;
}

const MAGNET_REGEX = /magnet:\?[^\s"'<>]+/i;
const TORRENT_URL_REGEX = /https?:\/\/[^\s"'<>]+?\.torrent(?:\?[^\s"'<>]*)?/i;

function childByName($: cheerio.CheerioAPI, element: any, names: string[]): cheerio.Cheerio<any> {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return $(element)
    .children()
    .filter((_, child) => {
      const name = String((child as any).name ?? '').split(':').pop() ?? '';
      return wanted.has(name.toLowerCase());
    });
}

function textOf($: cheerio.CheerioAPI, element: any, names: string[]): string {
  return childByName($, element, names).first().text().trim();
}

function linkOf($: cheerio.CheerioAPI, element: any): string | null {
  const links = $(element).children('link').toArray();
  if (links.length === 0) return null;
  const preferred = links.find((link) => {
    const rel = $(link).attr('rel') ?? '';
    return !rel || rel.toLowerCase() === 'alternate';
  }) ?? links[0];
  const href = $(preferred).attr('href');
  if (href && href.trim()) return href.trim();
  const text = $(preferred).text().trim();
  return text || null;
}

function enclosuresOf($: cheerio.CheerioAPI, element: any): Array<{ url: string; type: string | null }> {
  const result: Array<{ url: string; type: string | null }> = [];
  $(element).find('enclosure').each((_, enclosure) => {
    const url = $(enclosure).attr('url')?.trim();
    if (url) result.push({ url, type: $(enclosure).attr('type')?.trim() ?? null });
  });
  $(element).children('link').each((_, link) => {
    const rel = ($(link).attr('rel') ?? '').toLowerCase();
    if (rel !== 'enclosure') return;
    const url = $(link).attr('href')?.trim();
    if (url) result.push({ url, type: $(link).attr('type')?.trim() ?? null });
  });
  return result;
}

function normalizeUrl(value: string, feedUrl: string): string | null {
  const raw = value.trim().replace(/^["']|["']$/g, '');
  if (!raw) return null;
  if (/^magnet:/i.test(raw)) return raw;
  try {
    const resolved = new URL(raw, feedUrl);
    if (!/^https?:$/i.test(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function isTorrentUrl(value: string): boolean {
  return /^magnet:/i.test(value) || /\.torrent(?:$|\?)/i.test(value);
}

function extractTorrentUrl(
  enclosures: Array<{ url: string; type: string | null }>,
  link: string | null,
  guid: string | null,
  description: string,
  rawText: string,
  feedUrl: string,
  customRegex: string | null,
): string | null {
  for (const enclosure of enclosures) {
    const normalized = normalizeUrl(enclosure.url, feedUrl);
    if (!normalized) continue;
    if (isTorrentUrl(normalized) || (enclosure.type ?? '').toLowerCase().includes('bittorrent')) {
      return normalized;
    }
  }
  for (const candidate of [link, guid]) {
    if (!candidate) continue;
    const normalized = normalizeUrl(candidate, feedUrl);
    if (normalized && isTorrentUrl(normalized)) return normalized;
  }
  const magnet = MAGNET_REGEX.exec(description)?.[0];
  if (magnet) return magnet;
  const torrent = TORRENT_URL_REGEX.exec(description)?.[0];
  if (torrent) {
    const normalized = normalizeUrl(torrent, feedUrl);
    if (normalized) return normalized;
  }

  if (customRegex?.trim()) {
    try {
      const regex = new RegExp(customRegex);
      const match = regex.exec(rawText) ?? regex.exec(description);
      if (match) {
        const value = match.slice(1).find((group) => group && group.trim()) ?? match[0];
        const normalized = normalizeUrl(String(value).trim(), feedUrl);
        if (normalized && (isTorrentUrl(normalized) || /^magnet:/i.test(normalized))) {
          return normalized;
        }
      }
    } catch {
      // Invalid custom regex: fall through to the built-in patterns.
    }
  }

  const rawMagnet = MAGNET_REGEX.exec(rawText)?.[0];
  if (rawMagnet) return rawMagnet;
  const rawTorrent = TORRENT_URL_REGEX.exec(rawText)?.[0];
  if (rawTorrent) return normalizeUrl(rawTorrent, feedUrl);
  return null;
}

export function parseFeed(xml: string, feedUrl: string, customRegex: string | null = null): RssItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const elements = $('item, entry').toArray();
  const items: RssItem[] = [];

  for (const element of elements) {
    const title = textOf($, element, ['title']);
    if (!title) continue;
    const link = linkOf($, element);
    const guid = textOf($, element, ['guid', 'id']) || null;
    const pubDate = textOf($, element, ['pubDate', 'published', 'updated']) || null;
    const description = textOf($, element, ['description', 'summary', 'content', 'encoded']);
    const enclosures = enclosuresOf($, element);
    const rawText = [title, link, guid, description, ...enclosures.map((item) => item.url)]
      .filter(Boolean)
      .join('\n');
    const torrentUrl = extractTorrentUrl(
      enclosures,
      link,
      guid,
      description,
      rawText,
      feedUrl,
      customRegex,
    );
    if (!torrentUrl) continue;
    items.push({
      title,
      pageUrl: link,
      guid,
      pubDate,
      torrentUrl,
      rawText,
    });
  }

  return items;
}

export class RssClient {
  constructor(private readonly http: HttpClient) {}

  async fetch(feedUrl: string, customRegex: string | null = null): Promise<RssItem[]> {
    const response = await this.http.getText(feedUrl, {
      Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*',
    }, 60_000);
    return parseFeed(response.text, response.url, customRegex);
  }
}
