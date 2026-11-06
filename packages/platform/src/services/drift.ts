import { performance } from 'node:perf_hooks';
import {
  CompileError,
  DEFAULT_DRIFT_CONFIG,
  type DriftConfig,
  compareRuns,
  detectDrift,
  mayExecuteActive,
  trustFromHistory,
  compileReflex,
} from '@bigforge/core';
import { CANARY_IDS, type ToolchainVersion, getScenario } from '@bigforge/lab-monorepo';
import type {
  ConfidencePoint,
  DriftCheckDto,
  DriftDetail,
  DriftViewDto,
  MutationDiff,
  MutationDto,
  ReflexSpec,
  ReflexStatus,
} from '@bigforge/schemas';
import { contentHash } from '@bigforge/security';
import { type Actor, assertCan, conflict, notFound } from '../actor';
import type {
  DriftCheckRow,
  MutationRow,
  ReflexVersionRow,
  RunRow,
  TenantStore,
} from '../db/store';
import { materialize, runBaseline, runReflex } from '../execution';
import { preparerFor } from '../engine';
import type { Platform } from '../platform';
import { mapPool } from './pool';
import type { ValidationProgress } from './validation';
import { digestFromRun, saveRun } from './shared';

export const DRIFT_SYSTEM_NAME = 'BigForge Drift Canary';

function diffSpecs(from: ReflexSpec, to: ReflexSpec): MutationDiff {
  const steps: MutationDiff['steps'] = [];
  const op = (s: ReflexSpec['steps'][number]) => `${s.operator.id}@${s.operator.version}`;
  for (const t of to.steps) {
    const f = from.steps.find((x) => x.id === t.id);
    if (!f) steps.push({ stepId: t.id, change: 'added', from: null, to: op(t) });
    else if (op(f) !== op(t))
      steps.push({ stepId: t.id, change: 'operator', from: op(f), to: op(t) });
  }
  for (const f of from.steps)
    if (!to.steps.some((x) => x.id === f.id))
      steps.push({ stepId: f.id, change: 'removed', from: op(f), to: null });
  const a = new Set(from.provenance.assumptions);
  const b = new Set(to.provenance.assumptions);
  return {
    steps,
    assumptions: {
      added: [...b].filter((x) => !a.has(x)),
      removed: [...a].filter((x) => !b.has(x)),
    },
  };
}

export class DriftService {
  private readonly p: Platform;

  constructor(platform: Platform) {
    this.p = platform;
  }

  config(ts: TenantStore): DriftConfig {
    return ts.getSetting<DriftConfig>('drift', DEFAULT_DRIFT_CONFIG);
  }

  /** Sends familiar tasks through both the Reflex and the baseline and measures agreement. */
  async canary(
    actor: Actor,
    versionId: string,
    progress?: ValidationProgress,
  ): Promise<DriftCheckDto> {
    assertCan(actor, 'canary');
    const ts = this.p.store.forTenant(actor.tenantId);
    const version = this.p.validation.getVersion(ts, versionId);
    if (!mayExecuteActive(version.status))
      throw conflict(`The Drift Canary monitors active Reflexes; this one is "${version.status}"`);
    const env = this.p.tasks.environment(ts);
    const cfg = this.config(ts);
    const before = { confidence: version.confidence, status: version.status };
    const envHistory = this.p.tasks.environmentHistory(ts);
    const lastChange = envHistory[envHistory.length - 1];

    let done = 0;
    const pairs = await mapPool(CANARY_IDS, 3, async (sid) => {
      const task = await this.p.tasks.intake(actor, sid, { origin: 'canary' });
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
          runBaseline(this.p.engine, mtB, { taskId: task.id, kind: 'canary_baseline' }),
          runReflex(this.p.engine, mtR, version.spec, {
            taskId: task.id,
            kind: 'canary_reflex',
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
        ledger: { category: 'canary_reference', label: `Canary reference run ${sid}` },
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
        ledger: { category: 'reflex_canary', label: `Canary Reflex run ${sid}` },
        ids: this.p.ids,
        now: this.p.now(),
        metrics: this.p.metrics,
      });
      const comparison = compareRuns(digestFromRun(baseRow), digestFromRun(reflexRow));
      const comparisonId = this.p.ids.next('cmp');
      ts.comparisons.insert(ts.tenantId, {
        id: comparisonId,
        kind: 'canary',
        reflexVersionId: version.id,
        taskId: task.id,
        baselineRunId: baseRow.id,
        reflexRunId: reflexRow.id,
        variantKey: scenario.variantKey,
        agree: comparison.agree,
        comparison,
        createdAt: this.p.now(),
      });
      ts.tasks.update(ts.tenantId, task.id, {
        status: baseRow.trace.outcome.status === 'success' ? 'solved' : 'failed',
      });
      done += 1;
      progress?.(
        done,
        CANARY_IDS.length,
        `Canary ${sid}: ${comparison.agree ? 'agree' : 'DISAGREE'}`,
      );
      return { sid, scenario, comparison, comparisonId, baseRow, reflexRow };
    });

    const shadow = ts.comparisons.all(ts.tenantId, {
      where: { reflexVersionId: version.id, kind: 'shadow' },
    });
    const historic = { agree: shadow.filter((c) => c.agree).length, n: shadow.length };
    const current = { agree: pairs.filter((x) => x.comparison.agree).length, n: pairs.length };
    const verdict = detectDrift(historic, current, cfg);
    const trust = trustFromHistory(pairs.map((x) => x.comparison.agree));

    const transitions: DriftDetail['transitions'] = [];
    let v: ReflexVersionRow = this.p.validation.getVersion(ts, versionId);
    const step = (
      event: Parameters<typeof this.p.validation.applyTransition>[2],
      reason: string,
    ) => {
      const from = v.status;
      v = this.p.validation.applyTransition(ts, v, event, reason, DRIFT_SYSTEM_NAME, {
        confidence: trust.confidence,
        trust,
      });
      transitions.push({ from, to: v.status, event, reason });
    };
    if (verdict.drift) {
      if (v.status === 'active')
        step(
          'trust_declined',
          `Reflex confidence fell from ${before.confidence.toFixed(2)} to ${trust.confidence.toFixed(2)}`,
        );
      step('drift_confirmed', verdict.reasons[0] ?? 'Drift confirmed by the canary');
    } else if (v.status === 'active' && trust.confidence < cfg.watchBelow) {
      step(
        'trust_declined',
        `Confidence ${trust.confidence.toFixed(2)} is below the watch threshold ${cfg.watchBelow}`,
      );
    } else if (v.status === 'watch' && trust.confidence >= cfg.watchBelow) {
      step('trust_recovered', `Confidence recovered to ${trust.confidence.toFixed(2)}`);
    } else {
      ts.versions.update(ts.tenantId, v.id, {
        confidence: trust.confidence,
        trust,
        updatedAt: this.p.now(),
      });
      v = { ...v, confidence: trust.confidence, trust };
    }

    const disagreeing = pairs.filter((x) => !x.comparison.agree);
    const counts = new Map<string | null, number>();
    for (const x of disagreeing)
      counts.set(
        x.comparison.divergence.stepId,
        (counts.get(x.comparison.divergence.stepId) ?? 0) + 1,
      );
    const detail: DriftDetail = {
      sample: pairs.length,
      pairs: pairs.map((x) => ({
        scenarioId: x.sid,
        variantKey: x.scenario.variantKey,
        agree: x.comparison.agree,
        divergenceStep: x.comparison.divergence.stepId,
        reflexStatus: x.reflexRow.trace.outcome.status,
        stopReason: x.reflexRow.exec?.stopReason ?? null,
        comparisonId: x.comparisonId,
      })),
      firstDivergence: [...counts.entries()]
        .map(([stepId, count]) => ({ stepId, count }))
        .sort((a, b) => b.count - a.count),
      before,
      after: { confidence: trust.confidence, status: v.status },
      transitions,
      canaryCost: {
        tokens: pairs.reduce((n, x) => n + x.baseRow.usage.totalTokens, 0),
        costUsd: Math.round(pairs.reduce((n, x) => n + x.baseRow.usage.costUsd, 0) * 1e5) / 1e5,
        provenance: pairs[0]?.baseRow.usage.tokenProvenance ?? 'synthetic',
      },
      environmentChange: lastChange ? { from: lastChange.from, to: lastChange.to } : null,
    };
    const row: Omit<DriftCheckRow, 'tenantId'> = {
      id: this.p.ids.next('dft'),
      reflexVersionId: version.id,
      envVersion: env.toolchainVersion,
      verdict,
      detail,
      createdAt: this.p.now(),
    };
    ts.driftChecks.insert(ts.tenantId, row);
    this.p.audit(
      actor,
      verdict.drift ? 'drift.confirmed' : 'drift.checked',
      'reflex_version',
      version.id,
      verdict.drift
        ? `Drift confirmed: agreement ${(verdict.historicAgreement * 100).toFixed(0)}% -> ${(verdict.currentAgreement * 100).toFixed(0)}%; ${version.spec.name} v${version.version} returned to ${v.status}`
        : `Drift canary: agreement ${(verdict.currentAgreement * 100).toFixed(0)}% (within tolerance)`,
      {
        ...verdict,
        transitions,
        firstDivergence: detail.firstDivergence,
        env: env.toolchainVersion,
      },
    );
    return this.checkDto({ ...row, tenantId: ts.tenantId });
  }

  checkDto(row: DriftCheckRow): DriftCheckDto {
    return {
      id: row.id,
      reflexVersionId: row.reflexVersionId,
      envVersion: row.envVersion,
      verdict: row.verdict,
      detail: row.detail,
      createdAt: row.createdAt,
    };
  }

  /** Recompiles from the original traces plus the drifted tasks the baseline solved. Proposes; never activates. */
  async proposeMutation(actor: Actor, versionId: string): Promise<MutationDto> {
    assertCan(actor, 'compile');
    const ts = this.p.store.forTenant(actor.tenantId);
    const version = this.p.validation.getVersion(ts, versionId);
    if (version.status !== 'shadow' && version.status !== 'watch')
      throw conflict(
        `Mutations are proposed for a Reflex in shadow or watch; this one is "${version.status}"`,
      );
    if (ts.mutations.count(ts.tenantId, { fromVersionId: version.id, status: 'proposed' }) > 0)
      throw conflict('A mutation is already proposed for this version');
    const checks = ts.driftChecks.all(ts.tenantId, {
      where: { reflexVersionId: version.id },
      order: 'created_at DESC',
    });
    const latest = checks[0];
    if (!latest)
      throw conflict(
        'Run the Drift Canary first: a mutation learns from the tasks the baseline solved after the change',
      );

    const original = version.spec.provenance.sourceTraceIds
      .map((id) => ts.findRunByTraceId(id))
      .filter((r): r is RunRow => r !== null);
    const drifted: RunRow[] = [];
    for (const pair of latest.detail.pairs) {
      const cmp = ts.comparisons.get(ts.tenantId, pair.comparisonId);
      const base = cmp?.baselineRunId ? ts.runs.get(ts.tenantId, cmp.baselineRunId) : null;
      if (
        base &&
        base.trace.outcome.status === 'success' &&
        base.trace.verification.status === 'pass'
      )
        drifted.push(base);
    }
    const baselines = [...original, ...drifted];
    const [maj = 1, min = 0] = version.version.split('.').map(Number);
    const nextVersion = `${maj}.${min + 1}.0`;
    const divergence = latest.detail.firstDivergence[0];
    const reason = `Drift confirmed (agreement ${(latest.verdict.historicAgreement * 100).toFixed(0)}% -> ${(latest.verdict.currentAgreement * 100).toFixed(0)}%) with the first divergence at step "${divergence?.stepId ?? 'unknown'}". Recompiled from ${original.length} original and ${drifted.length} post-change traces.`;
    const started = performance.now();
    let compiled;
    try {
      compiled = await compileReflex({
        traces: baselines.map((b) => b.trace),
        library: this.p.engine.library,
        prepare: preparerFor(this.p.engine, (t) => ({
          toolchainVersion: t.environment.toolchain.version as ToolchainVersion,
        })),
        familyId: version.spec.familyId,
        name: version.spec.name,
        version: nextVersion,
        rollbackTo: version.version,
        mutationOf: { reflexVersion: version.version, reason },
        allowedRunKinds: ['baseline', 'canary_baseline'],
        ids: this.p.ids,
        clock: this.p.engine.clock,
        pricing: this.p.engine.pricing,
      });
    } catch (err) {
      if (err instanceof CompileError) throw conflict(err.message, err.reasons);
      throw err;
    }
    const compileMs = Math.round(performance.now() - started);
    const now = this.p.now();
    const newTrust = trustFromHistory([]);
    const newRow: Omit<ReflexVersionRow, 'tenantId'> = {
      id: this.p.ids.next('rfv'),
      reflexId: version.reflexId,
      version: nextVersion,
      status: 'candidate',
      spec: compiled.spec,
      contentHash: contentHash(compiled.spec),
      compileReport: { ...compiled.report, compileMs },
      confidence: newTrust.confidence,
      trust: newTrust,
      createdAt: now,
      updatedAt: now,
    };
    ts.versions.insert(ts.tenantId, newRow);
    const newVersion: ReflexVersionRow = { ...newRow, tenantId: ts.tenantId };

    // Regression replay: the proposed version must still reproduce every historical and post-change trace.
    const regression = await this.p.validation.replayRuns(actor, ts, newVersion, baselines);
    const evidence = {
      augmentedTraceIds: baselines.map((b) => b.trace.id),
      envVersions: [...new Set(baselines.map((b) => b.trace.environment.toolchain.version))].sort(),
      regression: {
        runs: baselines.length,
        agreements: regression.agreements,
        agreement: baselines.length ? regression.agreements / baselines.length : null,
        items: regression.items.map((i) => ({
          scenarioId: i.scenarioId,
          env: i.env,
          agree: i.agree,
        })),
      },
      activated: false as const,
    };
    const row: Omit<MutationRow, 'tenantId'> = {
      id: this.p.ids.next('mut'),
      reflexId: version.reflexId,
      fromVersionId: version.id,
      toVersionId: newVersion.id,
      status: 'proposed',
      reason,
      diff: diffSpecs(version.spec, compiled.spec),
      evidence,
      createdAt: this.p.now(),
      decidedAt: null,
    };
    ts.mutations.insert(ts.tenantId, row);
    this.p.audit(
      actor,
      'mutation.proposed',
      'mutation',
      row.id,
      `Mutation proposed: ${version.spec.name} v${version.version} -> v${nextVersion} (NOT activated; requires human approval)`,
      {
        diff: row.diff,
        regression: evidence.regression.agreement,
        compileMs,
        activated: false,
      },
    );
    return this.mutationDto(ts, { ...row, tenantId: ts.tenantId });
  }

  approveMutation(actor: Actor, mutationId: string, comment: string): MutationDto {
    assertCan(actor, 'approve_mutation');
    const ts = this.p.store.forTenant(actor.tenantId);
    const m = ts.mutations.get(ts.tenantId, mutationId);
    if (!m) throw notFound('Mutation');
    if (m.status !== 'proposed') throw conflict(`This mutation is already ${m.status}`);
    let v = this.p.validation.getVersion(ts, m.toVersionId);
    const agreement = m.evidence.regression.agreement ?? 0;
    if (agreement < 1)
      throw conflict(
        'Regression replay must reproduce every trace before a mutation can enter shadow validation',
        { agreement },
      );
    v = this.p.validation.applyTransition(
      ts,
      v,
      'replay_started',
      'Mutation approved by a reviewer; regression replay already complete',
      actor.name,
    );
    v = this.p.validation.applyTransition(
      ts,
      v,
      'replay_passed',
      `Regression replay ${m.evidence.regression.agreements}/${m.evidence.regression.runs}`,
      actor.name,
    );
    ts.mutations.update(ts.tenantId, m.id, { status: 'approved', decidedAt: this.p.now() });
    ts.approvals.insert(ts.tenantId, {
      id: this.p.ids.next('apr'),
      reflexVersionId: v.id,
      action: 'approve_mutation',
      actorUserId: actor.userId,
      actorName: actor.name,
      comment,
      evidence: { mutationId: m.id, agreement },
      createdAt: this.p.now(),
    });
    this.p.audit(
      actor,
      'mutation.approved',
      'mutation',
      m.id,
      `Mutation approved into shadow validation by ${actor.name} (still not active)`,
      { comment, toVersion: v.version },
    );
    return this.mutationDto(ts, { ...m, status: 'approved', decidedAt: this.p.now() });
  }

  rejectMutation(actor: Actor, mutationId: string, comment: string): MutationDto {
    assertCan(actor, 'approve_mutation');
    const ts = this.p.store.forTenant(actor.tenantId);
    const m = ts.mutations.get(ts.tenantId, mutationId);
    if (!m) throw notFound('Mutation');
    if (m.status !== 'proposed') throw conflict(`This mutation is already ${m.status}`);
    const v = this.p.validation.getVersion(ts, m.toVersionId);
    this.p.validation.applyTransition(
      ts,
      v,
      'deprecated',
      comment || 'Mutation rejected',
      actor.name,
    );
    ts.mutations.update(ts.tenantId, m.id, { status: 'rejected', decidedAt: this.p.now() });
    this.p.audit(
      actor,
      'mutation.rejected',
      'mutation',
      m.id,
      `Mutation rejected by ${actor.name}`,
      { comment },
    );
    return this.mutationDto(ts, { ...m, status: 'rejected', decidedAt: this.p.now() });
  }

  mutationDto(ts: TenantStore, m: MutationRow): MutationDto {
    const from = ts.versions.get(ts.tenantId, m.fromVersionId, ['id', 'version']);
    const to = ts.versions.get(ts.tenantId, m.toVersionId, ['id', 'version']);
    return {
      id: m.id,
      reflexId: m.reflexId,
      fromVersionId: m.fromVersionId,
      toVersionId: m.toVersionId,
      fromVersion: from?.version ?? '?',
      toVersion: to?.version ?? '?',
      status: m.status,
      reason: m.reason,
      diff: m.diff,
      evidence: m.evidence,
      createdAt: m.createdAt,
      decidedAt: m.decidedAt,
    };
  }

  mutationsFor(ts: TenantStore, reflexId: string): MutationDto[] {
    return ts.mutations
      .all(ts.tenantId, { where: { reflexId }, order: 'created_at DESC' })
      .map((m) => this.mutationDto(ts, m));
  }

  view(actor: Actor, ts: TenantStore): DriftViewDto {
    void actor;
    const versions = ts.versions.all(ts.tenantId, { order: 'created_at DESC' });
    const checks = ts.driftChecks.all(ts.tenantId, { order: 'created_at DESC' });
    const tracked: ReflexVersionRow | undefined =
      versions.find((v) => v.id === checks[0]?.reflexVersionId) ??
      versions.find((v) => mayExecuteActive(v.status)) ??
      versions[0];
    const history: ConfidencePoint[] = tracked
      ? this.p.validation.confidenceHistory(ts, tracked)
      : [];
    const cfg = this.config(ts);
    return {
      environment: this.p.tasks.environmentDto(ts),
      reflexVersion: tracked ? this.p.validation.summary(ts, tracked) : null,
      checks: checks.map((c) => this.checkDto(c)),
      confidenceHistory: history,
      mutations: tracked ? this.mutationsFor(ts, tracked.reflexId) : [],
      config: {
        minSamples: cfg.minSamples,
        dropThreshold: cfg.dropThreshold,
        floor: cfg.floor,
        watchBelow: cfg.watchBelow,
      },
    };
  }
}

export type { ReflexStatus };
