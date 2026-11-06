import type { CompileReport, ReflexStep } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildDna,
  columnLabel,
  layoutDna,
  relatedTo,
  stepBarHeight,
  truncateLabel,
} from '../../src/viz/dna/dnaModel';

const step = (
  id: string,
  kind: ReflexStep['kind'],
  replaces: string[],
  tokens: number,
  extra: Partial<ReflexStep> = {},
): ReflexStep => ({
  id,
  title: id,
  kind,
  operator: { id: `local.${id}`, version: '1.0.0' },
  args: {},
  dependsOn: [],
  escalateWhen: [],
  stopWhen: [],
  rationale: {
    replaces,
    conservation: 1,
    baselineTokens: tokens,
    selectedBecause: `${id} reproduces the baseline`,
    alternatives: [{ operator: `local.${id}@1.0.0`, consistent: true, matched: 3, of: 3 }],
  },
  ...extra,
});

const column = (
  key: string,
  meanPosition: number,
  conservation: number,
  replacedBy: string | null,
  extra: Partial<CompileReport['columns'][number]> = {},
): CompileReport['columns'][number] => ({
  key,
  kind: 'turn',
  conservation,
  presentIn: Math.round(conservation * 3),
  meanPosition,
  baselineTokens: 1000,
  variableSlots: [],
  classification: conservation === 1 ? 'invariant' : 'variable',
  replacedBy,
  ...extra,
});

const report: CompileReport = {
  compilerVersion: 'bigforge.compiler/1.0.0',
  tracesUsed: 3,
  variants: ['a@x', 'b@y', 'c@z'],
  // deliberately out of consensus order, with a tie on meanPosition
  columns: [
    column('report', 1, 1, 'local.render@1.0.0'),
    column('read_log', 0, 1, 'local.read@1.0.0'),
    column('clean_install', 0.5, 1 / 3, null),
    column('inspect_b', 0.5, 2 / 3, 'local.decide@1.0.0'),
    column('inspect_a', 0.5, 2 / 3, 'local.decide@1.0.0'),
    column('never_covered', 0.7, 1, null),
  ],
  rows: ['a', 'b', 'c'].map((s, i) => ({
    traceId: `trc_${s}`,
    scenarioId: `L${i + 1}`,
    variantKey: `${s}@x`,
    cells: [
      { key: 'read_log', present: true, count: 1, detail: 'read_file ci/last-build.log' },
      { key: 'report', present: true, count: 1, detail: 'final message' },
      { key: 'inspect_a', present: i !== 0, count: i !== 0 ? 1 : 0, detail: '' },
      {
        key: 'clean_install',
        present: i === 2,
        count: i === 2 ? 2 : 0,
        detail: 'rm -rf node_modules',
      },
    ],
  })),
  decisions: [
    {
      stepId: 'decide',
      chosen: 'local.decide@1.0.0',
      alternatives: [
        { operator: 'local.decide@1.0.0', consistent: true, matched: 3, of: 3, detail: '' },
        { operator: 'local.decide_alt@1.0.0', consistent: true, matched: 3, of: 3, detail: '' },
      ],
      reason: '2 operators fit; the simplest was chosen',
    },
  ],
  excludedBehaviours: [
    {
      purpose: 'clean_install',
      occurrences: 1,
      reason: 'Every tool call was blocked by the safety policy.',
    },
  ],
  uncovered: ['never_covered', 'ghost'],
  baselineTokensPerTask: 20000,
  baselineModelCallsPerTask: 8,
};

const steps = [
  step('snapshot', 'validation', [], 0),
  step('ingest', 'known', ['read_log'], 500),
  step('decide', 'hybrid', ['inspect_a', 'inspect_b'], 4000, {
    boundary: {
      question: 'q',
      kind: 'choose_option',
      optionsFrom: 'x',
      resolveInto: 'y',
      evidenceSelectors: [{ id: 'e', tags: ['t'], required: true }],
      budgetTokens: 1500,
      minCapability: 'standard',
      evidenceRequired: 'e',
      verifyBy: 'v',
    },
  }),
  step('report', 'known', ['report'], 1000),
];

describe('buildDna', () => {
  const dna = buildDna(report, steps);

  it('orders columns by consensus position, breaking ties by key', () => {
    expect(dna.columns.map((c) => c.key)).toEqual([
      'read_log',
      'clean_install',
      'inspect_a',
      'inspect_b',
      'never_covered',
      'report',
    ]);
  });

  it('classifies a behaviour as excluded (with the reason), uncovered or compiled', () => {
    const status = Object.fromEntries(dna.columns.map((c) => [c.key, c.status]));
    expect(status).toMatchObject({
      read_log: 'compiled',
      clean_install: 'excluded',
      never_covered: 'uncovered',
      inspect_a: 'compiled',
    });
    expect(dna.columns.find((c) => c.key === 'clean_install')?.excludedReason).toMatch(/blocked/);
    expect(dna.orphanUncovered).toEqual(['ghost']);
  });

  it('aligns every row to the column order, filling absent cells', () => {
    for (const row of dna.rows)
      expect(row.cells.map((c) => c.key)).toEqual(dna.columns.map((c) => c.key));
    const first = dna.rows[0]!;
    expect(first.cells.find((c) => c.key === 'inspect_b')).toMatchObject({
      present: false,
      count: 0,
    });
    expect(first.cells.find((c) => c.key === 'inspect_a')).toMatchObject({ present: false });
  });

  it('links columns to the steps that replace them, several to one', () => {
    expect(dna.links).toEqual(
      expect.arrayContaining([
        { columnKey: 'read_log', stepId: 'ingest' },
        { columnKey: 'inspect_a', stepId: 'decide' },
        { columnKey: 'inspect_b', stepId: 'decide' },
      ]),
    );
    expect(dna.steps.find((s) => s.id === 'decide')).toMatchObject({
      hasBoundary: true,
      columnKeys: ['inspect_a', 'inspect_b'],
    });
    expect(dna.steps.find((s) => s.id === 'decide')?.alternatives).toHaveLength(2);
  });

  it('counts classes without double counting excluded behaviours', () => {
    expect(dna.stats).toMatchObject({
      traces: 3,
      behaviours: 6,
      invariant: 3,
      variable: 2,
      excluded: 1,
      uncovered: 2,
      steps: 4,
      addedSteps: 1,
    });
  });
});

describe('layoutDna', () => {
  const dna = buildDna(report, steps);

  it('never goes narrower than its minimum cell width and scales up to a cap', () => {
    const narrow = layoutDna(dna, { width: 300 });
    expect(narrow.cellW).toBe(42);
    expect(narrow.width).toBeGreaterThan(300);
    expect(narrow.gutter).toBeLessThan(layoutDna(dna, { width: 1200 }).gutter);
    expect(layoutDna(dna, { width: 4000 }).cellW).toBe(74);
  });

  it('lays columns left to right and every cell inside its column', () => {
    const geometry = layoutDna(dna, { width: 1000 });
    const xs = geometry.columns.map((c) => c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    for (const row of geometry.rows) {
      row.cells.forEach((cell, index) => {
        const col = geometry.columns[index]!;
        expect(cell.x).toBeGreaterThanOrEqual(col.x);
        expect(cell.x + cell.w).toBeLessThanOrEqual(col.x + col.w);
      });
    }
  });

  it('scales conservation bars by conservation and strand bars by tokens', () => {
    const geometry = layoutDna(dna, { width: 1000 });
    const bar = (key: string) => geometry.columns.find((c) => c.key === key)!.barH;
    expect(bar('read_log')).toBeGreaterThan(bar('clean_install'));
    const heights = Object.fromEntries(geometry.steps.map((s) => [s.id, s.barH]));
    expect(heights.decide).toBe(geometry.strand.maxBarH);
    expect(heights.report).toBeCloseTo(heights.decide! / 4, 0);
    expect(heights.snapshot).toBe(stepBarHeight(0, 4000));
    expect(heights.snapshot).toBeGreaterThan(0);
  });

  it('draws one ribbon per link, from the column to the step', () => {
    const geometry = layoutDna(dna, { width: 1000 });
    expect(geometry.ribbonPaths).toHaveLength(dna.links.length);
    const path = geometry.ribbonPaths.find((r) => r.columnKey === 'read_log')!;
    const col = geometry.columns.find((c) => c.key === 'read_log')!;
    expect(path.d.startsWith(`M${col.cx} `)).toBe(true);
  });

  it('is deterministic', () => {
    expect(layoutDna(dna, { width: 1000 })).toEqual(
      layoutDna(buildDna(report, steps), { width: 1000 }),
    );
  });
});

describe('helpers', () => {
  it('relatedTo follows links in both directions', () => {
    const dna = buildDna(report, steps);
    const fromStep = relatedTo(dna, { type: 'step', id: 'decide' });
    expect([...fromStep.columns].sort()).toEqual(['inspect_a', 'inspect_b']);
    const fromColumn = relatedTo(dna, { type: 'column', key: 'read_log' });
    expect([...fromColumn.steps]).toEqual(['ingest']);
    expect(relatedTo(dna, null).columns.size).toBe(0);
  });

  it('formats labels', () => {
    expect(columnLabel('inspect_dependency_exports')).toBe('inspect dependency exports');
    expect(truncateLabel('abcdefghij', 6)).toBe('abcde\u2026');
    expect(truncateLabel('abc', 6)).toBe('abc');
    expect(stepBarHeight(5, 10, 60)).toBe(30);
  });
});
