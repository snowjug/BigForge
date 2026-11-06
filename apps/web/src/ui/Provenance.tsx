import { CircleCheck, FlaskConical, RotateCcw, Sigma, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMetricDefinitions } from '../api/hooks';
import { cx } from './cx';
import { PROVENANCE_INFO, type ProvenanceKind, provenanceList } from './provenance';
import { Tooltip } from './Tooltip';

const ICONS: Record<ProvenanceKind, ReactNode> = {
  measured: <CircleCheck size={11} strokeWidth={2.25} />,
  'replay-measured': <RotateCcw size={11} strokeWidth={2.25} />,
  synthetic: <FlaskConical size={11} strokeWidth={2.25} />,
  simulated: <Waves size={11} strokeWidth={2.25} />,
  estimated: <Sigma size={11} strokeWidth={2.25} />,
};

export interface ProvenanceProps {
  kind: ProvenanceKind | readonly ProvenanceKind[];
  /**
   * A metric id from `GET /api/metrics/definitions` (for example `tokens_per_task`). Its definition,
   * source and limitation are appended to the tooltip.
   */
  metric?: string;
  className?: string;
}

function ProvenanceBadge({ kind, metric }: { kind: ProvenanceKind; metric?: string }) {
  const info = PROVENANCE_INFO[kind];
  const { data: definitions } = useMetricDefinitions(Boolean(metric));
  const definition = metric ? definitions?.[metric] : undefined;
  const tip = (
    <div className="bf-prov-tip">
      <p className="bf-prov-tip__head">
        <span className="micro" data-tone={info.tone}>
          {info.label}
        </span>
      </p>
      <p>{info.summary}</p>
      {definition ? (
        <div className="bf-prov-tip__def">
          <p className="bf-prov-tip__label">{definition.label}</p>
          <p>{definition.definition}</p>
          <p className="faint">Source: {definition.source}</p>
          {definition.formula ? <p className="mono faint">{definition.formula}</p> : null}
          {definition.limitations ? (
            <p className="faint">Limitation: {definition.limitations}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <Tooltip content={tip} side="top" align="start">
      <button
        type="button"
        data-tone={info.tone}
        data-pattern={info.pattern}
        className="bf-prov"
        aria-label={`${info.label} value. ${info.summary}`}
      >
        <span className="bf-prov__icon" aria-hidden="true">
          {ICONS[kind]}
        </span>
        {info.label}
      </button>
    </Tooltip>
  );
}

/**
 * The provenance badge: a number is never shown without one when it is a measurement or an estimate.
 * Pass several kinds for a composite figure so every component's provenance stays visible.
 * The five kinds are drawn differently (lock, solid outline, dashed, hatched, replay) as well as coloured.
 */
export function Provenance({ kind, metric, className }: ProvenanceProps) {
  const kinds = provenanceList(kind);
  if (kinds.length === 0) return null;
  return (
    <span className={cx('bf-prov-group', className)}>
      {kinds.map((entry) => (
        <ProvenanceBadge key={entry} kind={entry} {...(metric ? { metric } : {})} />
      ))}
    </span>
  );
}
