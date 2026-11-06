import { type Action, can } from '@bigforge/security';
import type { Role } from '@bigforge/schemas';

export interface Actor {
  userId: string;
  name: string;
  role: Role;
  tenantId: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const forbidden = (message: string, details?: unknown) =>
  new AppError(403, 'forbidden', message, details);
export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

/** Server-side role enforcement. The UI also hides controls, but this is the real boundary. */
export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor.role, action)) {
    throw forbidden(`Role "${actor.role}" is not permitted to ${action.replaceAll('_', ' ')}`, {
      action,
      role: actor.role,
    });
  }
}

export const SYSTEM_ACTOR_NAME = 'BigForge system';

export function systemActor(tenantId: string): Actor {
  return { userId: 'system', name: SYSTEM_ACTOR_NAME, role: 'admin', tenantId };
}
