import type { ReflexStep, StepKind } from '@bigforge/schemas';
import type { NodeState } from './types';

export interface GraphMetrics {
  nodeW: number;
  /** Height of the node body (title + operator). A footer for captions/token bars is added below. */
  nodeH: number;
  footH: number;
  /** Space between layers along the flow (edge channels). */
  gapFlow: number;
  /** Space between siblings across the flow. */
  gapCross: number;
  radius: number;
  padX: number;
  titleSize: number;
  titleLead: number;
  titleLines: number;
  titleBaseline: number;
  /** Width reserved at the right of the title for the state icon. */
  iconGutter: number;
  opSize: number;
  opBaselineFromBottom: number;
}

export const METRICS: Record<'comfortable' | 'compact', GraphMetrics> = {
  comfortable: {
    nodeW: 160,
    nodeH: 66,
    footH: 24,
    gapFlow: 40,
    gapCross: 20,
    radius: 6,
    padX: 12,
    titleSize: 12.5,
    titleLead: 15,
    titleLines: 2,
    titleBaseline: 21,
    iconGutter: 26,
    opSize: 11,
    opBaselineFromBottom: 11,
  },
  compact: {
    nodeW: 124,
    nodeH: 56,
    footH: 22,
    gapFlow: 30,
    gapCross: 10,
    radius: 6,
    padX: 10,
    titleSize: 12,
    titleLead: 14,
    titleLines: 2,
    titleBaseline: 18,
    iconGutter: 22,
    opSize: 11,
    opBaselineFromBottom: 9,
  },
};

export const STATE_LABEL: Record<NodeState, string> = {
  idle: 'idle',
  running: 'running',
  done: 'done',
  boundary: 'boundary',
  verified: 'verified',
  stopped: 'stopped',
  skipped: 'skipped',
};

/** Both ends of an edge in one of these states means the edge has been traversed. */
export const TRAVERSED_STATES: ReadonlySet<NodeState> = new Set([
  'running',
  'done',
  'boundary',
  'verified',
]);

export function stateOf(
  states: Readonly<Record<string, NodeState>> | undefined,
  id: string,
): NodeState {
  return states?.[id] ?? 'idle';
}

/** Accessible name: "<title>. <kind>. <operator>. State: <state>." */
export function nodeAccessibleName(step: ReflexStep, state: NodeState): string {
  return `${step.title}. ${step.kind}. ${step.operator.id}. State: ${STATE_LABEL[state]}.`;
}

export function formatTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** The operator id without the redundant `local.` namespace (every operator is local). */
export function shortOperator(id: string): string {
  return id.startsWith('local.') ? id.slice('local.'.length) : id;
}

export const KIND_LABEL: Record<StepKind, string> = {
  known: 'Known',
  validation: 'Validation',
  hybrid: 'Hybrid',
  boundary: 'Boundary',
  verification: 'Verification',
};

export const KIND_HINT: Record<StepKind, string> = {
  known: 'runs locally, no model call',
  validation: 'checks a result locally',
  hybrid: 'local, may cross its uncertainty boundary',
  boundary: 'the uncertain decision, one bounded model call',
  verification: 'independent evidence locks the result',
};

/** Compact structural key: layout only depends on ids and dependencies. */
export function structureKeyOf(steps: readonly Pick<ReflexStep, 'id' | 'dependsOn'>[]): string {
  return JSON.stringify(steps.map((step) => [step.id, step.dependsOn]));
}

export function stepsFromStructureKey(key: string): { id: string; dependsOn: string[] }[] {
  const parsed = JSON.parse(key) as [string, string[]][];
  return parsed.map(([id, dependsOn]) => ({ id, dependsOn }));
}

export function sameStates(
  a: Readonly<Record<string, NodeState>> | undefined,
  b: Readonly<Record<string, NodeState>> | undefined,
  ids: readonly string[],
): boolean {
  if (a === b) return true;
  return ids.every((id) => stateOf(a, id) === stateOf(b, id));
}

export function describeStateChanges(
  previous: Readonly<Record<string, NodeState>> | undefined,
  next: Readonly<Record<string, NodeState>> | undefined,
  ids: readonly string[],
  titles: ReadonlyMap<string, string>,
): string {
  const changes: string[] = [];
  for (const id of ids) {
    const before = stateOf(previous, id);
    const after = stateOf(next, id);
    if (before !== after) changes.push(`Step ${titles.get(id) ?? id}: ${STATE_LABEL[after]}`);
  }
  if (changes.length <= 3) return changes.join('. ');
  return `${changes.slice(0, 3).join('. ')}. And ${changes.length - 3} more steps changed.`;
}
