import { compareRuns, extractFingerprint, matchFamily, mayExecuteActive } from '@bigforge/core';
import {
  DEFAULT_ENVIRONMENT,
  type LabEnvironment,
  NEGATIVE_TASKS,
  SCENARIOS,
  type ToolchainVersion,
  getScenario,
} from '@bigforge/lab-monorepo';
import type {
  EnvironmentDto,
  FamilyMatch,
  Fingerprint,
  RunResultDto,
  ScenarioDto,
  TaskDetailDto,
} from '@bigforge/schemas';
import { contentHash, redactSecrets } from '@bigforge/security';
import { type Actor, assertCan, badRequest, conflict, notFound } from '../actor';
import type { FamilyRow, ReflexVersionRow, RunRow, TaskRow, TenantStore } from '../db/store';
import { materialize, runBaseline, runReflex } from '../execution';
import type { Platform } from '../platform';
import { digestFromRun, saveRun, toRunDetail, toRunSummary, toTaskDto } from './shared';

const ENV_DESCRIPTIONS: Record<string, string> = {
  '1.4.2':
    'forge-ci 1.4.2: builds workspaces sequentially in dependency order (log lists a root failure before its consequences).',
  '1.5.0':
    'forge-ci 1.5.0: builds workspaces in parallel; log lines are emitted by completion time, so consequences can appear before the root failure.',
};

interface EnvironmentSetting {
  toolchainVersion: ToolchainVersion;
  history: { at: string; from: ToolchainVersion; to: ToolchainVersion; by: string }[];
}

export class TaskService {
  private readonly p: Platform;

  constructor(platform: Platform) {
    this.p = platform;
  }

  // ---- lab environment ----
  environment(ts: TenantStore): LabEnvironment {
    const s = ts.getSetting<EnvironmentSetting>('lab.environment', {
      ...DEFAULT_ENVIRONMENT,
      history: [],
    });
    return { toolchainVersion: s.toolchainVersion };
  }

  environmentDto(ts: TenantStore): EnvironmentDto {
    return {
      toolchainVersion: this.environment(ts).toolchainVersion,
      available: Object.entries(ENV_DESCRIPTIONS).map(([version, description]) => ({
        version,
        description,
      })),
    };
  }

  environmentHistory(ts: TenantStore): EnvironmentSetting['history'] {
    return ts.getSetting<EnvironmentSetting>('lab.environment', {
      ...DEFAULT_ENVIRONMENT,
      history: [],
    }).history;
  }

  setEnvironment(actor: Actor, version: string): EnvironmentDto {
    assertCan(actor, 'inject_environment_change');
    if (!(version in ENV_DESCRIPTIONS)) throw badRequest(`Unknown toolchain version: ${version}`);
    const ts = this.p.store.forTenant(actor.tenantId);
    const current = ts.getSetting<EnvironmentSetting>('lab.environment', {
      ...DEFAULT_ENVIRONMENT,
      history: [],
    });
    if (current.toolchainVersion === version) return this.environmentDto(ts);
    const next: EnvironmentSetting = {
      toolchainVersion: version as ToolchainVersion,
      history: [
        ...current.history,
        {
          at: this.p.now(),
          from: current.toolchainVersion,
          to: version as ToolchainVersion,
          by: actor.name,
        },
      ],
    };
    ts.setSetting('lab.environment', next);
    this.p.audit(
      actor,
      'lab.environment_changed',
      'environment',
      'forge-ci',
      `Synthetic environment changed: forge-ci ${current.toolchainVersion} -> ${version}`,
      {
        from: current.toolchainVersion,
        to: version,
        synthetic: true,
      },
    );
    return this.environmentDto(ts);
  }

  scenarios(ts: TenantStore): ScenarioDto[] {
    const tasks = ts.tasks.all(ts.tenantId, {
      fields: ['id', 'scenarioId', 'status', 'origin', 'createdAt'],
    });
    return SCENARIOS.map((s) => {
      const task = tasks
        .filter((t) => t.scenarioId === s.id && t.origin === 'intake')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        id: s.id,
        role: s.role,
        fault: s.fault,
        workspace: s.workspace,
        ambiguous: s.ambiguous,
        variantKey: s.variantKey,
        title: s.title,
        prompt: s.prompt,
        taskId: task?.id ?? null,
        taskStatus: task?.status ?? null,
      };
    });
  }

  // ---- intake and matching ----
  async intake(
    actor: Actor,
    scenarioId: string,
    options: { origin?: TaskRow['origin'] } = {},
  ): Promise<TaskRow> {
    assertCan(actor, 'run_task');
    const ts = this.p.store.forTenant(actor.tenantId);
    const spec = SCENARIOS.find((s) => s.id === scenarioId);
    if (!spec) throw badRequest(`Unknown scenario: ${scenarioId}`);
    const env = this.environment(ts);
    const mt = await materialize(this.p.engine, spec, env);
    let fingerprint: Fingerprint;
    let log: string;
    try {
      fingerprint = extractFingerprint({ prompt: spec.prompt, log: mt.originalLog });
      log = redactSecrets(mt.originalLog).text;
    } finally {
      await mt.dispose();
    }
    const { match } = this.matchFingerprint(ts, fingerprint);
    const row: Omit<TaskRow, 'tenantId'> = {
      id: this.p.ids.next('tsk'),
      scenarioId: spec.id,
      variantKey: spec.variantKey,
      scenarioRole: spec.role,
      title: spec.title,
      prompt: spec.prompt,
      envVersion: env.toolchainVersion,
      status: 'received',
      origin: options.origin ?? 'intake',
      fingerprint,
      match,
      familyId: match.familyId,
      originalLog: log,
      createdAt: this.p.now(),
    };
    ts.tasks.insert(ts.tenantId, row);
    this.p.audit(actor, 'task.received', 'task', row.id, `Build failure received: ${spec.title}`, {
      scenarioId: spec.id,
      env: env.toolchainVersion,
      match: match.decision,
      origin: row.origin,
    });
    return { ...row, tenantId: ts.tenantId };
  }

  /** Out-of-scope tasks that are observed (fingerprinted) but never executed. */
  intakeNoise(actor: Actor, negativeId: string): TaskRow {
    assertCan(actor, 'run_task');
    const ts = this.p.store.forTenant(actor.tenantId);
    const neg = NEGATIVE_TASKS.find((n) => n.id === negativeId);
    if (!neg) throw badRequest(`Unknown out-of-scope task: ${negativeId}`);
    const fingerprint = extractFingerprint({ prompt: neg.prompt, log: neg.log });
    const { match } = this.matchFingerprint(ts, fingerprint);
    const row: Omit<TaskRow, 'tenantId'> = {
      id: this.p.ids.next('tsk'),
      scenarioId: neg.id,
      variantKey: 'out-of-scope',
      scenarioRole: 'noise',
      title: `${neg.title}: ${neg.prompt}`,
      prompt: neg.prompt,
      envVersion: this.environment(ts).toolchainVersion,
      status: 'observed',
      origin: 'noise',
      fingerprint,
      match,
      familyId: match.familyId,
      originalLog: neg.log ? redactSecrets(neg.log).text : null,
      createdAt: this.p.now(),
    };
    ts.tasks.insert(ts.tenantId, row);
    this.p.audit(
      actor,
      'task.observed',
      'task',
      row.id,
      `Out-of-scope task observed (not executed): ${neg.title}`,
      { negativeId, reason: neg.reason },
    );
    return { ...row, tenantId: ts.tenantId };
  }

  matchFingerprint(
    ts: TenantStore,
    fp: Fingerprint,
  ): { match: FamilyMatch; family: FamilyRow | null } {
    const families = ts.families.all(ts.tenantId);
    let best: { match: FamilyMatch; family: FamilyRow } | null = null;
    for (const family of families) {
      const match = matchFamily(fp, {
        id: family.id,
        name: family.name,
        centroid: family.centroid,
      });
      if (!best || match.score > best.match.score) best = { match, family };
    }
    if (!best) return { match: matchFamily(fp, null), family: null };
    return { match: best.match, family: best.family };
  }

  selectReflex(ts: TenantStore, familyId: string): ReflexVersionRow | null {
    const reflexIds = new Set(
      ts.reflexes
        .all(ts.tenantId)
        .filter((r) => r.familyId === familyId)
        .map((r) => r.id),
    );
    const candidates = ts.versions
      .all(ts.tenantId)
      .filter((v) => reflexIds.has(v.reflexId) && mayExecuteActive(v.status))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    return candidates[0] ?? null;
  }

  matchTask(
    actor: Actor,
    taskId: string,
  ): { task: TaskDetailDto; match: FamilyMatch; reflexVersionId: string | null } {
    const ts = this.p.store.forTenant(actor.tenantId);
    const task = ts.tasks.get(ts.tenantId, taskId);
    if (!task) throw notFound('Task');
    const { match, family } = this.matchFingerprint(ts, task.fingerprint);
    ts.tasks.update(ts.tenantId, task.id, { match, familyId: match.familyId });
    const version = match.decision === 'match' && family ? this.selectReflex(ts, family.id) : null;
    return {
      task: this.detail(ts, { ...task, match, familyId: match.familyId }),
      match,
      reflexVersionId: version?.id ?? null,
    };
  }

  /** Fingerprints arbitrary text and reports how it would be matched. Executes nothing. */
  matchText(
    ts: TenantStore,
    prompt: string,
    log: string | null,
  ): { fingerprint: Fingerprint; match: FamilyMatch; reflexVersionId: string | null } {
    const fingerprint = extractFingerprint({ prompt, log });
    const { match, family } = this.matchFingerprint(ts, fingerprint);
    const version = match.decision === 'match' && family ? this.selectReflex(ts, family.id) : null;
    return { fingerprint, match, reflexVersionId: version?.id ?? null };
  }

  detail(ts: TenantStore, task: TaskRow): TaskDetailDto {
    const runs = ts.runs.all(ts.tenantId, {
      where: { taskId: task.id },
      order: 'created_at ASC, id ASC',
      fields: [
        'id',
        'taskId',
        'kind',
        'status',
        'reflexVersionId',
        'groupId',
        'createdAt',
        'usage',
        'trace',
      ],
    });
    return { ...toTaskDto(task), originalLog: task.originalLog, runs: runs.map(toRunSummary) };
  }

  // ---- execution ----
  async run(
    actor: Actor,
    taskId: string,
    mode: 'baseline' | 'auto' | 'compare',
  ): Promise<RunResultDto> {
    assertCan(actor, 'run_task');
    const ts = this.p.store.forTenant(actor.tenantId);
    const task = ts.tasks.get(ts.tenantId, taskId);
    if (!task) throw notFound('Task');
    if (task.status === 'observed')
      throw conflict(
        'This task was only observed; it is out of scope for the synthetic lab and cannot be executed',
      );
    const scenario = getScenario(task.scenarioId);
    const env: LabEnvironment = { toolchainVersion: task.envVersion as ToolchainVersion };
    const engine = this.p.engine;

    const { match, family } = this.matchFingerprint(ts, task.fingerprint);
    ts.tasks.update(ts.tenantId, task.id, { match, familyId: match.familyId });
    const version =
      mode !== 'baseline' && match.decision === 'match' && family
        ? this.selectReflex(ts, family.id)
        : null;
    const group = this.p.ids.next('grp');

    const persistBaseline = (
      result: Awaited<ReturnType<typeof runBaseline>>,
      category: string,
      label: string,
      groupId: string | null,
    ): RunRow =>
      saveRun(ts, {
        taskId,
        result,
        reflexVersionId: null,
        groupId,
        spec: null,
        ledger: { category, label },
        ids: this.p.ids,
        now: this.p.now(),
        metrics: this.p.metrics,
      });

    if (!version) {
      const mt = await materialize(engine, scenario, env);
      let result;
      try {
        result = await runBaseline(engine, mt, { taskId, kind: 'baseline' });
      } finally {
        await mt.dispose();
      }
      const learning = task.scenarioRole === 'learning';
      const row = persistBaseline(
        result,
        learning ? 'learning_baseline' : 'baseline_task',
        learning ? 'Learning-task baseline run' : 'Baseline task run',
        null,
      );
      ts.tasks.update(ts.tenantId, task.id, {
        status: row.trace.outcome.status === 'success' ? 'solved' : 'failed',
      });
      this.p.audit(
        actor,
        'run.baseline',
        'run',
        row.id,
        `Baseline agent ${row.trace.outcome.status}: ${task.title}`,
        {
          taskId,
          modelCalls: row.usage.modelCalls,
          tokens: row.usage.totalTokens,
          tokenProvenance: row.usage.tokenProvenance,
          verification: row.trace.verification.status,
        },
      );
      return {
        task: toTaskDto({
          ...task,
          match,
          familyId: match.familyId,
          status: row.trace.outcome.status === 'success' ? 'solved' : 'failed',
        }),
        match,
        reflexVersionId: null,
        primary: toRunDetail(row, task),
        reference: null,
        comparison: null,
        fallback: null,
      };
    }

    if (contentHash(version.spec) !== version.contentHash) {
      this.p.audit(
        actor,
        'reflex.integrity_failed',
        'reflex_version',
        version.id,
        'Execution refused: Reflex content hash mismatch',
        { expected: version.contentHash },
      );
      throw conflict(
        'Reflex integrity check failed: the stored specification does not match its content hash',
      );
    }
    const mtR = await materialize(engine, scenario, env);
    const mtB = mode === 'compare' ? await materialize(engine, scenario, env) : null;
    let reflexRes;
    let baseRes;
    try {
      [reflexRes, baseRes] = await Promise.all([
        runReflex(engine, mtR, version.spec, {
          taskId,
          kind: 'reflex',
          reflexId: version.id,
          allowBoundary: true,
        }),
        mtB ? runBaseline(engine, mtB, { taskId, kind: 'baseline' }) : Promise.resolve(null),
      ]);
    } finally {
      await Promise.all([mtR.dispose(), mtB?.dispose()]);
    }
    const reflexRow = saveRun(ts, {
      taskId,
      result: reflexRes,
      reflexVersionId: version.id,
      groupId: group,
      spec: version.spec,
      ledger: { category: 'reflex_live', label: `Reflex ${version.spec.name} v${version.version}` },
      ids: this.p.ids,
      now: this.p.now(),
      metrics: this.p.metrics,
    });
    const baseRow = baseRes
      ? persistBaseline(
          baseRes,
          'comparison_reference',
          'Baseline reference run (comparison only)',
          group,
        )
      : null;

    let comparison = null;
    if (baseRow) {
      comparison = compareRuns(digestFromRun(baseRow), digestFromRun(reflexRow));
      ts.comparisons.insert(ts.tenantId, {
        id: this.p.ids.next('cmp'),
        kind: 'live',
        reflexVersionId: version.id,
        taskId,
        baselineRunId: baseRow.id,
        reflexRunId: reflexRow.id,
        variantKey: scenario.variantKey,
        agree: comparison.agree,
        comparison,
        createdAt: this.p.now(),
      });
    }

    let fallbackRow: RunRow | null = null;
    if (reflexRow.trace.outcome.status === 'stopped') {
      const mtF = await materialize(engine, scenario, env);
      try {
        const fb = await runBaseline(engine, mtF, { taskId, kind: 'baseline' });
        fallbackRow = persistBaseline(
          fb,
          'fallback_baseline',
          'Baseline fallback after the Reflex stopped',
          group,
        );
      } finally {
        await mtF.dispose();
      }
    }
    const solved =
      reflexRow.trace.outcome.status === 'success' ||
      fallbackRow?.trace.outcome.status === 'success';
    ts.tasks.update(ts.tenantId, task.id, { status: solved ? 'solved' : 'failed' });
    this.p.audit(
      actor,
      'run.reflex',
      'run',
      reflexRow.id,
      `Reflex ${version.spec.name} v${version.version} ${reflexRow.trace.outcome.status}: ${task.title}`,
      {
        taskId,
        reflexVersionId: version.id,
        modelCalls: reflexRow.usage.modelCalls,
        tokens: reflexRow.usage.totalTokens,
        boundaries: reflexRow.exec?.boundaries.length ?? 0,
        stopReason: reflexRow.exec?.stopReason ?? null,
        fallback: fallbackRow !== null,
        verification: reflexRow.trace.verification.status,
      },
    );
    return {
      task: toTaskDto({
        ...task,
        match,
        familyId: match.familyId,
        status: solved ? 'solved' : 'failed',
      }),
      match,
      reflexVersionId: version.id,
      primary: toRunDetail(reflexRow, task),
      reference: baseRow ? toRunDetail(baseRow, task) : null,
      comparison,
      fallback: fallbackRow ? toRunDetail(fallbackRow, task) : null,
    };
  }
}
