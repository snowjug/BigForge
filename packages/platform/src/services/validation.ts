import {
  type GateEvidence,
  InvalidTransitionError,
  type LifecycleEvent,
  compareRuns,
  evaluateGate,
  mayExecuteActive,
  trustFromHistory,
  transition,
} from '@bigforge/core';
import { SHADOW_IDS, type ToolchainVersion, getScenario } from '@bigforge/lab-monorepo';
import {
  DEFAULT_PROMOTION_GATE,
  type ApprovalDto,
  type ComparisonDto,
  type ConfidencePoint,
  type GateResult,
  type PromotionGate,
  type ReflexListDto,
  type ReflexVersionDto,
  type ReflexVersionSummaryDto,
  type TransitionDto,
  type ValidationSummaryDto,
} from '@bigforge/schemas';
import { can, contentHash } from '@bigforge/security';
import { type Actor, assertCan, conflict, notFound } from '../actor';
import type { ComparisonRow, ReflexVersionRow, RunRow, TenantStore } from '../db/store';
import type { Page } from '../db/table';
import { materialize, runBaseline, runReflex } from '../execution';
import type { Platform } from '../platform';
import { mapPool } from './pool';
import { digestFromRun, saveRun } from './shared';

export interface ValidationProgress {
  (done: number, total: number, label: string): void;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export class ValidationService {
  private readonly p: Platform;

  constructor(platform: Platform) {
    this.p = platform;
  }

  gateConfig(ts: TenantStore): PromotionGate {
    return ts.getSetting<PromotionGate>('gate', DEFAULT_PROMOTION_GATE);
  }

  getVersion(ts: TenantStore, id: string): ReflexVersionRow {
    const v = ts.versions.get(ts.tenantId, id);
    if (!v) throw notFound('Reflex version');
    return v;
  }

  /** Applies a lifecycle event. Invalid transitions are refused; every transition is recorded and audited. */
  applyTransition(
    ts: TenantStore,
    version: ReflexVersionRow,
    event: LifecycleEvent,
    reason: string,
    actorName: string,
    extra: Partial<Pick<ReflexVersionRow, 'confidence' | 'trust'>> = {},
  ): ReflexVersionRow {
    let to;
    try {
      to = transition(version.status, event);
    } catch (err) {
      if (err instanceof InvalidTransitionError)
        throw conflict(err.message, { from: err.from, event: err.event });
      throw err;
    }
    this.p.metrics.transitions.inc({ from: version.status, to });
    const now = this.p.now();
    ts.versions.update(ts.tenantId, version.id, { status: to, updatedAt: now, ...extra });
    ts.transitions.insert(ts.tenantId, {
      id: this.p.ids.next('trn'),
      reflexVersionId: version.id,
      fromStatus: version.status,
      toStatus: to,
      event,
      reason,
      actor: actorName,
      createdAt: now,
    });
    this.p.auditFor(
      ts.tenantId,
      actorName,
      'reflex.transition',
      'reflex_version',
      version.id,
      `${version.spec.name} v${version.version}: ${version.status} -> ${to} (${event})`,
      { from: version.status, to, event, reason },
    );
    return { ...version, status: to, updatedAt: now, ...extra };
  }

  // ---- evidence ----
  private comparisonsOf(
    ts: TenantStore,
    versionId: string,
    kind?: ComparisonRow['kind'],
  ): ComparisonRow[] {
    return ts.comparisons.all(ts.tenantId, {
      where: { reflexVersionId: versionId, ...(kind ? { kind } : {}) },
      order: 'created_at ASC, id ASC',
    });
  }

  private safetyOf(c: ComparisonRow): number {
    const check = c.comparison.checks.find((x) => x.id === 'safety');
    return Number.parseInt(check?.reflex ?? '0', 10) || 0;
  }

  gate(ts: TenantStore, version: ReflexVersionRow): { result: GateResult; evidence: GateEvidence } {
    const replay = this.comparisonsOf(ts, version.id, 'replay');
    const shadow = this.comparisonsOf(ts, version.id, 'shadow');
    const evidence: GateEvidence = {
      replayRuns: replay.length,
      replayAgreement: replay.length ? replay.filter((c) => c.agree).length / replay.length : 0,
      shadowRuns: shadow.length,
      distinctVariants: new Set(shadow.map((c) => c.variantKey)).size,
      safetyViolations: [...replay, ...shadow].reduce((n, c) => n + this.safetyOf(c), 0),
      agreement: shadow.length ? shadow.filter((c) => c.agree).length / shadow.length : 0,
    };
    return { result: evaluateGate(evidence, this.gateConfig(ts)), evidence };
  }

  // ---- replay ----
  /** Re-runs the candidate on recorded tasks and compares with what the baseline did then. */
  async replayRuns(
    actor: Actor,
    ts: TenantStore,
    version: ReflexVersionRow,
    baselines: RunRow[],
    progress?: ValidationProgress,
  ): Promise<{
    agreements: number;
    items: { scenarioId: string; env: string; agree: boolean; comparisonId: string }[];
  }> {
    let done = 0;
    const items = await mapPool(baselines, 3, async (base) => {
      const task = ts.tasks.get(ts.tenantId, base.taskId);
      if (!task) throw notFound('Task');
      const scenario = getScenario(task.scenarioId);
      const env = {
        toolchainVersion: base.trace.environment.toolchain.version as ToolchainVersion,
      };
      const mt = await materialize(this.p.engine, scenario, env);
      let res;
      try {
        res = await runReflex(this.p.engine, mt, version.spec, {
          taskId: task.id,
          kind: 'replay_reflex',
          reflexId: version.id,
          allowBoundary: false,
        });
      } finally {
        await mt.dispose();
      }
      const reflexRow = saveRun(ts, {
        taskId: task.id,
        result: res,
        reflexVersionId: version.id,
        groupId: null,
        spec: version.spec,
        ledger: { category: 'reflex_replay', label: `Replay of ${scenario.id}` },
        ids: this.p.ids,
        now: this.p.now(),
        metrics: this.p.metrics,
      });
      const comparison = compareRuns(digestFromRun(base), digestFromRun(reflexRow));
      const comparisonId = this.p.ids.next('cmp');
      ts.comparisons.insert(ts.tenantId, {
        id: comparisonId,
        kind: 'replay',
        reflexVersionId: version.id,
        taskId: task.id,
        baselineRunId: base.id,
        reflexRunId: reflexRow.id,
        variantKey: scenario.variantKey,
        agree: comparison.agree,
        comparison,
        createdAt: this.p.now(),
      });
      done += 1;
      progress?.(done, baselines.length, `Replayed ${scenario.id}`);
      return {
        scenarioId: scenario.id,
        env: env.toolchainVersion,
        agree: comparison.agree,
        comparisonId,
      };
    });
    void actor;
    return { agreements: items.filter((i) => i.agree).length, items };
  }

  async replay(
    actor: Actor,
    versionId: string,
    progress?: ValidationProgress,
  ): Promise<ReflexVersionDto> {
    assertCan(actor, 'replay');
    const ts = this.p.store.forTenant(actor.tenantId);
    let version = this.getVersion(ts, versionId);
    if (version.status !== 'candidate')
      throw conflict(`Replay requires a candidate; this Reflex is "${version.status}"`);
    version = this.applyTransition(
      ts,
      version,
      'replay_started',
      'Replaying historical traces against the candidate',
      actor.name,
    );
    const baselines = version.spec.provenance.sourceTraceIds
      .map((id) => ts.findRunByTraceId(id))
      .filter((r): r is RunRow => r !== null);
    const result = await this.replayRuns(actor, ts, version, baselines, progress);
    const agreement = baselines.length ? result.agreements / baselines.length : 0;
    const passed = baselines.length > 0 && agreement >= this.gateConfig(ts).minReplayAgreement;
    version = this.applyTransition(
      ts,
      version,
      passed ? 'replay_passed' : 'replay_failed',
      passed
        ? `${result.agreements}/${baselines.length} historical traces reproduced`
        : `Only ${result.agreements}/${baselines.length} historical traces reproduced`,
      actor.name,
    );
    this.p.audit(
      actor,
      'reflex.replayed',
      'reflex_version',
      version.id,
      `Replay: ${result.agreements}/${baselines.length} traces agree`,
      { agreement, tracesReplayed: baselines.length },
    );
    return this.versionDto(actor, ts, version);
  }

  // ---- shadow ----
  async shadow(
    actor: Actor,
    versionId: string,
    scenarioIds: readonly string[] = SHADOW_IDS,
    progress?: ValidationProgress,
  ): Promise<ReflexVersionDto> {
    assertCan(actor, 'shadow');
    const ts = this.p.store.forTenant(actor.tenantId);
    let version = this.getVersion(ts, versionId);
    if (version.status !== 'shadow')
      throw conflict(
        `Shadow runs require a Reflex in shadow status (replay must pass first); this one is "${version.status}"`,
      );
    const env = this.p.tasks.environment(ts);
    let done = 0;
    await mapPool(scenarioIds, 3, async (sid) => {
      const existing = ts.tasks
        .all(ts.tenantId, { where: { scenarioId: sid, origin: 'intake' } })
        .find((t) => t.envVersion === env.toolchainVersion);
      const task = existing ?? (await this.p.tasks.intake(actor, sid));
      const scenario = getScenario(sid);
      const group = this.p.ids.next('grp');
      const [mtB, mtR] = await Promise.all([
        materialize(this.p.engine, scenario, env),
        materialize(this.p.engine, scenario, env),
      ]);
      let baseRes;
      let reflexRes;
      try {
        [baseRes, reflexRes] = await Promise.all([
          runBaseline(this.p.engine, mtB, { taskId: task.id, kind: 'shadow_baseline' }),
          runReflex(this.p.engine, mtR, version.spec, {
            taskId: task.id,
            kind: 'shadow_reflex',
            reflexId: version.id,
            allowBoundary: true,
          }),
        ]);
      } finally {
        await Promise.all([mtB.dispose(), mtR.dispose()]);
      }
      const baseRow = saveRun(ts, {
        taskId: task.id,
        result: baseRes,
        reflexVersionId: null,
        groupId: group,
        spec: null,
        ledger: { category: 'shadow_reference', label: `Shadow reference run ${sid}` },
        ids: this.p.ids,
        now: this.p.now(),
        metrics: this.p.metrics,
      });
      const reflexRow = saveRun(ts, {
        taskId: task.id,
        result: reflexRes,
        reflexVersionId: version.id,
        groupId: group,
        spec: version.spec,
        ledger: { category: 'reflex_shadow', label: `Shadow Reflex run ${sid}` },
        ids: this.p.ids,
        now: this.p.now(),
        metrics: this.p.metrics,
      });
      const comparison = compareRuns(digestFromRun(baseRow), digestFromRun(reflexRow));
      ts.comparisons.insert(ts.tenantId, {
        id: this.p.ids.next('cmp'),
        kind: 'shadow',
        reflexVersionId: version.id,
        taskId: task.id,
        baselineRunId: baseRow.id,
        reflexRunId: reflexRow.id,
        variantKey: scenario.variantKey,
        agree: comparison.agree,
        comparison,
        createdAt: this.p.now(),
      });
      if (task.status === 'received')
        ts.tasks.update(ts.tenantId, task.id, {
          status: baseRow.trace.outcome.status === 'success' ? 'solved' : 'failed',
        });
      done += 1;
      progress?.(
        done,
        scenarioIds.length,
        `Shadow ${sid}: ${comparison.agree ? 'agree' : 'DISAGREE'}`,
      );
    });

    const shadowRows = this.comparisonsOf(ts, version.id, 'shadow');
    const trust = trustFromHistory(shadowRows.map((c) => c.agree));
    version = this.getVersion(ts, versionId);
    ts.versions.update(ts.tenantId, version.id, {
      confidence: trust.confidence,
      trust,
      updatedAt: this.p.now(),
    });
    version = { ...version, confidence: trust.confidence, trust };
    const { result } = this.gate(ts, version);
    if (result.eligible && version.status === 'shadow') {
      version = this.applyTransition(
        ts,
        version,
        'gate_passed',
        'All promotion evidence gates passed; awaiting human approval',
        this.p.systemName,
      );
    }
    this.p.audit(
      actor,
      'reflex.shadowed',
      'reflex_version',
      version.id,
      `Shadow Brain: ${shadowRows.filter((c) => c.agree).length}/${shadowRows.length} runs agree`,
      {
        runs: shadowRows.length,
        eligible: result.eligible,
      },
    );
    return this.versionDto(actor, ts, version);
  }

  // ---- human decisions ----
  promote(actor: Actor, versionId: string, comment: string): ReflexVersionRow {
    assertCan(actor, 'promote');
    const ts = this.p.store.forTenant(actor.tenantId);
    let version = this.getVersion(ts, versionId);
    if (version.status !== 'approval')
      throw conflict(
        `Only a Reflex awaiting approval can be promoted; this one is "${version.status}"`,
        { status: version.status },
      );
    const actual = contentHash(version.spec);
    if (actual !== version.contentHash) {
      this.p.audit(
        actor,
        'reflex.integrity_failed',
        'reflex_version',
        version.id,
        'Promotion refused: content hash mismatch',
        { expected: version.contentHash, actual },
      );
      throw conflict(
        'Integrity check failed: the Reflex specification does not match its recorded content hash',
      );
    }
    const { result, evidence } = this.gate(ts, version);
    if (!result.eligible)
      throw conflict('The promotion evidence gate is not satisfied', { gate: result });
    const shadowRows = this.comparisonsOf(ts, version.id, 'shadow');
    const trust = trustFromHistory(shadowRows.map((c) => c.agree));
    // Retire any currently executing sibling version (e.g. promoting a mutation).
    for (const sibling of ts.versions
      .all(ts.tenantId)
      .filter((v) => v.reflexId === version.reflexId && v.id !== version.id)) {
      if (
        sibling.status === 'active' ||
        sibling.status === 'watch' ||
        sibling.status === 'shadow'
      ) {
        this.applyTransition(
          ts,
          sibling,
          'deprecated',
          `Superseded by v${version.version}`,
          actor.name,
        );
      }
    }
    version = this.applyTransition(
      ts,
      version,
      'approved',
      comment || 'Approved by reviewer',
      actor.name,
      { confidence: trust.confidence, trust },
    );
    ts.approvals.insert(ts.tenantId, {
      id: this.p.ids.next('apr'),
      reflexVersionId: version.id,
      action: 'promote',
      actorUserId: actor.userId,
      actorName: actor.name,
      comment,
      evidence: { gate: result, evidence, contentHash: actual, confidence: trust.confidence },
      createdAt: this.p.now(),
    });
    this.p.audit(
      actor,
      'reflex.promoted',
      'reflex_version',
      version.id,
      `Reflex ${version.spec.name} v${version.version} promoted to ACTIVE by ${actor.name}`,
      {
        comment,
        contentHash: actual,
        confidence: trust.confidence,
        human: true,
      },
    );
    return version;
  }

  reject(actor: Actor, versionId: string, comment: string): ReflexVersionRow {
    assertCan(actor, 'reject');
    const ts = this.p.store.forTenant(actor.tenantId);
    let version = this.getVersion(ts, versionId);
    if (version.status !== 'approval')
      throw conflict(
        `Only a Reflex awaiting approval can be rejected; this one is "${version.status}"`,
      );
    version = this.applyTransition(
      ts,
      version,
      'rejected',
      comment || 'Rejected by reviewer: more evidence needed',
      actor.name,
    );
    ts.approvals.insert(ts.tenantId, {
      id: this.p.ids.next('apr'),
      reflexVersionId: version.id,
      action: 'reject',
      actorUserId: actor.userId,
      actorName: actor.name,
      comment,
      evidence: { status: 'returned_to_shadow' },
      createdAt: this.p.now(),
    });
    this.p.audit(
      actor,
      'reflex.rejected',
      'reflex_version',
      version.id,
      `Reflex ${version.spec.name} v${version.version} returned to shadow by ${actor.name}`,
      { comment },
    );
    return version;
  }

  rollback(actor: Actor, versionId: string, comment: string): ReflexVersionRow {
    assertCan(actor, 'rollback');
    const ts = this.p.store.forTenant(actor.tenantId);
    let version = this.getVersion(ts, versionId);
    if (!mayExecuteActive(version.status))
      throw conflict(`Only an active Reflex can be rolled back; this one is "${version.status}"`);
    version = this.applyTransition(
      ts,
      version,
      'rolled_back',
      comment || 'Rolled back by reviewer',
      actor.name,
    );
    ts.approvals.insert(ts.tenantId, {
      id: this.p.ids.next('apr'),
      reflexVersionId: version.id,
      action: 'rollback',
      actorUserId: actor.userId,
      actorName: actor.name,
      comment,
      evidence: { rollbackTo: version.spec.rollbackTo },
      createdAt: this.p.now(),
    });
    this.p.audit(
      actor,
      'reflex.rolled_back',
      'reflex_version',
      version.id,
      `Reflex ${version.spec.name} v${version.version} rolled back by ${actor.name}`,
      { comment, rollbackTo: version.spec.rollbackTo },
    );
    return version;
  }

  // ---- views ----
  summary(_ts: TenantStore, row: ReflexVersionRow): ReflexVersionSummaryDto {
    return {
      id: row.id,
      reflexId: row.reflexId,
      name: row.spec.name,
      version: row.version,
      status: row.status,
      confidence: row.confidence,
      trust: row.trust,
      contentHash: row.contentHash,
      familyId: row.spec.familyId,
      stepCount: row.spec.steps.length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      mutationOf: row.spec.provenance.mutationOf?.reflexVersion ?? null,
    };
  }

  listReflexes(ts: TenantStore): ReflexListDto[] {
    const reflexes = ts.reflexes.all(ts.tenantId, { order: 'created_at ASC' });
    const versions = ts.versions.all(ts.tenantId, { order: 'created_at ASC' });
    return reflexes.map((r) => ({
      reflexId: r.id,
      name: r.name,
      familyId: r.familyId,
      versions: versions
        .filter((v) => v.reflexId === r.id)
        .map((v) => this.summary(ts, v))
        .reverse(),
    }));
  }

  validationSummary(
    ts: TenantStore,
    versionId: string,
    kind: ComparisonRow['kind'],
  ): ValidationSummaryDto {
    const rows = this.comparisonsOf(ts, versionId, kind);
    const dtos = rows.map((c) => this.comparisonDto(ts, c));
    return {
      kind,
      runs: rows.length,
      agreements: rows.filter((r) => r.agree).length,
      agreement: rows.length ? rows.filter((r) => r.agree).length / rows.length : null,
      distinctVariants: new Set(rows.map((r) => r.variantKey)).size,
      safetyViolations: rows.reduce((n, c) => n + this.safetyOf(c), 0),
      baseline: {
        meanTokens: Math.round(mean(dtos.map((d) => d.baseline.tokens))),
        meanModelCalls: Math.round(mean(dtos.map((d) => d.baseline.calls)) * 10) / 10,
        meanCostUsd: Math.round(mean(dtos.map((d) => d.baseline.costUsd)) * 1e5) / 1e5,
        meanCommands: Math.round(mean(dtos.map((d) => d.baseline.commands)) * 10) / 10,
        meanModelLatencyMs: Math.round(mean(dtos.map((d) => d.baseline.modelLatencyMs))),
        provenance: dtos.some((d) => d.baseline.tokens > 0) ? this.tokenProvenance() : 'measured',
      },
      reflex: {
        meanTokens: Math.round(mean(dtos.map((d) => d.reflex.tokens))),
        meanModelCalls: Math.round(mean(dtos.map((d) => d.reflex.calls)) * 100) / 100,
        meanCostUsd: Math.round(mean(dtos.map((d) => d.reflex.costUsd)) * 1e5) / 1e5,
        meanCommands: Math.round(mean(dtos.map((d) => d.reflex.commands)) * 10) / 10,
        meanLocalMs: Math.round(mean(dtos.map((d) => d.reflex.localMs))),
        provenance: kind === 'replay' ? 'replay-measured' : this.tokenProvenance(),
      },
    };
  }

  private tokenProvenance(): 'synthetic' | 'measured' {
    return this.p.engine.provider.mode === 'deterministic' ? 'synthetic' : 'measured';
  }

  comparisonDto(ts: TenantStore, c: ComparisonRow): ComparisonDto {
    const task = ts.tasks.get(ts.tenantId, c.taskId, ['id', 'title', 'scenarioId']);
    const base = c.baselineRunId
      ? ts.runs.get(ts.tenantId, c.baselineRunId, ['id', 'usage', 'status'])
      : null;
    const refl = ts.runs.get(ts.tenantId, c.reflexRunId, ['id', 'usage', 'status']);
    const side = (r: Pick<RunRow, 'usage' | 'status'> | null) => ({
      tokens: r?.usage.totalTokens ?? 0,
      calls: r?.usage.modelCalls ?? 0,
      costUsd: r?.usage.costUsd ?? 0,
      commands: r?.usage.commands ?? 0,
      modelLatencyMs: r?.usage.modelLatencyMs ?? 0,
      localMs: r?.usage.localMs ?? 0,
      status: r?.status ?? 'n/a',
    });
    return {
      id: c.id,
      kind: c.kind,
      reflexVersionId: c.reflexVersionId,
      taskId: c.taskId,
      taskTitle: task?.title ?? c.taskId,
      scenarioId: task?.scenarioId ?? '',
      variantKey: c.variantKey,
      agree: c.agree,
      comparison: c.comparison,
      baselineRunId: c.baselineRunId,
      reflexRunId: c.reflexRunId,
      createdAt: c.createdAt,
      baseline: side(base),
      reflex: side(refl),
    };
  }

  comparisonsPage(
    ts: TenantStore,
    versionId: string,
    kind: ComparisonRow['kind'] | undefined,
    limit: number,
    cursor?: string,
  ): Page<ComparisonDto> {
    const page = ts.comparisons.list(ts.tenantId, {
      where: { reflexVersionId: versionId, ...(kind ? { kind } : {}) },
      order: 'created_at ASC, id ASC',
      limit,
      ...(cursor ? { cursor } : {}),
    });
    return { ...page, items: page.items.map((c) => this.comparisonDto(ts, c)) };
  }

  confidenceHistory(ts: TenantStore, version: ReflexVersionRow): ConfidencePoint[] {
    const rows = [
      ...this.comparisonsOf(ts, version.id, 'shadow'),
      ...this.comparisonsOf(ts, version.id, 'canary'),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const out: ConfidencePoint[] = [];
    const results: boolean[] = [];
    for (const r of rows) {
      results.push(r.agree);
      out.push({
        at: r.createdAt,
        confidence: Math.round(trustFromHistory(results).confidence * 1000) / 1000,
        label: `${r.kind} ${r.agree ? 'agree' : 'disagree'}`,
      });
    }
    return out;
  }

  versionDto(actor: Actor, ts: TenantStore, row: ReflexVersionRow): ReflexVersionDto {
    const gate = this.gate(ts, row).result;
    const actual = contentHash(row.spec);
    const canary = this.comparisonsOf(ts, row.id, 'canary');
    const transitions: TransitionDto[] = ts.transitions
      .all(ts.tenantId, { where: { reflexVersionId: row.id }, order: 'created_at ASC, id ASC' })
      .map((t) => ({
        id: t.id,
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        event: t.event,
        reason: t.reason,
        actor: t.actor,
        createdAt: t.createdAt,
      }));
    const approvals: ApprovalDto[] = ts.approvals
      .all(ts.tenantId, { where: { reflexVersionId: row.id }, order: 'created_at ASC, id ASC' })
      .map((a) => ({
        id: a.id,
        action: a.action,
        actorName: a.actorName,
        comment: a.comment,
        evidence: a.evidence,
        createdAt: a.createdAt,
      }));
    const mutations = this.p.drift.mutationsFor(ts, row.reflexId);
    return {
      ...this.summary(ts, row),
      spec: row.spec,
      compileReport: row.compileReport,
      integrity: { ok: actual === row.contentHash, expected: row.contentHash, actual },
      gate,
      gateConfig: this.gateConfig(ts),
      replay: this.validationSummary(ts, row.id, 'replay'),
      shadow: this.validationSummary(ts, row.id, 'shadow'),
      canary: canary.length ? this.validationSummary(ts, row.id, 'canary') : null,
      transitions,
      approvals,
      mutations: mutations,
      confidenceHistory: this.confidenceHistory(ts, row),
      actions: {
        replay: row.status === 'candidate' && can(actor.role, 'replay'),
        shadow: row.status === 'shadow' && can(actor.role, 'shadow'),
        promote: row.status === 'approval' && gate.eligible && can(actor.role, 'promote'),
        reject: row.status === 'approval' && can(actor.role, 'reject'),
        rollback: mayExecuteActive(row.status) && can(actor.role, 'rollback'),
        canary: mayExecuteActive(row.status) && can(actor.role, 'canary'),
      },
    };
  }
}
