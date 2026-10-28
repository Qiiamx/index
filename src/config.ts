import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(8090),
  dataDir: z.string().min(1).default('data'),
});

export interface AppConfig {
  port: number;
  dataDir: string;
  databasePath: string;
  viewsDir: string;
  publicDir: string;
  htmxPath: string;
}

export function loadConfig(): AppConfig {
  const file = path.resolve('config.json');
  let raw: unknown = {};
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  }
  const parsed = configSchema.parse(raw);
  const port = process.env.PORT ? Number(process.env.PORT) : parsed.port;
  const dataDir = path.resolve(process.env.DATA_DIR ?? parsed.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = path.join(here, 'web');

  return {
    port,
    dataDir,
    databasePath: path.join(dataDir, 'index.db'),
    viewsDir: path.join(webRoot, 'views'),
    publicDir: path.join(webRoot, 'public'),
    htmxPath: path.resolve('node_modules/htmx.org/dist/htmx.min.js'),
  };
}
