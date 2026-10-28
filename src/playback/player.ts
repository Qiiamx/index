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

function spawnAndWait(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    let settled = false;
    const cleanup = (): void => {
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
    };
    const onSpawn = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      child.unref();
      resolve();
    };
    const onError = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

export class PlayerService {
  constructor(
    private readonly settings: SettingsService,
    private readonly history: WatchHistoryRepository,
  ) {}

  async launch(input: PlayInput): Promise<void> {
    const target = input.target.trim();
    if (!target) throw new Error('播放地址为空');
    if (/^https?:\/\//i.test(target)) {
      // Remote HTTP directory source: hand the URL to the player/browser.
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
      await spawnAndWait(playerPath, args);
      console.info(`[player] opened with ${playerPath}: ${target}`);
    } else if (process.platform === 'win32') {
      // explorer.exe goes through the Windows shell, i.e. exactly what a
      // double-click does. Do not use a hidden cmd window here: that can hide
      // the player window as well.
      await spawnAndWait('explorer.exe', [target]);
      console.info(`[player] opened with Windows association: ${target}`);
    } else {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      await spawnAndWait(opener, [target]);
      console.info(`[player] opened with ${opener}: ${target}`);
    }

    this.history.record(input.folderId, input.itemKey, input.title, target);
  }
}
