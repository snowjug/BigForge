import type { ReflexListDto, ReflexVersionSummaryDto } from '@bigforge/schemas';
import { Fingerprint, GitBranch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useReflexes } from '../api/hooks';
import { useDemoTarget } from '../demo/useDemo';
import { useNow } from '../hooks/useNow';
import { learnPath, reflexPath } from '../routes';
import {
  ButtonLink,
  type Column,
  DataTable,
  EmptyState,
  Page,
  PageHeader,
  Provenance,
  REFLEX_STATUS,
  StatusChip,
  plural,
  relativeTime,
} from '../ui';
import { ReflexGlyph } from '../viz';
import { ConfidenceBar } from './reflexes/parts';
import {
  type StatusFilter,
  filterReflexes,
  lineageText,
  primaryVersion,
  statusCounts,
} from './reflexes/registry';
import { StatusRibbon } from './reflexes/StatusRibbon';
import '../styles/reflexes.css';

interface Row {
  reflex: ReflexListDto;
  primary: ReflexVersionSummaryDto;
}

/** `/reflexes`: Is this Reflex trustworthy and what does it do? */
export default function ReflexesPage() {
  const reflexes = useReflexes();
  const navigate = useNavigate();
  const now = useNow();
  const target = useDemoTarget('candidate');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const list = reflexes.data?.reflexes;
  const counts = useMemo(() => statusCounts(list ?? []), [list]);
  const rows = useMemo<Row[] | undefined>(() => {
    if (!list) return undefined;
    return filterReflexes(list, filter).flatMap((reflex) => {
      const primary = primaryVersion(reflex.versions, filter);
      return primary ? [{ reflex, primary }] : [];
    });
  }, [list, filter]);

  const columns: Column<Row>[] = [
    {
      id: 'reflex',
      header: 'Reflex',
      width: 270,
      cell: ({ reflex, primary }) => {
        const lineage = lineageText(primary);
        return (
          <div className="rfx-name">
            <ReflexGlyph hash={primary.contentHash} size={36} />
            <div className="rfx-name__text">
              <span className="rfx-name__title">{reflex.name}</span>
              <span className="rfx-name__meta mono">
                <Fingerprint size={12} aria-hidden="true" />
                <Link
                  to={learnPath({ family: reflex.familyId })}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  title="Open the task family this Reflex was learned from"
                >
                  {reflex.familyId}
                </Link>
              </span>
              {lineage ? (
                <span className="rfx-name__meta">
                  <GitBranch size={12} aria-hidden="true" /> {lineage}
                </span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      id: 'versions',
      header: 'Versions',
      width: 240,
      hideOnMobile: true,
      cell: ({ reflex, primary }) => (
        <ul className="rfx-versions" aria-label={`Versions of ${reflex.name}`}>
          {reflex.versions.map((v) => (
            <li key={v.id}>
              <Link
                to={reflexPath(v.id)}
                className="rfx-vchip"
                data-primary={v.id === primary.id ? 'true' : undefined}
                data-tone={REFLEX_STATUS[v.status].tone}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <span className="mono">v{v.version}</span>
                <span className="rfx-vchip__status">{REFLEX_STATUS[v.status].label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'status',
      header: 'Lifecycle',
      width: 300,
      cell: ({ primary }) => <StatusRibbon status={primary.status} variant="compact" />,
    },
    {
      id: 'confidence',
      header: (
        <span className="rfx-th">
          Confidence <Provenance kind="estimated" metric="reflex_confidence" />
        </span>
      ),
      cell: ({ primary }) => <ConfidenceBar trust={primary.trust} />,
    },
    {
      id: 'steps',
      header: 'Steps',
      align: 'end',
      mono: true,
      hideOnMobile: true,
      cell: ({ primary }) => primary.stepCount,
    },
    {
      id: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: ({ primary }) => <span className="dim">{relativeTime(primary.updatedAt, now)}</span>,
    },
  ];

  const total = counts[0]?.count ?? 0;
  const reflexCount = list?.length ?? 0;

  return (
    <Page title="Reflexes">
      <PageHeader
        eyebrow="Compile · Validate"
        title="Reflexes"
        question="Is this Reflex trustworthy and what does it do?"
        meta={
          list
            ? `${plural(total, 'version')} of ${plural(reflexCount, 'Reflex', 'Reflexes')} · decision: promote, reject or roll back`
            : 'Decision: promote, reject or roll back'
        }
        actions={
          <ButtonLink to={learnPath()} variant="ghost">
            Compile from a task family
          </ButtonLink>
        }
      />

      <section {...target} className="rfx-registry" aria-label="Reflex registry">
        {counts.length > 1 ? (
          <div className="rfx-filter" role="group" aria-label="Filter by lifecycle status">
            {counts.map((entry) => (
              <button
                key={entry.status}
                type="button"
                className="rfx-filter__btn"
                aria-pressed={filter === entry.status}
                data-tone={entry.status === 'all' ? undefined : REFLEX_STATUS[entry.status].tone}
                onClick={() => {
                  setFilter(entry.status);
                }}
              >
                {entry.status === 'all' ? 'All' : REFLEX_STATUS[entry.status].label}
                <span className="rfx-filter__count num">{entry.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div data-testid="reflex-table">
          <DataTable
            caption="Reflexes and their lifecycle status"
            columns={columns}
            rows={rows}
            getRowId={(row) => row.reflex.reflexId}
            loading={reflexes.isPending}
            error={reflexes.error}
            onRetry={() => {
              void reflexes.refetch();
            }}
            onSelect={(row) => {
              void navigate(reflexPath(row.primary.id));
            }}
            maxHeight="none"
            empty={
              filter === 'all' ? (
                <EmptyState
                  title="No Reflex has been compiled yet"
                  description="A Reflex is compiled from a recurring task family. Open Learn, discover the family, then align the traces and compile a candidate."
                  action={
                    <ButtonLink to={learnPath()} variant="primary">
                      Open Learn
                    </ButtonLink>
                  }
                />
              ) : (
                <EmptyState
                  compact
                  title={`No Reflex has a ${REFLEX_STATUS[filter].label.toLowerCase()} version`}
                  description="Pick another status, or show all Reflexes."
                />
              )
            }
          />
        </div>
      </section>

      <details className="rfx-legend" open>
        <summary>How a Reflex earns trust, and loses it</summary>
        <ol className="rfx-legend__list">
          {(
            [
              'candidate',
              'replay',
              'shadow',
              'approval',
              'active',
              'watch',
              'recompile',
              'deprecated',
            ] as const
          ).map((status) => (
            <li key={status}>
              <StatusChip status={status} />
              <span>{REFLEX_STATUS[status].description}</span>
            </li>
          ))}
        </ol>
        <p className="rfx-legend__note">
          Promotion from awaiting approval to active is always a human decision (reviewer or admin).
          The server checks the role, the evidence gate and the content hash. Drift sends an active
          Reflex back to Shadow automatically; a mutation is proposed, never activated without a
          reviewer.
        </p>
      </details>
    </Page>
  );
}
