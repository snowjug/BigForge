import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Platform, loadConfig } from '@bigforge/platform';
import { buildApp } from './app';

/**
 * Starts the BigForge server: API + (when built) the web app, with the job runner in-process.
 * Binds to 127.0.0.1 by default. In container deployments set HOST=0.0.0.0.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const platform = await Platform.create(config);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = process.env.BIGFORGE_WEB_DIR ?? path.resolve(here, '../web');
  const app = await buildApp(platform, { webDir, logger: true });
  const port = Number(process.env.PORT ?? 4747);
  const host = process.env.HOST ?? '127.0.0.1';

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    platform.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port, host });
  app.log.info(`BigForge (${config.mode} mode) listening on http://${host}:${port}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
