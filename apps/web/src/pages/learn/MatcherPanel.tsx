import type { MatcherEvaluation } from '@bigforge/schemas';
import { CircleCheck } from 'lucide-react';
import { ErrorState, Metric, Provenance, Skeleton, formatCount, formatPct } from '../../ui';
import { matcherFigures } from './familyView';

interface MatcherPanelProps {
  evaluation: MatcherEvaluation | null | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  hasFamily: boolean;
}

/**
 * Matcher quality, shown honestly: the false-match rate is a first-class metric, measured on a labelled
 * synthetic corpus. It demonstrates the mechanism; it is not a general rate (docs/METRICS.md).
 */
export function MatcherPanel({
  evaluation,
  loading,
  error,
  onRetry,
  hasFamily,
}: MatcherPanelProps) {
  const figures = evaluation ? matcherFigures(evaluation) : null;
  return (
    <section
      className="learn-matcher"
      data-testid="matcher-eval"
      aria-labelledby="learn-matcher-title"
    >
      <header className="learn-matcher__head">
        <div>
          <h2 id="learn-matcher-title" className="learn-h2">
            Matcher quality
          </h2>
          <p className="learn-sub">
            When a new task arrives, how often does the matcher wrongly claim it belongs to this
            family?
          </p>
        </div>
        <Provenance kind={['measured', 'synthetic']} metric="false_match_rate" />
      </header>

      {error !== undefined && error !== null ? (
        <ErrorState compact title="Could not measure the matcher" error={error} onRetry={onRetry} />
      ) : loading ? (
        <div
          className="learn-matcher__metrics"
          role="status"
          aria-busy="true"
          aria-label="Measuring the matcher on its labelled corpus"
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="learn-matcher__skeleton">
              <Skeleton width="40%" height={11} />
              <Skeleton width="55%" height={28} />
              <Skeleton width="80%" height={11} />
            </div>
          ))}
        </div>
      ) : !figures ? (
        <p className="learn-note">
          {hasFamily
            ? 'The matcher has not been measured yet.'
            : 'The matcher is measured as soon as a family exists: its centroid is what out-of-family tasks are compared against.'}
        </p>
      ) : (
        <>
          <div className="learn-matcher__metrics">
            <Metric
              label="False-match rate"
              size="lg"
              value={formatPct(figures.falseMatchRate, { digits: 1 })}
              provenance={['measured', 'synthetic']}
              definition="false_match_rate"
              tone={figures.falseMatches === 0 ? 'jade' : 'crimson'}
              hint={`${figures.falseMatches} of ${figures.negatives} out-of-family tasks matched the family`}
            />
            <Metric
              label="Recall"
              size="lg"
              value={formatPct(figures.recall, { digits: 1 })}
              provenance={['measured', 'synthetic']}
              hint={`${figures.truePositives} of ${figures.positives} in-family tasks recognised`}
            />
            <Metric
              label="Labelled corpus"
              size="lg"
              value={formatCount(figures.corpusSize)}
              unit="tasks"
              provenance="synthetic"
              hint={`${figures.positives} lab tasks in the family, ${figures.negatives} hand-written tasks outside it`}
            />
            <Metric
              label="Match threshold"
              size="lg"
              value={figures.threshold.toFixed(2)}
              provenance="none"
              hint="Every hard gate must pass and similarity must reach this score"
            />
          </div>
          {figures.clean ? (
            <p className="learn-note learn-note--ok">
              <CircleCheck size={15} aria-hidden="true" /> No misses and no false matches on this
              corpus. It demonstrates the mechanism; it is not a general false-match rate.
            </p>
          ) : (
            <div className="learn-matcher__misses">
              {evaluation && evaluation.falseMatchExamples.length > 0 ? (
                <div>
                  <p className="micro">False matches</p>
                  <ul>
                    {evaluation.falseMatchExamples.map((x) => (
                      <li key={x.label}>
                        {x.label} <span className="mono num faint">{x.score.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {evaluation && evaluation.misses.length > 0 ? (
                <div>
                  <p className="micro">Missed in-family tasks</p>
                  <ul>
                    {evaluation.misses.map((x) => (
                      <li key={x.label}>
                        {x.label} <span className="mono num faint">{x.score.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
