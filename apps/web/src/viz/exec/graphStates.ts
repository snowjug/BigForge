import type { ExecSummary, ReflexStep, StepResult } from '@bigforge/schemas';
import type { GraphFracture, NodeBadge, NodeState } from '../index';
import type { Lane } from './playback';

/**
 * Maps a recorded Reflex execution onto Forge Graph node states and badges.
 * ok -> done (verified for a verification step when the run's verification passed), escalated -> boundary,
 * stopped -> stopped, skipped -> skipped. A step with no result was never reached and stays idle.
 */

type StepKindOnly = Pick<ReflexStep, 'id' | 'kind'>;

export function finalNodeState(
  step: Pick<ReflexStep, 'kind'>,
  result: StepResult | undefined,
  verification: 'pass' | 'fail' | 'incomplete',
): NodeState | null {
  if (!result) return null;
  switch (result.status) {
    case 'ok':
      return step.kind === 'verification' && verification === 'pass' ? 'verified' : 'done';
    case 'escalated':
      return 'boundary';
    case 'stopped':
      return 'stopped';
    case 'skipped':
      return 'skipped';
  }
}

export function finalNodeStates(
  steps: readonly StepKindOnly[],
  exec: Pick<ExecSummary, 'steps'>,
  verification: 'pass' | 'fail' | 'incomplete',
): Record<string, NodeState> {
  const results = new Map(exec.steps.map((result) => [result.stepId, result]));
  const states: Record<string, NodeState> = {};
  for (const step of steps) {
    const state = finalNodeState(step, results.get(step.id), verification);
    if (state) states[step.id] = state;
  }
  return states;
}

/**
 * The graph at virtual time `t`: steps not yet started are idle, the step in progress is hot (running, or
 * boundary while it waits on the model), finished steps take their final state. After the lane ends every
 * step shows its final state.
 */
export function nodeStatesAt(
  steps: readonly StepKindOnly[],
  exec: Pick<ExecSummary, 'steps'>,
  verification: 'pass' | 'fail' | 'incomplete',
  lane: Lane,
  t: number,
): Record<string, NodeState> {
  const final = finalNodeStates(steps, exec, verification);
  if (t >= lane.end) return final;
  const blocks = new Map(lane.steps.map((block) => [block.stepId, block]));
  const states: Record<string, NodeState> = {};
  for (const step of steps) {
    const block = blocks.get(step.id);
    if (!block || t < block.start) continue;
    if (t >= block.end) {
      const state = final[step.id];
      if (state) states[step.id] = state;
    } else {
      states[step.id] = block.status === 'escalated' ? 'boundary' : 'running';
    }
  }
  return states;
}

/** "0.3 ms", "12 ms", "251 ms", "1.04 s": compact enough for a graph caption. */
export function captionMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '\u2014';
  if (ms < 1) return '<1 ms';
  if (ms < 100) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * One short caption per step: local steps say "0 calls" with their duration, a step that crossed its
 * boundary says how many tokens (synthetic) the single call used, stopped and skipped steps say so.
 */
export function nodeBadges(
  steps: readonly StepKindOnly[],
  exec: Pick<ExecSummary, 'steps' | 'boundaries'>,
  lane: Lane,
): Record<string, NodeBadge> {
  const results = new Map(exec.steps.map((result) => [result.stepId, result]));
  const blocks = new Map(lane.steps.map((block) => [block.stepId, block]));
  const boundaries = new Map(exec.boundaries.map((boundary) => [boundary.stepId, boundary]));
  const badges: Record<string, NodeBadge> = {};
  for (const step of steps) {
    const result = results.get(step.id);
    if (!result) continue;
    const boundary = boundaries.get(step.id);
    const duration = blocks.get(step.id)?.durationMs;
    if (boundary) {
      const call = boundary.call;
      badges[step.id] = call
        ? {
            text: `1 call \u00b7 ${(call.inputTokens + call.outputTokens).toLocaleString('en-US')} tok`,
            tone: 'molten',
          }
        : { text: 'no call made', tone: 'crimson' };
    } else if (result.status === 'stopped') {
      badges[step.id] = { text: 'stopped', tone: 'crimson' };
    } else if (result.status === 'skipped') {
      badges[step.id] = { text: 'not reached', tone: 'ash' };
    } else if (result.executor === 'local') {
      badges[step.id] = {
        text: duration === undefined ? '0 calls' : `0 calls \u00b7 ${captionMs(duration)}`,
        tone: 'steel',
      };
    }
  }
  return badges;
}

/** A fracture is drawn only when the Reflex really stopped. */
export function stopFracture(
  exec: Pick<ExecSummary, 'status' | 'stopStepId'>,
): GraphFracture | null {
  return exec.status === 'stopped' && exec.stopStepId
    ? { stepId: exec.stopStepId, label: 'stopped here' }
    : null;
}
