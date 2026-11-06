import type { ReflexSpec } from '@bigforge/schemas';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import specJson from '../../src/viz/fixtures/reflex-spec.json';
import {
  ForgeGraph,
  ReflexGlyph,
  glyphFromHash,
  layoutDag,
  type ForgeGraphProps,
  type NodeState,
} from '../../src/viz';
import {
  describeStateChanges,
  formatTokens,
  nodeAccessibleName,
  sameStates,
  shortOperator,
  stepsFromStructureKey,
  structureKeyOf,
} from '../../src/viz/forge-graph/model';

const spec = specJson as unknown as ReflexSpec;
const steps = spec.steps;

function render(props: Partial<ForgeGraphProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ForgeGraph, { steps, ariaLabel: 'Reflex steps', ...props }),
  );
}

function attrs(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1] as string);
}

const buttons = (html: string): string[] =>
  html.split('<g ').filter((chunk) => chunk.includes('role="button"'));

/** The presentational wrapper of each node (carries data-kind, data-state, data-dim, ...). */
const nodes = (html: string): string[] =>
  html.split('<g ').filter((chunk) => chunk.startsWith('class="bf-node"'));

describe('public exports', () => {
  it('exposes the documented surface', () => {
    expect(typeof ForgeGraph).toBe('function');
    expect(typeof ReflexGlyph).toBe('function');
    expect(typeof layoutDag).toBe('function');
    expect(typeof glyphFromHash).toBe('function');
  });
});

describe('ForgeGraph markup and accessibility', () => {
  it('wraps the graph in a labelled group with one button per step', () => {
    const html = render();
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Reflex steps"');
    expect(buttons(html)).toHaveLength(steps.length);
  });

  it('names every node "<title>. <kind>. <operator>. State: <state>."', () => {
    const html = render({ states: { ingest: 'running', verify: 'verified' } });
    const names = attrs(html, 'aria-label');
    expect(names).toContain('Read CI log. known. local.read_ci_log. State: running.');
    expect(names).toContain(
      'Verify against declared evidence. verification. local.verify_outcome. State: verified.',
    );
    expect(names).toContain('Select the remedy. hybrid. local.select_remedy. State: idle.');
  });

  it('keeps a single roving tab stop, on the selected step when there is one', () => {
    const idle = render();
    expect(attrs(idle, 'tabindex').filter((v) => v === '0')).toHaveLength(1);
    expect(attrs(idle, 'tabindex').filter((v) => v === '-1')).toHaveLength(steps.length - 1);

    const selected = render({ selectedId: 'decide', onSelect: () => undefined });
    const decide = buttons(selected).find((chunk) => chunk.includes('data-step-id="decide"'));
    expect(decide).toContain('tabindex="0"');
    expect(decide).toContain('aria-pressed="true"');
    expect(attrs(selected, 'aria-pressed').filter((v) => v === 'false')).toHaveLength(
      steps.length - 1,
    );
  });

  it('keeps the button text to the title so the name contains the visible label', () => {
    const html = render();
    const start = html.indexOf('data-step-id="ingest" role="button"');
    const button = html.slice(start, html.indexOf('class="bf-node__meta"', start));
    expect(button).toContain('>Read CI log<');
    expect(button).not.toContain('<title>');
    // the operator is drawn by the presentational group beside the button
    const meta = html.slice(html.indexOf('class="bf-node__meta"', start));
    expect(meta.slice(0, meta.indexOf('</g></g>'))).toContain('read_ci_log');
    // tooltip and description sit beside the button, not in it
    expect(html).toContain('<title>Read CI log\nknown · local.read_ci_log\nState: idle</title>');
    expect(attrs(html, 'aria-describedby')).toHaveLength(steps.length);
  });

  it('only reports pressed state when the graph is selectable', () => {
    expect(render()).not.toContain('aria-pressed');
  });

  it('provides a text summary in topological order with dependencies and states', () => {
    const html = render({ states: { snapshot: 'done' } });
    expect(html).toContain('<details');
    expect(html).toContain('Text summary of this graph');
    const list = html.slice(html.indexOf('<ol>'), html.indexOf('</ol>'));
    expect((list.match(/<li>/g) ?? []).length).toBe(steps.length);
    expect(list.indexOf('Read CI log')).toBeLessThan(list.indexOf('Normalize the build log'));
    expect(list.indexOf('Normalize the build log')).toBeLessThan(
      list.indexOf('Locate first causal error'),
    );
    expect(list).toContain('Depends on Read CI log.');
    expect(list).toContain('No dependencies.');
    expect(list).toContain('State: done.');
  });

  it('labels token figures as synthetic wherever they are printed', () => {
    const plain = render();
    expect(plain).not.toContain('synthetic');
    expect(plain).not.toContain('Synthetic');

    const html = render({ showTokens: true });
    expect(html).toContain('Baseline tokens replaced (synthetic): 7,889.');
    expect(html).toContain('<strong>Synthetic</strong>');
    expect(html).toContain('7,889 tok');
    expect(attrs(html, 'class').filter((c) => c === 'bf-node__bar').length).toBeGreaterThan(5);
  });

  it('shows badges as captions and in the summary', () => {
    const html = render({ badges: { decide: { text: '371 tok', tone: 'molten' } } });
    expect(html).toContain('data-tone="molten"');
    expect(html).toContain('371 tok');
    expect(html).toContain('371 tok.</li>');
  });

  it('marks traversed edges only when both ends have run', () => {
    const none = render();
    expect(none).not.toContain('data-traversed');
    const states: Record<string, NodeState> = {
      ingest: 'done',
      normalize: 'running',
      locate: 'idle',
    };
    const html = render({ states });
    expect(attrs(html, 'data-traversed')).toHaveLength(1);
  });

  it('draws a fracture with a label, dims what is downstream and lists it in the summary', () => {
    const html = render({ fracture: { stepId: 'locate' } });
    expect(html).toContain('diverges here');
    expect(html).toContain('bf-node__cracks');
    expect(html).toContain('Fracture: diverges here at step Locate first causal error (log order)');
    const dimmed = nodes(html).filter((chunk) => chunk.includes('data-dim="true"'));
    // map, diagnose, decide, patch, rebuild, test, verify, report
    expect(dimmed).toHaveLength(8);
    expect(render({ fracture: { stepId: 'locate', label: 'drift at 2026-02' } })).toContain(
      'drift at 2026-02',
    );
  });

  it('announces through a polite live region and ships no scripts or external URLs', () => {
    const html = render();
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('renders the compact top-to-bottom variant without the legend', () => {
    const html = render({ direction: 'TB', density: 'compact' });
    expect(html).toContain('data-direction="TB"');
    expect(html).toContain('data-density="compact"');
    expect(html).not.toContain('bf-fg__legend');
    expect(render()).toContain('bf-fg__legend');
  });

  it('copes with unknown selections, dangling dependencies and a single step', () => {
    const lone = steps[0]!;
    const html = render({
      steps: [{ ...lone, dependsOn: ['ghost'] }],
      selectedId: 'nope',
      fracture: { stepId: 'nope' },
    });
    expect(buttons(html)).toHaveLength(1);
    expect(attrs(html, 'tabindex')).toEqual(['0']);
  });
});

describe('ReflexGlyph markup', () => {
  const hash = '4b34a479b92ec5f7028e464b29004c3928a52d850936865f347cca9481cb32f4';

  it('is decorative by default', () => {
    const html = renderToStaticMarkup(createElement(ReflexGlyph, { hash }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role=');
    expect(html).toContain('width="32"');
  });

  it('becomes a named image when given a title', () => {
    const html = renderToStaticMarkup(
      createElement(ReflexGlyph, { hash, size: 64, title: 'Reflex first-causal-error' }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Reflex first-causal-error"');
    expect(html).toContain('<title>Reflex first-causal-error</title>');
    expect(html).not.toContain('aria-hidden');
    expect(html).toContain('width="64"');
    expect(html).not.toMatch(/<animate|<style|animation/i);
  });
});

describe('graph model helpers', () => {
  const step = steps.find((s) => s.id === 'patch')!;

  it('formats names, operators and token counts', () => {
    expect(nodeAccessibleName(step, 'stopped')).toBe(
      'Apply the remedy. known. local.apply_remedy. State: stopped.',
    );
    expect(shortOperator('local.apply_remedy')).toBe('apply_remedy');
    expect(shortOperator('custom.thing')).toBe('custom.thing');
    expect(formatTokens(7889)).toBe('7,889');
  });

  it('round-trips the structure key that drives layout memoisation', () => {
    const key = structureKeyOf(steps);
    expect(structureKeyOf(steps.map((s) => ({ ...s, title: 'changed' })))).toBe(key);
    expect(stepsFromStructureKey(key)).toEqual(
      steps.map((s) => ({ id: s.id, dependsOn: s.dependsOn })),
    );
  });

  it('announces state changes, and only real ones', () => {
    const ids = steps.map((s) => s.id);
    const titles = new Map(steps.map((s) => [s.id, s.title] as const));
    expect(sameStates({ a: 'idle' }, {}, ['a'])).toBe(true);
    expect(sameStates({ patch: 'running' }, { patch: 'done' }, ids)).toBe(false);
    expect(describeStateChanges({}, {}, ids, titles)).toBe('');
    expect(describeStateChanges({}, { patch: 'running' }, ids, titles)).toBe(
      'Step Apply the remedy: running',
    );
    const many = Object.fromEntries(ids.map((id) => [id, 'done'])) as Record<string, NodeState>;
    expect(describeStateChanges({}, many, ids, titles)).toMatch(/And 10 more steps changed\.$/);
  });
});
