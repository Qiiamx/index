import { describe, expect, it } from 'vitest';
import { parseEntries, normalizeBaseUrl } from '../src/sources/httpDirectory.js';

describe('HTTP directory parsing', () => {
  it('parses python-style listings and filters noise', () => {
    const html = `
      <html><body><ul>
        <li><a href="../">../</a></li>
        <li><a href="sub/">sub/</a></li>
        <li><a href="?C=N;O=D">Name</a></li>
        <li><a href="episode%201.mp4">episode 1.mp4</a></li>
        <li><a href="episode%201.mp4#t=1">duplicate with fragment</a></li>
        <li><a href="Show%20&amp;%20More.mkv">Show &amp; More.mkv</a></li>
        <li><a href="/media/abs%20file.mp4">absolute</a></li>
        <li><a href='single.mp4'>single</a></li>
        <li><a href=bare.mp4>bare</a></li>
        <li><a href="https://other.example/evil.mp4">external</a></li>
        <li><a href="episode%201.mp4">duplicate</a></li>
      </ul></body></html>
    `;
    const entries = parseEntries(html, 'http://127.0.0.1:8000/media');
    expect(entries.map((entry) => entry.name)).toEqual([
      'sub',
      'abs file.mp4',
      'bare.mp4',
      'episode 1.mp4',
      'Show & More.mkv',
      'single.mp4',
    ]);
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[1].url).toBe('http://127.0.0.1:8000/media/abs%20file.mp4');
    expect(entries[3].relativePath).toBe('episode 1.mp4');
  });

  it('normalizes base urls', () => {
    expect(normalizeBaseUrl('http://host/media?x=1')).toBe('http://host/media/');
    expect(normalizeBaseUrl('http://host/media/')).toBe('http://host/media/');
  });
});
