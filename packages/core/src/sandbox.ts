import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, readlink, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type CommandPolicy,
  type CommandSpec,
  PathViolationError,
  PermissionGuard,
  type PermissionSet,
  type RunResult,
  resolveConfined,
  runCommand,
  toPosixRelative,
} from '@bigforge/security';

export interface SafetyRecord {
  action: string;
  blocked: boolean;
  rule: string;
  reason: string;
}

export class SandboxViolation extends Error {
  readonly rule: string;
  readonly destructive: boolean;
  constructor(rule: string, message: string, destructive = false) {
    super(message);
    this.name = 'SandboxViolation';
    this.rule = rule;
    this.destructive = destructive;
  }
}

export interface SandboxLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  timeoutMs: 20_000,
  maxOutputBytes: 1_000_000,
  maxFileBytes: 512 * 1024,
};

export interface SandboxOptions {
  root: string;
  commandPolicy: CommandPolicy;
  permissions: PermissionSet;
  limits?: Partial<SandboxLimits>;
  onSafety?: (record: SafetyRecord) => void;
}

const IGNORED_DIRS = new Set(['node_modules', '.git']);

/**
 * A confined working directory with least-privilege capabilities.
 * Every file and command action is path-confined, permission-checked and recorded.
 * Application-level containment: it is not an OS-level sandbox.
 */
export class Sandbox {
  readonly root: string;
  readonly permissions: PermissionSet;
  private readonly commandPolicy: CommandPolicy;
  private readonly guard: PermissionGuard;
  private readonly limits: SandboxLimits;
  private readonly onSafety: ((record: SafetyRecord) => void) | undefined;

  constructor(options: SandboxOptions) {
    this.root = path.resolve(options.root);
    this.permissions = options.permissions;
    this.commandPolicy = options.commandPolicy;
    this.guard = new PermissionGuard(options.permissions);
    this.limits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits };
    this.onSafety = options.onSafety;
  }

  /** A sandbox over the same directory with different (e.g. narrower) permissions. */
  derive(permissions: PermissionSet, onSafety?: (r: SafetyRecord) => void): Sandbox {
    return new Sandbox({
      root: this.root,
      commandPolicy: this.commandPolicy,
      permissions,
      limits: this.limits,
      onSafety: onSafety ?? this.onSafety,
    });
  }

  private deny(action: string, rule: string, reason: string, destructive = false): never {
    this.onSafety?.({ action, blocked: true, rule, reason });
    throw new SandboxViolation(rule, reason, destructive);
  }

  /**
   * Confines a path and returns it both as named (`posix`) and as the operating system will really
   * reach it (`realPosix`, which differs when a symlink is involved). Permissions apply to both.
   */
  private async confine(
    rel: string,
    action: string,
  ): Promise<{ abs: string; posix: string; realPosix: string }> {
    try {
      const { lexical, realRelative } = await resolveConfined(this.root, rel);
      return { abs: lexical, posix: toPosixRelative(this.root, lexical), realPosix: realRelative };
    } catch (err) {
      if (err instanceof PathViolationError) this.deny(action, err.rule, err.message);
      throw err;
    }
  }

  private authorize(
    kind: 'read' | 'write',
    action: string,
    posix: string,
    realPosix: string,
  ): void {
    for (const candidate of posix === realPosix ? [posix] : [posix, realPosix]) {
      const decision =
        kind === 'read' ? this.guard.canRead(candidate) : this.guard.canWrite(candidate);
      if (!decision.allowed) {
        const via = candidate === posix ? '' : ' (reached through a symbolic link)';
        this.deny(action, decision.rule, `${decision.reason}${via}`);
      }
    }
  }

  async readFile(rel: string): Promise<string> {
    const action = `read ${rel}`;
    const { abs, posix, realPosix } = await this.confine(rel, action);
    this.authorize('read', action, posix, realPosix);
    const info = await stat(abs);
    if (info.size > this.limits.maxFileBytes) {
      this.deny(action, 'file_too_large', `File exceeds ${this.limits.maxFileBytes} bytes`);
    }
    return readFile(abs, 'utf8');
  }

  async exists(rel: string): Promise<boolean> {
    const action = `stat ${rel}`;
    const { abs, posix, realPosix } = await this.confine(rel, action);
    this.authorize('read', action, posix, realPosix);
    return stat(abs).then(
      () => true,
      () => false,
    );
  }

  async listDir(rel: string): Promise<string[]> {
    const action = `list ${rel}`;
    const { abs, posix, realPosix } = await this.confine(rel, action);
    for (const candidate of posix === realPosix ? [posix] : [posix, realPosix]) {
      const decision = this.guard.canRead(`${candidate}/x`.replace(/^\.\//, ''));
      if (!decision.allowed && !this.guard.canRead(candidate).allowed) {
        this.deny(action, decision.rule, decision.reason);
      }
    }
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => !IGNORED_DIRS.has(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  }

  async writeFile(rel: string, content: string): Promise<void> {
    const action = `write ${rel}`;
    const { abs, posix, realPosix } = await this.confine(rel, action);
    this.authorize('write', action, posix, realPosix);
    // Never write through a symbolic link: it could redirect the write onto a protected or not-yet-existing file.
    const leaf = await lstat(abs).catch(() => null);
    if (leaf?.isSymbolicLink()) {
      this.deny(action, 'symlink_write', 'Writing through a symbolic link is not allowed');
    }
    if (Buffer.byteLength(content, 'utf8') > this.limits.maxFileBytes) {
      this.deny(action, 'file_too_large', `Content exceeds ${this.limits.maxFileBytes} bytes`);
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }

  async run(spec: CommandSpec): Promise<RunResult> {
    const action = [spec.program, ...spec.args].join(' ').slice(0, 200);
    const granted = this.guard.canRun(spec);
    if (!granted.allowed) {
      this.onSafety?.({ action, blocked: true, rule: granted.rule, reason: granted.reason });
      return {
        status: 'blocked',
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        truncated: false,
        durationMs: 0,
        durationProvenance: 'measured',
        normalized: action,
        blockedRule: granted.rule,
        blockedReason: granted.reason,
        destructive: false,
      };
    }
    const result = await runCommand({
      spec,
      policy: this.commandPolicy,
      root: this.root,
      timeoutMs: this.limits.timeoutMs,
      maxOutputBytes: this.limits.maxOutputBytes,
    });
    if (result.status === 'blocked') {
      this.onSafety?.({
        action,
        blocked: true,
        rule: result.blockedRule ?? 'blocked',
        reason: result.blockedReason ?? 'Command blocked by policy',
      });
    }
    return result;
  }

  /** SHA-256 manifest of every file under the root (system-level integrity check; not agent-visible). */
  async snapshot(): Promise<Record<string, string>> {
    return (await this.snapshotFiles(0)).hashes;
  }

  /** Hashes of every file, plus the text of files up to `maxTextBytes` (for diff-based policy checks). */
  async snapshotFiles(
    maxTextBytes = 64 * 1024,
  ): Promise<{ hashes: Record<string, string>; texts: Record<string, string> }> {
    // Null-prototype maps: a file named `__proto__` or `constructor` must be recorded like any other.
    const hashes = Object.create(null) as Record<string, string>;
    const texts = Object.create(null) as Record<string, string>;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs);
        else if (entry.isSymbolicLink()) {
          // Links are not followed, but creating or retargeting one must show up as a change.
          hashes[toPosixRelative(this.root, abs)] = `symlink:${await readlink(abs)}`;
        } else if (entry.isFile()) {
          const rel = toPosixRelative(this.root, abs);
          const buf = await readFile(abs);
          hashes[rel] = createHash('sha256').update(buf).digest('hex');
          if (buf.length <= maxTextBytes) texts[rel] = buf.toString('utf8');
        }
      }
    };
    await walk(this.root);
    return { hashes, texts };
  }
}

export function diffManifests(
  before: Record<string, string>,
  after: Record<string, string>,
): { added: string[]; removed: string[]; modified: string[] } {
  const added = Object.keys(after).filter((k) => !Object.hasOwn(before, k));
  const removed = Object.keys(before).filter((k) => !Object.hasOwn(after, k));
  const modified = Object.keys(after).filter(
    (k) => Object.hasOwn(before, k) && before[k] !== after[k],
  );
  return { added: added.sort(), removed: removed.sort(), modified: modified.sort() };
}
