import type {
  AuditEventDto,
  DriftCheckDto,
  EnvironmentDto,
  MutationDto,
  ReflexStep,
  TransitionDto,
} from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  agreementCounts,
  assumptionClause,
  canaryBlocker,
  canaryRows,
  compareVersions,
  confidenceFall,
  decisionBlocker,
  describeFracture,
  describeStepChange,
  describeStopReason,
  divergenceHistogram,
  downstreamOf,
  driftStatus,
  environmentChanges,
  fractureStates,
  lifecycleRibbon,
  mutationStatusInfo,
  parseOperator,
  pickFracture,
  proposeBlocker,
  regressionSummary,
  revertTargets,
  splitVariant,
  stepAssumptions,
  storyStages,
  updateTarget,
  updateToolBlocker,
} from '../../src/pages/drift/model';

const environment = (current: string): EnvironmentDto => ({
  toolchainVersion: current,
  available: [
    {
      version: '1.4.2',
      description: 'forge-ci 1.4.2: builds workspaces sequentially in dependency order.',
    },
    {
      version: '1.5.0',
      description:
        'forge-ci 1.5.0: builds workspaces in parallel; log lines are emitted by completion time, so consequences can appear before the root failure.',
    },
  ],
});

const STOP = 'stop_condition: steps.decide.output.candidate_count == 0';
const pair = (scenarioId: string, variantKey: string, agree: boolean) => ({
  scenarioId,
  variantKey,
  agree,
  divergenceStep: agree ? null : 'locate',
  reflexStatus: agree ? 'success' : 'stopped',
  stopReason: agree ? null : STOP,
  comparisonId: `cmp_${scenarioId}`,
});

/** The real drifted check: 12 canary tasks, 3 of which diverged at "locate". */
function driftedCheck(): DriftCheckDto {
  const agrees = [true, true, true, true, false, false, true, true, true, false, true, true];
  return {
    id: 'dft_1',
    reflexVersionId: 'rfv_1',
    envVersion: '1.5.0',
    verdict: {
      drift: true,
      samples: 12,
      historicAgreement: 1,
      currentAgreement: 0.75,
      drop: 0.25,
      interval: { low: 0.513, high: 0.895 },
      reasons: [
        'Agreement fell from 100% to 75% (drop 25 points, threshold 10); it is below the 90% floor',
      ],
    },
    detail: {
      sample: 12,
      pairs: agrees.map((agree, i) =>
        pair(
          `S${i + 1}`,
          i % 2 ? 'missing_export@packages/telemetry' : 'missing_dependency@packages/billing',
          agree,
        ),
      ),
      firstDivergence: [{ stepId: 'locate', count: 3 }],
      before: { confidence: 0.9286, status: 'active' },
      after: { confidence: 0.7143, status: 'shadow' },
      transitions: [
        {
          from: 'active',
          to: 'watch',
          event: 'trust_declined',
          reason: 'Reflex confidence fell from 0.93 to 0.71',
        },
        {
          from: 'watch',
          to: 'shadow',
          event: 'drift_confirmed',
          reason:
            'Agreement fell from 100% to 75% (drop 25 points, threshold 10); it is below the 90% floor',
        },
      ],
      canaryCost: { tokens: 413866, costUsd: 0.2444, provenance: 'synthetic' },
      environmentChange: { from: '1.4.2', to: '1.5.0' },
    },
    createdAt: '2026-11-06T09:01:52.637Z',
  };
}

const step = (id: string, dependsOn: string[], title = id): ReflexStep => ({
  id,
  title,
  kind: 'known',
  operator: { id: 'local.read_ci_log', version: '1.0.0' },
  args: {},
  dependsOn,
  escalateWhen: [],
  stopWhen: [],
  rationale: {
    replaces: [],
    conservation: 1,
    baselineTokens: 0,
    selectedBecause: '',
    alternatives: [],
  },
});

const STEPS = [
  step('ingest', []),
  step('normalize', ['ingest']),
  step('locate', ['normalize'], 'Locate first causal error (log order)'),
  step('map', ['locate']),
  step('decide', ['locate', 'map']),
  step('patch', ['decide']),
  step('verify', ['patch']),
  step('graph', []),
];

const ASSUMPTION =
  'Step "locate": 2 operators fit all 5 traces (local.locate_by_log_order@1.0.0, local.locate_by_dependency_graph@1.0.0). Chose the simpler local.locate_by_log_order. Takes the first error line in the build log as the root cause. Cheap; assumes the log lists a workspace failure before the failures it causes.';

describe('versions and the environment action', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBeGreaterThan(0);
    expect(compareVersions('1.4.2', '1.4.2')).toBe(0);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
  });

  it('updates to the newest version and offers the older ones as a way back', () => {
    expect(updateTarget(environment('1.4.2'))).toBe('1.5.0');
    expect(updateTarget(environment('1.5.0'))).toBeNull();
    expect(revertTargets(environment('1.5.0'))).toEqual(['1.4.2']);
    expect(revertTargets(environment('1.4.2'))).toEqual([]);
  });

  it('explains why the update is unavailable', () => {
    expect(updateToolBlocker({ canChange: false, target: '1.5.0', current: '1.4.2' })).toContain(
      'operator',
    );
    expect(updateToolBlocker({ canChange: true, target: null, current: '1.5.0' })).toContain(
      '1.5.0',
    );
    expect(updateToolBlocker({ canChange: true, target: '1.5.0', current: '1.4.2' })).toBeNull();
  });

  it('reads the change history from audit events and ignores the rest', () => {
    const event = (
      id: string,
      action: string,
      details: unknown,
      createdAt: string,
    ): AuditEventDto => ({
      seq: 1,
      id,
      actor: 'Grace Lindqvist',
      action,
      subjectType: 'environment',
      subjectId: 'forge-ci',
      summary: '',
      details,
      prevHash: '',
      hash: '',
      createdAt,
    });
    const changes = environmentChanges([
      event('b', 'lab.environment_changed', { from: '1.5.0', to: '1.4.2' }, '2026-11-06T10:00:00Z'),
      event('a', 'lab.environment_changed', { from: '1.4.2', to: '1.5.0' }, '2026-11-06T09:00:00Z'),
      event('c', 'auth.login', { from: 'x', to: 'y' }, '2026-11-06T09:30:00Z'),
      event('d', 'lab.environment_changed', 'not an object', '2026-11-06T09:40:00Z'),
    ]);
    expect(changes.map((c) => c.id)).toEqual(['a', 'b']);
    expect(changes[0]).toMatchObject({ from: '1.4.2', to: '1.5.0', by: 'Grace Lindqvist' });
  });
});

describe('canary grid and histogram', () => {
  const check = driftedCheck();

  it('builds one row per task with the fault and workspace split out', () => {
    const rows = canaryRows(check);
    expect(rows).toHaveLength(12);
    expect(rows[4]).toMatchObject({ scenarioId: 'S5', agree: false, divergenceStep: 'locate' });
    expect(splitVariant('missing_export@packages/telemetry')).toEqual({
      fault: 'missing export',
      workspace: 'packages/telemetry',
    });
    expect(splitVariant('plain')).toEqual({ fault: 'plain', workspace: '' });
  });

  it('counts agreement and diverging tasks', () => {
    expect(agreementCounts(check)).toEqual({ agree: 9, disagree: 3, total: 12 });
    expect(divergenceHistogram(check)).toEqual([{ stepId: 'locate', count: 3, share: 0.25 }]);
  });

  it('puts the stop reason in words and keeps unknown shapes as they are', () => {
    expect(describeStopReason(STOP, 'stopped')).toBe(
      'Stopped safely by the guard on step "decide": candidate_count == 0',
    );
    expect(describeStopReason(null, 'success')).toBe('Completed and verified');
    expect(describeStopReason('budget exceeded', 'stopped')).toBe('budget exceeded');
  });
});

describe('fracture', () => {
  const check = driftedCheck();

  it('picks the most frequent first divergence', () => {
    expect(pickFracture(check)).toEqual({ stepId: 'locate', count: 3, sample: 12 });
    const split: DriftCheckDto = {
      ...check,
      detail: {
        ...check.detail,
        firstDivergence: [
          { stepId: null, count: 5 },
          { stepId: 'map', count: 2 },
          { stepId: 'locate', count: 4 },
        ],
      },
    };
    expect(pickFracture(split)?.stepId).toBe('locate');
    expect(pickFracture(null)).toBeNull();
    expect(pickFracture({ ...check, detail: { ...check.detail, firstDivergence: [] } })).toBeNull();
  });

  it('finds the compiler assumption recorded for the step and states it plainly', () => {
    const all = [
      'Toolchain compatibility is inferred as forge-ci >=1.4.2 <2.0.0.',
      ASSUMPTION,
      'Step "decide" decides locally only when its confidence is at least 0.8.',
    ];
    expect(stepAssumptions(all, 'locate')).toEqual([ASSUMPTION]);
    expect(stepAssumptions(all, 'map')).toEqual([]);
    expect(assumptionClause(ASSUMPTION)).toBe(
      'assumes the log lists a workspace failure before the failures it causes',
    );
    expect(assumptionClause('Step "x": picks the first one. Cheap and simple.')).toBe(
      'Cheap and simple',
    );
  });

  it('dims what is downstream and leaves the rest cooled', () => {
    expect([...downstreamOf(STEPS, 'locate')].sort()).toEqual(['decide', 'map', 'patch', 'verify']);
    expect(fractureStates(STEPS, 'locate')).toEqual({
      ingest: 'done',
      normalize: 'done',
      locate: 'stopped',
      graph: 'done',
    });
  });

  it('explains what diverged, why, and where the Reflex actually stopped', () => {
    const info = describeFracture({
      check,
      steps: STEPS,
      assumptions: [ASSUMPTION],
      details: [
        'The Reflex located TS2307 in apps/web; the reference found TS2305 in packages/telemetry',
      ],
      environment: environment('1.5.0'),
    });
    expect(info).toMatchObject({
      stepId: 'locate',
      stepTitle: 'Locate first causal error (log order)',
      count: 3,
      sample: 12,
      label: 'diverged in 3 of 12',
      assumption: 'assumes the log lists a workspace failure before the failures it causes',
      stoppedAt: 'decide',
    });
    expect(info?.headline).toContain('3 of 12 canary tasks');
    expect(info?.cause).toContain('in parallel');
    expect(info?.detail).toContain('TS2307');
    expect(describeFracture({ check: null, steps: STEPS, assumptions: [] })).toBeNull();
  });
});

describe('verdict and confidence', () => {
  it('classifies a check', () => {
    const check = driftedCheck();
    expect(driftStatus(check.verdict, { minSamples: 8 })).toBe('drift');
    expect(driftStatus({ ...check.verdict, drift: false }, { minSamples: 8 })).toBe('ok');
    expect(driftStatus({ ...check.verdict, drift: false, samples: 4 }, { minSamples: 8 })).toBe(
      'insufficient',
    );
    expect(driftStatus(null, { minSamples: 8 })).toBe('none');
  });

  it('measures the fall in confidence against the watch threshold', () => {
    const fall = confidenceFall(driftedCheck(), 0.7143, 0.85);
    expect(fall.fell).toBe(true);
    expect(fall.belowWatch).toBe(true);
    expect(fall.delta).toBeCloseTo(-0.2143, 4);
    const none = confidenceFall(null, 0.93, 0.85);
    expect(none).toMatchObject({
      before: null,
      after: 0.93,
      fell: false,
      belowWatch: false,
      delta: null,
    });
  });
});

describe('lifecycle ribbon', () => {
  const transitions: TransitionDto[] = [
    {
      id: 't1',
      fromStatus: 'active',
      toStatus: 'watch',
      event: 'trust_declined',
      reason: 'Reflex confidence fell from 0.93 to 0.71',
      actor: 'BigForge Drift Canary',
      createdAt: '2026-11-06T09:01:52.635Z',
    },
    {
      id: 't2',
      fromStatus: 'watch',
      toStatus: 'shadow',
      event: 'drift_confirmed',
      reason:
        'Agreement fell from 100% to 75% (drop 25 points, threshold 10); it is below the 90% floor',
      actor: 'BigForge Drift Canary',
      createdAt: '2026-11-06T09:01:52.636Z',
    },
  ];

  it('walks Active, Watch, Shadow with the real reasons and marks them automatic', () => {
    const { stages, links } = lifecycleRibbon(driftedCheck(), transitions, 'shadow');
    expect(stages.map((s) => `${s.label}:${s.position}`)).toEqual([
      'Active:passed',
      'Watch:passed',
      'Shadow:current',
    ]);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      event: 'trust_declined',
      actor: 'BigForge Drift Canary',
      automatic: true,
    });
    expect(links[1]?.reason).toContain('100% to 75%');
  });

  it('does not call a person automatic and survives a missing audit match', () => {
    const human: TransitionDto[] = transitions.map((t) => ({ ...t, actor: 'Grace Lindqvist' }));
    expect(lifecycleRibbon(driftedCheck(), human, 'shadow').links[0]?.automatic).toBe(false);
    expect(lifecycleRibbon(driftedCheck(), [], 'shadow').links[0]).toMatchObject({
      actor: null,
      automatic: true,
    });
  });

  it('shows only the current status when nothing was demoted', () => {
    const ok: DriftCheckDto = {
      ...driftedCheck(),
      detail: { ...driftedCheck().detail, transitions: [] },
    };
    expect(lifecycleRibbon(ok, [], 'active')).toEqual({
      stages: [{ status: 'active', label: 'Active', position: 'current' }],
      links: [],
    });
    expect(lifecycleRibbon(null, [], 'active').stages).toHaveLength(1);
  });
});

function mutation(overrides: Partial<MutationDto> = {}, agreements = 17): MutationDto {
  return {
    id: 'mut_1',
    reflexId: 'rfx_1',
    fromVersionId: 'rfv_1',
    toVersionId: 'rfv_2',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    status: 'proposed',
    reason: 'Drift confirmed',
    diff: {
      steps: [
        {
          stepId: 'locate',
          change: 'operator',
          from: 'local.locate_by_log_order@1.0.0',
          to: 'local.locate_by_dependency_graph@1.0.0',
        },
      ],
      assumptions: { added: ['a'], removed: ['b', 'c'] },
    },
    evidence: {
      augmentedTraceIds: [],
      envVersions: ['1.4.2', '1.5.0'],
      regression: {
        runs: 17,
        agreements,
        agreement: agreements / 17,
        items: [
          ...Array.from({ length: 5 }, (_, i) => ({
            scenarioId: `L${i + 1}`,
            env: '1.4.2',
            agree: true,
          })),
          ...Array.from({ length: 12 }, (_, i) => ({
            scenarioId: `S${i + 1}`,
            env: '1.5.0',
            agree: i + 5 < agreements,
          })),
        ],
      },
      activated: false,
    },
    createdAt: '2026-11-06T09:02:10.805Z',
    decidedAt: null,
    ...overrides,
  };
}

describe('mutation proposal', () => {
  it('reads operator references and describes each step change', () => {
    expect(parseOperator('local.locate_by_log_order@1.0.0')).toEqual({
      name: 'locate_by_log_order',
      version: '1.0.0',
    });
    expect(parseOperator('weird')).toBeNull();
    expect(describeStepChange(mutation().diff.steps[0] as never)).toBe(
      'swaps locate_by_log_order for locate_by_dependency_graph',
    );
    expect(
      describeStepChange({ stepId: 'x', change: 'added', from: null, to: 'local.new_op@1.0.0' }),
    ).toBe('adds new_op');
    expect(
      describeStepChange({ stepId: 'x', change: 'removed', from: 'local.old_op@1.0.0', to: null }),
    ).toBe('removes old_op');
  });

  it('summarises the regression replay by environment', () => {
    const summary = regressionSummary(mutation().evidence);
    expect(summary).toMatchObject({ runs: 17, agreements: 17, allAgree: true });
    expect(summary.groups).toEqual([
      { env: '1.4.2', agree: 5, total: 5 },
      { env: '1.5.0', agree: 12, total: 12 },
    ]);
    expect(regressionSummary(mutation({}, 15).evidence).allAgree).toBe(false);
  });

  it('always says that a proposal is not activated', () => {
    expect(mutationStatusInfo(mutation()).words).toContain('not activated');
    expect(mutationStatusInfo(mutation()).tone).toBe('ember');
    expect(mutationStatusInfo(mutation({ status: 'approved' })).words).toContain(
      'still not active',
    );
    expect(mutationStatusInfo(mutation({ status: 'rejected' })).words).toContain('Nothing changed');
  });
});

describe('why an action is unavailable', () => {
  it('canary: needs a role and an active Reflex', () => {
    expect(canaryBlocker({ hasVersion: false, canRun: true, status: null })).toContain('no Reflex');
    expect(canaryBlocker({ hasVersion: true, canRun: false, status: 'active' })).toContain(
      'operator',
    );
    expect(canaryBlocker({ hasVersion: true, canRun: true, status: 'shadow' })).toContain(
      'back in validation',
    );
    expect(canaryBlocker({ hasVersion: true, canRun: true, status: 'candidate' })).toContain(
      'candidate',
    );
    expect(canaryBlocker({ hasVersion: true, canRun: true, status: 'active' })).toBeNull();
    expect(canaryBlocker({ hasVersion: true, canRun: true, status: 'watch' })).toBeNull();
  });

  it('propose: needs a role, shadow or watch, a canary, and no open proposal', () => {
    const ok = { canPropose: true, status: 'shadow' as const, hasCheck: true, hasProposed: false };
    expect(proposeBlocker(ok)).toBeNull();
    expect(proposeBlocker({ ...ok, status: null })).toContain('no Reflex');
    expect(proposeBlocker({ ...ok, canPropose: false })).toContain('operator');
    expect(proposeBlocker({ ...ok, status: 'active' })).toContain('shadow or watch');
    expect(proposeBlocker({ ...ok, hasCheck: false })).toContain('Run the Drift Canary first');
    expect(proposeBlocker({ ...ok, hasProposed: true })).toContain('already proposed');
  });

  it('approve and reject: reviewers only, only while proposed, approval needs a clean regression', () => {
    const proposed = mutation();
    expect(
      decisionBlocker({ kind: 'approve', canDecide: true, role: 'reviewer', mutation: proposed }),
    ).toBeNull();
    expect(
      decisionBlocker({ kind: 'reject', canDecide: false, role: 'operator', mutation: proposed }),
    ).toContain('signed in as operator');
    expect(
      decisionBlocker({
        kind: 'approve',
        canDecide: true,
        role: 'admin',
        mutation: mutation({ status: 'approved' }),
      }),
    ).toContain('already approved');
    const dirty = mutation({}, 15);
    expect(
      decisionBlocker({ kind: 'approve', canDecide: true, role: 'admin', mutation: dirty }),
    ).toContain('15 of 17');
    expect(
      decisionBlocker({ kind: 'reject', canDecide: true, role: 'admin', mutation: dirty }),
    ).toBeNull();
  });
});

describe('story strip', () => {
  it('walks from an unchanged world to a proposed mutation', () => {
    const calm = storyStages({
      environmentChange: null,
      status: 'none',
      confidence: confidenceFall(null, 0.93, 0.85),
      demoted: false,
      mutation: null,
    });
    expect(calm.map((s) => s.state)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);

    const full = storyStages({
      environmentChange: { from: '1.4.2', to: '1.5.0' },
      status: 'drift',
      confidence: confidenceFall(driftedCheck(), 0.7143, 0.85),
      demoted: true,
      mutation: mutation(),
    });
    expect(full.map((s) => s.state)).toEqual(['done', 'alert', 'alert', 'alert', 'alert']);
    expect(full[0]?.note).toBe('forge-ci 1.4.2 \u2192 1.5.0');
  });
});
