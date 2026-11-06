import type { ExecSummary, ReflexSpec, RunDetailDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  captionMs,
  finalNodeStates,
  nodeBadges,
  nodeStatesAt,
  stopFracture,
} from '../../src/viz/exec/graphStates';
import { buildLane } from '../../src/viz/exec/playback';
import reflexJson from './fixtures/k1-reflex-run.json';
import exportJson from './fixtures/reflex-export.json';
import stoppedJson from './fixtures/stopped-reflex-run.json';

const run = reflexJson as unknown as RunDetailDto;
const stopped = stoppedJson as unknown as RunDetailDto;
const spec = (exportJson as unknown as { spec: ReflexSpec }).spec;
const exec = run.exec as ExecSummary;
const stoppedExec = stopped.exec as ExecSummary;
const lane = buildLane('reflex', run);

describe('finalNodeStates', () => {
  it('maps ok to done, escalated to boundary and the verification step to verified', () => {
    const states = finalNodeStates(spec.steps, exec, 'pass');
    expect(states.snapshot).toBe('done');
    expect(states.graph).toBe('done');
    expect(states.decide).toBe('boundary');
    expect(states.verify).toBe('verified');
    expect(Object.keys(states)).toHaveLength(spec.steps.length);
  });

  it('only locks a verification step when the run was verified', () => {
    expect(finalNodeStates(spec.steps, exec, 'fail').verify).toBe('done');
    expect(finalNodeStates(spec.steps, exec, 'incomplete').verify).toBe('done');
  });

  it('marks a stop and leaves steps that were never reached idle', () => {
    const states = finalNodeStates(spec.steps, stoppedExec, 'fail');
    expect(states.decide).toBe('stopped');
    expect(states.snapshot).toBe('done');
    expect(states.patch).toBeUndefined();
    expect(states.verify).toBeUndefined();
  });

  it('maps skipped steps', () => {
    const skipped: Pick<ExecSummary, 'steps'> = {
      steps: [
        {
          stepId: 'patch',
          operator: 'local.apply_remedy@1.0.0',
          status: 'skipped',
          executor: 'local',
          summary: '',
        },
      ],
    };
    expect(finalNodeStates(spec.steps, skipped, 'incomplete').patch).toBe('skipped');
  });
});

describe('nodeStatesAt', () => {
  const at = (t: number) => nodeStatesAt(spec.steps, exec, 'pass', lane, t);

  it('is idle before anything starts except the first step', () => {
    const states = at(0);
    expect(states.snapshot).toBe('running');
    expect(states.ingest).toBeUndefined();
    expect(states.decide).toBeUndefined();
  });

  it('lights steps in execution order and cools them when they finish', () => {
    const decide = lane.steps.find((step) => step.stepId === 'decide');
    const mid = (decide?.start ?? 0) + 100;
    const states = at(mid);
    expect(states.snapshot).toBe('done');
    expect(states.graph).toBe('done');
    expect(states.decide).toBe('boundary');
    expect(states.patch).toBeUndefined();
    const after = at((decide?.end ?? 0) + 5);
    expect(after.decide).toBe('boundary');
    expect(after.patch).toBe('running');
  });

  it('shows the final state once the lane has finished', () => {
    expect(at(lane.end)).toEqual(finalNodeStates(spec.steps, exec, 'pass'));
    expect(at(lane.end + 5000)).toEqual(finalNodeStates(spec.steps, exec, 'pass'));
  });
});

describe('nodeBadges and stopFracture', () => {
  it('says "0 calls" with a duration on local steps and the single call on the boundary step', () => {
    const badges = nodeBadges(spec.steps, exec, lane);
    expect(badges.graph?.text).toMatch(/^0 calls \u00b7 \d+(\.\d)? ms$/);
    expect(badges.graph?.tone).toBe('steel');
    expect(badges.decide?.text).toBe('1 call \u00b7 371 tok');
    expect(badges.decide?.tone).toBe('molten');
  });

  it('badges a stop and draws a fracture only for a stopped run', () => {
    const stoppedLane = buildLane('reflex', stopped);
    expect(nodeBadges(spec.steps, stoppedExec, stoppedLane).decide).toEqual({
      text: 'stopped',
      tone: 'crimson',
    });
    expect(stopFracture(stoppedExec)).toEqual({ stepId: 'decide', label: 'stopped here' });
    expect(stopFracture(exec)).toBeNull();
  });

  it('formats short durations', () => {
    expect(captionMs(0.2)).toBe('<1 ms');
    expect(captionMs(4.44)).toBe('4.4 ms');
    expect(captionMs(251.37)).toBe('251 ms');
    expect(captionMs(1036.7)).toBe('1.04 s');
    expect(captionMs(Number.NaN)).toBe('\u2014');
  });
});
