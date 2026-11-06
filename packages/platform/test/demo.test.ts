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
    const t0 = Date.now();
    const state = await platform.demo.perform(grace, 25);
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`25 steps in ${seconds}s`);
    expect(state.completed).toHaveLength(25);

    const ts = platform.store.forTenant(grace.tenantId);
    const versions = ts.versions.all(ts.tenantId, { order: 'created_at ASC' });
    console.log(
      versions
        .map((v) => `${v.spec.name} v${v.version} ${v.status} conf=${v.confidence.toFixed(2)}`)
        .join('\n'),
    );

    const original = versions[0];
    const mutated = versions[1];
    expect(original?.status).toBe('shadow');
    expect(mutated?.status).toBe('candidate');
    expect(mutated?.spec.provenance.mutationOf?.reflexVersion).toBe('1.0.0');

    const mutation = ts.mutations.all(ts.tenantId)[0];
    expect(mutation?.status).toBe('proposed');
    expect(mutation?.evidence.activated).toBe(false);
    console.log(JSON.stringify(mutation?.diff), mutation?.evidence.regression.agreement);

    const audit = ts.verifyAudit();
    expect(audit.ok).toBe(true);
    console.log(`audit events: ${audit.count}`);
  });

  it('records the headline numbers honestly', () => {
    const ts = platform.store.forTenant(grace.tenantId);
    const killer = platform.demo.state(grace).context.killerRunId as string;
    const run = ts.runs.get(ts.tenantId, killer);
    expect(run?.usage.modelCalls).toBe(1);
    const b = run?.exec?.boundaries[0];
    console.log(
      `KILLER: calls=${run?.usage.modelCalls} tokens=${run?.usage.totalTokens} considered=${b?.decision.tokensConsidered} selected=${b?.decision.tokensSelected} path=${b?.decision.path.join('>')}`,
    );
    const econ = platform.economics.compute(ts);
    console.log(
      JSON.stringify(
        {
          baseline: econ.baseline,
          reuse: econ.reuse,
          perExec: econ.perExecution,
          invest: econ.investment.totalTokens,
          realized: econ.realized,
          projected: econ.projected,
          crr: econ.crr,
        },
        null,
        1,
      ),
    );
    const drift = ts.driftChecks.all(ts.tenantId)[0];
    console.log(
      JSON.stringify(
        {
          verdict: drift?.verdict,
          first: drift?.detail.firstDivergence,
          tr: drift?.detail.transitions,
        },
        null,
        1,
      ),
    );
  });
});
