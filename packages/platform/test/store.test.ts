import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/migrations';
import { MigrationError, migrate, openDatabase } from '../src/db/database';
import { type Actor, Platform, loadConfig } from '../src';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-store-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('migrates a clean database and is idempotent', () => {
    const db = openDatabase(':memory:');
    const first = migrate(db);
    expect(first.applied).toEqual(MIGRATIONS.map((m) => `${m.version}:${m.name}`));
    expect(migrate(db).applied).toEqual([]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    for (const t of [
      'tenants',
      'users',
      'tasks',
      'runs',
      'reflex_versions',
      'comparisons',
      'audit_events',
      'jobs',
      'ledger',
    ])
      expect(tables).toContain(t);
  });

  it('refuses to run when an applied migration was edited', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const edited = MIGRATIONS.map((m) => ({ ...m, sql: `${m.sql}\n-- tampered` }));
    expect(() => migrate(db, edited)).toThrow(MigrationError);
  });
});

describe('persistence, tenancy and audit integrity', () => {
  const file = () => path.join(dir, 'persist.db');

  it('survives a restart without re-seeding and keeps its data', async () => {
    const config = { ...loadConfig({ BIGFORGE_DATA_DIR: dir }), databaseFile: file() };
    let platform = await Platform.create(config);
    const ada = platform.actorFor('usr_ada') as Actor;
    const task = await platform.tasks.intake(ada, 'L1');
    platform.close();

    platform = await Platform.create(config);
    expect(platform.store.listTenants()).toHaveLength(2);
    const ts = platform.store.forTenant(ada.tenantId);
    expect(ts.tasks.get(ts.tenantId, task.id)?.scenarioId).toBe('L1');
    expect(platform.login('grace@acme.test', 'forge-demo').role).toBe('reviewer');
    expect(ts.verifyAudit().ok).toBe(true);
    platform.close();
  });

  it('cannot read or modify another tenant row by id', async () => {
    const platform = await Platform.create({
      ...loadConfig({ BIGFORGE_DATA_DIR: dir }),
      databaseFile: ':memory:',
    });
    const ada = platform.actorFor('usr_ada') as Actor;
    const task = await platform.tasks.intake(ada, 'L1');
    const other = platform.store.forTenant('ten_globex');
    expect(other.tasks.get('ten_globex', task.id)).toBeNull();
    expect(() => other.tasks.update('ten_globex', task.id, { title: 'hijack' })).toThrow();
    expect(other.tasks.list('ten_globex').total).toBe(0);
    expect(platform.store.forTenant(ada.tenantId).tasks.get(ada.tenantId, task.id)?.title).not.toBe(
      'hijack',
    );
    platform.close();
  });

  it('keeps audit history append-only and tamper-evident', async () => {
    const platform = await Platform.create({
      ...loadConfig({ BIGFORGE_DATA_DIR: dir }),
      databaseFile: ':memory:',
    });
    const ada = platform.actorFor('usr_ada') as Actor;
    platform.audit(ada, 'test.one', 'test', '1', 'first', {});
    platform.audit(ada, 'test.two', 'test', '2', 'second', {});
    const db = platform.store.db;
    expect(() => db.exec("UPDATE audit_events SET summary = 'edited'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM audit_events')).toThrow(/append-only/);
    expect(platform.store.forTenant(ada.tenantId).verifyAudit().ok).toBe(true);
    // An attacker with raw database access can drop the trigger, but the hash chain still exposes the edit.
    db.exec('DROP TRIGGER audit_events_no_update');
    db.exec("UPDATE audit_events SET summary = 'rewritten history' WHERE action = 'test.one'");
    const verdict = platform.store.forTenant(ada.tenantId).verifyAudit();
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSeq).not.toBeNull();
    platform.close();
  });

  it('leaves jobs to an external worker when configured, and the worker drains them', async () => {
    const platform = await Platform.create({
      ...loadConfig({ BIGFORGE_DATA_DIR: dir, BIGFORGE_JOBS_MODE: 'external' }),
      databaseFile: ':memory:',
    });
    const linus = platform.actorFor('usr_linus') as Actor;
    const job = platform.jobs.enqueue(linus, 'learn.batch', { scenarioIds: ['L1'] });
    platform.jobs.kick();
    await new Promise((r) => setTimeout(r, 100));
    const ts = platform.store.forTenant(linus.tenantId);
    expect(ts.jobs.get(ts.tenantId, job.id)?.status).toBe('queued');
    await platform.jobs.drain();
    const done = ts.jobs.get(ts.tenantId, job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.progress.done).toBe(1);
    platform.close();
  });
});
