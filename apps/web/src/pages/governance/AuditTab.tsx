import type { AuditEventDto } from '@bigforge/schemas';
import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../api/client';
import { flattenPages, useInfiniteAudit } from '../../api/hooks';
import { useNow } from '../../hooks/useNow';
import {
  Button,
  Chip,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  formatCount,
  formatTimestamp,
  relativeTime,
} from '../../ui';
import { actionOptions, actionTone, subjectLink } from './audit';
import { CopyButton } from './CopyButton';

const PAGE_SIZE = 25;

function HashBlock({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="gov-hash">
      <div className="gov-hash__head">
        <span className="micro">{label}</span>
        <CopyButton text={hash} label={label} />
      </div>
      <p className="gov-hash__value mono">{hash}</p>
    </div>
  );
}

function EventDetail({ event }: { event: AuditEventDto }) {
  const link = subjectLink(event.subjectType, event.subjectId);
  const genesis = /^0+$/.test(event.prevHash);
  const details = JSON.stringify(event.details, null, 2);
  return (
    <div className="gov-event">
      <dl className="gov-event__facts">
        <div>
          <dt className="micro">When (UTC)</dt>
          <dd className="mono">{formatTimestamp(event.createdAt)}</dd>
        </div>
        <div>
          <dt className="micro">Actor</dt>
          <dd>{event.actor}</dd>
        </div>
        <div>
          <dt className="micro">Action</dt>
          <dd>
            <Chip tone={actionTone(event.action)} size="sm" mono>
              {event.action}
            </Chip>
          </dd>
        </div>
        <div>
          <dt className="micro">Subject</dt>
          <dd>
            {event.subjectType}{' '}
            {link ? (
              <Link to={link} className="mono">
                {event.subjectId}
              </Link>
            ) : (
              <span className="mono">{event.subjectId}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="micro">Event id</dt>
          <dd className="mono">{event.id}</dd>
        </div>
      </dl>

      <section aria-labelledby="chain-links">
        <h3 id="chain-links" className="gov-event__heading">
          Hash chain
        </h3>
        <p className="gov-event__explain">
          hash = SHA-256 of the previous hash, a newline and the canonical JSON of this event.
          {genesis
            ? ' This is the first event, so its previous hash is the genesis value (all zeros).'
            : ''}
        </p>
        <HashBlock label="Previous hash" hash={event.prevHash} />
        <HashBlock label="This event’s hash" hash={event.hash} />
      </section>

      <section aria-labelledby="event-details">
        <h3 id="event-details" className="gov-event__heading">
          Details
        </h3>
        <pre className="gov-json" tabIndex={0} aria-label="Event details as JSON">
          {details}
        </pre>
      </section>
    </div>
  );
}

/** The audit log: filter by action, load more by cursor, inspect any event with its hash links. */
export function AuditTab() {
  const [action, setAction] = useState('');
  const [selected, setSelected] = useState<AuditEventDto | null>(null);
  const now = useNow();
  const query = useInfiniteAudit(action ? { action, limit: PAGE_SIZE } : { limit: PAGE_SIZE });
  const events = flattenPages(query.data);
  const total = query.data?.pages[0]?.total;
  const options = useMemo(() => actionOptions(events.map((event) => event.action)), [events]);

  const columns: Column<AuditEventDto>[] = [
    { id: 'seq', header: '#', cell: (event) => event.seq, mono: true, align: 'end', width: 64 },
    {
      id: 'when',
      header: 'When',
      cell: (event) => (
        <time
          dateTime={event.createdAt}
          title={formatTimestamp(event.createdAt)}
          className="nowrap"
        >
          {relativeTime(event.createdAt, now)}
        </time>
      ),
      width: 110,
      hideOnMobile: true,
    },
    {
      id: 'action',
      header: 'Action',
      cell: (event) => (
        <Chip tone={actionTone(event.action)} size="sm" mono>
          {event.action}
        </Chip>
      ),
      hideOnMobile: true,
    },
    { id: 'actor', header: 'Actor', cell: (event) => event.actor, hideOnMobile: true },
    {
      id: 'subject',
      header: 'Subject',
      cell: (event) => <span className="gov-subject mono">{event.subjectType}</span>,
      hideOnMobile: true,
    },
    {
      id: 'summary',
      header: 'Summary',
      cell: (event) => (
        <>
          <span className="gov-meta-mobile">
            <Chip tone={actionTone(event.action)} size="sm" mono>
              {event.action}
            </Chip>
            <time dateTime={event.createdAt} title={formatTimestamp(event.createdAt)}>
              {relativeTime(event.createdAt, now)}
            </time>
          </span>
          <span className="gov-summary">{event.summary}</span>
        </>
      ),
    },
  ];

  const shown = events.length;
  const footer = (
    <>
      <span aria-live="polite">
        {action
          ? `${formatCount(shown)} matching ${shown === 1 ? 'event' : 'events'} loaded${query.hasNextPage ? ', more available' : ''}`
          : `Showing ${formatCount(shown)} of ${total === undefined ? '\u2014' : formatCount(total)} events`}
      </span>
      {query.hasNextPage ? (
        <Button
          loading={query.isFetchingNextPage}
          data-testid="audit-load-more"
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          Load more
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="gov-tab">
      <div className="gov-filter">
        <Field label="Filter by action">
          {(control) => (
            <select
              {...control}
              className="bf-select"
              data-testid="audit-filter"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
              }}
            >
              <option value="">All actions</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
        {action ? (
          <Button
            onClick={() => {
              setAction('');
            }}
          >
            Clear filter
          </Button>
        ) : null}
      </div>

      <DataTable
        caption="Audit events, newest first"
        columns={columns}
        rows={query.isPending ? undefined : events}
        getRowId={(event) => String(event.seq)}
        selectedId={selected ? String(selected.seq) : null}
        onSelect={setSelected}
        loading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => {
          void query.refetch();
        }}
        empty={
          <EmptyState
            compact
            icon={<ScrollText size={16} />}
            title={action ? `No ${action} events yet` : 'No audit events yet'}
            description={
              action
                ? 'Try another action, or clear the filter.'
                : 'Every sign-in, run, promotion and setting change appends an event here.'
            }
          />
        }
        footer={footer}
        maxHeight="min(62dvh, 640px)"
      />

      <Drawer
        open={selected !== null}
        onClose={() => {
          setSelected(null);
        }}
        title={selected ? `Event #${selected.seq}` : ''}
        description={selected?.summary}
      >
        {selected ? <EventDetail event={selected} /> : null}
      </Drawer>
      {query.isError && events.length > 0 ? (
        <p role="alert" className="gov-error">
          {errorMessage(query.error)}
        </p>
      ) : null}
    </div>
  );
}
