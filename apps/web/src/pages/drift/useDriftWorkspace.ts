import { useState } from 'react';
import type { DriftCheckDto, MutationDto } from '@bigforge/schemas';
import {
  useAudit,
  useComparisons,
  useDrift,
  useJob,
  useReflexVersion,
  useReflexes,
} from '../../api/hooks';
import { useOptionalDemo } from '../../demo/useDemo';
import { type EnvChange, environmentChanges } from './model';

/**
 * Everything the Drift page reads, in one place: the drift view (environment, checks, thresholds), the
 * selected Reflex version (spec, transitions, what the caller may do), its canary comparisons and the
 * environment change history. The tracked version is the one `GET /api/drift` reports unless the URL names another.
 */
export function useDriftWorkspace(versionParam: string | null) {
  const drift = useDrift();
  const reflexes = useReflexes();
  const tracked = drift.data?.reflexVersion ?? null;
  const versionId = versionParam ?? tracked?.id ?? null;
  const version = useReflexVersion(versionId);
  const canary = useComparisons(versionId, { kind: 'canary', limit: 100 });
  const audit = useAudit({ action: 'lab.environment_changed', limit: 20 });

  const checks: DriftCheckDto[] = (drift.data?.checks ?? []).filter(
    (check) => check.reflexVersionId === versionId,
  );
  const latest: DriftCheckDto | null = checks[0] ?? null;
  const mutations: MutationDto[] = (version.data?.mutations ?? []).filter(
    (mutation) => mutation.fromVersionId === versionId || mutation.toVersionId === versionId,
  );
  const proposal: MutationDto | null =
    mutations.find((mutation) => mutation.fromVersionId === versionId) ?? null;
  const origin: MutationDto | null =
    mutations.find((mutation) => mutation.toVersionId === versionId) ?? null;
  const changes: EnvChange[] = environmentChanges(audit.data?.items ?? []);

  return {
    drift,
    reflexes,
    version,
    canary,
    audit,
    versionId,
    checks,
    latest,
    mutations,
    proposal,
    origin,
    changes,
  };
}

export type DriftWorkspace = ReturnType<typeof useDriftWorkspace>;

/** Follows a job started by a mutation hook (canary, mutation) until it finishes. */
export function useJobFollower() {
  const [jobId, setJobId] = useState<string | null>(null);
  const query = useJob(jobId);
  const job = query.data ?? null;
  const running =
    jobId !== null && (job === null || job.status === 'queued' || job.status === 'running');
  return {
    follow: setJobId,
    job,
    running,
    failure: job?.status === 'failed' ? (job.error ?? 'The job failed.') : null,
    finished: job?.status === 'succeeded',
  };
}

/** The guided demo's own running job of a given type, so a step performed by the presenter shows progress here too. */
export function useDemoJob(type: string) {
  const demo = useOptionalDemo();
  const job = demo?.busy ? (demo.activeJob ?? null) : null;
  return job && job.type === type && (job.status === 'queued' || job.status === 'running')
    ? job
    : null;
}
