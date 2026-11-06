import type { RunDetailDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  activeAt,
  axisTicks,
  buildLane,
  buildPlayback,
  countersAt,
  eventTimes,
  maxModelTokens,
  nextEventTime,
  previousEventTime,
  toolLabel,
} from '../../src/viz/exec/playback';
import baselineJson from './fixtures/k1-baseline-run.json';
import blockedJson from './fixtures/blocked-baseline-run.json';
import reflexJson from './fixtures/k1-reflex-run.json';
import stoppedJson from './fixtures/stopped-reflex-run.json';

const reflexRun = reflexJson as unknown as RunDetailDto;
const baselineRun = baselineJson as unknown as RunDetailDto;
const blockedRun = blockedJson as unknown as RunDetailDto;
const stoppedRun = stoppedJson as unknown as RunDetailDto;

const reflex = buildLane('reflex', reflexRun);
const baseline = buildLane('baseline', baselineRun);

describe('buildLane', () => {
  it('turns trace events into model, tool and step blocks on the trace clock', () => {
    expect(baseline.models).toHaveLength(12);
    expect(baseline.steps).toHaveLength(0);
    expect(baseline.tools).toHaveLength(11);
    expect(reflex.models).toHaveLength(1);
    expect(reflex.steps.map((step) => step.stepId)).toEqual([
      'snapshot',
      'ingest',
      'normalize',
      'graph',
      'locate',
      'map',
      'diagnose',
      'decide',
      'patch',
      'rebuild',
      'test',
      'verify',
      'report',
    ]);
    const first = baseline.models[0];
    expect(first?.start).toBe(0);
    expect(first?.end).toBeCloseTo(854, 0);
  });

  it('ends where the recorded usage says: simulated model latency plus measured local time', () => {
    const recorded = baselineRun.usage.modelLatencyMs + baselineRun.usage.localMs;
    // The last event is the final model call: its end is the lane end, local tool time included.
    expect(Math.abs(baseline.end - recorded)).toBeLessThan(2);
    expect(reflex.end).toBeGreaterThan(1900);
    expect(reflex.end).toBeLessThan(2100);
  });

  it('marks the boundary call and escalated step of the Reflex run', () => {
    expect(reflex.models[0]?.boundaryStepId).toBe('decide');
    expect(reflex.steps.find((step) => step.stepId === 'decide')?.status).toBe('escalated');
    expect(reflex.marks.some((mark) => mark.type === 'boundary')).toBe(true);
  });

  it('keeps steps sequential: a step starts when the previous one ends', () => {
    for (let index = 1; index < reflex.steps.length; index += 1) {
      const previous = reflex.steps[index - 1];
      const step = reflex.steps[index];
      if (!previous || !step) continue;
      expect(step.start).toBeGreaterThanOrEqual(previous.start);
      expect(step.start).toBeLessThanOrEqual(previous.end + 1e-6);
    }
  });
});

describe('countersAt', () => {
  it('equals the recorded usage at the end of each lane', () => {
    for (const [lane, run] of [
      [baseline, baselineRun],
      [reflex, reflexRun],
      [buildLane('baseline', blockedRun), blockedRun],
      [buildLane('reflex', stoppedRun), stoppedRun],
    ] as const) {
      const end = countersAt(lane, lane.end);
      expect(end.modelCalls).toBe(run.usage.modelCalls);
      expect(end.totalTokens).toBe(run.usage.totalTokens);
      expect(end.inputTokens).toBe(run.usage.inputTokens);
      expect(end.outputTokens).toBe(run.usage.outputTokens);
      expect(end.cachedInputTokens).toBe(run.usage.cachedInputTokens);
      expect(end.commands).toBe(run.usage.commands);
      expect(end.blockedActions).toBe(run.usage.blockedActions);
      expect(end.costUsd).toBeCloseTo(run.usage.costUsd, 9);
      expect(end.finished).toBe(true);
    }
  });

  it('never decreases as time advances', () => {
    let previous = countersAt(baseline, 0);
    for (let t = 0; t <= baseline.end; t += baseline.end / 80) {
      const now = countersAt(baseline, t);
      expect(now.modelCalls).toBeGreaterThanOrEqual(previous.modelCalls);
      expect(now.totalTokens).toBeGreaterThanOrEqual(previous.totalTokens);
      expect(now.costUsd).toBeGreaterThanOrEqual(previous.costUsd);
      expect(now.commands).toBeGreaterThanOrEqual(previous.commands);
      previous = now;
    }
  });

  it('shows the contrast at the moment the Reflex run finishes', () => {
    const t = reflex.end;
    expect(countersAt(reflex, t).modelCalls).toBe(1);
    expect(countersAt(reflex, t).finished).toBe(true);
    const base = countersAt(baseline, t);
    expect(base.finished).toBe(false);
    expect(base.modelCalls).toBeGreaterThan(1);
    expect(base.elapsedMs).toBe(t);
  });

  it('starts a model call at its start time and reports it in flight', () => {
    expect(countersAt(baseline, 0).modelCalls).toBe(1);
    expect(countersAt(baseline, 0).modelCallActive).toBe(true);
    expect(countersAt(reflex, 0).modelCalls).toBe(0);
  });

  it('does not count a blocked command as a spawned command', () => {
    const lane = buildLane('baseline', blockedRun);
    const end = countersAt(lane, lane.end);
    expect(end.blockedActions).toBe(1);
    expect(end.toolCalls).toBe(blockedRun.usage.toolCalls);
    expect(end.commands).toBe(blockedRun.usage.commands);
  });
});

describe('activeAt', () => {
  it('prefers a model call, then a step, then a tool call', () => {
    const modelMid = (baseline.models[3]?.start ?? 0) + 5;
    expect(activeAt(baseline, modelMid)?.type).toBe('model');
    const decide = reflex.steps.find((step) => step.stepId === 'decide');
    expect(activeAt(reflex, (decide?.start ?? 0) + 5)?.type).toBe('step');
    const model = reflex.models[0];
    expect(activeAt(reflex, (model?.start ?? 0) + 10)?.type).toBe('model');
    expect(activeAt(reflex, reflex.end + 1)).toBeNull();
  });
});

describe('event stepping', () => {
  const playback = buildPlayback([baseline, reflex]);
  const times = eventTimes(playback);

  it('shares one axis as long as the longest lane', () => {
    expect(playback.duration).toBe(baseline.end);
    expect(playback.duration).toBeGreaterThan(reflex.end * 5);
  });

  it('lists ascending stops from 0 to the end, without crowding', () => {
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(playback.duration);
    for (let index = 1; index < times.length; index += 1) {
      expect((times[index] ?? 0) - (times[index - 1] ?? 0)).toBeGreaterThan(0);
    }
    expect(times.length).toBeGreaterThan(10);
    expect(times.length).toBeLessThan(60);
    // The Reflex lane's end is a stop (or within one merge gap of one).
    expect(times.some((value) => Math.abs(value - reflex.end) < playback.duration * 0.004)).toBe(
      true,
    );
  });

  it('moves to the next and previous stop and clamps at the ends', () => {
    expect(nextEventTime(times, 0)).toBe(times[1]);
    expect(nextEventTime(times, playback.duration)).toBe(playback.duration);
    expect(previousEventTime(times, playback.duration)).toBe(times[times.length - 2]);
    expect(previousEventTime(times, 0)).toBe(0);
    const mid = ((times[3] ?? 0) + (times[4] ?? 0)) / 2;
    expect(nextEventTime(times, mid)).toBe(times[4]);
    expect(previousEventTime(times, mid)).toBe(times[3]);
  });

  it('copes with an empty trace', () => {
    const empty = buildLane('reflex', {
      id: 'x',
      trace: { events: [], agent: reflexRun.trace.agent },
      usage: reflexRun.usage,
    });
    const single = buildPlayback([empty]);
    expect(single.duration).toBe(1);
    expect(eventTimes(single)).toEqual([0, 1]);
    expect(countersAt(empty, 0).modelCalls).toBe(0);
  });
});

describe('axisTicks and scales', () => {
  it('chooses round intervals', () => {
    expect(axisTicks(16607)).toEqual([0, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000]);
    expect(axisTicks(1980)[1]).toBe(200);
    expect(axisTicks(0)).toEqual([0]);
  });

  it('shares one token scale across lanes', () => {
    expect(maxModelTokens([baseline, reflex])).toBe(
      Math.max(...baseline.models.map((block) => block.tokens)),
    );
    expect(maxModelTokens([])).toBe(0);
  });

  it('labels a tool call by what it acted on', () => {
    expect(toolLabel('run_command', { command: 'forge-ci build' })).toBe('forge-ci build');
    expect(toolLabel('read_file', { path: 'ci/last-build.log' })).toBe('ci/last-build.log');
    expect(toolLabel('apply_patch', { file: 'a.ts' })).toBe('a.ts');
    expect(toolLabel('finish', {})).toBe('finish');
  });
});
