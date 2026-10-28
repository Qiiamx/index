import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { WatchHistoryRepository, SettingsService } from '../db/repositories.js';

export interface PlayInput {
  folderId: string;
  itemKey: string;
  title: string;
  target: string;
}

function splitArgs(template: string): string[] {
  const matches = template.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ''));
}

export class PlayerService {
  constructor(
    private readonly settings: SettingsService,
    private readonly history: WatchHistoryRepository,
  ) {}

  launch(input: PlayInput): void {
    const target = input.target.trim();
    if (!target) throw new Error('播放地址为空');
    if (/^https?:\/\//i.test(target)) {
      // Remote HTTP directory source: hand the URL to the player.
    } else if (/^magnet:/i.test(target)) {
      throw new Error('磁力链接不能直接播放');
    } else {
      if (!path.isAbsolute(target)) throw new Error('本地文件路径必须是绝对路径');
      if (!fs.existsSync(target)) throw new Error(`文件不存在：${target}`);
    }

    const config = this.settings.get();
    const playerPath = config.playerPath.trim();
    const template = config.playerArgs.trim() || '{file}';

    if (playerPath) {
      if (!fs.existsSync(playerPath)) {
        throw new Error(`播放器不存在：${playerPath}`);
      }
      let args = splitArgs(template);
      if (!args.some((arg) => arg.includes('{file}'))) args = [...args, '{file}'];
      args = args.map((arg) => arg.replaceAll('{file}', target));
      const child = spawn(playerPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', (error) => {
        console.error(`[player] ${error.message}`);
      });
      child.unref();
    } else if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '', `"${target}"`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', (error) => {
        console.error(`[player] ${error.message}`);
      });
      child.unref();
    } else {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(opener, [target], { detached: true, stdio: 'ignore' });
      child.unref();
    }

    this.history.record(input.folderId, input.itemKey, input.title, target);
  }
}
