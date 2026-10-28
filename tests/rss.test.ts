import { describe, expect, it } from 'vitest';
import { parseFeed } from '../src/sources/rss.js';

describe('RSS parsing', () => {
  it('parses a standard RSS enclosure', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel><title>Demo</title><item>
        <title>Show S01E01</title>
        <link>https://example.com/post/1</link>
        <guid>item-1</guid>
        <enclosure url="https://example.com/1.torrent" type="application/x-bittorrent"/>
      </item></channel></rss>`;
    const items = parseFeed(xml, 'https://example.com/feed.xml');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Show S01E01');
    expect(items[0].torrentUrl).toBe('https://example.com/1.torrent');
    expect(items[0].guid).toBe('item-1');
  });

  it('extracts a magnet from description and resolves a relative torrent', () => {
    const xml = `<rss version="2.0"><channel>
      <item>
        <title>With magnet</title>
        <description><![CDATA[<a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567">magnet</a>]]></description>
      </item>
      <item>
        <title>Relative</title>
        <enclosure url="/files/2.torrent" type="application/x-bittorrent"/>
      </item>
    </channel></rss>`;
    const items = parseFeed(xml, 'https://example.com/feed.xml');
    expect(items).toHaveLength(2);
    expect(items[0].torrentUrl.startsWith('magnet:?xt=urn:btih:')).toBe(true);
    expect(items[1].torrentUrl).toBe('https://example.com/files/2.torrent');
  });

  it('parses an Atom entry', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom"><title>Demo</title>
        <entry>
          <title>Atom Show</title>
          <id>tag:example.com,2026:1</id>
          <link rel="alternate" href="https://example.com/atom/1"/>
          <link rel="enclosure" href="https://example.com/atom/1.torrent" type="application/x-bittorrent"/>
        </entry>
      </feed>`;
    const items = parseFeed(xml, 'https://example.com/atom.xml');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Atom Show');
    expect(items[0].torrentUrl).toBe('https://example.com/atom/1.torrent');
    expect(items[0].guid).toBe('tag:example.com,2026:1');
  });

  it('uses a custom regex for custom fields', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Custom</title>
      <description>download=https://cdn.example.com/a.torrent</description>
    </item></channel></rss>`;
    const items = parseFeed(xml, 'https://example.com/feed.xml', 'download=(\\S+)');
    expect(items).toHaveLength(1);
    expect(items[0].torrentUrl).toBe('https://cdn.example.com/a.torrent');
  });

  it('ignores items without a torrent link', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>No link</title><link>https://example.com/post</link>
    </item></channel></rss>`;
    expect(parseFeed(xml, 'https://example.com/feed.xml')).toHaveLength(0);
  });
});
