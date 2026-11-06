import { matchesAnyGlob } from './paths';
import type { CommandSpec } from './commands';

export interface PermissionSet {
  read: readonly string[];
  write: readonly string[];
  commands: readonly { program: string; subcommands: readonly string[] }[];
}

export interface PermissionDecision {
  allowed: boolean;
  rule: string;
  reason: string;
}

/** Never writable by any Reflex, regardless of its declared write globs. */
export const PROTECTED_WRITE_GLOBS: readonly string[] = [
  '**/forge.lock.json',
  '.github/**',
  'ci/**',
  '**/.env',
  '**/.env.*',
  '**/node_modules/**',
];

const allow = (rule: string): PermissionDecision => ({ allowed: true, rule, reason: 'permitted' });
const deny = (rule: string, reason: string): PermissionDecision => ({
  allowed: false,
  rule,
  reason,
});

/** Evaluates file and command actions against a declared permission set (least privilege). */
export class PermissionGuard {
  private readonly perms: PermissionSet;

  constructor(perms: PermissionSet) {
    this.perms = perms;
  }

  canRead(posixRelativePath: string): PermissionDecision {
    if (matchesAnyGlob(this.perms.read, posixRelativePath)) return allow('read_glob');
    return deny(
      'read_not_granted',
      `Read of "${posixRelativePath}" is outside the granted permissions`,
    );
  }

  canWrite(posixRelativePath: string): PermissionDecision {
    if (matchesAnyGlob(PROTECTED_WRITE_GLOBS, posixRelativePath)) {
      return deny(
        'protected_path',
        `"${posixRelativePath}" is a protected path and cannot be modified`,
      );
    }
    if (matchesAnyGlob(this.perms.write, posixRelativePath)) return allow('write_glob');
    return deny(
      'write_not_granted',
      `Write to "${posixRelativePath}" is outside the granted permissions`,
    );
  }

  canRun(spec: CommandSpec): PermissionDecision {
    const sub = spec.args[0];
    const granted = this.perms.commands.find((c) => c.program === spec.program);
    if (!granted) return deny('command_not_granted', `Program "${spec.program}" is not granted`);
    if (sub === undefined || !granted.subcommands.includes(sub)) {
      return deny(
        'subcommand_not_granted',
        `Subcommand "${sub ?? ''}" of "${spec.program}" is not granted`,
      );
    }
    return allow('command_granted');
  }
}
