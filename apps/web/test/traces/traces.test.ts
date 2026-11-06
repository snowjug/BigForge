import type { RunDetailDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import { assessTrace, blockedActionsOf } from '../../src/pages/traces/safety';
import {
  barGeometry,
  buildTimeline,
  categoryCounts,
  countMarkers,
  filterRows,
  humanize,
  timelineSpan,
} from '../../src/pages/traces/timeline';
import baselineJson from '../run/fixtures/k1-baseline-run.json';
import blockedJson from '../run/fixtures/blocked-baseline-run.json';
import reflexJson from '../run/fixtures/k1-reflex-run.json';
import stoppedJson from '../run/fixtures/stopped-reflex-run.json';

const baseline = baselineJson as unknown as RunDetailDto;
const blocked = blockedJson as unknown as RunDetailDto;
const reflex = reflexJson as unknown as RunDetailDto;
const stopped = stoppedJson as unknown as RunDetailDto;

describe('buildTimeline', () => {
  const rows = buildTimeline(reflex.trace);

  it('orders rows on the virtual clock and ends with the verification report', () => {
    const events = rows.slice(0, -1);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]?.at ?? 0).toBeGreaterThanOrEqual(events[index - 1]?.at ?? 0);
    }
    const last = rows[rows.length - 1];
    expect(last?.category).toBe('verification');
    expect(last?.payload.type).toBe('verification');
    expect(last?.tone).toBe('jade');
    expect(rows).toHaveLength(reflex.trace.events.length + 1);
  });

  it('nests the calls made inside a Reflex step under that step', () => {
    const decide = rows.find((row) => row.category === 'step' && row.title === 'decide');
    expect(decide?.depth).toBe(0);
    const inside = rows.filter((row) => row.parentStepId === 'decide');
    expect(inside.length).toBeGreaterThanOrEqual(6);
    expect(inside.some((row) => row.category === 'model')).toBe(true);
    expect(inside.some((row) => row.category === 'boundary')).toBe(true);
    expect(inside.every((row) => row.depth === 1)).toBe(true);
    const firstTool = rows.find((row) => row.category === 'tool');
    expect(firstTool?.parentStepId).toBe('ingest');
    // A parent step is listed before its children.
    const decideIndex = rows.indexOf(decide as (typeof rows)[number]);
    for (const row of inside) expect(rows.indexOf(row)).toBeGreaterThan(decideIndex);
  });

  it('keeps a baseline trace flat and calls the boundary call a boundary call', () => {
    const flat = buildTimeline(baseline.trace);
    expect(flat.every((row) => row.depth === 0)).toBe(true);
    expect(flat.filter((row) => row.category === 'model')).toHaveLength(12);
    expect(rows.find((row) => row.category === 'model')?.title).toBe('Boundary call');
    expect(rows.find((row) => row.category === 'model')?.tone).toBe('molten');
    expect(flat.find((row) => row.category === 'model')?.title).toBe('Model call');
  });

  it('describes tool calls by what they acted on and flags blocked and failed ones', () => {
    const rowsBlocked = buildTimeline(blocked.trace);
    const block = rowsBlocked.find((row) => row.blocked && row.category === 'tool');
    expect(block?.detail).toBe('rm -rf node_modules && npm ci');
    expect(block?.tone).toBe('crimson');
    expect(rowsBlocked.some((row) => row.category === 'safety' && row.blocked)).toBe(true);
    const failedTool = rowsBlocked.find((row) => row.category === 'tool' && row.failed);
    expect(failedTool?.detail).toContain('forge-ci build');
  });

  it('counts redaction markers recorded in previews', () => {
    expect(countMarkers('a [REDACTED:forge_token] b [REDACTED:email]')).toBe(2);
    expect(countMarkers('none')).toBe(0);
    const total = buildTimeline(baseline.trace).reduce((sum, row) => sum + row.redactions, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('marks a stopped step as failed', () => {
    const rowsStopped = buildTimeline(stopped.trace);
    const stop = rowsStopped.find((row) => row.category === 'step' && row.title === 'decide');
    expect(stop?.failed).toBe(true);
    expect(stop?.tone).toBe('crimson');
    expect(rowsStopped[rowsStopped.length - 1]?.tone).toBe('crimson');
  });

  it('counts and filters by category', () => {
    const counts = categoryCounts(rows);
    expect(counts.get('step')).toBe(13);
    expect(counts.get('model')).toBe(1);
    expect(counts.get('verification')).toBe(1);
    const visible = filterRows(rows, new Set(['tool', 'note']));
    expect(visible.some((row) => row.category === 'tool')).toBe(false);
    expect(visible.some((row) => row.category === 'step')).toBe(true);
    expect(filterRows(rows, new Set())).toHaveLength(rows.length);
  });

  it('draws bars on one axis with a visible minimum', () => {
    const span = timelineSpan(rows);
    expect(span).toBeGreaterThan(1900);
    const instant = barGeometry({ at: 100, end: 100 }, span);
    expect(instant.width).toBeGreaterThanOrEqual(0.006);
    const whole = barGeometry({ at: 0, end: span }, span);
    expect(whole).toEqual({ left: 0, width: 1 });
    const tail = barGeometry({ at: span, end: span }, span);
    expect(tail.left + tail.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(timelineSpan([])).toBe(1);
  });

  it('humanizes identifiers', () => {
    expect(humanize('inspect_dependency_exports')).toBe('inspect dependency exports');
    expect(humanize('first-causal-error')).toBe('first causal error');
  });
});

describe('blockedActionsOf', () => {
  it('pairs the blocked tool call with the safety rule', () => {
    const actions = blockedActionsOf(blocked.trace);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: 'rm -rf node_modules && npm ci',
      rule: 'destructive:shell_metacharacters',
      purpose: 'clean_install_attempt',
    });
    expect(actions[0]?.reason).toContain('Shell control characters');
  });

  it('finds none in a clean trace', () => {
    expect(blockedActionsOf(baseline.trace)).toEqual([]);
  });
});

const compile = {
  reflexName: 'first-causal-error',
  version: '1.0.0',
  sourceTraceIds: [baseline.trace.id, 'trc_other'],
  excluded: [
    {
      purpose: 'clean_install_attempt',
      occurrences: 1,
      reason:
        'Every tool call was blocked by the safety policy; unsafe behaviour is never compiled into a Reflex.',
    },
  ],
};

describe('assessTrace', () => {
  const base = { compile: null, currentToolchain: '1.5.0', redactionMarkers: 3 };

  it('says a verified standalone baseline success is safe to learn from', () => {
    const standalone = assessTrace({
      ...base,
      trace: baseline.trace,
      kind: 'baseline',
      groupId: null,
      compile,
    });
    expect(standalone.verdict).toBe('safe');
    expect(standalone.headline).toBe('Safe to learn from');
    expect(standalone.checks.find((check) => check.id === 'verification')?.status).toBe('pass');
    expect(standalone.checks.find((check) => check.id === 'source_use')?.answer).toContain(
      'source trace of first-causal-error v1.0.0',
    );
  });

  it('treats a run made as a comparison reference as not a source', () => {
    const result = assessTrace({
      ...base,
      trace: baseline.trace,
      kind: 'baseline',
      groupId: 'grp_1',
      compile: null,
    });
    expect(result.verdict).toBe('not_a_source');
    expect(result.checks.find((check) => check.id === 'standalone')?.status).toBe('info');
  });

  it('treats Reflex and validation runs as outputs, never sources', () => {
    const result = assessTrace({
      ...base,
      trace: reflex.trace,
      kind: 'reflex',
      groupId: 'grp_1',
      compile,
    });
    expect(result.verdict).toBe('not_a_source');
    expect(result.summary).toContain('baseline agent runs');
    expect(result.checks.find((check) => check.id === 'source_use')?.answer).toContain(
      'not include this trace',
    );
  });

  it('keeps blocked behaviour as an excluded behaviour confirmed by the compile report', () => {
    const result = assessTrace({
      ...base,
      trace: blocked.trace,
      kind: 'baseline',
      groupId: null,
      compile,
    });
    expect(result.verdict).toBe('safe_with_exclusions');
    expect(result.blocked).toHaveLength(1);
    expect(result.excludedConfirmed).toHaveLength(1);
    const check = result.checks.find((entry) => entry.id === 'blocked');
    expect(check?.status).toBe('warn');
    expect(check?.answer).toContain('clean_install_attempt');
    expect(check?.answer).toContain('never compiled');
    const without = assessTrace({
      ...base,
      trace: blocked.trace,
      kind: 'baseline',
      groupId: null,
      compile: null,
    });
    expect(without.excludedConfirmed).toEqual([]);
    expect(without.checks.find((entry) => entry.id === 'blocked')?.answer).toContain(
      'never compiled into a step',
    );
  });

  it('refuses a failed or unverified run, and one without redaction', () => {
    const failed = assessTrace({
      ...base,
      trace: stopped.trace,
      kind: 'baseline',
      groupId: null,
      compile: null,
    });
    expect(failed.verdict).toBe('not_safe');
    expect(failed.checks.find((check) => check.id === 'outcome')?.status).toBe('fail');
    expect(failed.checks.find((check) => check.id === 'verification')?.answer).toContain('Failed:');
    const unredacted = assessTrace({
      ...base,
      trace: { ...baseline.trace, redaction: { applied: false, redactions: 0 } },
      kind: 'baseline',
      groupId: null,
      compile: null,
    });
    expect(unredacted.verdict).toBe('not_safe');
    expect(unredacted.summary).toContain('redacted');
  });

  it('flags a trace recorded on an older toolchain', () => {
    const result = assessTrace({
      ...base,
      trace: baseline.trace,
      kind: 'baseline',
      groupId: null,
      compile: null,
    });
    const environment = result.checks.find((check) => check.id === 'environment');
    expect(environment?.status).toBe('warn');
    expect(environment?.answer).toContain('1.4.2');
    expect(environment?.answer).toContain('1.5.0');
    const same = assessTrace({
      ...base,
      currentToolchain: '1.4.2',
      trace: baseline.trace,
      kind: 'baseline',
      groupId: null,
      compile: null,
    });
    expect(same.checks.find((check) => check.id === 'environment')?.status).toBe('pass');
  });

  it('gives every number a provenance', () => {
    const result = assessTrace({
      ...base,
      trace: baseline.trace,
      kind: 'baseline',
      groupId: null,
      compile: null,
    });
    expect(result.provenance.map((row) => row.value)).toEqual([
      'tokens',
      'model_latency',
      'local_time',
      'cost',
      'commands',
    ]);
    expect(result.provenance.find((row) => row.value === 'tokens')?.provenance).toEqual([
      'synthetic',
    ]);
    expect(result.provenance.find((row) => row.value === 'model_latency')?.provenance).toEqual([
      'simulated',
    ]);
    expect(result.provenance.find((row) => row.value === 'local_time')?.provenance).toEqual([
      'measured',
    ]);
    expect(result.provenance.every((row) => row.provenance.length > 0)).toBe(true);
  });
});
