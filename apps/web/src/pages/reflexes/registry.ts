import type { ReflexListDto, ReflexStatus, ReflexVersionSummaryDto } from '@bigforge/schemas';

/** Registry selectors: which version represents a Reflex, filtering by status, lineage wording. */

/** Which version a registry row foregrounds: the one doing (or closest to doing) the most work. */
export const STATUS_PRIORITY: readonly ReflexStatus[] = [
  'active',
  'watch',
  'approval',
  'shadow',
  'replay',
  'candidate',
  'recompile',
  'deprecated',
  'retired',
];

export type StatusFilter = ReflexStatus | 'all';

const priorityOf = (status: ReflexStatus): number => STATUS_PRIORITY.indexOf(status);

const collator = new Intl.Collator('en', { numeric: true });
export const compareVersionNumbers = (a: string, b: string): number => collator.compare(a, b);

/** Newest first: by creation time, then by version number. */
export function newestFirst(a: ReflexVersionSummaryDto, b: ReflexVersionSummaryDto): number {
  return b.createdAt.localeCompare(a.createdAt) || compareVersionNumbers(b.version, a.version);
}

export function primaryVersion(
  versions: readonly ReflexVersionSummaryDto[],
  filter: StatusFilter = 'all',
): ReflexVersionSummaryDto | null {
  const pool = filter === 'all' ? versions : versions.filter((v) => v.status === filter);
  const sorted = [...pool].sort(
    (a, b) => priorityOf(a.status) - priorityOf(b.status) || newestFirst(a, b),
  );
  return sorted[0] ?? null;
}

export function filterReflexes(
  reflexes: readonly ReflexListDto[],
  filter: StatusFilter,
): ReflexListDto[] {
  return filter === 'all'
    ? [...reflexes]
    : reflexes.filter((r) => r.versions.some((v) => v.status === filter));
}

export interface StatusCount {
  status: StatusFilter;
  count: number;
}

/** Versions per status, plus the total, for the filter chips. Only statuses that occur are listed. */
export function statusCounts(reflexes: readonly ReflexListDto[]): StatusCount[] {
  const counts = new Map<ReflexStatus, number>();
  let total = 0;
  for (const reflex of reflexes) {
    for (const version of reflex.versions) {
      counts.set(version.status, (counts.get(version.status) ?? 0) + 1);
      total += 1;
    }
  }
  return [
    { status: 'all', count: total },
    ...STATUS_PRIORITY.flatMap((status) => {
      const count = counts.get(status);
      return count ? [{ status, count }] : [];
    }),
  ];
}

/** "Mutation of v1.0.0" for a version that was proposed from another, else null. */
export function lineageText(version: Pick<ReflexVersionSummaryDto, 'mutationOf'>): string | null {
  return version.mutationOf ? `Mutation of v${version.mutationOf}` : null;
}

/** The version a Shadow Lab opens by default: the newest one that is not retired. */
export function defaultShadowVersion(
  reflexes: readonly ReflexListDto[],
  familyId?: string | null,
): ReflexVersionSummaryDto | null {
  const pool = reflexes
    .filter((r) => !familyId || r.familyId === familyId)
    .flatMap((r) => r.versions)
    .filter((v) => v.status !== 'retired')
    .sort(newestFirst);
  return pool[0] ?? null;
}
