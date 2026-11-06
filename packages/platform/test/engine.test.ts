import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileReflex } from '@bigforge/core';
import { DEFAULT_ENVIRONMENT, getScenario, LEARNING_IDS } from '@bigforge/lab-monorepo';
import type { ReflexSpec, Trace } from '@bigforge/schemas';
import { createEngine, preparerFor } from '../src/engine';
import { type EngineDeps, materialize, runBaseline, runReflex } from '../src/execution';

let dir: string;
let deps: EngineDeps;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-engine-'));
  deps = await createEngine({ dataDir: dir });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('engine end to end (deterministic provider, real sandboxed commands)', () => {
  const learning: Trace[] = [];
  let reflex: ReflexSpec;

  it('baseline agent solves every learning scenario and the independent verifier agrees', async () => {
    for (const id of LEARNING_IDS) {
      const spec = getScenario(id);
      const mt = await materialize(deps, spec, DEFAULT_ENVIRONMENT);
      const run = await runBaseline(deps, mt, { taskId: `task-${id}`, kind: 'baseline' });
      await mt.dispose();
      expect(
        run.trace.verification.rules.map((r) => `${r.id}:${r.status}`),
        `${id} verification`,
      ).toEqual([
        'original_failure_gone:pass',
        'relevant_tests_pass:pass',
        'no_unrelated_changes:pass',
        'security_policy_pass:pass',
      ]);
      expect(run.trace.outcome.status, id).toBe('success');
      expect(run.trace.usage.modelCalls).toBeGreaterThanOrEqual(8);
      expect(run.trace.usage.tokenProvenance).toBe('synthetic');
      learning.push(run.trace);
    }
    const l4 = learning.find((t) => t.task.scenarioId === 'L4');
    expect(
      l4?.usage.blockedActions,
      'L4 includes a blocked destructive proposal',
    ).toBeGreaterThanOrEqual(1);
    console.log(
      learning
        .map(
          (t) =>
            `${t.task.scenarioId}: ${t.usage.modelCalls} calls, ${t.usage.totalTokens} tokens (cached ${t.usage.cachedInputTokens}), ${t.usage.commands} cmds, $${t.usage.costUsd.toFixed(4)}`,
        )
        .join('\n'),
    );
  });

  it('compiles a Reflex from the learning traces and chooses operators by consistency', async () => {
    const { spec, report } = await compileReflex({
      traces: learning,
      library: deps.library,
      prepare: preparerFor(deps, () => DEFAULT_ENVIRONMENT),
      familyId: 'fam_test',
      name: 'first-causal-error',
      ids: deps.ids,
      clock: deps.clock,
      pricing: deps.pricing,
    });
    reflex = spec;
    console.log(spec.steps.map((s) => `${s.id}[${s.kind}] ${s.operator.id}`).join(' -> '));
    console.log(
      report.columns.map((c) => `${c.key}:${c.classification}:${c.replacedBy ?? '-'}`).join('\n'),
    );
    expect(spec.steps.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        'ingest',
        'graph',
        'normalize',
        'locate',
        'map',
        'diagnose',
        'decide',
        'patch',
        'rebuild',
        'test',
        'verify',
        'report',
      ]),
    );
    const locate = spec.steps.find((s) => s.id === 'locate');
    expect(locate?.operator.id).toBe('local.locate_by_log_order');
    expect(locate?.rationale.alternatives.every((a) => a.consistent)).toBe(true);
    expect(report.excludedBehaviours.map((e) => e.purpose)).toContain('clean_install_attempt');
  });

  it('a known task runs through the Reflex with zero model calls and passes independent verification', async () => {
    const spec = getScenario('S1');
    const mt = await materialize(deps, spec, DEFAULT_ENVIRONMENT);
    const run = await runReflex(deps, mt, reflex, {
      taskId: 'task-S1',
      kind: 'shadow_reflex',
      reflexId: 'rfx',
      allowBoundary: true,
    });
    const base = await runBaseline(deps, await materialize(deps, spec, DEFAULT_ENVIRONMENT), {
      taskId: 'task-S1',
      kind: 'shadow_baseline',
    });
    await mt.dispose();
    expect(run.execution?.stopReason).toBeNull();
    expect(run.trace.outcome.status).toBe('success');
    expect(run.trace.usage.modelCalls).toBe(0);
    expect(run.trace.usage.totalTokens).toBe(0);
    expect(run.trace.usage.localSteps).toBeGreaterThanOrEqual(12);
    expect(run.trace.outcome.rootFailure?.workspace).toBe(
      base.trace.outcome.rootFailure?.workspace,
    );
    expect(run.changes.map((c) => c.after)).toEqual(base.changes.map((c) => c.after));
    console.log(
      `S1 reflex: ${run.trace.usage.commands} cmds, ${run.trace.usage.localMs.toFixed(0)}ms local | baseline: ${base.trace.usage.modelCalls} calls ${base.trace.usage.totalTokens} tokens`,
    );
  });

  it('the ambiguous held-out task crosses exactly one uncertainty boundary through the Token Firewall', async () => {
    const spec = getScenario('K1');
    const mt = await materialize(deps, spec, DEFAULT_ENVIRONMENT);
    const run = await runReflex(deps, mt, reflex, {
      taskId: 'task-K1',
      kind: 'reflex',
      reflexId: 'rfx',
      allowBoundary: true,
    });
    await mt.dispose();
    expect(run.execution?.stopReason).toBeNull();
    expect(run.trace.outcome.status).toBe('success');
    expect(run.boundaries).toHaveLength(1);
    const b = run.boundaries[0]!;
    expect(b.decision.path).toEqual(['REDUCE_CONTEXT', 'USE_SMALLER_MODEL', 'ALLOW']);
    expect(b.answer?.choiceId).toBe('signAccessToken');
    expect(b.decision.tokensSelected).toBeLessThan(b.decision.tokensConsidered / 3);
    expect(run.trace.usage.modelCalls).toBe(1);
    console.log(
      `K1 boundary: considered ${b.decision.tokensConsidered} -> selected ${b.decision.tokensSelected} tokens; call ${b.call?.inputTokens} in / ${b.call?.outputTokens} out on ${b.call?.model}`,
    );
    console.log(b.decision.rejected.map((r) => `${r.source}(${r.tokens})`).join(', '));
  });

  it('drift: a minor toolchain update reorders the log; the Reflex stops instead of acting on a wrong root cause', async () => {
    const drift = { toolchainVersion: '1.5.0' as const };
    const results: string[] = [];
    for (const id of ['S1', 'S5', 'S6', 'S10']) {
      const spec = getScenario(id);
      const mt = await materialize(deps, spec, drift);
      const run = await runReflex(deps, mt, reflex, {
        taskId: `task-${id}`,
        kind: 'canary_reflex',
        reflexId: 'rfx',
        allowBoundary: true,
      });
      await mt.dispose();
      results.push(
        `${id}: ${run.trace.outcome.status} ${run.execution?.stopReason ?? ''} root=${run.trace.outcome.rootFailure?.workspace ?? '-'}`,
      );
    }
    console.log(results.join('\n'));
    expect(results.join('\n')).toMatch(/S5: stopped/);
  });
});
