import type { ComparisonDto, RunDetailDto, RunSummaryDto } from '@bigforge/schemas';
import { useMemo } from 'react';
import { useComparisons, useRun, useRuns } from '../../api/hooks';
import { comparisonKindFor } from './selectors';

/**
 * The recorded comparison of a Reflex run against its baseline reference. A live comparison is made when the
 * run is started in compare mode; shadow, canary and replay runs have theirs from those jobs. The list
 * endpoint is per Reflex version and kind, so the run is looked up in it.
 */
export function useRunComparison(
  run: Pick<RunDetailDto, 'id' | 'kind' | 'reflexVersionId'> | undefined,
) {
  const kind = run ? comparisonKindFor(run.kind) : null;
  const versionId = run && kind ? run.reflexVersionId : null;
  const query = useComparisons(versionId, kind ? { kind, limit: 100 } : {});
  const comparison: ComparisonDto | null = useMemo(
    () => (run ? (query.data?.items.find((item) => item.reflexRunId === run.id) ?? null) : null),
    [query.data, run],
  );
  return {
    comparison,
    /** The comparison list is still loading (so "no comparison" is not yet known). */
    pending: versionId !== null && query.isPending,
    error: query.error,
  };
}

/** The newest runs the console started itself (baseline and Reflex), merged and ordered by time. */
export function useRecentLiveRuns(limit = 8): {
  runs: RunSummaryDto[];
  loading: boolean;
  error: unknown;
} {
  const baseline = useRuns({ kind: 'baseline', limit });
  const reflex = useRuns({ kind: 'reflex', limit });
  const runs = useMemo(
    () =>
      [...(baseline.data?.items ?? []), ...(reflex.data?.items ?? [])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    [baseline.data, reflex.data, limit],
  );
  return {
    runs,
    loading: baseline.isPending || reflex.isPending,
    error: baseline.error ?? reflex.error,
  };
}

export { useRun };
