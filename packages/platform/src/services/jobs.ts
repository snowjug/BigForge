import type { JobDto } from '@bigforge/schemas';
import type { Actor } from '../actor';
import { assertCan, forbidden, notFound } from '../actor';
import type { JobRow } from '../db/store';
import type { Platform } from '../platform';

export const JOB_TYPES = ['learn.batch', 'shadow', 'canary', 'mutation'] as const;
export type JobType = (typeof JOB_TYPES)[number];

interface JobParams extends Record<string, unknown> {
  actor: Actor;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class JobService {
  private readonly p: Platform;
  private draining: Promise<void> | null = null;

  constructor(platform: Platform) {
    this.p = platform;
  }

  toDto(row: JobRow): JobDto {
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      result: row.result,
      error: row.error,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  }

  enqueue(actor: Actor, type: JobType, params: Record<string, unknown>): JobRow {
    assertCan(actor, 'run_task');
    const ts = this.p.store.forTenant(actor.tenantId);
    const row: Omit<JobRow, 'tenantId'> = {
      id: this.p.ids.next('job'),
      type,
      status: 'queued',
      params: { ...params, actor } satisfies JobParams,
      progress: { done: 0, total: 0, label: 'Queued' },
      result: null,
      error: null,
      createdBy: actor.userId,
      createdAt: this.p.now(),
      startedAt: null,
      finishedAt: null,
    };
    ts.jobs.insert(ts.tenantId, row);
    this.p.audit(actor, 'job.queued', 'job', row.id, `Job queued: ${type}`, { type });
    return { ...row, tenantId: ts.tenantId };
  }

  get(actor: Actor, id: string): JobDto {
    const ts = this.p.store.forTenant(actor.tenantId);
    const row = ts.jobs.get(ts.tenantId, id);
    if (!row) throw notFound('Job');
    if (row.createdBy !== actor.userId && actor.role === 'viewer')
      throw forbidden('Jobs are visible to their creator and to operators');
    return this.toDto(row);
  }

  /** Starts draining the queue in the background (inline jobs mode). */
  kick(): void {
    if (this.p.config.jobsMode !== 'inline' || this.draining) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
  }

  /** Processes queued jobs one at a time across tenants until none remain. */
  async drain(): Promise<void> {
    for (;;) {
      const claim = this.p.store.claimNextJob();
      if (!claim) return;
      const ts = this.p.store.forTenant(claim.tenantId);
      const row = ts.jobs.get(claim.tenantId, claim.id);
      if (row) await this.execute(row);
    }
  }

  /** Runs one specific job to completion in this process. */
  async runNow(actor: Actor, id: string): Promise<JobRow> {
    const ts = this.p.store.forTenant(actor.tenantId);
    const claimed = this.p.store.db
      .prepare(
        "UPDATE jobs SET status = 'running', started_at = ? WHERE tenant_id = ? AND id = ? AND status = 'queued'",
      )
      .run(this.p.now(), actor.tenantId, id);
    const row = ts.jobs.get(actor.tenantId, id);
    if (!row) throw notFound('Job');
    if (Number(claimed.changes) === 1) await this.execute({ ...row, status: 'running' });
    return this.waitFor(actor.tenantId, id, 120_000);
  }

  async waitFor(tenantId: string, id: string, timeoutMs: number): Promise<JobRow> {
    const ts = this.p.store.forTenant(tenantId);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = ts.jobs.get(tenantId, id);
      if (!row) throw notFound('Job');
      if (row.status === 'succeeded' || row.status === 'failed') return row;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for job ${id}`);
      await sleep(50);
    }
  }

  private async execute(row: JobRow): Promise<void> {
    const ts = this.p.store.forTenant(row.tenantId);
    const params = row.params as JobParams;
    const actor = params.actor;
    const progress = (done: number, total: number, label: string) => {
      try {
        ts.jobs.update(ts.tenantId, row.id, { progress: { done, total, label } });
      } catch {
        // The store may have been reset while the job was running; progress is best-effort.
      }
    };
    try {
      let result: unknown;
      switch (row.type as JobType) {
        case 'learn.batch': {
          const ids = params.scenarioIds as string[];
          let done = 0;
          const taskIds: Record<string, string> = {};
          const env = this.p.tasks.environment(ts).toolchainVersion;
          for (const id of ids) {
            progress(done, ids.length, `Solving ${id} with the baseline agent`);
            // A failure the baseline agent already solved (for example from the Run Console) is not solved twice.
            const solved = ts.tasks
              .all(ts.tenantId, { where: { scenarioId: id, origin: 'intake' } })
              .find((t) => t.envVersion === env && t.status === 'solved');
            if (solved) {
              taskIds[id] = solved.id;
            } else {
              const task = await this.p.tasks.intake(actor, id);
              await this.p.tasks.run(actor, task.id, 'baseline');
              taskIds[id] = task.id;
            }
            done += 1;
          }
          progress(done, ids.length, 'Done');
          result = { taskIds };
          break;
        }
        case 'shadow': {
          const v = await this.p.validation.shadow(
            actor,
            params.versionId as string,
            (params.scenarioIds as string[] | undefined) ?? undefined,
            progress,
          );
          result = { versionId: v.id, status: v.status, eligible: v.gate.eligible };
          break;
        }
        case 'canary': {
          result = await this.p.drift.canary(actor, params.versionId as string, progress);
          break;
        }
        case 'mutation': {
          progress(0, 1, 'Recompiling from original and post-change traces');
          result = await this.p.drift.proposeMutation(actor, params.versionId as string);
          progress(1, 1, 'Done');
          break;
        }
        default:
          throw new Error(`Unknown job type: ${row.type}`);
      }
      ts.jobs.update(ts.tenantId, row.id, {
        status: 'succeeded',
        result,
        finishedAt: this.p.now(),
      });
      this.p.metrics.jobs.inc({ type: row.type, status: 'succeeded' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Job failed';
      this.p.metrics.jobs.inc({ type: row.type, status: 'failed' });
      try {
        ts.jobs.update(ts.tenantId, row.id, {
          status: 'failed',
          error: message.slice(0, 500),
          finishedAt: this.p.now(),
        });
      } catch {
        // Database replaced by a reset; nothing to record.
      }
    }
  }
}
