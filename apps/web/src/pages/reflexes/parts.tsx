import type { GateResult, TrustWindow } from '@bigforge/schemas';
import { CircleCheck, CircleX, Lock, TriangleAlert } from 'lucide-react';
import { Chip, Provenance, formatPct, shortHash } from '../../ui';
import { summariseGate } from './gate';

/** Confidence as a point estimate with its trust interval, as a labelled meter. */
export function ConfidenceBar({
  trust,
  showText = true,
  withProvenance = false,
}: {
  trust: TrustWindow;
  showText?: boolean;
  withProvenance?: boolean;
}) {
  const { confidence, interval, n } = trust;
  if (n === 0) return <span className="rfx-conf__text">No comparisons yet</span>;
  const text = `${formatPct(confidence, { digits: 0 })}. ${formatPct(interval.low, { digits: 0 })} to ${formatPct(interval.high, { digits: 0 })} interval from ${n} ${n === 1 ? 'comparison' : 'comparisons'}.`;
  return (
    <div className="rfx-conf">
      <div
        className="rfx-conf__bar"
        role="meter"
        aria-label="Reflex confidence"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={confidence}
        aria-valuetext={text}
      >
        <span
          className="rfx-conf__band"
          style={{
            left: `${interval.low * 100}%`,
            width: `${Math.max(1, (interval.high - interval.low) * 100)}%`,
          }}
        />
        <span className="rfx-conf__tick" style={{ left: `${confidence * 100}%` }} />
      </div>
      <span className="rfx-conf__value num">{formatPct(confidence, { digits: 0 })}</span>
      {showText ? (
        <span className="rfx-conf__text num">
          {formatPct(interval.low, { digits: 0 })} to {formatPct(interval.high, { digits: 0 })} · n=
          {n}
        </span>
      ) : null}
      {withProvenance ? <Provenance kind="estimated" metric="reflex_confidence" /> : null}
    </div>
  );
}

/** The content-hash integrity check as a chip: verified (lock) or failed (alert), with the short hash. */
export function IntegrityChip({
  integrity,
}: {
  integrity: { ok: boolean; expected: string; actual: string };
}) {
  return (
    <Chip
      data-testid="integrity-chip"
      data-ok={integrity.ok}
      tone={integrity.ok ? 'jade' : 'crimson'}
      variant="outline"
      icon={integrity.ok ? <Lock size={12} /> : <TriangleAlert size={12} />}
      title={
        integrity.ok
          ? `The specification hashes to the recorded content hash.\nsha256 ${integrity.actual}`
          : `The specification does not match its recorded hash.\nexpected ${integrity.expected}\nactual   ${integrity.actual}`
      }
    >
      {integrity.ok ? 'Integrity verified' : 'Integrity check failed'}
      <span className="mono rfx-integrity__hash">{shortHash(integrity.actual, 8)}</span>
    </Chip>
  );
}

/**
 * The promotion gate as a checklist: what each check requires, what the Reflex has, and what is still
 * missing. Server-evaluated; this only presents it.
 */
export function GateChecklist({
  gate,
  variant = 'full',
}: {
  gate: GateResult;
  variant?: 'full' | 'compact';
}) {
  const summary = summariseGate(gate);
  return (
    <div
      className="rfx-gate"
      data-testid="gate-checklist"
      data-eligible={gate.eligible}
      data-variant={variant}
    >
      <p className="rfx-gate__headline" role="status">
        {gate.eligible ? (
          <CircleCheck size={16} aria-hidden="true" />
        ) : (
          <CircleX size={16} aria-hidden="true" />
        )}
        <span>
          <strong className="num">
            {summary.passed} of {summary.total}
          </strong>{' '}
          checks passed. {gate.eligible ? 'A reviewer may promote it.' : summary.headline}
        </span>
      </p>
      <div className="rfx-table-wrap" tabIndex={0} role="region" aria-label="Promotion gate checks">
        <table className="rfx-table">
          <caption className="sr-only">
            Promotion gate: required against actual for each check
          </caption>
          <thead>
            <tr>
              <th scope="col">Result</th>
              <th scope="col">Check</th>
              <th scope="col">Required</th>
              <th scope="col">Actual</th>
            </tr>
          </thead>
          <tbody>
            {gate.checks.map((check) => (
              <tr key={check.id} data-passed={check.passed}>
                <td>
                  <span className="rfx-gate__result" data-passed={check.passed}>
                    {check.passed ? (
                      <CircleCheck size={15} aria-hidden="true" />
                    ) : (
                      <CircleX size={15} aria-hidden="true" />
                    )}
                    {check.passed ? 'Pass' : 'Open'}
                  </span>
                </td>
                <th scope="row">{check.label}</th>
                <td className="mono num">{check.required}</td>
                <td className="mono num">{check.actual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {variant === 'full' && summary.missing.length > 0 ? (
        <div className="rfx-gate__missing">
          <p className="micro">Still missing for promotion</p>
          <ul>
            {summary.missing.map((gap) => (
              <li key={gap.check.id}>{gap.gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
