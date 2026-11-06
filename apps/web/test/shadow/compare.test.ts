import type { ComparisonDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  aggregateComparisons,
  byScenario,
  divergenceText,
  failedChecks,
  reduction,
  safetyViolationsOf,
  totalBaselineTokens,
} from '../../src/pages/shadow/compare';

const side = (tokens: number, calls: number, localMs = 1000) => ({
  tokens,
  calls,
  costUsd: tokens / 1_000_000,
  commands: 4,
  modelLatencyMs: calls * 1500,
  localMs,
  status: 'success',
});

function item(
  scenarioId: string,
  variantKey: string,
  agree: boolean,
  baseline: ReturnType<typeof side>,
  reflex: ReturnType<typeof side>,
  safety = '0',
): ComparisonDto {
  return {
    id: `cmp_${scenarioId}`,
    kind: 'shadow',
    reflexVersionId: 'rfv',
    taskId: `tsk_${scenarioId}`,
    taskTitle: scenarioId,
    scenarioId,
    variantKey,
    agree,
    comparison: {
      agree,
      checks: [
        {
          id: 'outcome',
          label: 'Outcome',
          baseline: 'success',
          reflex: agree ? 'success' : 'stopped',
          match: agree,
        },
        {
          id: 'safety',
          label: 'Safety violations by the Reflex',
          baseline: '0',
          reflex: safety,
          match: safety === '0',
        },
      ],
      divergence: agree
        ? { stepId: null, kind: 'none', detail: 'No divergence' }
        : { stepId: 'locate', kind: 'root_cause', detail: 'The Reflex located TS2307 in apps/web' },
      deltas: { modelCalls: 0, tokens: 0, costUsd: 0, commands: 0, modelLatencyMs: 0, localMs: 0 },
    },
    baselineRunId: `run_b_${scenarioId}`,
    reflexRunId: `run_r_${scenarioId}`,
    createdAt: '2026-11-06T09:00:00Z',
    baseline,
    reflex,
  };
}

const items = [
  item('S10', 'v@a', true, side(30000, 9), side(0, 0, 900)),
  item('S2', 'v@b', true, side(40000, 12), side(2000, 1, 1100)),
  item('S1', 'v@b', false, side(20000, 6), side(0, 0, 1300), '1'),
];

describe('aggregateComparisons', () => {
  const totals = aggregateComparisons(items);

  it('counts agreement, variants and safety violations', () => {
    expect(totals).toMatchObject({
      runs: 3,
      agreements: 2,
      disagreements: 1,
      distinctVariants: 2,
      safetyViolations: 1,
    });
    expect(totals.agreement).toBeCloseTo(2 / 3, 6);
  });

  it('averages each side separately so baseline and Reflex are never blended', () => {
    expect(totals.baseline.tokens).toBe(30000);
    expect(totals.reflex.tokens).toBeCloseTo(2000 / 3, 6);
    expect(totals.baseline.calls).toBe(9);
    expect(totals.reflex.localMs).toBeCloseTo(1100, 6);
  });

  it('has no agreement rate for an empty set', () => {
    expect(aggregateComparisons([])).toMatchObject({
      runs: 0,
      agreement: null,
      baseline: { tokens: 0 },
      reflex: { calls: 0 },
    });
  });
});

describe('helpers', () => {
  it('reads safety violations from the safety check', () => {
    expect(safetyViolationsOf(items[2]!)).toBe(1);
    expect(safetyViolationsOf(items[0]!)).toBe(0);
  });

  it('computes a reduction ratio and refuses to divide by a zero baseline', () => {
    expect(reduction(30000, 7500)).toBe(0.75);
    expect(reduction(0, 0)).toBeNull();
    expect(reduction(100, 150)).toBe(0);
  });

  it('sorts scenarios naturally and words divergences and failed checks', () => {
    expect(byScenario(items).map((i) => i.scenarioId)).toEqual(['S1', 'S2', 'S10']);
    expect(divergenceText(items[0]!)).toBe('No divergence');
    expect(divergenceText(items[2]!)).toBe('The Reflex located TS2307 in apps/web (step locate)');
    expect(failedChecks(items[2]!)).toEqual(['Outcome', 'Safety violations by the Reflex']);
  });

  it('totals what the baseline reference runs spent', () => {
    expect(totalBaselineTokens(items)).toBe(90000);
    expect(totalBaselineTokens([])).toBe(0);
  });
});
