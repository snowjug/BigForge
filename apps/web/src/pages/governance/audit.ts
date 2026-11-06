import { driftPath, learnPath, reflexPath, runPath, tracePath } from '../../routes';
import type { Tone } from '../../ui';

/** Audit actions the server records. The filter also offers any other action seen in the loaded events. */
export const KNOWN_AUDIT_ACTIONS: readonly string[] = [
  'auth.login',
  'demo.reset',
  'drift.checked',
  'family.discovered',
  'job.queued',
  'lab.environment_changed',
  'mutation.approved',
  'mutation.proposed',
  'mutation.rejected',
  'reflex.compiled',
  'reflex.integrity_failed',
  'reflex.promoted',
  'reflex.rejected',
  'reflex.replayed',
  'reflex.rolled_back',
  'reflex.shadowed',
  'run.baseline',
  'run.reflex',
  'settings.updated',
  'task.observed',
  'task.received',
];

const TONES: Record<string, Tone> = {
  auth: 'ash',
  job: 'ash',
  task: 'steel',
  run: 'steel',
  family: 'steel',
  reflex: 'jade',
  mutation: 'ember',
  drift: 'amber',
  lab: 'amber',
  settings: 'molten',
  demo: 'crimson',
};

/** The colour family of an action: its namespace, except that failures and withdrawals stand out. */
export function actionTone(action: string): Tone {
  if (action === 'reflex.integrity_failed' || action === 'reflex.rolled_back') return 'crimson';
  if (action === 'reflex.rejected' || action === 'mutation.rejected') return 'amber';
  return TONES[action.split('.')[0] ?? ''] ?? 'neutral';
}

/** "reflex.rolled_back" -> "rolled back" (the namespace is shown by the chip colour and the subject). */
export function actionVerb(action: string): string {
  const [, ...rest] = action.split('.');
  return (rest.length > 0 ? rest.join('.') : action).replaceAll('_', ' ');
}

/** In-app destination for an event's subject, when the subject has a page. */
export function subjectLink(subjectType: string, subjectId: string): string | null {
  switch (subjectType) {
    case 'reflex_version':
      return reflexPath(subjectId);
    case 'task':
      return runPath({ task: subjectId });
    case 'run':
      return tracePath(subjectId);
    case 'family':
      return learnPath({ family: subjectId });
    case 'mutation':
      return driftPath();
    default:
      return null;
  }
}

/** The filter's options: known actions plus anything else that appeared, sorted. */
export function actionOptions(seen: readonly string[]): string[] {
  return [...new Set([...KNOWN_AUDIT_ACTIONS, ...seen])].sort();
}
