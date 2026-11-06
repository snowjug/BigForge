import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BOUNDARY_POLICY_ID,
  CompileError,
  DEFAULT_FIREWALL_POLICY,
  compileReflex,
} from '@bigforge/core';
import {
  DEFAULT_ENVIRONMENT,
  LEARNING_IDS,
  getScenario,
  monorepoAgentPolicy,
} from '@bigforge/lab-monorepo';
import { DeterministicProvider, type Provider } from '@bigforge/providers';
import type { ReflexSpec, Trace } from '@bigforge/schemas';
import { createEngine, preparerFor } from '../src/engine';
import { type EngineDeps, materialize, runBaseline, runReflex } from '../src/execution';

let dir: string;
let deps: EngineDeps;
let traces: Trace[];
let spec: ReflexSpec;

const compile = (t: Trace[], d: EngineDeps = deps) =>
  compileReflex({
    traces: t,
    library: d.library,
    prepare: preparerFor(d, () => DEFAULT_ENVIRONMENT),
    familyId: 'fam',
    name: 'first-causal-error',
    ids: d.ids,
    clock: d.clock,
    pricing: d.pricing,
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-hard-'));
  deps = await createEngine({ dataDir: dir });
  traces = [];
  for (const id of LEARNING_IDS) {
    const mt = await materialize(deps, getScenario(id), DEFAULT_ENVIRONMENT);
    traces.push((await runBaseline(deps, mt, { taskId: `t-${id}`, kind: 'baseline' })).trace);
    await mt.dispose();
  }
  spec = (await compile(traces)).spec;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const withProvider = async (provider: Provider, firewall = DEFAULT_FIREWALL_POLICY) => ({
  ...(await createEngine({ dataDir: dir, provider })),
  firewallPolicy: firewall,
});

async function runK1(
  d: EngineDeps,
  s: ReflexSpec,
  allowBoundary = true,
  env = DEFAULT_ENVIRONMENT,
) {
  const mt = await materialize(d, getScenario('K1'), env);
  try {
    return await runReflex(d, mt, s, {
      taskId: 'k1',
      kind: 'reflex',
      reflexId: 'rfx',
      allowBoundary,
    });
  } finally {
    await mt.dispose();
  }
}

describe('cold-start protection and honest compilation', () => {
  it('refuses to learn from a single lucky run', async () => {
    const err = await compile(traces.slice(0, 1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CompileError);
    expect((err as CompileError).reasons.join(' ')).toMatch(/Cold-start protection/);
  });

  it('requires variation across the traces', async () => {
    const sameVariant = traces
      .slice(0, 3)
      .map((t) => ({ ...t, task: { ...t.task, variantKey: 'one-variant' } }));
    const err = await compile(sameVariant).catch((e: unknown) => e);
    expect((err as CompileError).reasons.join(' ')).toMatch(/Variation analysis/);
  });

  it('compiles only from verified successes of the right kind', async () => {
    const failed = traces.map((t, i) =>
      i === 0 ? { ...t, outcome: { ...t.outcome, status: 'failed' as const } } : t,
    );
    expect(
      ((await compile(failed).catch((e: unknown) => e)) as CompileError).reasons.join(' '),
    ).toMatch(/did not succeed/);
    const unverified = traces.map((t, i) =>
      i === 0 ? { ...t, verification: { ...t.verification, status: 'fail' as const } } : t,
    );
    expect(
      ((await compile(unverified).catch((e: unknown) => e)) as CompileError).reasons.join(' '),
    ).toMatch(/not verified/);
    const wrongKind = traces.map((t, i) =>
      i === 0 ? { ...t, runKind: 'canary_baseline' as const } : t,
    );
    expect(
      ((await compile(wrongKind).catch((e: unknown) => e)) as CompileError).reasons.join(' '),
    ).toMatch(/compile only from baseline/);
  });

  it('never compiles blocked destructive behaviour and records it as excluded', async () => {
    const { report, spec: s } = await compile(traces);
    expect(
      report.excludedBehaviours.find((e) => e.purpose === 'clean_install_attempt')?.reason,
    ).toMatch(/blocked by the safety policy/);
    expect(JSON.stringify(s)).not.toMatch(/rm -rf|clean_install/);
  });

  it('declares least-privilege permissions that never include protected paths', () => {
    expect(spec.permissions.write.every((g) => /^(packages|apps)\//.test(g))).toBe(true);
    expect(spec.permissions.commands).toEqual([
      { program: 'forge-ci', subcommands: ['build', 'graph', 'test'] },
    ]);
    expect(spec.permissions.limits).toMatchObject({ network: false, secrets: 'none' });
  });

  it('records the assumption that makes it fragile, so a reviewer can see it', () => {
    expect(spec.provenance.assumptions.join('\n')).toMatch(
      /lists a workspace failure before the failures it causes/,
    );
  });
});

describe('executor: stops instead of improvising', () => {
  it('rejects a tampered specification', async () => {
    const bad = { ...spec, steps: [] } as unknown as ReflexSpec;
    expect((await runK1(deps, bad)).execution?.stopReason).toMatch(/invalid_spec/);
  });

  it('rejects cyclic or dangling step graphs', async () => {
    const cyc = structuredClone(spec);
    (cyc.steps[0] as { dependsOn: string[] }).dependsOn = [
      cyc.steps[cyc.steps.length - 1]?.id ?? 'x',
    ];
    expect((await runK1(deps, cyc)).execution?.stopReason).toMatch(/invalid_graph/);
  });

  it('stops on an unknown operator', async () => {
    const s = structuredClone(spec);
    s.steps[1] = {
      ...(s.steps[1] as ReflexSpec['steps'][number]),
      operator: { id: 'local.does_not_exist', version: '1.0.0' },
    };
    expect((await runK1(deps, s)).execution?.stopReason).toMatch(/unknown_operator/);
  });

  it('enforces its declared permissions at run time and changes nothing when denied', async () => {
    const s = structuredClone(spec);
    s.permissions.write = [];
    const run = await runK1(deps, s);
    expect(run.execution?.stopReason).toMatch(/sandbox_violation: write_not_granted/);
    expect(run.changes).toHaveLength(0);
    expect(run.trace.usage.blockedActions).toBeGreaterThan(0);
    expect(run.trace.outcome.status).toBe('stopped');
  });

  it('refuses to run outside its compatible toolchain range', async () => {
    const s = structuredClone(spec);
    s.preconditions = [{ op: 'in', left: { ref: 'env.toolchain_major' }, right: { const: [2] } }];
    expect((await runK1(deps, s)).execution?.stopReason).toMatch(/precondition_failed/);
  });

  it('does not call a model when boundaries are disabled, and stops safely', async () => {
    const run = await runK1(deps, spec, false);
    expect(run.trace.usage.modelCalls).toBe(0);
    expect(run.execution?.stopReason).toMatch(/needs_escalation/);
    expect(run.changes).toHaveLength(0);
  });

  it('validates model output: garbage and out-of-set answers stop the Reflex', async () => {
    const garbage = await withProvider(
      new DeterministicProvider([
        monorepoAgentPolicy(),
        { id: BOUNDARY_POLICY_ID, respond: () => ({ text: 'I think you should delete the repo' }) },
      ]),
    );
    expect((await runK1(garbage, spec)).execution?.stopReason).toBe('boundary_invalid_output');
    const outOfSet = await withProvider(
      new DeterministicProvider([
        monorepoAgentPolicy(),
        {
          id: BOUNDARY_POLICY_ID,
          respond: () => ({ text: '{"choiceId":"rm -rf /","rationale":"x","confidence":1}' }),
        },
      ]),
    );
    const run = await runK1(outOfSet, spec);
    expect(run.execution?.stopReason).toBe('boundary_invalid_output');
    expect(run.changes).toHaveLength(0);
  });

  it('falls back safely when the provider fails', async () => {
    const failing: Provider = {
      id: 'x',
      mode: 'live',
      modelFor: () => 'm',
      complete: () => Promise.reject(new Error('provider down')),
    };
    const run = await runK1(await withProvider(failing), spec);
    expect(run.execution?.stopReason).toBe('boundary_provider_error');
    expect(run.execution?.boundaries[0]?.outcome).toBe('provider_error');
  });

  it('stops when the Token Firewall denies the call', async () => {
    const run = await runK1(
      await withProvider(deps.provider, { ...DEFAULT_FIREWALL_POLICY, maxCallsPerRun: 0 }),
      spec,
    );
    expect(run.execution?.stopReason).toBe('boundary_denied');
    expect(run.trace.usage.modelCalls).toBe(0);
  });

  it('catches a plausible but wrong repair: the independent verifier fails it', async () => {
    // A model that picks the name-similar export compiles fine but breaks the contract test.
    const wrong = await withProvider(
      new DeterministicProvider([
        monorepoAgentPolicy(),
        {
          id: BOUNDARY_POLICY_ID,
          respond: () => ({
            text: '{"choiceId":"signToken","rationale":"closest name","confidence":0.9}',
          }),
        },
      ]),
    );
    const run = await runK1(wrong, spec);
    const rules = Object.fromEntries(run.trace.verification.rules.map((r) => [r.id, r.status]));
    expect(rules.original_failure_gone).toBe('pass');
    expect(rules.relevant_tests_pass).toBe('fail');
    expect(run.trace.outcome.status).not.toBe('success');
  });
});
