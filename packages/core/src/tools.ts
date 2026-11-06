import { performance } from 'node:perf_hooks';
import type { CommandSpec } from '@bigforge/security';
import { type Sandbox, SandboxViolation } from './sandbox';
import type { TraceRecorder } from './recorder';

export interface CommandOutcome {
  ok: boolean;
  blocked: boolean;
  exitCode: number | null;
  /** stdout followed by stderr (if any). */
  output: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  normalized: string;
  blockedReason?: string;
}

export interface PatchEdit {
  search: string;
  replace: string;
}

/**
 * Sandbox capabilities that record every action into the trace with measured durations.
 * Shared by the baseline agent's tool gateway and by Reflex operators, so both execution
 * paths leave identical, comparable evidence.
 */
export class InstrumentedTools {
  readonly sandbox: Sandbox;
  readonly recorder: TraceRecorder;

  constructor(sandbox: Sandbox, recorder: TraceRecorder) {
    this.sandbox = sandbox;
    this.recorder = recorder;
  }

  async readFile(rel: string, purpose?: string): Promise<string> {
    const t0 = performance.now();
    try {
      const content = await this.sandbox.readFile(rel);
      this.recorder.toolCall({
        ...(purpose !== undefined ? { purpose } : {}),
        tool: 'read_file',
        args: { path: rel },
        status: 'ok',
        durationMs: performance.now() - t0,
        exitCode: null,
        output: content,
        spawned: false,
      });
      return content;
    } catch (err) {
      this.recordViolation('read_file', { path: rel }, err, t0, purpose);
      throw err;
    }
  }

  async listDir(rel: string, purpose?: string): Promise<string[]> {
    const t0 = performance.now();
    try {
      const entries = await this.sandbox.listDir(rel);
      this.recorder.toolCall({
        ...(purpose !== undefined ? { purpose } : {}),
        tool: 'list_dir',
        args: { path: rel },
        status: 'ok',
        durationMs: performance.now() - t0,
        exitCode: null,
        output: entries.join('\n'),
        spawned: false,
      });
      return entries;
    } catch (err) {
      this.recordViolation('list_dir', { path: rel }, err, t0, purpose);
      throw err;
    }
  }

  async applyPatch(
    file: string,
    edits: PatchEdit[],
    purpose?: string,
  ): Promise<{ before: string; after: string }> {
    const t0 = performance.now();
    try {
      const before = await this.sandbox.readFile(file);
      let after = before;
      for (const edit of edits) {
        if (!after.includes(edit.search)) {
          throw new SandboxViolation(
            'patch_search_not_found',
            `Search text not found in ${file}: ${edit.search.slice(0, 80)}`,
          );
        }
        after = after.split(edit.search).join(edit.replace);
      }
      await this.sandbox.writeFile(file, after);
      this.recorder.toolCall({
        ...(purpose !== undefined ? { purpose } : {}),
        tool: 'apply_patch',
        args: { file, edits },
        status: 'ok',
        durationMs: performance.now() - t0,
        exitCode: null,
        output: `patched ${file} (${edits.length} edit${edits.length === 1 ? '' : 's'})`,
        spawned: false,
      });
      return { before, after };
    } catch (err) {
      this.recordViolation('apply_patch', { file }, err, t0, purpose);
      throw err;
    }
  }

  async run(spec: CommandSpec, purpose?: string): Promise<CommandOutcome> {
    const result = await this.sandbox.run(spec);
    const output = result.stderr ? `${result.stdout}\n[stderr]\n${result.stderr}` : result.stdout;
    const blocked = result.status === 'blocked';
    const ok = result.status === 'completed' && result.exitCode === 0;
    this.recorder.toolCall({
      ...(purpose !== undefined ? { purpose } : {}),
      tool: 'run_command',
      args: { command: result.normalized },
      status: blocked ? 'blocked' : ok ? 'ok' : 'error',
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      output: blocked ? (result.blockedReason ?? 'blocked') : output,
      ...(blocked ? { blockedReason: result.blockedReason ?? 'blocked' } : {}),
      spawned: !blocked,
    });
    return {
      ok,
      blocked,
      exitCode: result.exitCode,
      output,
      durationMs: result.durationMs,
      timedOut: result.status === 'timed_out',
      truncated: result.truncated,
      normalized: result.normalized,
      ...(result.blockedReason !== undefined ? { blockedReason: result.blockedReason } : {}),
    };
  }

  private recordViolation(
    tool: string,
    args: Record<string, unknown>,
    err: unknown,
    t0: number,
    purpose: string | undefined,
  ): void {
    if (!(err instanceof SandboxViolation)) return;
    this.recorder.toolCall({
      ...(purpose !== undefined ? { purpose } : {}),
      tool,
      args,
      status: 'blocked',
      durationMs: performance.now() - t0,
      exitCode: null,
      output: err.message,
      blockedReason: `${err.rule}: ${err.message}`,
      spawned: false,
    });
  }
}
