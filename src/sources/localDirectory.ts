import fs from 'node:fs/promises';
import path from 'node:path';
import type { RemoteEntry } from '../domain/models.js';

const MAX_ENTRIES = 5000;

/**
 * Lists a local folder for the LOCAL_DIRECTORY source type. The root is fixed
 * when the source is created; traversal is rejected if it escapes that root.
 * Symlinks are skipped so a rule cannot walk outside the source directory.
 */
export class LocalDirectoryClient {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async list(directory: string): Promise<RemoteEntry[]> {
    const target = path.resolve(directory);
    if (!this.isInsideRoot(target)) {
      throw new Error('本地目录路径超出源根目录');
    }
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => {
        const absolute = path.join(target, entry.name);
        return {
          name: entry.name,
          url: absolute,
          isDirectory: entry.isDirectory(),
          relativePath: path.relative(this.root, absolute).split(path.sep).join('/'),
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      })
      .slice(0, MAX_ENTRIES);
  }

  private isInsideRoot(target: string): boolean {
    const relative = path.relative(this.root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }
}
