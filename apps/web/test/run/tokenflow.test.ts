import type { ReflexSpec, RunDetailDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  aggregatePurposes,
  allocateRemaining,
  flowTable,
  layoutTokenFlow,
  linkPath,
  purposeLabel,
  type FlowLayout,
} from '../../src/viz/exec/tokenflow';
import baselineJson from './fixtures/k1-baseline-run.json';
import reflexJson from './fixtures/k1-reflex-run.json';
import exportJson from './fixtures/reflex-export.json';

const baselineRun = baselineJson as unknown as RunDetailDto;
const reflexRun = reflexJson as unknown as RunDetailDto;
const spec = (exportJson as unknown as { spec: ReflexSpec }).spec;
const purposes = aggregatePurposes(baselineRun.trace.events);
const boundaryStep = spec.steps.find((step) => step.id === 'decide');
const replaced = new Set(boundaryStep?.rationale.replaces ?? []);
const reflexInput = {
  total: reflexRun.usage.totalTokens,
  input: reflexRun.usage.inputTokens,
  output: reflexRun.usage.outputTokens,
};

describe('aggregatePurposes', () => {
  it('groups model calls by purpose and keeps the usage totals', () => {
    expect(purposes.map((row) => row.key)).toEqual([
      'read_failure_log',
      'inspect_workspace_graph',
      'inspect_failing_workspace',
      'run_focused_diagnostic',
      'inspect_failing_source',
      'inspect_dependency_exports',
      'apply_remedy',
      'verify_build',
      'verify_tests',
      'report',
    ]);
    const exports = purposes.find((row) => row.key === 'inspect_dependency_exports');
    expect(exports?.calls).toBe(3);
    expect(purposes.reduce((sum, row) => sum + row.total, 0)).toBe(baselineRun.usage.totalTokens);
    expect(purposes.reduce((sum, row) => sum + row.cachedInput, 0)).toBe(
      baselineRun.usage.cachedInputTokens,
    );
    expect(purposes.reduce((sum, row) => sum + row.output, 0)).toBe(baselineRun.usage.outputTokens);
    expect(purposes.reduce((sum, row) => sum + row.uncachedInput + row.cachedInput, 0)).toBe(
      baselineRun.usage.inputTokens,
    );
    expect(purposes.reduce((sum, row) => sum + row.calls, 0)).toBe(12);
  });

  it('humanizes purposes', () => {
    expect(purposeLabel('inspect_dependency_exports')).toBe('inspect dependency exports');
  });
});

describe('allocateRemaining', () => {
  it('places the Reflex tokens on the purposes its boundary step replaced, in proportion', () => {
    const allocation = allocateRemaining(purposes, 371, replaced);
    expect(allocation.basis).toBe('replaced_steps');
    const total = [...allocation.perPurpose.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(371, 6);
    for (const key of allocation.perPurpose.keys()) expect(replaced.has(key)).toBe(true);
    expect(allocation.overspend).toBe(0);
    for (const row of purposes)
      expect(allocation.perPurpose.get(row.key) ?? 0).toBeLessThanOrEqual(row.total);
  });

  it('falls back to every purpose when no step names them', () => {
    const allocation = allocateRemaining(purposes, 371, null);
    expect(allocation.basis).toBe('proportional');
    expect(allocation.perPurpose.size).toBe(purposes.length);
  });

  it('allocates nothing when the Reflex made no call, and reports overspend', () => {
    expect(allocateRemaining(purposes, 0, replaced).basis).toBe('none');
    const over = allocateRemaining(purposes, 100_000, replaced);
    expect(over.overspend).toBe(100_000 - baselineRun.usage.totalTokens);
    const kept = [...over.perPurpose.values()].reduce((sum, value) => sum + value, 0);
    expect(kept).toBeCloseTo(baselineRun.usage.totalTokens, 6);
  });
});

function columnTotals(layout: FlowLayout): number[] {
  return [0, 1, 2].map((column) =>
    layout.nodes
      .filter((node) => node.column === column)
      .reduce((sum, node) => sum + node.value, 0),
  );
}

describe('layoutTokenFlow', () => {
  const layout = layoutTokenFlow(
    { baseline: purposes, reflex: reflexInput, replacedKeys: replaced },
    { width: 860, height: 340 },
  );

  it('conserves tokens through every column', () => {
    const [types, purposeTotal, outcome] = columnTotals(layout);
    expect(types).toBe(baselineRun.usage.totalTokens);
    expect(purposeTotal).toBe(baselineRun.usage.totalTokens);
    expect(outcome).toBeCloseTo(baselineRun.usage.totalTokens, 6);
    expect(layout.sent).toBe(371);
    expect(layout.avoided).toBe(baselineRun.usage.totalTokens - 371);
    expect(layout.baselineTotal).toBe(baselineRun.usage.totalTokens);
  });

  it('keeps every node and link inside the drawing and every flow visible', () => {
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + node.w).toBeLessThanOrEqual(layout.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.h).toBeLessThanOrEqual(layout.height + 1);
      expect(node.h).toBeGreaterThanOrEqual(4);
    }
    for (const link of layout.links) {
      expect(link.thickness).toBeGreaterThanOrEqual(1.5);
      expect(link.x1).toBeGreaterThan(link.x0);
    }
  });

  it('does not overlap nodes within a column', () => {
    for (const column of [0, 1, 2]) {
      const nodes = layout.nodes.filter((node) => node.column === column).sort((a, b) => a.y - b.y);
      for (let index = 1; index < nodes.length; index += 1) {
        const previous = nodes[index - 1];
        const node = nodes[index];
        if (previous && node) expect(node.y).toBeGreaterThanOrEqual(previous.y + previous.h - 1e-6);
      }
    }
  });

  it('labels the thin boundary flow as an estimated allocation and the recorded type flows as recorded', () => {
    const sent = layout.links.filter((link) => link.to === 'out:sent');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((link) => link.estimated)).toBe(true);
    expect(
      layout.links.filter((link) => link.from.startsWith('type:')).every((link) => !link.estimated),
    ).toBe(true);
    expect(layout.nodes.find((node) => node.id === 'out:sent')?.tone).toBe('molten');
    expect(layout.nodes.find((node) => node.id === 'out:avoided')?.tone).toBe('steel');
  });

  it('is deterministic and draws links as S-curves', () => {
    const again = layoutTokenFlow(
      { baseline: purposes, reflex: reflexInput, replacedKeys: replaced },
      { width: 860, height: 340 },
    );
    expect(again).toEqual(layout);
    const link = layout.links[0];
    expect(link ? linkPath(link) : '').toMatch(/^M[\d.]+ [\d.]+C/);
  });

  it('draws only the baseline side when there is no Reflex run', () => {
    const single = layoutTokenFlow(
      { baseline: purposes, reflex: null, replacedKeys: null },
      { width: 700, height: 320 },
    );
    expect(single.nodes.some((node) => node.column === 2)).toBe(false);
    expect(single.sent).toBe(0);
    expect(single.avoided).toBe(0);
  });

  it('reports an empty flow for a run without model calls', () => {
    const none = layoutTokenFlow(
      { baseline: [], reflex: null, replacedKeys: null },
      { width: 700, height: 320 },
    );
    expect(none.empty).toBe(true);
    expect(none.nodes).toEqual([]);
  });
});

describe('flowTable', () => {
  it('lists each purpose with what was kept and avoided', () => {
    const rows = flowTable(purposes, 371, replaced);
    expect(rows).toHaveLength(purposes.length);
    expect(rows.reduce((sum, row) => sum + row.kept, 0)).toBeCloseTo(371, 6);
    expect(rows.reduce((sum, row) => sum + row.avoided, 0)).toBeCloseTo(
      baselineRun.usage.totalTokens - 371,
      6,
    );
    expect(
      flowTable(purposes, null, null).every((row) => row.kept === 0 && row.avoided === 0),
    ).toBe(true);
  });
});
