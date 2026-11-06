import { Stamp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useApprovals } from '../../api/hooks';
import type { ApprovalRecord } from '../../api/types';
import { useNow } from '../../hooks/useNow';
import { reflexPath } from '../../routes';
import {
  ButtonLink,
  Chip,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  type Tone,
  formatTimestamp,
  relativeTime,
  shortHash,
} from '../../ui';

const DECISIONS: Record<string, { label: string; tone: Tone; dashed: boolean }> = {
  promote: { label: 'Promoted', tone: 'jade', dashed: false },
  reject: { label: 'Returned to shadow', tone: 'amber', dashed: false },
  rollback: { label: 'Rolled back', tone: 'crimson', dashed: false },
  approve_mutation: { label: 'Mutation approved into shadow', tone: 'ember', dashed: true },
};

const decisionOf = (action: string) =>
  DECISIONS[action] ?? {
    label: action.replaceAll('_', ' '),
    tone: 'neutral' as const,
    dashed: false,
  };

/** Human decisions on Reflexes: who approved, rejected or rolled back what, and the evidence they saw. */
export function ApprovalsTab() {
  const query = useApprovals();
  const now = useNow();
  const [selected, setSelected] = useState<ApprovalRecord | null>(null);
  const rows = query.data?.approvals;

  const columns: Column<ApprovalRecord>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (row) => (
        <time dateTime={row.createdAt} title={formatTimestamp(row.createdAt)} className="nowrap">
          {relativeTime(row.createdAt, now)}
        </time>
      ),
      width: 110,
    },
    {
      id: 'decision',
      header: 'Decision',
      cell: (row) => {
        const decision = decisionOf(row.action);
        return (
          <Chip tone={decision.tone} variant="outline" dashed={decision.dashed} size="sm">
            {decision.label}
          </Chip>
        );
      },
    },
    { id: 'actor', header: 'Decided by', cell: (row) => row.actorName },
    {
      id: 'version',
      header: 'Reflex version',
      cell: (row) => <span className="mono">{shortHash(row.reflexVersionId, 14)}</span>,
      hideOnMobile: true,
    },
    {
      id: 'comment',
      header: 'Comment',
      cell: (row) => <span className="gov-summary">{row.comment || '\u2014'}</span>,
    },
  ];

  return (
    <div className="gov-tab">
      <p className="gov-lede">
        Promotion, rejection, rollback and mutation approval are human decisions. Each one records
        the reviewer, the comment and the evidence they were shown.
      </p>
      <DataTable
        caption="Human decisions on Reflexes, newest first"
        columns={columns}
        rows={query.isPending ? undefined : rows}
        getRowId={(row) => row.id}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
        loading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => {
          void query.refetch();
        }}
        empty={
          <EmptyState
            compact
            icon={<Stamp size={16} />}
            title="No decisions recorded yet"
            description="Nothing has been promoted, rejected or rolled back. A reviewer promotes a Reflex from its page once the evidence gate is met."
            action={<ButtonLink to="/reflexes">Open Reflexes</ButtonLink>}
          />
        }
        maxHeight="min(62dvh, 640px)"
      />
      <Drawer
        open={selected !== null}
        onClose={() => {
          setSelected(null);
        }}
        title={selected ? decisionOf(selected.action).label : ''}
        description={
          selected ? `${selected.actorName} · ${formatTimestamp(selected.createdAt)}` : undefined
        }
      >
        {selected ? (
          <div className="gov-event">
            <dl className="gov-event__facts">
              <div>
                <dt className="micro">Reflex version</dt>
                <dd>
                  <Link to={reflexPath(selected.reflexVersionId)} className="mono">
                    {selected.reflexVersionId}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="micro">Comment</dt>
                <dd>{selected.comment || 'No comment was left.'}</dd>
              </div>
            </dl>
            <section aria-labelledby="approval-evidence">
              <h3 id="approval-evidence" className="gov-event__heading">
                Evidence at the time
              </h3>
              <pre className="gov-json" tabIndex={0} aria-label="Evidence as JSON">
                {JSON.stringify(selected.evidence, null, 2)}
              </pre>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
