import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolveInside } from './paths';
import { type CommandPolicy, type CommandSpec, validateCommand } from './commands';

export interface RunOptions {
  spec: CommandSpec;
  policy: CommandPolicy;
  /** Confinement root. The working directory must resolve inside it. */
  root: string;
  /** Working directory relative to root (default: the root itself). */
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Explicit extra environment. The parent environment is never inherited. */
  env?: Record<string, string>;
}

export interface RunResult {
  status: 'completed' | 'blocked' | 'timed_out' | 'failed_to_start';
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  /** Always `measured`: this is real wall-clock time of a real process. */
  durationProvenance: 'measured';
  normalized: string;
  blockedRule?: string;
  blockedReason?: string;
  destructive?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

function scrubbedEnv(
  root: string,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    CI: 'true',
    HOME: root,
    ...extra,
  };
}

/**
 * Runs an allowlisted, structured command with no shell, a confined working directory,
 * a scrubbed environment, a timeout and output caps.
 *
 * This is application-level containment. It is NOT an OS-level sandbox.
 */
export async function runCommand(options: RunOptions): Promise<RunResult> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const base = {
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    truncated: false,
    durationProvenance: 'measured' as const,
  };

  const validation = validateCommand(options.spec, options.policy, options.root);
  if (!validation.ok) {
    return {
      ...base,
      status: 'blocked',
      durationMs: elapsed(),
      normalized: [options.spec.program, ...options.spec.args].join(' ').slice(0, 300),
      blockedRule: validation.rule,
      blockedReason: validation.reason,
      destructive: validation.destructive,
    };
  }

  let cwd: string;
  try {
    cwd = resolveInside(options.root, options.cwd ?? '.');
  } catch (err) {
    return {
      ...base,
      status: 'blocked',
      durationMs: elapsed(),
      normalized: validation.normalized,
      blockedRule: 'cwd_outside_root',
      blockedReason: err instanceof Error ? err.message : 'Invalid working directory',
      destructive: false,
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const [file, ...args] = validation.argv as [string, ...string[]];

  return new Promise<RunResult>((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(file, args, {
      cwd,
      env: scrubbedEnv(options.root, options.env),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (
      result: Omit<RunResult, 'durationMs' | 'durationProvenance' | 'normalized'>,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        durationMs: elapsed(),
        durationProvenance: 'measured',
        normalized: validation.normalized,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const collect = (chunks: Buffer[], bytes: number, chunk: Buffer): number => {
      const room = maxBytes - bytes;
      if (room <= 0) {
        truncated = true;
        return bytes;
      }
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, room));
        truncated = true;
        return bytes + room;
      }
      chunks.push(chunk);
      return bytes + chunk.length;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes = collect(out, outBytes, chunk);
      if (truncated && outBytes + errBytes > maxBytes * 2) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes = collect(err, errBytes, chunk);
    });
    child.on('error', (e) => {
      finish({
        ...base,
        status: 'failed_to_start',
        stderr: e.message,
        truncated,
      });
    });
    child.on('close', (code, signal) => {
      finish({
        status: timedOut ? 'timed_out' : 'completed',
        exitCode: code,
        signal,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        truncated,
      });
    });
  });
}
