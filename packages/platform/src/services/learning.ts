import { performance } from 'node:perf_hooks';
import {
  CompileError,
  centroidOf,
  clusterFingerprints,
  compareFingerprints,
  compileReflex,
  evaluateMatcher,
  extractFingerprint,
  trustFromHistory,
  MATCH_THRESHOLD,
  type LabelledFingerprint,
} from '@bigforge/core';
import { DEFAULT_ENVIRONMENT, NEGATIVE_TASKS, SCENARIOS } from '@bigforge/lab-monorepo';
import { contentHash } from '@bigforge/security';
import type {
  FamiliesViewDto,
  FamilyDto,
  FamilyMember,
  MatcherEvaluation,
} from '@bigforge/schemas';
import { type Actor, assertCan, conflict, notFound } from '../actor';
import type { FamilyRow, ReflexVersionRow, RunRow, TaskRow, TenantStore } from '../db/store';
import { materialize, probeEnvironment } from '../execution';
import { preparerFor } from '../engine';
import type { Platform } from '../platform';
import { mapPool } from './pool';

export const CLUSTER_THRESHOLD = 0.75;
export const MIN_FAMILY_MEMBERS = 3;
export const MIN_FAMILY_VARIANTS = 2;

const INTENT_LABELS: Record<string, string> = {
  diagnose_build_failure: 'Monorepo build failure',
};

export class LearningService {
  private readonly p: Platform;

  constructor(platform: Platform) {
    this.p = platform;
  }

  /** Clusters the fingerprints of every task seen so far into task families. */
  async discoverFamilies(actor: Actor): Promise<FamiliesViewDto> {
    assertCan(actor, 'compile');
    const ts = this.p.store.forTenant(actor.tenantId);
    const tasks = ts.tasks
      .all(ts.tenantId, { order: 'created_at ASC, id ASC' })
      .filter(
        (t) =>
          (t.status === 'solved' || t.status === 'observed') &&
          (t.origin === 'intake' || t.origin === 'noise'),
      );
    const clusters = clusterFingerprints(
      tasks.map((t) => ({ id: t.id, fingerprint: t.fingerprint })),
      CLUSTER_THRESHOLD,
    );
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const existing = ts.families.all(ts.tenantId);

    for (const cluster of clusters) {
      const members = cluster.memberIds.map((id) => byId.get(id)).filter((t): t is TaskRow => !!t);
      const variants = [...new Set(members.map((m) => m.variantKey))].sort();
      if (members.length < MIN_FAMILY_MEMBERS || variants.length < MIN_FAMILY_VARIANTS) continue;
      const centroid = centroidOf(members.map((m) => m.fingerprint));
      const memberDtos: FamilyMember[] = members.map((m) => ({
        taskId: m.id,
        scenarioId: m.scenarioId,
        variantKey: m.variantKey,
        similarityToCentroid:
          Math.round(compareFingerprints(m.fingerprint, centroid, 'jaccard').score * 1000) / 1000,
      }));
      const prior = existing.find((f) =>
        f.members.some((fm) => cluster.memberIds.includes(fm.taskId)),
      );
      const label =
        INTENT_LABELS[centroid.intent.label] ?? centroid.intent.label.replaceAll('_', ' ');
      const name = `${label}${centroid.toolchain.tool ? ` (${centroid.toolchain.tool})` : ''}`;
      const description = `Tasks whose intent is "${centroid.intent.label}", failure type "${centroid.failure.type}", toolchain "${centroid.toolchain.tool ?? 'unknown'}", error classes [${centroid.failure.signatures.join(', ')}].`;
      let familyId: string;
      if (prior) {
        familyId = prior.id;
        ts.families.update(ts.tenantId, prior.id, {
          name,
          description,
          centroid,
          members: memberDtos,
          variants,
        });
      } else {
        familyId = this.p.ids.next('fam');
        ts.families.insert(ts.tenantId, {
          id: familyId,
          name,
          description,
          centroid,
          members: memberDtos,
          variants,
          createdAt: this.p.now(),
        });
        this.p.audit(
          actor,
          'family.discovered',
          'family',
          familyId,
          `Task family discovered: ${name} (${members.length} tasks, ${variants.length} variants)`,
          {
            members: members.map((m) => m.scenarioId),
            variants,
            threshold: CLUSTER_THRESHOLD,
          },
        );
      }
      for (const m of members) ts.tasks.update(ts.tenantId, m.id, { familyId });
    }
    return this.view(ts, await this.measureMatcher(ts));
  }

  /** Measured on a labelled synthetic corpus: positives are the lab's tasks, negatives are hand-written out-of-family tasks. */
  async measureMatcher(ts: TenantStore): Promise<MatcherEvaluation | null> {
    const family = ts.families.all(ts.tenantId)[0];
    if (!family) return null;
    const positives = await mapPool(SCENARIOS, 4, async (spec): Promise<LabelledFingerprint> => {
      const mt = await materialize(this.p.engine, spec, DEFAULT_ENVIRONMENT);
      try {
        return {
          label: `${spec.id} ${spec.title}`,
          isInFamily: true,
          fingerprint: extractFingerprint({ prompt: spec.prompt, log: mt.originalLog }),
        };
      } finally {
        await mt.dispose();
      }
    });
    const negatives: LabelledFingerprint[] = NEGATIVE_TASKS.map((n) => ({
      label: `${n.id} ${n.title}`,
      isInFamily: false,
      fingerprint: extractFingerprint({ prompt: n.prompt, log: n.log }),
    }));
    return evaluateMatcher(
      { id: family.id, name: family.name, centroid: family.centroid },
      [...positives, ...negatives],
      MATCH_THRESHOLD,
    );
  }

  view(ts: TenantStore, matcher: MatcherEvaluation | null): FamiliesViewDto {
    const families = ts.families.all(ts.tenantId, { order: 'created_at ASC' });
    const reflexes = ts.reflexes.all(ts.tenantId);
    const versions = ts.versions.all(ts.tenantId);
    const tasks = ts.tasks
      .all(ts.tenantId, { order: 'created_at ASC, id ASC' })
      .filter((t) => t.origin === 'intake' || t.origin === 'noise');
    const edges: FamiliesViewDto['edges'] = [];
    for (let i = 0; i < tasks.length; i += 1) {
      for (let j = i + 1; j < tasks.length; j += 1) {
        const a = tasks[i] as TaskRow;
        const b = tasks[j] as TaskRow;
        const score = compareFingerprints(a.fingerprint, b.fingerprint, 'jaccard').score;
        if (score >= 0.5) edges.push({ a: a.id, b: b.id, score });
      }
    }
    return {
      families: families.map((f): FamilyDto => ({
        id: f.id,
        name: f.name,
        description: f.description,
        centroid: f.centroid,
        memberCount: f.members.length,
        members: f.members,
        variants: f.variants,
        createdAt: f.createdAt,
        reflexVersionIds: versions
          .filter((v) => reflexes.find((r) => r.id === v.reflexId)?.familyId === f.id)
          .map((v) => v.id),
      })),
      nodes: tasks.map((t) => ({
        taskId: t.id,
        scenarioId: t.scenarioId,
        variantKey: t.variantKey,
        title: t.title,
        familyId: t.familyId,
        intent: t.fingerprint.intent.label,
        failureType: t.fingerprint.failure.type,
        toolchain: t.fingerprint.toolchain.tool,
        origin: t.origin,
      })),
      edges,
      matcher,
      thresholds: {
        match: MATCH_THRESHOLD,
        cluster: CLUSTER_THRESHOLD,
        minMembers: MIN_FAMILY_MEMBERS,
        minVariants: MIN_FAMILY_VARIANTS,
      },
    };
  }

  /** Compiles a candidate Reflex from the verified-successful baseline traces of a family. */
  async compile(actor: Actor, familyId: string): Promise<ReflexVersionRow> {
    assertCan(actor, 'compile');
    const ts = this.p.store.forTenant(actor.tenantId);
    const family = ts.families.get(ts.tenantId, familyId);
    if (!family) throw notFound('Task family');
    const traces = this.sourceRuns(ts, family).map((r) => r.trace);
    const started = performance.now();
    let compiled;
    try {
      compiled = await compileReflex({
        traces,
        library: this.p.engine.library,
        prepare: preparerFor(this.p.engine, (t) => ({
          toolchainVersion: t.environment.toolchain.version as '1.4.2' | '1.5.0',
        })),
        familyId: family.id,
        name: 'first-causal-error',
        ids: this.p.ids,
        clock: this.p.engine.clock,
        pricing: this.p.engine.pricing,
      });
    } catch (err) {
      if (err instanceof CompileError) throw conflict(err.message, err.reasons);
      throw err;
    }
    const compileMs = Math.round(performance.now() - started);
    const { spec, report } = compiled;
    let reflex = ts.reflexes
      .all(ts.tenantId)
      .find((r) => r.familyId === family.id && r.name === spec.name);
    if (!reflex) {
      reflex = {
        id: this.p.ids.next('rfx'),
        tenantId: ts.tenantId,
        name: spec.name,
        familyId: family.id,
        createdAt: this.p.now(),
      };
      ts.reflexes.insert(ts.tenantId, {
        id: reflex.id,
        name: reflex.name,
        familyId: reflex.familyId,
        createdAt: reflex.createdAt,
      });
    }
    const existing = ts.versions.all(ts.tenantId).filter((v) => v.reflexId === reflex?.id);
    if (existing.length > 0) {
      const latest = existing
        .map((v) => v.version)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .pop() as string;
      const [maj = 1, min = 0, pat = 0] = latest.split('.').map(Number);
      spec.version = `${maj}.${min}.${pat + 1}`;
      spec.rollbackTo = latest;
    }
    const trust = trustFromHistory([]);
    const now = this.p.now();
    const row: Omit<ReflexVersionRow, 'tenantId'> = {
      id: this.p.ids.next('rfv'),
      reflexId: reflex.id,
      version: spec.version,
      status: 'candidate',
      spec,
      contentHash: contentHash(spec),
      compileReport: { ...report, compileMs },
      confidence: trust.confidence,
      trust,
      createdAt: now,
      updatedAt: now,
    };
    ts.versions.insert(ts.tenantId, row);
    this.p.audit(
      actor,
      'reflex.compiled',
      'reflex_version',
      row.id,
      `Candidate Reflex ${spec.name} v${spec.version} compiled from ${traces.length} traces (${report.variants.length} variants)`,
      {
        contentHash: row.contentHash,
        sourceTraceIds: spec.provenance.sourceTraceIds,
        steps: spec.steps.map((s) => `${s.id}:${s.operator.id}`),
        compileMs,
        deterministic: true,
        modelTokens: 0,
      },
    );
    return { ...row, tenantId: ts.tenantId };
  }

  /** The verified baseline runs a family's Reflex learns from: one per member task, no references or fallbacks. */
  sourceRuns(ts: TenantStore, family: FamilyRow): RunRow[] {
    const out: RunRow[] = [];
    for (const m of family.members) {
      const task = ts.tasks.get(ts.tenantId, m.taskId);
      if (!task || task.origin !== 'intake') continue;
      const run = ts.runs
        .all(ts.tenantId, {
          where: { taskId: m.taskId, kind: 'baseline' },
          order: 'created_at ASC',
        })
        .find(
          (r) =>
            r.groupId === null &&
            r.trace.outcome.status === 'success' &&
            r.trace.verification.status === 'pass',
        );
      if (run) out.push(run);
    }
    if (out.length === 0)
      throw conflict(
        'No verified baseline traces exist for this family yet: run the baseline agent on its tasks first',
      );
    return out;
  }
}

export { probeEnvironment };
