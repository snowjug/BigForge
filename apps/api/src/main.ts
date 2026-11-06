import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTelemetry } from '@bigforge/observability';
import { Platform, loadConfig } from '@bigforge/platform';
import { buildApp } from './app';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/**
 * A server bound to loopback only accepts loopback Host headers (DNS-rebinding defence), plus any host
 * names in BIGFORGE_ALLOWED_HOSTS. On other addresses the check applies only when that list is set.
 */
function allowedHostsFor(bindHost: string, extra: string | undefined): string[] | undefined {
  const listed = (extra ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!LOOPBACK_HOSTS.has(bindHost.toLowerCase()) && listed.length === 0) return undefined;
  return [...new Set(['localhost', '127.0.0.1', '[::1]', ...listed])];
}

/**
 * Starts the BigForge server: API + (when built) the web app, with the job runner in-process.
 * Binds to 127.0.0.1 by default. In container deployments set HOST=0.0.0.0.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const telemetry = await setupTelemetry(process.env);
  const platform = await Platform.create(config);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = process.env.BIGFORGE_WEB_DIR ?? path.resolve(here, '../web');
  const port = Number(process.env.PORT ?? 4747);
  const host = process.env.HOST ?? '127.0.0.1';
  const app = await buildApp(platform, {
    webDir,
    logger: true,
    allowedHosts: allowedHostsFor(host, process.env.BIGFORGE_ALLOWED_HOSTS),
    trustProxyHops: Number.parseInt(process.env.BIGFORGE_TRUST_PROXY_HOPS ?? '0', 10) || 0,
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    platform.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  app.log.info({ telemetry: telemetry.exporter }, telemetry.note);
  await app.listen({ port, host });
  app.log.info(`BigForge (${config.mode} mode) listening on http://${host}:${port}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
