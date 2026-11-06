import type { ReflexVersionDto } from '@bigforge/schemas';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import { useSystem } from '../../../api/hooks';
import { shadowPath } from '../../../routes';
import {
  Chip,
  Sparkline,
  StatusChip,
  Summary,
  formatPct,
  formatTimestamp,
  plural,
} from '../../../ui';
import { TRANSITION_RULES, eventLabel } from '../lifecycle';
import { GateChecklist } from '../parts';
import { StatusRibbon } from '../StatusRibbon';
import { ValidationTable } from '../ValidationTable';

/** Evidence: the promotion gate (required against actual) and every validation kind with provenance. */
export function EvidenceTab({ version }: { version: ReflexVersionDto }) {
  const system = useSystem();
  const { gateConfig } = version;
  return (
    <div className="rfx-tab-stack">
      <section aria-labelledby="rfx-gate-title">
        <h3 id="rfx-gate-title" className="rfx-h3">
          Promotion gate
        </h3>
        <p className="rfx-lead">
          Evaluated on the server at promotion time, together with the role check and the
          content-hash integrity check. Thresholds are configurable defaults, not validated
          recommendations.
        </p>
        <GateChecklist gate={version.gate} />
        <p className="rfx-fine">
          Configured thresholds: replay agreement{' '}
          {formatPct(gateConfig.minReplayAgreement, { digits: 0 })}; at least{' '}
          {gateConfig.minShadowRuns} shadow runs across at least {gateConfig.minDistinctVariants}{' '}
          variants; at most {gateConfig.maxSafetyViolations} safety violations; shadow agreement of
          at least {formatPct(gateConfig.minAgreement, { digits: 0 })}.
        </p>
      </section>

      <section aria-labelledby="rfx-validation-title">
        <div className="rfx-section-head">
          <h3 id="rfx-validation-title" className="rfx-h3">
            Validation evidence
          </h3>
          <Link to={shadowPath({ version: version.id })} className="rfx-inline-link">
            Per-run comparisons in the Shadow Lab <ExternalLink size={13} aria-hidden="true" />
          </Link>
        </div>
        <p className="rfx-lead">
          Baseline and Reflex means over the same tasks. Shadow runs use the held-out shadow
          scenarios on the synthetic lab; the Reflex works on a throwaway copy and never acts on a
          real repository.
        </p>
        <div className="rfx-validations">
          <ValidationTable summary={version.replay} />
          <ValidationTable summary={version.shadow} />
          {version.canary ? <ValidationTable summary={version.canary} /> : null}
        </div>
        {system.data ? (
          <p className="rfx-fine">
            Cost uses the pricing assumption <span className="mono">{system.data.pricing.id}</span>,
            assumed {formatTimestamp(system.data.pricing.assumedAt)}: {system.data.pricing.note}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function isSeeded(evidence: unknown): boolean {
  return (
    typeof evidence === 'object' &&
    evidence !== null &&
    'seeded' in evidence &&
    (evidence as { seeded?: unknown }).seeded === true
  );
}

/** Lifecycle: the state-machine ribbon, the transition timeline, the confidence history and the approvals. */
export function LifecycleTab({ version }: { version: ReflexVersionDto }) {
  const history = version.confidenceHistory;
  const lowest = history.reduce((m, h) => Math.min(m, h.confidence), 1);
  const scaleMin = Math.max(0, Math.floor(lowest * 10) / 10 - 0.1);
  return (
    <div className="rfx-tab-stack">
      <section aria-labelledby="rfx-ribbon-title">
        <h3 id="rfx-ribbon-title" className="rfx-h3">
          Where it is in its lifecycle
        </h3>
        <StatusRibbon status={version.status} transitions={version.transitions} variant="full" />
        <Summary
          label="View the state machine as a table"
          description="Every transition the server allows. Only a reviewer or admin can move a Reflex from approval to active, reject it, or roll it back."
          caption="Lifecycle state machine"
          rows={TRANSITION_RULES}
          getRowId={(r) => `${r.from}-${r.event}`}
          columns={[
            { id: 'from', header: 'From', cell: (r) => <StatusChip status={r.from} size="sm" /> },
            { id: 'event', header: 'Event', cell: (r) => eventLabel(r.event) },
            { id: 'to', header: 'To', cell: (r) => <StatusChip status={r.to} size="sm" /> },
            {
              id: 'who',
              header: 'Who',
              cell: (r) => (r.human ? 'A reviewer or admin' : 'The system'),
            },
          ]}
        />
      </section>

      <section aria-labelledby="rfx-timeline-title">
        <h3 id="rfx-timeline-title" className="rfx-h3">
          Transitions
        </h3>
        {version.transitions.length === 0 ? (
          <p className="dim">No transition has been recorded yet: this version is a candidate.</p>
        ) : (
          <ol className="rfx-timeline">
            {version.transitions.map((t) => (
              <li key={t.id}>
                <time dateTime={t.createdAt} className="rfx-timeline__time mono num">
                  {formatTimestamp(t.createdAt)}
                </time>
                <div className="rfx-timeline__body">
                  <p className="rfx-timeline__move">
                    <StatusChip status={t.fromStatus} size="sm" />
                    <span aria-hidden="true">{'\u2192'}</span>
                    <span className="sr-only">to</span>
                    <StatusChip status={t.toStatus} size="sm" />
                    <strong>{eventLabel(t.event)}</strong>
                  </p>
                  <p className="dim">{t.reason}</p>
                  <p className="faint rfx-timeline__actor">by {t.actor}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="rfx-conf-title">
        <h3 id="rfx-conf-title" className="rfx-h3">
          Confidence over time
        </h3>
        {history.length === 0 ? (
          <p className="dim">
            Confidence is computed from shadow and canary comparisons; there are none yet.
          </p>
        ) : (
          <>
            <div className="rfx-conf-history">
              <Sparkline
                data={history.map((h) => h.confidence)}
                label="Confidence after each shadow or canary comparison"
                width={420}
                height={72}
                min={scaleMin}
                max={1}
                tone={version.confidence >= 0.9 ? 'jade' : 'amber'}
                area
                format={(v) => formatPct(v, { digits: 0 })}
              />
              <p className="rfx-fine num">
                {plural(history.length, 'comparison')}: from{' '}
                {formatPct(history[0]?.confidence ?? 0, { digits: 0 })} to{' '}
                {formatPct(history[history.length - 1]?.confidence ?? 0, { digits: 0 })}. Beta(1,1)
                posterior mean over the most recent 12 comparisons, estimated.
              </p>
            </div>
            <Summary
              label="View confidence history as a table"
              description="Confidence after each shadow or canary comparison, oldest first."
              caption="Confidence history"
              rows={history}
              getRowId={(h) => `${h.at}-${h.label}`}
              columns={[
                { id: 'at', header: 'When', mono: true, cell: (h) => formatTimestamp(h.at) },
                { id: 'what', header: 'Comparison', cell: (h) => h.label },
                {
                  id: 'c',
                  header: 'Confidence',
                  align: 'end',
                  mono: true,
                  cell: (h) => formatPct(h.confidence, { digits: 1 }),
                },
              ]}
            />
          </>
        )}
      </section>

      <section aria-labelledby="rfx-approvals-title">
        <h3 id="rfx-approvals-title" className="rfx-h3">
          Human decisions
        </h3>
        {version.approvals.length === 0 ? (
          <p className="dim">No reviewer has decided on this version yet.</p>
        ) : (
          <ul className="rfx-approvals">
            {version.approvals.map((a) => (
              <li key={a.id}>
                <p>
                  <Chip tone={a.action === 'promote' ? 'jade' : 'ash'} variant="outline">
                    {a.action}
                  </Chip>{' '}
                  <strong>{a.actorName}</strong>
                  {isSeeded(a.evidence) ? (
                    <>
                      {' '}
                      <Chip
                        tone="amber"
                        variant="outline"
                        dashed
                        title="Recorded by the demo fast-forward helper, not by an individual review of the evidence."
                      >
                        Seeded demo approval
                      </Chip>
                    </>
                  ) : null}
                </p>
                <p className="dim">{a.comment || 'No comment.'}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
