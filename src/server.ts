import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp();

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  app.log.info(`Index server: http://127.0.0.1:${config.port}`);
  app.log.info(`Data directory: ${config.dataDir}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
