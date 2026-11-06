import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, ConfigError, Platform, loadConfig } from '../src';

let dir: string;
let platform: Platform;
let grace: Actor;
let linus: Actor;
let vera: Actor;
let gus: Actor;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-security-'));
  platform = await Platform.create({
    ...loadConfig({ BIGFORGE_DATA_DIR: path.join(dir, 'demo') }),
    databaseFile: ':memory:',
  });
  grace = platform.actorFor('usr_grace') as Actor;
  linus = platform.actorFor('usr_linus') as Actor;
  vera = platform.actorFor('usr_vera') as Actor;
  gus = platform.actorFor('usr_gus') as Actor;
});
afterAll(async () => {
  platform.close();
  await rm(dir, { recursive: true, force: true });
});

const rejection = async (promise: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (err) {
    return err as { status?: number; code?: string; message: string };
  }
  throw new Error('expected a rejection');
};

describe('deployment mode fails closed', () => {
  it('accepts only demo or production (case-insensitively) and rejects anything else', () => {
    expect(loadConfig({}).mode).toBe('demo');
    expect(loadConfig({ BIGFORGE_MODE: ' Demo ' }).mode).toBe('demo');
    const secret = 'x'.repeat(40);
    expect(loadConfig({ BIGFORGE_MODE: 'Production', BIGFORGE_SESSION_SECRET: secret }).mode).toBe(
      'production',
    );
    for (const typo of ['prod', 'live', 'true', '1']) {
      expect(() => loadConfig({ BIGFORGE_MODE: typo }), typo).toThrow(ConfigError);
    }
  });

  it('refuses to serve public demo credentials on a network address by omission', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/BIGFORGE_MODE/);
    expect(loadConfig({ HOST: '127.0.0.1' }).mode).toBe('demo');
    expect(loadConfig({ HOST: '0.0.0.0', BIGFORGE_MODE: 'demo' }).mode).toBe('demo');
  });

  it('refuses to start in production against a database that holds demo identities', async () => {
    const file = path.join(dir, 'reused.db');
    const demo = await Platform.create({
      ...loadConfig({ BIGFORGE_DATA_DIR: path.join(dir, 'reused') }),
      databaseFile: file,
    });
    demo.close();
    const production = loadConfig({
      BIGFORGE_MODE: 'production',
      BIGFORGE_SESSION_SECRET: 'p'.repeat(40),
      BIGFORGE_DATA_DIR: path.join(dir, 'reused'),
    });
    const err = await rejection(Platform.create({ ...production, databaseFile: file }));
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toMatch(/demo identities/);
  });

  it('exposes no guided demo in production mode', async () => {
    const production = await Platform.create({
      ...loadConfig({
        BIGFORGE_MODE: 'production',
        BIGFORGE_SESSION_SECRET: 'p'.repeat(40),
        BIGFORGE_DATA_DIR: path.join(dir, 'prod'),
        BIGFORGE_BOOTSTRAP_ADMIN_EMAIL: 'root@example.test',
        BIGFORGE_BOOTSTRAP_ADMIN_PASSWORD: 'a-long-bootstrap-password',
      }),
      databaseFile: ':memory:',
    });
    try {
      const admin = production.actorFor('usr_admin') as Actor;
      expect(admin.role).toBe('admin');
      expect(production.personas()).toEqual([]);
      for (const call of [
        () => production.demo.state(admin),
        () => production.demo.goto(admin, 2),
        () => production.demo.perform(admin, 1),
        () => production.demo.seed(admin, 'learned'),
        () => production.reset(admin),
      ]) {
        const err = await rejection(call);
        expect([403, 404]).toContain(err.status);
      }
    } finally {
      production.close();
    }
  });
});

describe('role and tenant boundaries of the demo and validation services', () => {
  it('does not let an operator fast-forward through the human approval', async () => {
    const err = await rejection(platform.demo.seed(linus, 'promoted'));
    expect(err.status).toBe(403);
    expect(platform.demo.state(grace).completed).toEqual([]);
  });

  it('does not let a read-only role move the shared presenter cursor or re-match tasks', async () => {
    expect((await rejection(() => platform.demo.goto(vera, 5))).status).toBe(403);
    expect((await rejection(() => platform.tasks.matchTask(vera, 'tsk_x'))).status).toBe(403);
  });

  it('does not let another tenant reset the shared demo database', async () => {
    const err = await rejection(platform.reset(gus));
    expect(err.status).toBe(403);
    expect(platform.store.listTenants().length).toBeGreaterThan(1);
  });

  it('does not leak one tenant demo context into another', async () => {
    await platform.demo.perform(grace, 1);
    const acme = platform.demo.state(grace).context.taskIds;
    expect(Object.keys(acme).length).toBeGreaterThan(0);
    expect(platform.demo.state(gus).context.taskIds).toEqual({});
  });

  it('only accepts the held-out shadow scenarios as shadow evidence', async () => {
    for (const ids of [['L1'], ['K1'], ['S1', 'L2'], []]) {
      const err = await rejection(platform.validation.shadow(grace, 'rfv_any', ids));
      expect(err.status, ids.join(',')).toBe(400);
    }
  });
});
