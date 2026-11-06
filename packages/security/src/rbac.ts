export const ROLES = ['viewer', 'operator', 'reviewer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'read',
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
  'view_audit',
  'reset_demo',
  'manage_settings',
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<Action, readonly Role[]> = {
  read: ['viewer', 'operator', 'reviewer', 'admin'],
  view_audit: ['viewer', 'operator', 'reviewer', 'admin'],
  run_task: ['operator', 'reviewer', 'admin'],
  compile: ['operator', 'reviewer', 'admin'],
  replay: ['operator', 'reviewer', 'admin'],
  shadow: ['operator', 'reviewer', 'admin'],
  canary: ['operator', 'reviewer', 'admin'],
  inject_environment_change: ['operator', 'reviewer', 'admin'],
  // Human approval: operators can prepare evidence but cannot activate or approve.
  promote: ['reviewer', 'admin'],
  reject: ['reviewer', 'admin'],
  rollback: ['reviewer', 'admin'],
  approve_mutation: ['reviewer', 'admin'],
  reset_demo: ['admin'],
  manage_settings: ['admin'],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export function rolesFor(action: Action): readonly Role[] {
  return MATRIX[action];
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
