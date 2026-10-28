import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QbittorrentClient } from '../src/qbittorrent/client.js';

let server: http.Server;
let baseUrl = '';
let apiVersion = '2.11.4';
const calls: string[] = [];

beforeAll(async () => {
  server = http.createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    const url = request.url ?? '';
    if (url.startsWith('/api/v2/app/webapiVersion')) {
      response.end(apiVersion);
      return;
    }
    if (url.startsWith('/api/v2/torrents/info')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{
        hash: 'abc', name: 'Demo', progress: 1, state: 'uploading',
        save_path: 'C:/downloads', content_path: 'C:/downloads/Demo',
        size: 100, total_size: 100, completed: 100, dlspeed: 0, upspeed: 0,
        eta: 0, num_seeds: 1, num_leechs: 0, category: 'Index',
        tags: 'index,index-1', ratio: 1, seeding_time: 10, added_on: 0,
        completion_on: 0, amount_left: 0,
      }]));
      return;
    }
    if (url.startsWith('/api/v2/torrents/files')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ name: 'Demo/01.mkv', size: 100, progress: 1, priority: 1, is_seed: true }]));
      return;
    }
    if (url.startsWith('/api/v2/torrents/categories')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ Index: { name: 'Index', savePath: 'C:/downloads' } }));
      return;
    }
    if (url.startsWith('/api/v2/app/preferences')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ save_path: 'C:/downloads' }));
      return;
    }
    if (url.startsWith('/api/v2/auth/login')) {
      response.end('Ok.');
      return;
    }
    if (url.startsWith('/api/v2/torrents/add')) {
      response.end('Ok.');
      return;
    }
    response.end('');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('qBittorrent client', () => {
  it('reads web api version and torrents without auth', async () => {
    apiVersion = '2.11.4';
    const client = new QbittorrentClient({ url: baseUrl, username: '', password: '' });
    expect(await client.webApiVersion()).toBe('2.11.4');
    const torrents = await client.torrents();
    expect(torrents).toHaveLength(1);
    expect(torrents[0].tags).toContain('index');
  });

  it('uses start/stop on Web API 2.11+', async () => {
    apiVersion = '2.11.4';
    calls.length = 0;
    const client = new QbittorrentClient({ url: baseUrl, username: '', password: '' });
    await client.stop('abc');
    await client.start('abc');
    expect(calls.some((call) => call.startsWith('POST /api/v2/torrents/stop'))).toBe(true);
    expect(calls.some((call) => call.startsWith('POST /api/v2/torrents/start'))).toBe(true);
  });

  it('falls back to pause/resume on older Web APIs', async () => {
    apiVersion = '2.8.0';
    calls.length = 0;
    const client = new QbittorrentClient({ url: baseUrl, username: '', password: '' });
    await client.stop('abc');
    await client.start('abc');
    expect(calls.some((call) => call.startsWith('POST /api/v2/torrents/pause'))).toBe(true);
    expect(calls.some((call) => call.startsWith('POST /api/v2/torrents/resume'))).toBe(true);
  });

  it('adds torrents with tags and auto TMM', async () => {
    apiVersion = '2.11.4';
    calls.length = 0;
    const client = new QbittorrentClient({ url: baseUrl, username: '', password: '' });
    await client.addTorrent({ urls: 'magnet:?xt=urn:btih:abc', tags: 'index,index-1' });
    expect(calls.some((call) => call.startsWith('POST /api/v2/torrents/add'))).toBe(true);
  });

  it('reads files', async () => {
    apiVersion = '2.11.4';
    const client = new QbittorrentClient({ url: baseUrl, username: '', password: '' });
    const files = await client.files('abc');
    expect(files[0].name).toBe('Demo/01.mkv');
  });
});
