import { describe, expect, it } from 'vitest';
import { crackGeometry } from '../../src/viz/forge-graph/fracture';
import { nextFocusTarget, type NavKey } from '../../src/viz/forge-graph/nav';
import { layoutDag } from '../../src/viz/forge-graph/layout';
import {
  arrowHeadPath,
  endDirection,
  roundedPath,
  shortenEnd,
} from '../../src/viz/forge-graph/path';
import { textWidth, truncateToWidth, wrapText } from '../../src/viz/forge-graph/text';

describe('text metrics', () => {
  it('measures mono text as 0.6em per character', () => {
    expect(textWidth('locate_by_log_order', 11, true)).toBeCloseTo(19 * 0.6 * 11, 5);
    expect(textWidth('', 12)).toBe(0);
  });

  it('truncates with an ellipsis only when needed', () => {
    expect(truncateToWidth('short', 200, 12)).toBe('short');
    const cut = truncateToWidth('Map the error to its workspace and owner', 100, 12.5);
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut, 12.5)).toBeLessThanOrEqual(100);
    const mono = truncateToWidth('locate_by_log_order', 80, 11, true);
    expect(mono.endsWith('…')).toBe(true);
    expect(textWidth(mono, 11, true)).toBeLessThanOrEqual(80);
  });

  it('wraps titles at word boundaries and flags what it had to cut', () => {
    const fits = wrapText('Locate first causal error (log order)', 122, 12.5, 2);
    expect(fits.truncated).toBe(false);
    expect(fits.lines).toHaveLength(2);
    expect(fits.lines.join(' ')).toBe('Locate first causal error (log order)');

    const cut = wrapText('Map the error to its workspace and owner', 122, 12.5, 2);
    expect(cut.truncated).toBe(true);
    expect(cut.lines).toHaveLength(2);
    expect(cut.lines[1]?.endsWith('…')).toBe(true);
    for (const line of cut.lines) expect(textWidth(line, 12.5)).toBeLessThanOrEqual(122);

    expect(wrapText('Read CI log', 122, 12.5, 2).lines).toEqual(['Read CI log']);
    expect(wrapText('   ', 122, 12.5, 2)).toEqual({ lines: [''], truncated: false });
  });

  it('splits a single word that is wider than a line', () => {
    const result = wrapText('Supercalifragilisticexpialidocious', 60, 12.5, 3);
    expect(result.lines.length).toBeGreaterThan(1);
    for (const line of result.lines) expect(textWidth(line, 12.5)).toBeLessThanOrEqual(60);
  });
});

describe('path helpers', () => {
  const corner = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 },
  ];

  it('rounds corners and limits the radius to half of the shorter segment', () => {
    expect(roundedPath(corner, 9)).toBe('M0 0L31 0Q40 0 40 9L40 30');
    expect(roundedPath(corner, 100)).toBe('M0 0L25 0Q40 0 40 15L40 30');
    expect(roundedPath(corner.slice(0, 2), 9)).toBe('M0 0L40 0');
    expect(roundedPath([], 9)).toBe('');
  });

  it('points the arrowhead along the last segment and trims the line under it', () => {
    expect(endDirection(corner)).toEqual({ x: 0, y: 1 });
    const head = arrowHeadPath({ x: 40, y: 30 }, { x: 0, y: 1 }, 7, 3.5);
    expect(head.startsWith('M40 30L')).toBe(true);
    expect(head).toContain('36.5 23');
    expect(shortenEnd(corner, 6)[2]).toEqual({ x: 40, y: 24 });
    expect(shortenEnd(corner.slice(0, 2), 100)[1]).toEqual({ x: 40, y: 0 });
    expect(arrowHeadPath({ x: 1, y: 1 }, { x: 0, y: 0 })).toBe('');
  });
});

describe('crackGeometry', () => {
  it('is deterministic per step and differs between steps', () => {
    const a = crackGeometry('locate', 0, 0, 160, 66);
    expect(crackGeometry('locate', 0, 0, 160, 66)).toEqual(a);
    expect(crackGeometry('patch', 0, 0, 160, 66)).not.toEqual(a);
  });

  it('crosses the node top to bottom and stays near its box', () => {
    const { main, branches } = crackGeometry('locate', 10, 20, 160, 66);
    const numbers = [...main.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(numbers[0]?.[1]).toBeLessThan(20);
    expect(numbers[numbers.length - 1]?.[1]).toBeGreaterThan(86);
    for (const [x, y] of numbers) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(170);
      expect(y).toBeGreaterThanOrEqual(15);
      expect(y).toBeLessThanOrEqual(91);
    }
    expect(branches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('keyboard navigation', () => {
  const steps = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['a'] },
    { id: 'd', dependsOn: ['b', 'c'] },
    { id: 'lone', dependsOn: [] },
  ];
  const layout = layoutDag(steps);
  const order = layout.layers.flat();
  const go = (current: string, key: NavKey): string | null =>
    nextFocusTarget({
      nodes: layout.nodes,
      edges: layout.edges,
      order,
      current,
      key,
      direction: 'LR',
    });

  it('follows connections along the flow', () => {
    expect(go('b', 'ArrowRight')).toBe('d');
    expect(go('d', 'ArrowLeft')).toMatch(/^[bc]$/);
    expect(go('d', 'ArrowRight')).toBeNull();
  });

  it('moves between siblings of the same layer across the flow', () => {
    const upper =
      layout.nodes.find((n) => n.id === 'b')!.y < layout.nodes.find((n) => n.id === 'c')!.y
        ? 'b'
        : 'c';
    const lower = upper === 'b' ? 'c' : 'b';
    expect(go(upper, 'ArrowDown')).toBe(lower);
    expect(go(lower, 'ArrowUp')).toBe(upper);
  });

  it('reaches steps that have no connection, and jumps to the ends with Home/End', () => {
    // `lone` shares layer 0 with `a`, so it is one arrow away although no edge links them.
    expect([go('a', 'ArrowDown'), go('a', 'ArrowUp')]).toContain('lone');
    expect(go('d', 'Home')).toBe(order[0]);
    expect(go('a', 'End')).toBe(order[order.length - 1]);
  });

  it('follows a dependency into another row of a folded layout', () => {
    const chain = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      dependsOn: i === 0 ? [] : [`s${i - 1}`],
    }));
    const folded = layoutDag(chain, { maxLayersPerBand: 4 });
    const result = nextFocusTarget({
      nodes: folded.nodes,
      edges: folded.edges,
      order: folded.layers.flat(),
      current: 's3',
      key: 'ArrowRight',
      direction: 'LR',
    });
    expect(result).toBe('s4');
  });
});
