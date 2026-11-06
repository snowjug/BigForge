import type {
  Condition,
  GateResult,
  ReflexListDto,
  ReflexVersionDto,
  ReflexVersionSummaryDto,
} from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import { actionStates } from '../../src/pages/reflexes/actions';
import { describeCondition, describeGuard, describeRef } from '../../src/pages/reflexes/conditions';
import { gateGap, summariseGate } from '../../src/pages/reflexes/gate';
import { tokenizeJson } from '../../src/pages/reflexes/jsonView';
import { buildRibbon } from '../../src/pages/reflexes/lifecycle';
import {
  defaultShadowVersion,
  filterReflexes,
  lineageText,
  primaryVersion,
  statusCounts,
} from '../../src/pages/reflexes/registry';

const check = (
  id: GateResult['checks'][number]['id'],
  required: string,
  actual: string,
  passed: boolean,
): GateResult['checks'][number] => ({ id, label: id, required, actual, passed });

const passingGate: GateResult = {
  eligible: true,
  checks: [
    check('replay', '100.0% on at least 1 trace', '100.0% over 5 trace(s)', true),
    check('shadow_runs', 'at least 10', '12', true),
    check('variants', 'at least 3', '12', true),
    check('safety', 'at most 0', '0', true),
    check('agreement', 'at least 95.0%', '100.0%', true),
  ],
};

const midGate: GateResult = {
  eligible: false,
  checks: [
    check('replay', '100.0% on at least 1 trace', '100.0% over 5 trace(s)', true),
    check('shadow_runs', 'at least 10', '4', false),
    check('variants', 'at least 3', '2', false),
    check('safety', 'at most 0', '0', true),
    check('agreement', 'at least 95.0%', '75.0%', false),
  ],
};

describe('gate summary', () => {
  it('summarises a passing gate', () => {
    expect(summariseGate(passingGate)).toMatchObject({
      eligible: true,
      passed: 5,
      total: 5,
      ratio: 1,
      missing: [],
    });
    expect(summariseGate(passingGate).headline).toMatch(/All 5 checks passed/);
  });

  it('says exactly what is still missing', () => {
    const summary = summariseGate(midGate);
    expect(summary).toMatchObject({ passed: 2, total: 5 });
    expect(summary.missing.map((m) => m.check.id)).toEqual([
      'shadow_runs',
      'variants',
      'agreement',
    ]);
    expect(summary.missing[0]?.gap).toBe('Run 6 more Shadow Brain scenarios (4 of 10 done).');
    expect(summary.missing[1]?.gap).toBe('Shadow-run 1 more distinct variant (2 of 3 covered).');
    expect(summary.missing[2]?.gap).toBe('Shadow agreement is 75.0%; it must be at least 95.0%.');
  });

  it('asks for a replay when none ran and explains safety failures', () => {
    expect(
      gateGap(check('replay', '100.0% on at least 1 trace', '0.0% over 0 trace(s)', false)),
    ).toMatch(/Replay the candidate/);
    expect(gateGap(check('safety', 'at most 0', '2', false))).toMatch(
      /2 unsafe or blocked actions/,
    );
  });
});

const actions = (over: Partial<ReflexVersionDto['actions']> = {}): ReflexVersionDto['actions'] => ({
  replay: false,
  shadow: false,
  promote: false,
  reject: false,
  rollback: false,
  canary: false,
  ...over,
});

describe('actionStates', () => {
  it('is available exactly when the server says so', () => {
    const states = actionStates({
      status: 'approval',
      actions: actions({ promote: true, reject: true }),
      gate: passingGate,
      integrityOk: true,
      role: 'reviewer',
    });
    expect(states.promote).toEqual({ available: true, reason: null });
    expect(states.reject.available).toBe(true);
    expect(states.rollback.available).toBe(false);
  });

  it('explains that promotion is a reviewer decision to an operator', () => {
    const { promote } = actionStates({
      status: 'approval',
      actions: actions(),
      gate: passingGate,
      integrityOk: true,
      role: 'operator',
    });
    expect(promote.available).toBe(false);
    expect(promote.reason).toBe(
      'Promotion is a human decision reserved for reviewers. You are signed in as an operator.',
    );
  });

  it('tells a reviewer what is missing before the gate, and refuses a broken hash first', () => {
    const shadow = actionStates({
      status: 'shadow',
      actions: actions({ shadow: true }),
      gate: midGate,
      integrityOk: true,
      role: 'reviewer',
    });
    expect(shadow.promote.reason).toBe(
      'Not yet: Run 6 more Shadow Brain scenarios (4 of 10 done).',
    );
    expect(shadow.shadow.available).toBe(true);
    const broken = actionStates({
      status: 'approval',
      actions: actions(),
      gate: passingGate,
      integrityOk: false,
      role: 'reviewer',
    });
    expect(broken.promote.reason).toMatch(/Integrity check failed/);
  });

  it('explains status-bound actions', () => {
    const states = actionStates({
      status: 'active',
      actions: actions({ rollback: true }),
      gate: passingGate,
      integrityOk: true,
      role: 'reviewer',
    });
    expect(states.replay.reason).toBe(
      'Replay is only available for a candidate; this one is active.',
    );
    expect(states.rollback.available).toBe(true);
    expect(states.promote.reason).toMatch(/Only a Reflex awaiting approval/);
  });

  it('never leaves a disabled action without a reason', () => {
    for (const role of [null, 'viewer', 'operator'] as const) {
      const states = actionStates({
        status: 'shadow',
        actions: actions(),
        gate: midGate,
        integrityOk: true,
        role,
      });
      for (const state of Object.values(states)) {
        if (!state.available) expect(state.reason).toBeTruthy();
      }
    }
  });
});

describe('lifecycle ribbon', () => {
  it('marks the current stage and the ones before it', () => {
    const ribbon = buildRibbon('shadow', undefined);
    expect(ribbon.stages.map((s) => [s.status, s.state])).toEqual([
      ['candidate', 'done'],
      ['replay', 'done'],
      ['shadow', 'current'],
      ['approval', 'upcoming'],
      ['active', 'upcoming'],
      ['watch', 'upcoming'],
    ]);
    expect(ribbon.returns).toEqual([]);
  });

  it('shows a Reflex demoted by drift as back in Shadow, with the return arc and Active as visited', () => {
    const t = (fromStatus: string, toStatus: string, event: string, n: number) => ({
      fromStatus: fromStatus as ReflexVersionSummaryDto['status'],
      toStatus: toStatus as ReflexVersionSummaryDto['status'],
      event,
      reason: `r${n}`,
      createdAt: `2026-11-06T09:0${n}:00Z`,
    });
    const ribbon = buildRibbon('shadow', [
      t('candidate', 'replay', 'replay_started', 1),
      t('replay', 'shadow', 'replay_passed', 2),
      t('shadow', 'approval', 'gate_passed', 3),
      t('approval', 'active', 'approved', 4),
      t('active', 'watch', 'trust_declined', 5),
      t('watch', 'shadow', 'drift_confirmed', 6),
    ]);
    const state = Object.fromEntries(ribbon.stages.map((s) => [s.status, s.state]));
    expect(state).toMatchObject({
      shadow: 'current',
      replay: 'done',
      approval: 'visited',
      active: 'visited',
      watch: 'visited',
    });
    expect(ribbon.returns).toHaveLength(1);
    expect(ribbon.returns[0]).toMatchObject({
      from: 'watch',
      to: 'shadow',
      event: 'drift_confirmed',
    });
  });

  it('appends off-path states when they are current', () => {
    expect(buildRibbon('recompile', undefined).stages.at(-1)).toMatchObject({
      status: 'recompile',
      state: 'current',
      satellite: true,
    });
    expect(buildRibbon('deprecated', undefined).stages.at(-1)?.status).toBe('deprecated');
    const watch = buildRibbon('watch', undefined);
    expect(watch.stages.find((s) => s.status === 'active')?.state).toBe('done');
  });
});

const version = (
  id: string,
  v: string,
  status: ReflexVersionSummaryDto['status'],
  createdAt: string,
  mutationOf: string | null = null,
): ReflexVersionSummaryDto => ({
  id,
  reflexId: 'rfx',
  name: 'first-causal-error',
  version: v,
  status,
  confidence: 0.7,
  trust: { confidence: 0.7, successes: 5, n: 7, interval: { low: 0.5, high: 0.9 } },
  contentHash: 'abc',
  familyId: 'fam',
  stepCount: 13,
  createdAt,
  updatedAt: createdAt,
  mutationOf,
});

describe('registry selectors', () => {
  const reflexes: ReflexListDto[] = [
    {
      reflexId: 'rfx',
      name: 'first-causal-error',
      familyId: 'fam',
      versions: [
        version('v11', '1.1.0', 'candidate', '2026-11-06T09:30:00Z', '1.0.0'),
        version('v10', '1.0.0', 'shadow', '2026-11-06T09:00:00Z'),
      ],
    },
  ];

  it('foregrounds the version doing the most work, not simply the newest', () => {
    expect(primaryVersion(reflexes[0]!.versions)?.id).toBe('v10');
    expect(primaryVersion(reflexes[0]!.versions, 'candidate')?.id).toBe('v11');
    expect(primaryVersion(reflexes[0]!.versions, 'active')).toBeNull();
  });

  it('filters Reflexes by any version status and counts versions per status', () => {
    expect(filterReflexes(reflexes, 'candidate')).toHaveLength(1);
    expect(filterReflexes(reflexes, 'active')).toHaveLength(0);
    expect(statusCounts(reflexes)).toEqual([
      { status: 'all', count: 2 },
      { status: 'shadow', count: 1 },
      { status: 'candidate', count: 1 },
    ]);
  });

  it('describes lineage and picks the newest non-retired version for the Shadow Lab', () => {
    expect(lineageText(reflexes[0]!.versions[0]!)).toBe('Mutation of v1.0.0');
    expect(lineageText(reflexes[0]!.versions[1]!)).toBeNull();
    expect(defaultShadowVersion(reflexes)?.id).toBe('v11');
    const retired = [
      {
        ...reflexes[0]!,
        versions: [
          version('v12', '1.2.0', 'retired', '2026-11-07T00:00:00Z'),
          ...reflexes[0]!.versions,
        ],
      },
    ];
    expect(defaultShadowVersion(retired)?.id).toBe('v11');
    expect(defaultShadowVersion(reflexes, 'other')).toBeNull();
  });
});

describe('condition sentences', () => {
  const titles: Record<string, string> = { decide: 'Select the remedy' };
  const titleOf = (id: string) => titles[id];

  it('reads references in words', () => {
    expect(describeRef('steps.decide.confidence', titleOf)).toBe(
      'the confidence of \u201cSelect the remedy\u201d',
    );
    expect(describeRef('steps.decide.output.candidate_count', titleOf)).toBe(
      'the candidate count from \u201cSelect the remedy\u201d',
    );
    expect(describeRef('env.toolchain_major', titleOf)).toBe('the environment toolchain major');
    expect(describeRef('steps.unknown.confidence', titleOf)).toBe('the confidence of step unknown');
  });

  it('reads the escalate and stop guards of a real Reflex', () => {
    const escalate: Condition = {
      op: 'lt',
      left: { ref: 'steps.decide.confidence' },
      right: { const: 0.8 },
    };
    const stop: Condition = {
      op: 'eq',
      left: { ref: 'steps.decide.output.candidate_count' },
      right: { const: 0 },
    };
    expect(describeGuard([escalate], 'Crosses its boundary when', titleOf)).toBe(
      'Crosses its boundary when the confidence of \u201cSelect the remedy\u201d is below 0.8.',
    );
    expect(describeGuard([stop], 'Stops when', titleOf)).toBe(
      'Stops when the candidate count from \u201cSelect the remedy\u201d is 0.',
    );
    expect(describeGuard([], 'Stops when', titleOf)).toBeNull();
  });

  it('reads combinators and set membership', () => {
    const condition: Condition = {
      op: 'any',
      conditions: [
        { op: 'in', left: { ref: 'env.toolchain_major' }, right: { const: [1, 2] } },
        { op: 'not', condition: { op: 'exists', left: { ref: 'inputs.ci_log' } } },
      ],
    };
    expect(describeCondition(condition, titleOf)).toBe(
      '(the environment toolchain major is one of [1, 2] or not (the input ci log exists))',
    );
  });
});

describe('tokenizeJson', () => {
  it('colours keys, strings, numbers and literals and preserves the text', () => {
    const text = JSON.stringify(
      { name: 'x', n: -1.5, ok: true, none: null, list: [1, 'a'] },
      null,
      2,
    );
    const lines = tokenizeJson(text);
    expect(lines.map((l) => l.map((t) => t.text).join('')).join('\n')).toBe(text);
    const flat = lines.flat();
    expect(flat.find((t) => t.text === '"name"')?.type).toBe('key');
    expect(flat.find((t) => t.text === '"x"')?.type).toBe('string');
    expect(flat.find((t) => t.text === '-1.5')?.type).toBe('number');
    expect(flat.find((t) => t.text === 'true')?.type).toBe('literal');
    expect(flat.find((t) => t.text === 'null')?.type).toBe('literal');
  });
});
