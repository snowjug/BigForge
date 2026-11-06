import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMOTION_GATE, type ReflexStatus } from '@bigforge/schemas';
import {
  DEFAULT_DRIFT_CONFIG,
  InvalidTransitionError,
  allowedEvents,
  computeEconomics,
  depreciationFactor,
  detectDrift,
  diffLines,
  evaluateGate,
  mayExecuteActive,
  runCrr,
  transition,
  trustFromHistory,
  type UsagePoint,
} from '../src';

describe('Reflex lifecycle', () => {
  it('follows the documented path and never skips human approval', () => {
    let s: ReflexStatus = 'candidate';
    for (const [event, expected] of [
      ['replay_started', 'replay'],
      ['replay_passed', 'shadow'],
      ['gate_passed', 'approval'],
      ['approved', 'active'],
      ['trust_declined', 'watch'],
      ['drift_confirmed', 'shadow'],
    ] as const) {
      s = transition(s, event);
      expect(s).toBe(expected);
    }
    expect(() => transition('shadow', 'approved')).toThrow(InvalidTransitionError);
    expect(() => transition('candidate', 'approved')).toThrow(InvalidTransitionError);
    expect(() => transition('replay', 'approved')).toThrow(InvalidTransitionError);
    expect(allowedEvents('retired')).toEqual([]);
  });

  it('only active and watch Reflexes may execute applied work', () => {
    const live = (
      [
        'candidate',
        'replay',
        'shadow',
        'approval',
        'active',
        'watch',
        'recompile',
        'deprecated',
        'retired',
      ] as ReflexStatus[]
    ).filter(mayExecuteActive);
    expect(live).toEqual(['active', 'watch']);
  });
});

describe('promotion gate', () => {
  const ok = {
    replayRuns: 5,
    replayAgreement: 1,
    shadowRuns: 12,
    distinctVariants: 9,
    safetyViolations: 0,
    agreement: 1,
  };
  it('passes with sufficient evidence', () =>
    expect(evaluateGate(ok, DEFAULT_PROMOTION_GATE).eligible).toBe(true));
  it.each([
    ['too few shadow runs', { shadowRuns: 9 }],
    ['too few variants', { distinctVariants: 2 }],
    ['any safety violation', { safetyViolations: 1 }],
    ['agreement below 95%', { agreement: 0.94 }],
    ['replay disagreement', { replayAgreement: 0.8 }],
    ['no replay at all', { replayRuns: 0 }],
  ])('fails on %s', (_name, patch) => {
    const r = evaluateGate({ ...ok, ...patch }, DEFAULT_PROMOTION_GATE);
    expect(r.eligible).toBe(false);
    expect(r.checks.filter((c) => !c.passed)).toHaveLength(1);
  });
});

describe('trust and drift', () => {
  it('uses a recency window with a Laplace-smoothed posterior mean', () => {
    expect(trustFromHistory([]).confidence).toBe(0.5);
    expect(trustFromHistory(Array(12).fill(true)).confidence).toBeCloseTo(13 / 14, 6);
    // 12 agreements followed by 9/12 recent: only the last 12 count.
    const history = [
      ...Array<boolean>(12).fill(true),
      ...Array<boolean>(9).fill(true),
      false,
      false,
      false,
    ];
    const t = trustFromHistory(history);
    expect(t.n).toBe(12);
    expect(t.successes).toBe(9);
    expect(t.confidence).toBeCloseTo(10 / 14, 6);
    expect(t.interval.low).toBeLessThan(0.75);
    expect(t.interval.high).toBeGreaterThan(0.75);
  });

  it('confirms drift only with enough samples, a real drop and an absolute floor', () => {
    expect(detectDrift({ agree: 12, n: 12 }, { agree: 9, n: 12 }, DEFAULT_DRIFT_CONFIG).drift).toBe(
      true,
    );
    expect(
      detectDrift({ agree: 12, n: 12 }, { agree: 11, n: 12 }, DEFAULT_DRIFT_CONFIG).drift,
    ).toBe(false);
    const few = detectDrift({ agree: 12, n: 12 }, { agree: 2, n: 4 }, DEFAULT_DRIFT_CONFIG);
    expect(few.drift).toBe(false);
    expect(few.reasons[0]).toMatch(/at least 8/);
    expect(detectDrift({ agree: 9, n: 10 }, { agree: 11, n: 12 }, DEFAULT_DRIFT_CONFIG).drift).toBe(
      false,
    );
  });

  it('decays confidence with the age of the last validation', () => {
    expect(depreciationFactor(0)).toBe(1);
    expect(depreciationFactor(90)).toBeCloseTo(0.5, 6);
    expect(depreciationFactor(-5)).toBe(1);
  });
});

describe('cognitive economics', () => {
  const pt = (tokens: number, costUsd = tokens / 1e6, calls = 9): UsagePoint => ({
    tokens,
    uncachedTokens: Math.round(tokens / 20),
    costUsd,
    modelCalls: calls,
    provenance: 'synthetic',
  });
  const base = {
    pricing: { id: 'p', assumedAt: 'x', source: 'assumption', note: 'n' },
    now: 't',
    compileMs: 1500,
    replayRuns: 5,
    review: { minutes: 10, usdPerHour: 60 },
    projectedExecutions: 100,
    includeLearningInInvestment: false,
  };

  it('counts shadow, canary and review as investment, excludes learning by default, and breaks even', () => {
    const baseline = [pt(30_000), pt(32_000), pt(34_000), pt(36_000)];
    const r = computeEconomics({
      ...base,
      baselineSamples: baseline,
      learningBaseline: [pt(30_000), pt(32_000)],
      shadowReference: [pt(34_000), pt(36_000)],
      canaryReference: [pt(33_000)],
      reflexRuns: [
        { usage: pt(0, 0, 0), verified: true, purpose: 'shadow', reference: null, crr: 1 },
        {
          usage: pt(500, 0.001, 1),
          verified: true,
          purpose: 'live',
          reference: pt(40_000),
          crr: 0.75,
        },
      ],
    });
    expect(r.investment.totalTokens).toBe(34_000 + 36_000 + 33_000);
    expect(r.investment.lines.find((l) => l.id === 'learning')?.counted).toBe(false);
    expect(r.perExecution.basis).toBe('measured_reference');
    expect(r.perExecution.tokensAvoided).toBe(39_500);
    expect(r.realized.netTokens).toBe(39_500 - 103_000);
    expect(r.projected.breakEvenExecutions).toBe(Math.ceil(103_000 / 39_500));
    expect(r.projected.roi).toBeGreaterThan(0);
    expect(r.projected.roiInterval?.low).toBeLessThanOrEqual(r.projected.roi ?? 0);
    expect(r.crr.value).toBeCloseTo(0.875, 3);
    expect(r.realized.provenance).toBe('synthetic');
    // The conservative view includes the learning-phase runs.
    const conservative = computeEconomics({
      ...base,
      includeLearningInInvestment: true,
      baselineSamples: baseline,
      learningBaseline: [pt(30_000), pt(32_000)],
      shadowReference: [pt(34_000)],
      canaryReference: [],
      reflexRuns: [],
    });
    expect(conservative.investment.totalTokens).toBe(96_000);
  });

  it('labels counterfactual savings as estimated when no measured reference exists', () => {
    const r = computeEconomics({
      ...base,
      baselineSamples: [pt(30_000), pt(34_000)],
      learningBaseline: [],
      shadowReference: [pt(30_000)],
      canaryReference: [],
      reflexRuns: [
        { usage: pt(0, 0, 0), verified: true, purpose: 'live', reference: null, crr: 1 },
      ],
    });
    expect(r.perExecution.basis).toBe('counterfactual_estimate');
    expect(r.realized.provenance).toBe('estimated');
  });

  it('reports no ROI rather than inventing one when nothing has been invested', () => {
    const r = computeEconomics({
      ...base,
      baselineSamples: [pt(10_000)],
      learningBaseline: [],
      shadowReference: [],
      canaryReference: [],
      reflexRuns: [],
    });
    expect(r.realized.roi).toBeNull();
    expect(r.perExecution.basis).toBe('none');
  });

  it('computes CRR weighted by baseline spend and counts boundary steps as not reused', () => {
    expect(
      runCrr([
        { weight: 100, executor: 'local', status: 'ok' },
        { weight: 300, executor: 'model', status: 'escalated' },
      ]),
    ).toBe(0.25);
    expect(runCrr([{ weight: 0, executor: 'local', status: 'ok' }])).toBe(1);
    expect(
      runCrr([
        { weight: 100, executor: 'local', status: 'ok' },
        { weight: 100, executor: 'local', status: 'skipped' },
      ]),
    ).toBe(0.5);
    expect(runCrr([])).toBeNull();
  });
});

describe('diff', () => {
  it('shows only changed lines with context', () => {
    const a = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const b = ['a', 'b', 'c', 'X', 'e', 'f', 'g', 'h'].join('\n');
    const d = diffLines(a, b, 1);
    expect(d.filter((l) => l.kind !== 'context').map((l) => `${l.kind}:${l.text}`)).toEqual([
      'remove:d',
      'add:X',
    ]);
    expect(d.length).toBeLessThan(8);
  });
});
