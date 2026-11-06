import type { Comparison, RunDetailDto } from '@bigforge/schemas';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartLine,
  CircleCheck,
  CircleX,
  Equal,
  OctagonX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useSystem } from '../../api/hooks';
import { economicsPath, runPath } from '../../routes';
import {
  ButtonLink,
  Chip,
  Provenance,
  type ProvenanceKind,
  formatMs,
  formatPct,
  formatTimestamp,
  formatTokens,
  formatUsd,
  plural,
} from '../../ui';

const unique = (kinds: readonly ProvenanceKind[]): ProvenanceKind[] => [...new Set(kinds)];

function Delta({
  value,
  format,
  goodWhen,
}: {
  value: number;
  format: (abs: number) => string;
  goodWhen: 'down' | 'none';
}) {
  if (value === 0) {
    return (
      <span className="run-delta" data-sentiment="neutral">
        <Equal size={13} aria-hidden="true" /> no change
      </span>
    );
  }
  const down = value < 0;
  const sentiment = goodWhen === 'down' ? (down ? 'good' : 'bad') : 'neutral';
  return (
    <span className="run-delta num" data-sentiment={sentiment}>
      {down ? (
        <ArrowDownRight size={13} aria-hidden="true" />
      ) : (
        <ArrowUpRight size={13} aria-hidden="true" />
      )}
      {down ? '\u2212' : '+'}
      {format(Math.abs(value))}
      <span className="sr-only">{down ? ' (fewer)' : ' (more)'}</span>
    </span>
  );
}

export interface ComparisonPanelProps {
  comparison: Comparison;
  baseline: RunDetailDto;
  reflex: RunDetailDto;
}

/** Baseline against Reflex on the same task: did they agree, and what did the difference cost? */
export function ComparisonPanel({ comparison, baseline, reflex }: ComparisonPanelProps) {
  const system = useSystem();
  const b = baseline.usage;
  const r = reflex.usage;
  const d = comparison.deltas;
  const pricing = system.data?.pricing;
  const tokenShare = b.totalTokens > 0 ? Math.abs(d.tokens) / b.totalTokens : null;
  // A smaller number is only a saving when both runs reached the same result.
  const saved = comparison.agree;

  const metricRows: {
    id: string;
    label: string;
    baseline: ReactNode;
    reflex: ReactNode;
    delta: ReactNode;
    provenance: ProvenanceKind[];
    metric: string;
  }[] = [
    {
      id: 'calls',
      label: 'Model calls',
      baseline: b.modelCalls,
      reflex: r.modelCalls,
      delta: (
        <Delta
          value={d.modelCalls}
          format={(abs) => String(abs)}
          goodWhen={saved ? 'down' : 'none'}
        />
      ),
      provenance: unique([b.tokenProvenance, r.tokenProvenance]),
      metric: 'model_calls',
    },
    {
      id: 'tokens',
      label: 'Tokens',
      baseline: formatTokens(b.totalTokens),
      reflex: formatTokens(r.totalTokens),
      delta: <Delta value={d.tokens} format={formatTokens} goodWhen={saved ? 'down' : 'none'} />,
      provenance: unique([b.tokenProvenance, r.tokenProvenance]),
      metric: 'tokens_per_task',
    },
    {
      id: 'cost',
      label: 'Cost',
      baseline: formatUsd(b.costUsd),
      reflex: formatUsd(r.costUsd),
      delta: (
        <Delta
          value={d.costUsd}
          format={(abs) => formatUsd(abs)}
          goodWhen={saved ? 'down' : 'none'}
        />
      ),
      provenance: unique([b.costProvenance, r.costProvenance]),
      metric: 'cost_usd',
    },
    {
      id: 'commands',
      label: 'Commands run',
      baseline: b.commands,
      reflex: r.commands,
      delta: <Delta value={d.commands} format={(abs) => String(abs)} goodWhen="none" />,
      provenance: ['measured'],
      metric: 'commands',
    },
    {
      id: 'latency',
      label: 'Model latency',
      baseline: formatMs(b.modelLatencyMs),
      reflex: formatMs(r.modelLatencyMs),
      delta: (
        <Delta value={d.modelLatencyMs} format={formatMs} goodWhen={saved ? 'down' : 'none'} />
      ),
      provenance: unique([b.modelLatencyProvenance, r.modelLatencyProvenance]),
      metric: 'model_latency',
    },
    {
      id: 'local',
      label: 'Local time',
      baseline: formatMs(b.localMs),
      reflex: formatMs(r.localMs),
      delta: <Delta value={d.localMs} format={formatMs} goodWhen="none" />,
      provenance: unique([b.localMsProvenance, r.localMsProvenance]),
      metric: 'local_time',
    },
  ];

  return (
    <div className="run-compare">
      <div className="run-compare__hero">
        <div className="run-compare__verdict" data-agree={comparison.agree ? 'true' : 'false'}>
          <Chip
            tone={comparison.agree ? 'jade' : 'crimson'}
            variant="soft"
            icon={comparison.agree ? <CircleCheck size={13} /> : <CircleX size={13} />}
          >
            {comparison.agree ? 'Same result' : 'Different result'}
          </Chip>
          <p className="dim">
            {comparison.agree
              ? 'Both reached the same outcome, root cause and final files, and both passed the same independent verifier.'
              : 'They did not reach the same result, so the differences below are not savings. See where they diverged.'}
          </p>
        </div>
        <ul className="run-compare__stats">
          <li>
            <span className="micro">Model calls</span>
            <span
              className="run-compare__big num"
              data-good={saved && d.modelCalls < 0 ? 'true' : undefined}
            >
              {d.modelCalls === 0
                ? '0'
                : `${d.modelCalls < 0 ? '\u2212' : '+'}${Math.abs(d.modelCalls)}`}
            </span>
            <Provenance
              kind={unique([b.tokenProvenance, r.tokenProvenance])}
              metric="model_calls"
            />
          </li>
          <li>
            <span className="micro">Tokens</span>
            <span
              className="run-compare__big num"
              data-good={saved && d.tokens < 0 ? 'true' : undefined}
            >
              {d.tokens === 0
                ? '0'
                : `${d.tokens < 0 ? '\u2212' : '+'}${formatTokens(Math.abs(d.tokens))}`}
            </span>
            <span className="dim">
              {tokenShare !== null ? `${formatPct(tokenShare, { digits: 1 })} of the baseline` : ''}
            </span>
            <Provenance
              kind={unique([b.tokenProvenance, r.tokenProvenance])}
              metric="tokens_per_task"
            />
          </li>
          <li>
            <span className="micro">Model latency</span>
            <span
              className="run-compare__big num"
              data-good={saved && d.modelLatencyMs < 0 ? 'true' : undefined}
            >
              {d.modelLatencyMs === 0
                ? '0 ms'
                : `${d.modelLatencyMs < 0 ? '\u2212' : '+'}${formatMs(Math.abs(d.modelLatencyMs))}`}
            </span>
            <Provenance
              kind={unique([b.modelLatencyProvenance, r.modelLatencyProvenance])}
              metric="model_latency"
            />
          </li>
        </ul>
      </div>

      {comparison.divergence.kind !== 'none' ? (
        <p className="run-compare__divergence" role="note">
          <strong>Where they diverged:</strong> {comparison.divergence.detail}
          {comparison.divergence.stepId ? ` (step ${comparison.divergence.stepId})` : ''}
        </p>
      ) : null}

      <div
        className="run-table-wrap"
        role="region"
        aria-label="Baseline and Reflex comparison table"
        tabIndex={0}
      >
        <table className="run-table" data-testid="comparison-table">
          <caption className="sr-only">
            Baseline agent against BigForge Reflex on the same task: checks, then costs with their
            provenance
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col" data-side="baseline">
                Baseline agent
              </th>
              <th scope="col" data-side="reflex">
                BigForge Reflex
              </th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            <tr className="run-table__section">
              <th colSpan={4} scope="colgroup">
                Same result?
              </th>
            </tr>
            {comparison.checks.map((check) => (
              <tr key={check.id} data-match={check.match ? 'true' : 'false'}>
                <th scope="row">{check.label}</th>
                <td className="mono">{check.baseline}</td>
                <td className="mono">{check.reflex}</td>
                <td>
                  <span className="run-match-cell" data-match={check.match ? 'true' : 'false'}>
                    {check.match ? (
                      <CircleCheck size={14} aria-hidden="true" />
                    ) : (
                      <CircleX size={14} aria-hidden="true" />
                    )}
                    {check.match ? 'match' : 'mismatch'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tbody>
            <tr className="run-table__section">
              <th colSpan={4} scope="colgroup">
                What it cost: difference is Reflex minus baseline, with each figure&rsquo;s
                provenance
              </th>
            </tr>
            {metricRows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                <td className="mono num">{row.baseline}</td>
                <td className="mono num">{row.reflex}</td>
                <td>
                  <span className="run-cost-cell">
                    {row.delta}
                    <Provenance kind={row.provenance} metric={row.metric} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="run-compare__note faint">
        Tokens are synthetic (deterministic provider), model latency is simulated, command time is
        measured.
        {pricing
          ? ` Cost uses a price assumption (${pricing.id}, assumed ${formatTimestamp(pricing.assumedAt).slice(0, 10)}): ${pricing.note}`
          : ''}
      </p>
      <div className="run-compare__links">
        <ButtonLink to={economicsPath()} icon={<ChartLine size={14} />}>
          See cumulative economics
        </ButtonLink>
        <span className="faint">
          One run saves tokens; Cognitive Economics shows what earning that saving cost.
        </span>
      </div>
    </div>
  );
}

export interface FallbackStoryProps {
  stopped: RunDetailDto;
  fallback: RunDetailDto | null;
  pending: boolean;
}

/** A Reflex that stops does not improvise: the baseline agent takes over. */
export function FallbackStory({ stopped, fallback, pending }: FallbackStoryProps) {
  const exec = stopped.exec;
  const step = exec?.stopStepId ?? 'a step';
  return (
    <div className="run-fallback" data-testid="fallback-story">
      <ol className="run-fallback__steps">
        <li data-tone="amber">
          <span className="run-fallback__n" aria-hidden="true">
            1
          </span>
          <div>
            <p className="run-fallback__t">
              <OctagonX size={15} aria-hidden="true" />
              <span>
                The Reflex stopped at <span className="mono">{step}</span>
              </span>
            </p>
            <p className="dim">{exec?.stopReason ?? stopped.outcomeSummary}</p>
          </div>
        </li>
        <li data-tone="steel">
          <span className="run-fallback__n" aria-hidden="true">
            2
          </span>
          <div>
            <p className="run-fallback__t">
              <span>Nothing was guessed</span>
            </p>
            <p className="dim">
              No patch was applied and independent verification is{' '}
              <strong>{stopped.verification}</strong>. The stop condition is a guard, not an error.
            </p>
          </div>
        </li>
        <li data-tone={fallback ? 'jade' : 'ash'}>
          <span className="run-fallback__n" aria-hidden="true">
            3
          </span>
          <div>
            <p className="run-fallback__t">
              {fallback
                ? 'The baseline agent took over'
                : pending
                  ? 'Looking for the fallback run'
                  : 'No fallback run was recorded'}
            </p>
            {fallback ? (
              <p className="dim">
                It {fallback.status === 'success' ? 'solved the task' : `ended ${fallback.status}`}{' '}
                with verification <strong>{fallback.verification}</strong>, using{' '}
                {plural(fallback.usage.modelCalls, 'model call')} and{' '}
                {formatTokens(fallback.usage.totalTokens)} tokens (synthetic).{' '}
                <Link to={runPath({ task: fallback.taskId, run: fallback.id })}>
                  Open the fallback run
                </Link>
              </p>
            ) : (
              <p className="dim">
                Only runs started from this console hand over to the baseline agent automatically.
              </p>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
}
