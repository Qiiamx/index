import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

await copy(join(root, 'src/web/views'), join(root, 'dist/web/views'));
await copy(join(root, 'src/web/public'), join(root, 'dist/web/public'));
console.log('copied web assets to dist/web');
