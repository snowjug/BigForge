import { diffLines, diffStats, runCrr } from '@bigforge/core';
import type { UsagePoint } from '@bigforge/core';
import type { BigForgeMetrics } from '@bigforge/observability';
import type {
  ExecSummary,
  FileChangeDto,
  ReflexSpec,
  RunDetailDto,
  RunDigest,
  RunSummaryDto,
  TaskDto,
} from '@bigforge/schemas';
import type { RunRow, TaskRow, TenantStore } from '../db/store';
import type { RunResult } from '../execution';

export function toTaskDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    variantKey: row.variantKey,
    scenarioRole: row.scenarioRole,
    title: row.title,
    prompt: row.prompt,
    envVersion: row.envVersion,
    status: row.status,
    origin: row.origin,
    fingerprint: row.fingerprint,
    match: row.match,
    familyId: row.familyId,
    createdAt: row.createdAt,
  };
}

export function toRunSummary(row: RunRow): RunSummaryDto {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    status: row.status,
    reflexVersionId: row.reflexVersionId,
    groupId: row.groupId,
    createdAt: row.createdAt,
    usage: row.usage,
    rootFailure: row.trace.outcome.rootFailure,
    verification: row.trace.verification.status,
    agent: row.trace.agent,
    provider: row.trace.provider,
    outcomeSummary: row.trace.outcome.summary,
  };
}

export function toRunDetail(
  row: RunRow,
  task: Pick<TaskRow, 'id' | 'title' | 'scenarioId' | 'variantKey'>,
): RunDetailDto {
  const changes: FileChangeDto[] = row.changes.map((c) => {
    const diff = diffLines(c.before, c.after, 3);
    const s = diffStats(diff);
    return { ...c, diff, added: s.added, removed: s.removed };
  });
  return {
    ...toRunSummary(row),
    trace: row.trace,
    changes,
    exec: row.exec,
    task: {
      id: task.id,
      title: task.title,
      scenarioId: task.scenarioId,
      variantKey: task.variantKey,
    },
  };
}

export function digestFromRun(row: RunRow): RunDigest {
  return {
    runId: row.id,
    traceId: row.trace.id,
    kind: row.kind,
    status: row.trace.outcome.status,
    verification: row.trace.verification.status,
    rootFailure: row.trace.outcome.rootFailure,
    changes: row.changes.map((c) => ({ file: c.file, after: c.after })),
    usage: row.usage,
    stopReason: row.exec?.stopReason ?? null,
    stopStepId: row.exec?.stopStepId ?? null,
    safetyViolations: row.trace.agent.kind === 'reflex' ? row.usage.blockedActions : 0,
  };
}

export function usagePoint(row: RunRow): UsagePoint {
  return {
    tokens: row.usage.totalTokens,
    uncachedTokens:
      Math.max(0, row.usage.inputTokens - row.usage.cachedInputTokens) + row.usage.outputTokens,
    costUsd: row.usage.costUsd,
    modelCalls: row.usage.modelCalls,
    provenance: row.usage.tokenProvenance,
  };
}

export function execSummaryOf(result: RunResult, spec: ReflexSpec | null): ExecSummary | null {
  const execution = result.execution;
  if (!execution) return null;
  const weights = new Map((spec?.steps ?? []).map((s) => [s.id, s.rationale.baselineTokens]));
  const byId = new Map(execution.steps.map((s) => [s.stepId, s]));
  const crr = spec
    ? runCrr(
        spec.steps.map((s) => {
          const r = byId.get(s.id);
          return {
            weight: weights.get(s.id) ?? 1,
            executor: r?.executor ?? 'local',
            status: r?.status ?? 'skipped',
          };
        }),
      )
    : null;
  const report =
    (execution.ctx.steps.report?.output as { report?: string } | undefined)?.report ?? null;
  return {
    status: execution.status,
    stopReason: execution.stopReason,
    stopStepId: execution.stopStepId,
    steps: execution.steps,
    boundaries: execution.boundaries,
    evidenceTokens: execution.evidence.reduce((n, c) => n + c.tokens, 0),
    crr,
    outputs: { report },
  };
}

export interface SaveRunInput {
  taskId: string;
  result: RunResult;
  reflexVersionId: string | null;
  groupId: string | null;
  spec: ReflexSpec | null;
  ledger: { category: string; label: string };
  ids: { next(prefix: string): string };
  now: string;
  metrics?: BigForgeMetrics;
}

/** Persists a run and its ledger entry. The trace is already redacted by the recorder. */
export function saveRun(ts: TenantStore, input: SaveRunInput): RunRow {
  const { trace } = input.result;
  const id = input.ids.next('run');
  const row: Omit<RunRow, 'tenantId'> = {
    id,
    taskId: input.taskId,
    kind: trace.runKind,
    status: trace.outcome.status,
    reflexVersionId: input.reflexVersionId,
    groupId: input.groupId,
    trace,
    changes: input.result.changes,
    exec: execSummaryOf(input.result, input.spec),
    usage: trace.usage,
    totalTokens: trace.usage.totalTokens,
    costUsd: trace.usage.costUsd,
    modelCalls: trace.usage.modelCalls,
    createdAt: input.now,
  };
  ts.runs.insert(ts.tenantId, row);
  const m = input.metrics;
  if (m) {
    m.runs.inc({ kind: trace.runKind, status: trace.outcome.status });
    const mode = trace.provider.mode;
    if (trace.usage.modelCalls > 0)
      m.modelCalls.inc({ mode, provenance: trace.usage.tokenProvenance }, trace.usage.modelCalls);
    m.tokens.inc(
      { type: 'input', provenance: trace.usage.tokenProvenance },
      trace.usage.inputTokens,
    );
    m.tokens.inc(
      { type: 'output', provenance: trace.usage.tokenProvenance },
      trace.usage.outputTokens,
    );
    for (const b of input.result.boundaries)
      m.firewallVerdicts.inc({ verdict: b.decision.verdict });
  }
  ts.ledger.insert(ts.tenantId, {
    id: input.ids.next('led'),
    category: input.ledger.category,
    label: input.ledger.label,
    runId: id,
    taskId: input.taskId,
    reflexVersionId: input.reflexVersionId,
    inputTokens: trace.usage.inputTokens,
    outputTokens: trace.usage.outputTokens,
    cachedTokens: trace.usage.cachedInputTokens,
    modelCalls: trace.usage.modelCalls,
    costUsd: trace.usage.costUsd,
    tokenProvenance: trace.usage.tokenProvenance,
    createdAt: input.now,
  });
  return { ...row, tenantId: ts.tenantId };
}
