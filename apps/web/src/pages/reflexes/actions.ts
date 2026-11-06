import type { GateResult, ReflexStatus, ReflexVersionDto, Role } from '@bigforge/schemas';
import { type GateSummary, summariseGate } from './gate';

/**
 * Which lifecycle actions are available and, when one is not, the one-sentence reason shown next to the
 * disabled control. The server stays the authority (`ReflexVersionDto.actions`); this explains its answer.
 */

export type ActionId = 'replay' | 'shadow' | 'promote' | 'reject' | 'rollback';

export interface ActionState {
  available: boolean;
  /** Why it is unavailable, null when it is available. */
  reason: string | null;
}

export type ActionStates = Record<ActionId, ActionState>;

interface Input {
  status: ReflexStatus;
  actions: ReflexVersionDto['actions'];
  gate: GateResult;
  integrityOk: boolean;
  role: Role | null;
}

const ROLE_NAME: Record<Role, string> = {
  viewer: 'a viewer',
  operator: 'an operator',
  reviewer: 'a reviewer',
  admin: 'an admin',
};

const STATUS_NAME: Record<ReflexStatus, string> = {
  candidate: 'a candidate',
  replay: 'in replay',
  shadow: 'in shadow',
  approval: 'awaiting approval',
  active: 'active',
  watch: 'on watch',
  recompile: 'waiting for a recompile',
  deprecated: 'deprecated',
  retired: 'retired',
};

const ALLOWED_ROLES: Record<ActionId, readonly Role[]> = {
  replay: ['operator', 'reviewer', 'admin'],
  shadow: ['operator', 'reviewer', 'admin'],
  promote: ['reviewer', 'admin'],
  reject: ['reviewer', 'admin'],
  rollback: ['reviewer', 'admin'],
};

const VERB: Record<ActionId, string> = {
  replay: 'replay a candidate',
  shadow: 'run Shadow Brain',
  promote: 'promote a Reflex',
  reject: 'reject a candidate',
  rollback: 'roll back a Reflex',
};

function roleReason(action: ActionId, role: Role | null): string | null {
  if (role && ALLOWED_ROLES[action].includes(role)) return null;
  const who =
    action === 'replay' || action === 'shadow'
      ? 'An operator, reviewer or admin'
      : 'A reviewer or admin';
  const you = role ? `You are signed in as ${ROLE_NAME[role]}.` : 'You are not signed in.';
  const why =
    action === 'promote'
      ? 'Promotion is a human decision reserved for reviewers.'
      : `Only ${who.toLowerCase()} can ${VERB[action]}.`;
  return `${why} ${you}`;
}

export function actionStates({ status, actions, gate, integrityOk, role }: Input): ActionStates {
  const summary: GateSummary = summariseGate(gate);

  const statusReason = (needs: ReflexStatus, message: string): string | null =>
    status === needs ? null : `${message}; this one is ${STATUS_NAME[status]}.`;

  const promoteStatusReason = (): string | null => {
    if (status === 'approval') return null;
    if (status === 'candidate')
      return 'Not yet: replay it, then run Shadow Brain until the evidence gate passes.';
    if (status === 'replay') return 'Not yet: replay is still running.';
    if (status === 'shadow') {
      const first = summary.missing[0];
      return first
        ? `Not yet: ${first.gap}`
        : 'Not yet: run Shadow Brain again; when the gate holds on fresh evidence it returns to a reviewer.';
    }
    return `Only a Reflex awaiting approval can be promoted; this one is ${STATUS_NAME[status]}.`;
  };

  const make = (flag: boolean, derived: (string | null)[]): ActionState => {
    if (flag) return { available: true, reason: null };
    const reason = derived.find((r): r is string => r !== null);
    return {
      available: false,
      reason: reason ?? 'The server does not allow this action right now.',
    };
  };

  return {
    replay: make(actions.replay, [
      roleReason('replay', role),
      statusReason('candidate', 'Replay is only available for a candidate'),
    ]),
    shadow: make(actions.shadow, [
      roleReason('shadow', role),
      statusReason('shadow', 'Shadow Brain runs only on a Reflex in shadow'),
    ]),
    promote: make(actions.promote, [
      roleReason('promote', role),
      integrityOk
        ? null
        : 'Integrity check failed: the specification no longer matches its recorded content hash.',
      promoteStatusReason(),
      gate.eligible ? null : `The evidence gate is not satisfied. ${summary.headline}`,
    ]),
    reject: make(actions.reject, [
      roleReason('reject', role),
      statusReason('approval', 'Only a Reflex awaiting approval can be rejected'),
    ]),
    rollback: make(actions.rollback, [
      roleReason('rollback', role),
      status === 'active' || status === 'watch'
        ? null
        : `Only an active Reflex can be rolled back; this one is ${STATUS_NAME[status]}.`,
    ]),
  };
}
