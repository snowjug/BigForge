import type { ReflexVersionDto, RunKind, RunSummaryDto, TaskDto } from '@bigforge/schemas';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { http } from '../../api/client';
import { useReflexes, useTasks } from '../../api/hooks';
import type { Paged } from '../../api/types';
import { keys } from '../../api/keys';
import type { CompileInfo } from './safety';

/** Filters of the trace list, kept in the query string so a filtered list can be shared. */
export interface TraceFilters {
  kind: RunKind | null;
  task: string | null;
}

const KINDS: readonly RunKind[] = [
  'baseline',
  'reflex',
  'shadow_baseline',
  'shadow_reflex',
  'replay_reflex',
  'canary_baseline',
  'canary_reflex',
];

export function useTraceFilters(): TraceFilters & {
  set: (patch: Partial<TraceFilters>) => void;
  clear: () => void;
} {
  const [search, setSearch] = useSearchParams();
  const kindParam = search.get('kind');
  const kind = KINDS.find((entry) => entry === kindParam) ?? null;
  const task = search.get('task') || null;
  return {
    kind,
    task,
    set: (patch) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    clear: () => {
      setSearch({}, { replace: true });
    },
  };
}

export interface TaskLabel {
  scenarioId: string;
  title: string;
}

/** Task id -> scenario id and title, so a run can be named by what it was about. */
export function useTaskIndex(): {
  index: Map<string, TaskLabel>;
  tasks: TaskDto[];
  loading: boolean;
  total: number;
} {
  const query = useTasks({ limit: 100 });
  return useMemo(() => {
    const tasks = query.data?.items ?? [];
    return {
      index: new Map(
        tasks.map((task) => [task.id, { scenarioId: task.scenarioId, title: task.title }]),
      ),
      tasks,
      loading: query.isPending,
      total: query.data?.total ?? 0,
    };
  }, [query.data, query.isPending]);
}

/**
 * What the registry knows about learning from a trace: the Reflex versions' compile provenance (which
 * traces were sources) and their excluded behaviours. Only fetched when the trace could be a source.
 */
export function useCompileInfo(
  traceId: string | null,
  enabled: boolean,
): { info: CompileInfo | null; loading: boolean } {
  const reflexes = useReflexes();
  const versions = useMemo(
    () =>
      (reflexes.data?.reflexes ?? [])
        .flatMap((reflex) => reflex.versions)
        .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })),
    [reflexes.data],
  );
  const details = useQueries({
    queries: versions.map((version) => ({
      queryKey: keys.reflexes.version(version.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        http.get<ReflexVersionDto>(`/api/reflexes/versions/${encodeURIComponent(version.id)}`, {
          signal,
        }),
      enabled,
      staleTime: 5_000,
    })),
  });
  return useMemo(() => {
    const loaded = details.flatMap((entry) => (entry.data ? [entry.data] : []));
    if (!enabled || !traceId || loaded.length === 0) {
      return {
        info: null,
        loading: enabled && (reflexes.isPending || details.some((entry) => entry.isPending)),
      };
    }
    const source =
      loaded.find((version) => version.spec.provenance.sourceTraceIds.includes(traceId)) ??
      loaded[0];
    if (!source) return { info: null, loading: false };
    const excluded = new Map<string, { purpose: string; occurrences: number; reason: string }>();
    for (const version of loaded)
      for (const entry of version.compileReport.excludedBehaviours)
        excluded.set(entry.purpose, entry);
    return {
      info: {
        reflexName: source.name,
        version: source.version,
        sourceTraceIds: source.spec.provenance.sourceTraceIds,
        excluded: [...excluded.values()],
      },
      loading: false,
    };
  }, [details, enabled, reflexes.isPending, traceId]);
}

export const TRACE_KINDS = KINDS;

/** How many runs exist per kind (and in total), from one-row pages of the runs list. */
export function useKindCounts(): { total: number | null; byKind: Map<RunKind, number> } {
  const results = useQueries({
    queries: [undefined, ...KINDS].map((kind) => {
      const params = { limit: 1, ...(kind ? { kind } : {}) };
      return {
        queryKey: keys.runs.list(params),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          http.get<Paged<RunSummaryDto>>('/api/runs', { query: params, signal }),
        staleTime: 5_000,
      };
    }),
  });
  return useMemo(() => {
    const byKind = new Map<RunKind, number>();
    KINDS.forEach((kind, index) => {
      const count = results[index + 1]?.data?.total;
      if (count !== undefined) byKind.set(kind, count);
    });
    return { total: results[0]?.data?.total ?? null, byKind };
  }, [results]);
}
