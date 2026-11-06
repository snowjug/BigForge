import type { ReflexStatus } from '@bigforge/schemas';
import type { ForgeStageId } from '../stages';

/** What the Forge Floor knows about the forge, reduced to the facts that decide "where is it right now". */
export interface ForgeFacts {
  /** Recorded runs (traces). */
  runs: number;
  families: number;
  /** Status of every Reflex version. */
  versionStatuses: readonly ReflexStatus[];
  liveExecutions: number;
  driftChecks: number;
  /** Verdict of the most recent drift check, when there is one. */
  latestDriftDetected: boolean | null;
  proposedMutations: number;
}

export interface ForgeState {
  /** The stage that is hot. Null when nothing has run. */
  stage: ForgeStageId | null;
  headline: string;
  detail: string;
}

const count = (statuses: readonly ReflexStatus[], ...wanted: ReflexStatus[]): number =>
  statuses.filter((status) => wanted.includes(status)).length;

const noun = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Names where the forge is right now, from the latest evidence outwards: drift beats an active Reflex,
 * which beats validation, which beats learning, which beats just watching.
 */
export function describeForge(facts: ForgeFacts): ForgeState {
  const { versionStatuses: statuses } = facts;
  const active = count(statuses, 'active', 'watch');

  if (facts.driftChecks > 0 && facts.latestDriftDetected) {
    return {
      stage: 'evolve',
      headline: 'The world changed.',
      detail: `The latest Drift Canary found disagreement; trust fell and the Reflex went back to validation.${
        facts.proposedMutations > 0
          ? ` ${noun(facts.proposedMutations, 'mutation')} proposed, waiting for a human.`
          : ''
      }`,
    };
  }
  if (facts.proposedMutations > 0) {
    return {
      stage: 'evolve',
      headline: 'A mutation is waiting.',
      detail: `${noun(facts.proposedMutations, 'proposed mutation')} must be approved or rejected by a reviewer. None is active.`,
    };
  }
  if (active > 0) {
    return {
      stage: 'execute',
      headline: facts.liveExecutions > 0 ? 'Known steps run locally.' : 'A Reflex is active.',
      detail:
        facts.liveExecutions > 0
          ? `${noun(active, 'Reflex', 'Reflexes')} active, ${noun(facts.liveExecutions, 'live execution')}. Only unknowns cross the Token Firewall.`
          : `${noun(active, 'Reflex', 'Reflexes')} promoted by a human and ready for the next matching task.`,
    };
  }
  if (count(statuses, 'approval') > 0) {
    return {
      stage: 'validate',
      headline: 'A Reflex awaits a human.',
      detail: 'Replay and Shadow Brain evidence is in. Promotion is always a reviewer’s decision.',
    };
  }
  if (count(statuses, 'candidate', 'replay', 'shadow', 'recompile') > 0) {
    return {
      stage: 'validate',
      headline: 'A candidate is being validated.',
      detail: `${noun(statuses.length, 'Reflex version')} compiled. It cannot run live until replay, Shadow Brain and a human say so.`,
    };
  }
  if (facts.families > 0) {
    return {
      stage: 'compile',
      headline: 'Something repeats.',
      detail: `${noun(facts.families, 'task family', 'task families')} discovered from ${noun(facts.runs, 'trace')}. Compile it into a candidate Reflex.`,
    };
  }
  if (facts.runs > 0) {
    return {
      stage: 'observe',
      headline: 'Watching the agent.',
      detail: `${noun(facts.runs, 'trace')} recorded. No repeating family has been found yet.`,
    };
  }
  return {
    stage: null,
    headline: 'The forge is cold.',
    detail: 'Nothing has run yet. The guided demo lights it step by step, offline.',
  };
}
