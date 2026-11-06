import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, Platform, loadConfig } from '../src';

let dir: string;
let platform: Platform;
let grace: Actor;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-demo-'));
  platform = await Platform.create({
    ...loadConfig({ BIGFORGE_DATA_DIR: dir }),
    databaseFile: ':memory:',
  });
  grace = platform.actorFor('usr_grace') as Actor;
});
afterAll(async () => {
  platform.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the complete 25-step demo runs end to end through the real services', () => {
  it('performs every step and ends with a proposed (not activated) mutation', async () => {
    const state = await platform.demo.perform(grace, 25);
    expect(state.completed).toHaveLength(25);

    const ts = platform.store.forTenant(grace.tenantId);
    const versions = ts.versions.all(ts.tenantId, { order: 'created_at ASC' });
    const original = versions[0];
    const mutated = versions[1];
    expect(original?.status).toBe('shadow');
    expect(mutated?.status).toBe('candidate');
    expect(mutated?.spec.provenance.mutationOf?.reflexVersion).toBe('1.0.0');

    const mutation = ts.mutations.all(ts.tenantId)[0];
    expect(mutation?.status).toBe('proposed');
    expect(mutation?.evidence.activated).toBe(false);

    expect(ts.verifyAudit().ok).toBe(true);
  }, 300_000);

  it('records the headline numbers honestly', () => {
    const ts = platform.store.forTenant(grace.tenantId);
    const killer = platform.demo.state(grace).context.killerRunId as string;
    const run = ts.runs.get(ts.tenantId, killer);
    expect(run?.usage.modelCalls).toBe(1);
    const boundary = run?.exec?.boundaries[0];
    expect(boundary?.decision.path).toContain('ALLOW');
    expect(boundary?.decision.tokensSelected).toBeLessThan(
      (boundary?.decision.tokensConsidered ?? 0) / 10,
    );

    const econ = platform.economics.compute(ts);
    expect(econ.baseline.samples).toBeGreaterThanOrEqual(5);
    expect(econ.baseline.meanModelCalls).toBeGreaterThanOrEqual(8);
    expect(econ.reuse.meanModelCalls).toBeLessThan(econ.baseline.meanModelCalls / 3);
    expect(econ.perExecution.tokensAvoided).toBeGreaterThan(10_000);
    expect(econ.projected.provenance).toBe('estimated');
    expect(econ.projected.roi ?? 0).toBeGreaterThan(1);
    expect(econ.projected.breakEvenExecutions).not.toBeNull();

    const drift = ts.driftChecks.all(ts.tenantId)[0];
    expect(drift?.verdict.drift).toBe(true);
    expect(drift?.verdict.currentAgreement).toBeLessThan(drift?.verdict.historicAgreement ?? 0);
  });
});
