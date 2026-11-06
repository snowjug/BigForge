import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, Platform, loadConfig } from '../src';

let dir: string;
let platform: Platform;
let grace: Actor;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-integrity-'));
  platform = await Platform.create({
    ...loadConfig({ BIGFORGE_DATA_DIR: dir }),
    databaseFile: ':memory:',
  });
  grace = platform.actorFor('usr_grace') as Actor;
  // Steps 1-10: learn, replay, shadow and compare. The candidate now awaits a human decision.
  await platform.demo.perform(grace, 10);
}, 300_000);

afterAll(async () => {
  platform.close();
  await rm(dir, { recursive: true, force: true });
});

describe('Reflex integrity is enforced by the platform, not only by the executor', () => {
  it('refuses to promote a specification that no longer matches its recorded hash', () => {
    const ts = platform.store.forTenant(grace.tenantId);
    const version = ts.versions.all(ts.tenantId)[0];
    if (!version) throw new Error('expected a candidate Reflex after step 10');
    expect(version.status).toBe('approval');
    expect(platform.validation.versionDto(grace, ts, version).integrity.ok).toBe(true);

    // Simulates a row edited outside the application (the content hash is left untouched).
    ts.versions.update(ts.tenantId, version.id, {
      spec: { ...version.spec, name: `${version.spec.name} (edited)` },
    });

    expect(() => platform.validation.promote(grace, version.id, 'Looks fine')).toThrow(
      /Integrity check failed/,
    );
    const stored = ts.versions.get(ts.tenantId, version.id);
    expect(stored?.status).toBe('approval');
    expect(platform.validation.versionDto(grace, ts, stored ?? version).integrity.ok).toBe(false);

    const failures = ts.listAudit({ action: 'reflex.integrity_failed' });
    expect(failures.items).toHaveLength(1);
    expect(failures.items[0]?.subjectId).toBe(version.id);
    expect(ts.verifyAudit().ok).toBe(true);

    // Put the specification back so the next test can promote this version.
    ts.versions.update(ts.tenantId, version.id, { spec: version.spec });
    expect(platform.validation.versionDto(grace, ts, version).integrity.ok).toBe(true);
  });

  it('records a fast-forward approval as a simulated one, never as a named reviewer', async () => {
    const linus = platform.actorFor('usr_linus') as Actor;
    await expect(platform.demo.seed(linus, 'promoted')).rejects.toMatchObject({ status: 403 });

    await platform.demo.seed(grace, 'promoted');
    const ts = platform.store.forTenant(grace.tenantId);
    const approval = ts.approvals.all(ts.tenantId)[0];
    expect(approval?.actorUserId).toBe('system');
    expect(approval?.actorName).toMatch(/simulated reviewer/);
    expect(approval?.evidence).toMatchObject({ seeded: true });
    const promoted = ts.listAudit({ action: 'reflex.promoted' }).items[0];
    expect(promoted?.details).toMatchObject({ human: false, seeded: true });
    expect(promoted?.actor).not.toBe(grace.name);
  });
});
