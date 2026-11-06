import type { Role } from '@bigforge/schemas';

/**
 * What each role may do. This mirrors the matrix enforced by the server (packages/security/src/rbac.ts);
 * the server is the real boundary, this copy only decides which controls to offer and explain.
 * Keep the two in step: test/rbac.test.ts asserts the invariants this UI relies on.
 */

export const ROLES: readonly Role[] = ['viewer', 'operator', 'reviewer', 'admin'];

export const ACTIONS = [
  'read',
  'view_audit',
  'run_task',
  'compile',
  'replay',
  'shadow',
  'canary',
  'inject_environment_change',
  'promote',
  'reject',
  'rollback',
  'approve_mutation',
  'manage_settings',
  'reset_demo',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, { label: string; detail: string }> = {
  read: { label: 'Read everything', detail: 'Browse tasks, traces, Reflexes, drift, economics.' },
  view_audit: {
    label: 'View the audit log',
    detail: 'Read the hash-chained audit trail and verify it.',
  },
  run_task: {
    label: 'Run tasks',
    detail: 'Receive failures, run the baseline agent or a Reflex, start background jobs.',
  },
  compile: {
    label: 'Discover families and compile',
    detail: 'Turn repeated traces into a candidate Reflex.',
  },
  replay: { label: 'Replay history', detail: 'Re-run recorded tasks against a candidate.' },
  shadow: { label: 'Run Shadow Brain', detail: 'Run the AI and the candidate side by side.' },
  canary: {
    label: 'Run the Drift Canary',
    detail: 'Sample familiar tasks through both and compare.',
  },
  inject_environment_change: {
    label: 'Change the environment',
    detail: 'Introduce a synthetic toolchain update to trigger drift.',
  },
  promote: { label: 'Promote a Reflex', detail: 'The human decision that lets a Reflex run live.' },
  reject: { label: 'Reject a candidate', detail: 'Return a Reflex awaiting approval to shadow.' },
  rollback: { label: 'Roll back an active Reflex', detail: 'Take a Reflex out of service.' },
  approve_mutation: {
    label: 'Approve or reject a mutation',
    detail: 'Decide whether a proposed new version enters validation.',
  },
  manage_settings: {
    label: 'Change settings',
    detail: 'Promotion gate, drift thresholds, economics assumptions.',
  },
  reset_demo: {
    label: 'Reset the demo',
    detail: 'Recreate the database and start a new audit chain.',
  },
};

const MATRIX: Record<Action, readonly Role[]> = {
  read: ['viewer', 'operator', 'reviewer', 'admin'],
  view_audit: ['viewer', 'operator', 'reviewer', 'admin'],
  run_task: ['operator', 'reviewer', 'admin'],
  compile: ['operator', 'reviewer', 'admin'],
  replay: ['operator', 'reviewer', 'admin'],
  shadow: ['operator', 'reviewer', 'admin'],
  canary: ['operator', 'reviewer', 'admin'],
  inject_environment_change: ['operator', 'reviewer', 'admin'],
  promote: ['reviewer', 'admin'],
  reject: ['reviewer', 'admin'],
  rollback: ['reviewer', 'admin'],
  approve_mutation: ['reviewer', 'admin'],
  manage_settings: ['admin'],
  reset_demo: ['admin'],
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return role ? MATRIX[action].includes(role) : false;
}

export function rolesFor(action: Action): readonly Role[] {
  return MATRIX[action];
}
