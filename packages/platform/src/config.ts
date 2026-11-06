import path from 'node:path';

export interface PlatformConfig {
  mode: 'demo' | 'production';
  dataDir: string;
  /** ':memory:' for tests. Default: <dataDir>/bigforge.db */
  databaseFile: string;
  sessionSecret: string;
  /** Requested provider mode. Falls back to deterministic when live is not configured. */
  providerMode: 'deterministic' | 'live';
  /** Run queued jobs inside this process (default) or leave them to an external worker. */
  jobsMode: 'inline' | 'external';
  keepWorkspaces: boolean;
  env: Record<string, string | undefined>;
}

export const DEFAULT_DEMO_SESSION_SECRET = 'bigforge-demo-session-secret-not-for-production';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/**
 * Fails closed: only the exact values "demo" and "production" are accepted. An unset mode means demo on a
 * loopback address (local development); exposing public demo credentials on any other interface must be explicit.
 */
function parseMode(env: Record<string, string | undefined>): 'demo' | 'production' {
  const raw = env.BIGFORGE_MODE?.trim().toLowerCase();
  if (raw === 'demo' || raw === 'production') return raw;
  if (raw === undefined || raw === '') {
    const host = env.HOST?.trim().toLowerCase();
    if (host && !LOOPBACK_HOSTS.has(host))
      throw new ConfigError(
        `BIGFORGE_MODE is not set but HOST binds "${host}". Set BIGFORGE_MODE=production, or BIGFORGE_MODE=demo to deliberately expose the demo (public credentials) on that address`,
      );
    return 'demo';
  }
  throw new ConfigError(
    `BIGFORGE_MODE must be "demo" or "production" (received "${env.BIGFORGE_MODE ?? ''}")`,
  );
}

export function loadConfig(env: Record<string, string | undefined>): PlatformConfig {
  const mode = parseMode(env);
  const dataDir = path.resolve(env.BIGFORGE_DATA_DIR ?? '.bigforge');
  const sessionSecret = env.BIGFORGE_SESSION_SECRET ?? DEFAULT_DEMO_SESSION_SECRET;
  if (
    mode === 'production' &&
    (!env.BIGFORGE_SESSION_SECRET || env.BIGFORGE_SESSION_SECRET.length < 32)
  ) {
    throw new ConfigError(
      'BIGFORGE_SESSION_SECRET (at least 32 characters) is required in production mode',
    );
  }
  return {
    mode,
    dataDir,
    databaseFile: env.BIGFORGE_DATABASE_FILE ?? path.join(dataDir, 'bigforge.db'),
    sessionSecret,
    providerMode: env.BIGFORGE_PROVIDER_MODE === 'live' ? 'live' : 'deterministic',
    jobsMode: env.BIGFORGE_JOBS_MODE === 'external' ? 'external' : 'inline',
    keepWorkspaces: env.BIGFORGE_KEEP_WORKSPACES === '1',
    env,
  };
}
