import type { EconomicsReport } from '@bigforge/schemas';
import {
  Chip,
  Metric,
  formatCount,
  formatTimestamp,
  formatTokens,
  formatUsd,
  plural,
} from '../../ui';
import {
  type Derived,
  cachingSentence,
  dollarProvenance,
  formatRoi,
  formatRoiRange,
  realizedProvenance,
  savingBasisInfo,
  tokenProvenance,
} from './model';

type MetricTone = 'steel' | 'ember' | undefined;
const toneOf = (roi: number | null): MetricTone =>
  roi === null ? undefined : roi > 0 ? 'steel' : roi < 0 ? 'ember' : undefined;

function RealizedLine({
  label,
  roi,
  detail,
}: {
  label: string;
  roi: number | null;
  detail: string;
}) {
  const text = formatRoi(roi);
  return (
    <div className="econ-roi__realized">
      <span className="micro">{label}</span>
      <span className="econ-roi__realized-value num" data-sign={text.sign}>
        {text.text}
        <span className="sr-only">{`, ${text.words}`}</span>
      </span>
      <span className="econ-roi__realized-detail">{detail}</span>
    </div>
  );
}

/** Token ROI and dollar ROI side by side, each with its realized counterpart and the reason for its size. */
export function RoiPair({ report, derived }: { report: EconomicsReport; derived: Derived }) {
  const { tokens, dollars } = derived;
  const basis = savingBasisInfo(derived.basis);
  const interval = formatRoiRange(tokens.interval);
  const projectedToken = formatRoi(tokens.projectedRoi);
  const projectedDollar = formatRoi(dollars.projectedRoi);
  const caching = cachingSentence(report, derived);
  const live = report.reuse.liveExecutions;
  const tokenTone = toneOf(tokens.projectedRoi);
  const dollarTone = toneOf(dollars.projectedRoi);
  const countedTokenLines = report.investment.lines
    .filter((line) => line.counted && line.tokens > 0)
    .map((line) => line.label.toLowerCase())
    .join(', ');
  const dollarsLag =
    dollars.projectedRoi !== null &&
    tokens.projectedRoi !== null &&
    dollars.projectedRoi < tokens.projectedRoi;

  return (
    <div className="econ-roi-pair">
      <section className="econ-roi" data-testid="econ-roi-token" aria-label="Token ROI">
        <Metric
          label="Token ROI, projected"
          value={projectedToken.text}
          provenance={tokenProvenance(report)}
          definition="cognitive_roi"
          size="lg"
          {...(tokenTone ? { tone: tokenTone } : {})}
          hint={
            <>
              {interval ? `Interval ${interval}. ` : 'No interval: there is no saving to bound. '}
              {tokens.breakEven === null
                ? 'No break-even.'
                : `Break-even after ${plural(tokens.breakEven, 'execution')}.`}
            </>
          }
        />
        <RealizedLine
          label="Realized so far"
          roi={tokens.realizedRoi}
          detail={
            live === 0
              ? 'No live execution yet'
              : tokens.realizedPayback === null
                ? `${plural(live, 'live execution')}`
                : `${plural(live, 'live execution')} recovered ${(tokens.realizedPayback * 100).toFixed(tokens.realizedPayback < 0.1 ? 1 : 0)}% of ${formatTokens(tokens.invested)} tokens`
          }
        />
        <p className="econ-roi__why">
          Each Reflex execution avoids about {formatTokens(report.perExecution.tokensAvoided)}{' '}
          tokens ({basis.label.toLowerCase()}); the {formatTokens(tokens.invested)}-token investment
          is paid once.
        </p>
        <dl className="econ-ledger" aria-label="Token ROI at the projected volume">
          <div>
            <dt>Avoided at {formatCount(report.projected.executions)} executions</dt>
            <dd className="num">{formatTokens(report.projected.avoidedTokens)}</dd>
          </div>
          <div>
            <dt>Invested: {countedTokenLines || 'nothing yet'}</dt>
            <dd className="num">{`\u2212${formatTokens(tokens.invested)}`}</dd>
          </div>
          <div className="econ-ledger__net">
            <dt>Net</dt>
            <dd className="num">{formatTokens(report.projected.netTokens)}</dd>
          </div>
          <div>
            <dt>Compilation, replay and review</dt>
            <dd className="num">no model tokens</dd>
          </div>
        </dl>
        <span className="sr-only">{`Realized provenance ${realizedProvenance(report).join(', ')}`}</span>
      </section>

      <section className="econ-roi" data-testid="econ-roi-cost" aria-label="Dollar ROI">
        <Metric
          label="Dollar ROI, projected"
          value={projectedDollar.text}
          provenance={dollarProvenance(report)}
          definition="cognitive_roi"
          size="lg"
          {...(dollarTone ? { tone: dollarTone } : {})}
          hint={
            dollars.breakEven === null
              ? 'No dollar break-even.'
              : `Dollar break-even after about ${formatCount(dollars.breakEven)} executions. No interval: the report gives none for dollars.`
          }
        />
        <RealizedLine
          label="Realized so far"
          roi={dollars.realizedRoi}
          detail={`${formatUsd(report.realized.avoidedCostUsd, { digits: 4 })} avoided against ${formatUsd(dollars.invested)} invested`}
        />
        <p className="econ-roi__why">
          {dollarsLag ? 'Dollars lag tokens in this data. ' : ''}
          {dollars.reviewShare !== null ? (
            <>
              The assumed human review is {formatUsd(dollars.review)},{' '}
              {(dollars.reviewShare * 100).toFixed(0)}% of the {formatUsd(dollars.invested)}{' '}
              invested.{' '}
            </>
          ) : null}
          {caching ?? ''}
        </p>
        <dl className="econ-ledger" aria-label="Dollar ROI at the projected volume">
          <div>
            <dt>Avoided at {formatCount(report.projected.executions)} executions</dt>
            <dd className="num">{formatUsd(dollars.projectedAvoided)}</dd>
          </div>
          <div>
            <dt>Model spend invested (shadow, canary)</dt>
            <dd className="num">{`\u2212${formatUsd(dollars.modelSpend)}`}</dd>
          </div>
          <div>
            <dt>
              Human review, assumed{' '}
              <Chip tone="amber" size="sm" dashed>
                estimated
              </Chip>
            </dt>
            <dd className="num">
              {dollars.review > 0 ? `\u2212${formatUsd(dollars.review)}` : formatUsd(0)}
            </dd>
          </div>
          <div className="econ-ledger__net">
            <dt>Net</dt>
            <dd className="num">{formatUsd(dollars.projectedNet)}</dd>
          </div>
          {dollars.projectedRoiWithoutReview !== null && dollars.review > 0 ? (
            <div>
              <dt>Without the review assumption, dollar ROI would be</dt>
              <dd className="num">{formatRoi(dollars.projectedRoiWithoutReview).text}</dd>
            </div>
          ) : null}
        </dl>
        <p className="econ-roi__why faint">
          Prices: {report.pricing.id}, an {report.pricing.source} dated{' '}
          {formatTimestamp(report.pricing.assumedAt).slice(0, 10)}.
        </p>
      </section>
    </div>
  );
}
