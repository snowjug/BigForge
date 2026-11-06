import type { Provenance as ProvenanceKind, ValidationSummaryDto } from '@bigforge/schemas';
import { Provenance, formatCount, formatMs, formatPct, formatUsd, plural } from '../../ui';
import { reduction } from '../shadow/compare';

const KIND_TITLE: Record<ValidationSummaryDto['kind'], string> = {
  replay: 'Replay of the source traces',
  shadow: 'Shadow Brain on held-out tasks',
  canary: 'Drift Canary',
  live: 'Live executions',
};

interface Row {
  id: string;
  label: string;
  baseline: string;
  reflex: string;
  change: string;
  /** Provenance of the baseline figure and of the Reflex figure. */
  basis: readonly [ProvenanceKind, ProvenanceKind];
}

function change(baseline: number, reflex: number): string {
  const r = reduction(baseline, reflex);
  return r === null
    ? '\u2014'
    : r === 0 && reflex > baseline
      ? 'higher'
      : `${formatPct(-r, { digits: 0 })}`;
}

function rowsOf(summary: ValidationSummaryDto): Row[] {
  const { baseline, reflex } = summary;
  const tokens: [ProvenanceKind, ProvenanceKind] = [baseline.provenance, reflex.provenance];
  const latencyKind: ProvenanceKind =
    baseline.provenance === 'synthetic' ? 'simulated' : 'measured';
  return [
    {
      id: 'tokens',
      label: 'Mean tokens per task',
      baseline: formatCount(baseline.meanTokens),
      reflex: formatCount(reflex.meanTokens),
      change: change(baseline.meanTokens, reflex.meanTokens),
      basis: tokens,
    },
    {
      id: 'calls',
      label: 'Mean model calls',
      baseline: String(baseline.meanModelCalls),
      reflex: String(reflex.meanModelCalls),
      change: change(baseline.meanModelCalls, reflex.meanModelCalls),
      basis: tokens,
    },
    {
      id: 'cost',
      label: 'Mean model cost',
      baseline: formatUsd(baseline.meanCostUsd),
      reflex: formatUsd(reflex.meanCostUsd),
      change: change(baseline.meanCostUsd, reflex.meanCostUsd),
      basis: tokens,
    },
    {
      id: 'commands',
      label: 'Mean commands run',
      baseline: String(baseline.meanCommands),
      reflex: String(reflex.meanCommands),
      change: change(baseline.meanCommands, reflex.meanCommands),
      basis: ['measured', 'measured'],
    },
    {
      id: 'latency',
      label: 'Time: model latency (baseline) · local run (Reflex)',
      baseline: formatMs(baseline.meanModelLatencyMs),
      reflex: formatMs(reflex.meanLocalMs),
      change: '\u2014',
      basis: [latencyKind, 'measured'],
    },
  ];
}

/**
 * Baseline versus Reflex means for one validation kind. Each row carries the provenance of both sides;
 * the two latencies are different measures (simulated model time versus measured local time), so no change
 * is computed for them.
 */
export function ValidationTable({
  summary,
  headingLevel = 4,
}: {
  summary: ValidationSummaryDto;
  headingLevel?: 3 | 4;
}) {
  const Heading = `h${headingLevel}` as const;
  const rows = rowsOf(summary);
  return (
    <div className="rfx-validation" data-kind={summary.kind}>
      <div className="rfx-validation__head">
        <Heading className="rfx-h4">{KIND_TITLE[summary.kind]}</Heading>
        <p className="rfx-validation__stats num">
          {summary.runs === 0 ? (
            'No runs yet'
          ) : (
            <>
              <strong>
                {summary.agreements} of {summary.runs}
              </strong>{' '}
              agree ({formatPct(summary.agreement, { digits: 1 })}) ·{' '}
              {plural(summary.distinctVariants, 'variant')} ·{' '}
              {plural(summary.safetyViolations, 'safety violation')}
            </>
          )}
        </p>
      </div>
      {summary.runs === 0 ? null : (
        <div
          className="rfx-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={`${KIND_TITLE[summary.kind]}: baseline versus Reflex means`}
        >
          <table className="rfx-table">
            <caption className="sr-only">
              Mean baseline and Reflex figures over {summary.runs} runs
            </caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="rfx-table__end">
                  Baseline agent
                </th>
                <th scope="col" className="rfx-table__end">
                  Reflex
                </th>
                <th scope="col" className="rfx-table__end">
                  Change
                </th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  <td className="rfx-table__end mono num">{row.baseline}</td>
                  <td className="rfx-table__end mono num">{row.reflex}</td>
                  <td className="rfx-table__end mono num">{row.change}</td>
                  <td>
                    {row.basis[0] === row.basis[1] ? (
                      <Provenance kind={row.basis[0]} />
                    ) : (
                      <span className="rfx-basis">
                        <span className="rfx-basis__side">
                          <span className="faint">baseline</span> <Provenance kind={row.basis[0]} />
                        </span>
                        <span className="rfx-basis__side">
                          <span className="faint">Reflex</span> <Provenance kind={row.basis[1]} />
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
