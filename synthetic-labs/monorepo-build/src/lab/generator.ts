import type { LabEnvironment, ScenarioSpec } from './types';

export type RepoFiles = Record<string, string>;

const CATALOG: Record<string, string> = {
  jsonwebtoken: '9.0.2',
  bcryptjs: '2.4.3',
  'decimal.js': '10.4.3',
  pino: '9.5.0',
  clsx: '2.1.1',
  fastify: '5.0.0',
  react: '19.0.0',
};

interface WorkspaceDef {
  path: string;
  name: string;
  version: string;
  deps: Record<string, string>;
  owner: string;
  files: Record<string, string>;
}

const j = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function lines(...parts: string[]): string {
  return `${parts.join('\n')}\n`;
}

const WORKSPACES: WorkspaceDef[] = [
  {
    path: 'packages/core',
    name: '@acme/core',
    version: '1.9.0',
    owner: '@acme/platform-team',
    deps: {},
    files: {
      'src/format.ts': lines(
        'export function formatDate(date: Date): string {',
        '  return date.toISOString().slice(0, 10);',
        '}',
        '',
        "export function formatMoney(cents: number, currency = 'USD'): string {",
        '  return `${(cents / 100).toFixed(2)} ${currency}`;',
        '}',
        '',
        'export function formatBytes(bytes: number): string {',
        "  const units = ['B', 'KB', 'MB', 'GB'];",
        '  let value = bytes;',
        '  let unit = 0;',
        '  while (value >= 1024 && unit < units.length - 1) {',
        '    value /= 1024;',
        '    unit += 1;',
        '  }',
        '  return `${value.toFixed(1)} ${units[unit]}`;',
        '}',
      ),
      'src/util.ts': lines(
        'export function clamp(value: number, min: number, max: number): number {',
        '  return Math.min(max, Math.max(min, value));',
        '}',
        '',
        'export function joinClasses(...parts: string[]): string {',
        "  return parts.filter(Boolean).join(' ');",
        '}',
        '',
        'export function assertNever(value: never): never {',
        '  throw new Error(`Unexpected value: ${String(value)}`);',
        '}',
      ),
      'src/index.ts': lines("export * from './format';", "export * from './util';"),
      'src/format.test.ts': lines(
        "import { formatDate, formatMoney } from './format';",
        '',
        "describe('format', () => {",
        "  it('formats dates', () => {",
        "    expect(formatDate(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');",
        '  });',
        '',
        "  it('formats money', () => {",
        "    expect(formatMoney(1234)).toBe('12.34 USD');",
        '  });',
        '});',
      ),
    },
  },
  {
    path: 'packages/security',
    name: '@acme/security',
    version: '3.2.1',
    owner: '@acme/security-team',
    deps: { '@acme/core': '^1.9.0', jsonwebtoken: '^9.0.2' },
    files: {
      'src/token.ts': lines(
        "import jwt from 'jsonwebtoken';",
        "import { clamp } from '@acme/core';",
        '',
        'export interface TokenPayload {',
        '  sub: string;',
        '  scopes: string[];',
        '}',
        '',
        '/** Signs an arbitrary payload with a shared secret. Generic; carries no user semantics. */',
        'export function signToken(payload: Record<string, unknown>, secret: string): string {',
        "  return jwt.sign(payload, secret, { expiresIn: '1h' });",
        '}',
        '',
        '/** Issues an access token for a user id with the given scopes. */',
        'export function signAccessToken(userId: string, scopes: string[]): string {',
        '  const ttl = clamp(scopes.length * 600, 600, 3600);',
        "  return jwt.sign({ sub: userId, scopes }, process.env.TOKEN_SECRET ?? '', { expiresIn: ttl });",
        '}',
        '',
        'export function verifyToken(token: string, secret: string): TokenPayload {',
        '  return jwt.verify(token, secret) as TokenPayload;',
        '}',
      ),
      'src/password.ts': lines(
        "import { randomBytes, scryptSync } from 'node:crypto';",
        '',
        'export function hashPassword(password: string): string {',
        '  const salt = randomBytes(16);',
        "  return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`;",
        '}',
        '',
        'export function verifyPassword(password: string, stored: string): boolean {',
        "  const [salt, hash] = stored.split(':');",
        "  return scryptSync(password, Buffer.from(salt ?? '', 'hex'), 32).toString('hex') === hash;",
        '}',
      ),
      'src/index.ts': lines("export * from './token';", "export * from './password';"),
      'src/token.test.ts': lines(
        "import { signAccessToken, verifyToken } from './token';",
        '',
        "describe('token', () => {",
        "  it('round-trips an access token', () => {",
        "    expect(verifyToken(signAccessToken('u1', ['read']), 'secret').sub).toBe('u1');",
        '  });',
        '',
        "  it('rejects a tampered token', () => {",
        "    expect(() => verifyToken('x.y.z', 'secret')).toThrow();",
        '  });',
        '});',
      ),
    },
  },
  {
    path: 'packages/auth',
    name: '@acme/auth',
    version: '2.4.0',
    owner: '@acme/identity-team',
    deps: { '@acme/core': '^1.9.0', '@acme/security': '^3.2.1', bcryptjs: '^2.4.3' },
    files: {
      'src/session.ts': lines(
        "import { signAccessToken, verifyToken } from '@acme/security';",
        "import { clamp } from '@acme/core';",
        '',
        'export interface Session {',
        '  token: string;',
        '  ttlSeconds: number;',
        '}',
        '',
        'export function createSession(user: { id: string }, scopes: string[]): Session {',
        '  const token = signAccessToken(user.id, scopes);',
        '  return { token, ttlSeconds: clamp(scopes.length * 600, 600, 3600) };',
        '}',
        '',
        'export function readSession(token: string, secret: string) {',
        '  return verifyToken(token, secret);',
        '}',
      ),
      'src/password.ts': lines(
        "import bcrypt from 'bcryptjs';",
        "import { hashPassword } from '@acme/security';",
        '',
        'export async function rehash(password: string): Promise<string> {',
        '  const pre = hashPassword(password);',
        '  return bcrypt.hash(pre, 10);',
        '}',
      ),
      'src/index.ts': lines("export * from './session';", "export * from './password';"),
      'src/session.test.ts': lines(
        "import { createSession } from './session';",
        '',
        "describe('session', () => {",
        "  it('creates a scoped session', () => {",
        '    // @expect-call signAccessToken',
        "    expect(createSession({ id: 'u1' }, ['read']).ttlSeconds).toBe(600);",
        '  });',
        '});',
      ),
      'src/password.test.ts': lines(
        "import { rehash } from './password';",
        '',
        "describe('password', () => {",
        "  it('rehashes a password', async () => {",
        '    // @expect-call hashPassword',
        "    expect(await rehash('pw')).toBeTruthy();",
        '  });',
        '});',
      ),
    },
  },
  {
    path: 'packages/billing',
    name: '@acme/billing',
    version: '1.3.0',
    owner: '@acme/payments-team',
    deps: { '@acme/core': '^1.9.0', 'decimal.js': '^10.4.3' },
    files: {
      'src/invoice.ts': lines(
        "import Decimal from 'decimal.js';",
        "import { formatMoney } from '@acme/core';",
        '',
        'export function totalWithTax(cents: number, rate: number): string {',
        '  const total = new Decimal(cents).times(1 + rate).round();',
        '  return formatMoney(total.toNumber());',
        '}',
      ),
      'src/index.ts': lines("export * from './invoice';"),
      'src/invoice.test.ts': lines(
        "import { totalWithTax } from './invoice';",
        '',
        "describe('invoice', () => {",
        "  it('adds tax', () => {",
        "    expect(totalWithTax(1000, 0.2)).toBe('12.00 USD');",
        '  });',
        '});',
      ),
    },
  },
  {
    path: 'packages/telemetry',
    name: '@acme/telemetry',
    version: '0.8.4',
    owner: '@acme/observability-team',
    deps: { '@acme/core': '^1.9.0', pino: '^9.5.0' },
    files: {
      'src/logger.ts': lines(
        "import pino from 'pino';",
        "import { formatDate } from '@acme/core';",
        '',
        "export const logger = pino({ name: 'acme' });",
        '',
        'export function logEvent(name: string): void {',
        '  logger.info({ name, at: formatDate(new Date()) });',
        '}',
      ),
      'src/index.ts': lines("export * from './logger';"),
      'src/logger.test.ts': lines(
        "import { logEvent } from './logger';",
        '',
        "describe('logger', () => {",
        "  it('logs an event', () => {",
        "    expect(() => logEvent('boot')).not.toThrow();",
        '  });',
        '});',
      ),
    },
  },
  {
    path: 'packages/ui-kit',
    name: '@acme/ui-kit',
    version: '5.1.0',
    owner: '@acme/design-system-team',
    deps: { '@acme/core': '^1.9.0', clsx: '^2.1.1' },
    files: {
      'src/button.ts': lines(
        "import clsx from 'clsx';",
        "import { joinClasses } from '@acme/core';",
        '',
        "export function buttonClass(variant: 'primary' | 'ghost', disabled = false): string {",
        "  return joinClasses(clsx('btn', `btn-${variant}`, disabled && 'is-disabled'));",
        '}',
      ),
      'src/badge.ts': lines(
        "import { formatDate } from '@acme/core';",
        '',
        'export function badgeLabel(date: Date): string {',
        '  return `Updated ${formatDate(date)}`;',
        '}',
      ),
      'src/index.ts': lines("export * from './button';", "export * from './badge';"),
      'src/button.test.ts': lines(
        "import { buttonClass } from './button';",
        '',
        "describe('button', () => {",
        "  it('builds class names', () => {",
        "    expect(buttonClass('primary')).toContain('btn-primary');",
        '  });',
        '});',
      ),
    },
  },
  {
    path: 'apps/api',
    name: '@acme/api',
    version: '1.0.0',
    owner: '@acme/backend-team',
    deps: {
      '@acme/auth': '^2.4.0',
      '@acme/billing': '^1.3.0',
      '@acme/security': '^3.2.1',
      '@acme/telemetry': '^0.8.4',
      fastify: '^5.0.0',
    },
    files: {
      'src/server.ts': lines(
        "import Fastify from 'fastify';",
        "import { createSession } from '@acme/auth';",
        "import { totalWithTax } from '@acme/billing';",
        "import { verifyToken } from '@acme/security';",
        "import { logEvent } from '@acme/telemetry';",
        '',
        'export const app = Fastify();',
        "app.get('/health', () => ({ ok: true, session: createSession({ id: 'probe' }, []), total: totalWithTax(100, 0), v: verifyToken }));",
        "logEvent('api-boot');",
      ),
      'src/index.ts': lines("export * from './server';"),
      'src/server.test.ts': lines(
        "import { app } from './server';",
        '',
        "describe('server', () => {",
        "  it('exposes health', () => {",
        '    expect(app).toBeDefined();',
        '  });',
        '});',
      ),
    },
  },
  {
    path: 'apps/web',
    name: '@acme/web',
    version: '1.0.0',
    owner: '@acme/frontend-team',
    deps: {
      '@acme/auth': '^2.4.0',
      '@acme/telemetry': '^0.8.4',
      '@acme/ui-kit': '^5.1.0',
      react: '^19.0.0',
    },
    files: {
      'src/app.ts': lines(
        "import { createElement } from 'react';",
        "import { createSession } from '@acme/auth';",
        "import { logEvent } from '@acme/telemetry';",
        "import { buttonClass } from '@acme/ui-kit';",
        '',
        'export function App() {',
        "  logEvent('web-boot');",
        "  return createElement('button', { className: buttonClass('primary'), 'data-session': createSession({ id: 'anon' }, []).token });",
        '}',
      ),
      'src/index.ts': lines("export * from './app';"),
      'src/app.test.ts': lines(
        "import { App } from './app';",
        '',
        "describe('app', () => {",
        "  it('renders a button', () => {",
        '    expect(App).toBeDefined();',
        '  });',
        '});',
      ),
    },
  },
];

function packageJson(w: WorkspaceDef, deps: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
  return j({
    name: w.name,
    version: w.version,
    private: true,
    main: 'src/index.ts',
    dependencies: sorted,
  });
}

/** The healthy baseline repository: `forge-ci build` passes. */
export function healthyRepo(env: LabEnvironment, seed: number): RepoFiles {
  const files: RepoFiles = {
    'package.json': j({
      name: 'acme-platform',
      private: true,
      workspaces: ['packages/*', 'apps/*'],
    }),
    'forge.config.json': j({
      toolchain: { name: 'forge-ci', version: env.toolchainVersion },
      registry: 'https://registry.acme.internal',
      registryToken: 'frg_demo_NOT_A_REAL_SECRET_0001',
      buildSeed: seed,
    }),
    'forge.lock.json': j({ lockfileVersion: 1, catalog: CATALOG }),
    CODEOWNERS: `${WORKSPACES.map((w) => `/${w.path}/ ${w.owner}`).join('\n')}\n`,
  };
  for (const w of WORKSPACES) {
    files[`${w.path}/package.json`] = packageJson(w, w.deps);
    for (const [rel, text] of Object.entries(w.files)) files[`${w.path}/${rel}`] = text;
  }
  return files;
}

function replaceOnce(files: RepoFiles, file: string, search: string, replace: string): void {
  const text = files[file];
  if (text === undefined || !text.includes(search)) {
    throw new Error(`Lab generator invariant broken: "${search}" not found in ${file}`);
  }
  files[file] = text.split(search).join(replace);
}

/** Introduces the scenario's single root-cause fault into a healthy repository. */
function injectFault(files: RepoFiles, spec: ScenarioSpec): void {
  const ws = WORKSPACES.find((w) => w.path === spec.workspace);
  if (!ws) throw new Error(`Unknown workspace in scenario ${spec.id}: ${spec.workspace}`);
  const pkgFile = `${ws.path}/package.json`;

  if (spec.fault === 'missing_dependency') {
    const module = spec.detail.module;
    if (!module || !(module in ws.deps)) {
      throw new Error(`Scenario ${spec.id}: ${module ?? '?'} is not a dependency of ${ws.path}`);
    }
    const { [module]: _omitted, ...rest } = ws.deps;
    files[pkgFile] = packageJson(ws, rest);
    return;
  }

  if (spec.fault === 'version_mismatch') {
    const range = spec.detail.range ?? '^2.0.0';
    const dep = spec.detail.dependency ?? '@acme/core';
    replaceOnce(files, pkgFile, `"${dep}": "${ws.deps[dep] ?? ''}"`, `"${dep}": "${range}"`);
    return;
  }

  // missing_export: a consumer still uses a stale (renamed) export name.
  const requested = spec.detail.requested;
  const expected = spec.detail.expectedChoice;
  if (!requested || !expected) throw new Error(`Scenario ${spec.id}: missing export details`);
  const target = Object.keys(files).find(
    (f) =>
      f.startsWith(`${ws.path}/src/`) && !f.endsWith('.test.ts') && files[f]?.includes(expected),
  );
  if (!target) throw new Error(`Scenario ${spec.id}: no source in ${ws.path} uses ${expected}`);
  replaceOnce(files, target, expected, requested);
}

/** Deterministically materialises the files of a scenario's broken repository. */
export function scenarioRepo(spec: ScenarioSpec, env: LabEnvironment): RepoFiles {
  const files = healthyRepo(env, spec.seed);
  injectFault(files, spec);
  return files;
}

export const WORKSPACE_PATHS: readonly string[] = WORKSPACES.map((w) => w.path);
export function workspaceName(path: string): string | undefined {
  return WORKSPACES.find((w) => w.path === path)?.name;
}
export function catalogVersion(module: string): string | undefined {
  return CATALOG[module];
}
