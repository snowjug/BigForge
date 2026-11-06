import { CircleDashed, TrendingDown, TrendingUp } from 'lucide-react';
import type { EconomicsReport } from '@bigforge/schemas';
import { Chip, EmptyState, Provenance, formatCount, plural } from '../../ui';
import {
  type Derived,
  type Missing,
  type Verdict,
  formatRoi,
  realizedProvenance,
  tokenProvenance,
} from './model';

const FACT_LABEL = {
  projection: 'Projected, in tokens',
  dollars: 'Projected, in dollars',
  realized: 'Realized so far',
} as const;

function Signal({ label, roi }: { label: string; roi: number | null }) {
  const text = formatRoi(roi);
  const icon =
    text.sign === 'positive' ? (
      <TrendingUp size={12} />
    ) : text.sign === 'negative' ? (
      <TrendingDown size={12} />
    ) : (
      <CircleDashed size={12} />
    );
  const tone = text.sign === 'positive' ? 'steel' : text.sign === 'negative' ? 'ember' : 'ash';
  return (
    <Chip tone={tone} variant="soft" icon={icon} className="econ-signal">
      <span className="econ-signal__label">{label}</span>
      <span className="num">{text.text}</span>
      <span className="sr-only">{`, ${text.words}`}</span>
    </Chip>
  );
}

/** The verdict in words, computed from the report, with the three signs it rests on. */
export function VerdictBlock({
  report,
  derived,
  verdict,
}: {
  report: EconomicsReport;
  derived: Derived;
  verdict: Verdict;
}) {
  return (
    <section
      className="econ-verdict"
      data-testid="econ-verdict"
      data-kind={verdict.kind}
      aria-labelledby="econ-verdict-title"
    >
      <p className="micro">
        Verdict at {formatCount(report.projected.executions)} projected executions
      </p>
      <h2 id="econ-verdict-title" className="econ-verdict__headline">
        {verdict.headline}
      </h2>
      <div className="econ-verdict__signals" aria-label="Signs behind the verdict">
        <Signal label="Token ROI, projected" roi={derived.tokens.projectedRoi} />
        <Signal label="Dollar ROI, projected" roi={derived.dollars.projectedRoi} />
        <Signal label="Token ROI, realized" roi={derived.tokens.realizedRoi} />
      </div>
      <div className="econ-verdict__facts">
        {verdict.facts.map((fact) => (
          <p key={fact.id} className="econ-verdict__fact">
            <span className="micro">{FACT_LABEL[fact.id]}</span>
            <span>{fact.text}</span>
          </p>
        ))}
      </div>
      <p className="econ-verdict__foot">
        <Provenance
          kind={[...tokenProvenance(report), ...realizedProvenance(report)]}
          metric="cognitive_roi"
        />
        <span>
          Figures come from the deterministic provider on a synthetic lab. They demonstrate the
          accounting, not a general saving.
        </span>
      </p>
    </section>
  );
}

/** Before there is anything to judge: what is missing and which demo step produces it. */
export function EarlyState({ missing }: { missing: readonly Missing[] }) {
  return (
    <section
      className="econ-verdict econ-verdict--empty"
      data-testid="econ-verdict"
      data-kind="empty"
      aria-labelledby="econ-verdict-title"
    >
      <p className="micro">Verdict</p>
      <h2 id="econ-verdict-title" className="econ-verdict__headline">
        Nothing to judge yet.
      </h2>
      <EmptyState
        icon={<CircleDashed size={18} />}
        title="There is no saving to measure, so there is no ROI to show"
        description={`${plural(missing.length, 'thing')} missing. The guided demo produces each of them through the real services.`}
      />
      <ol className="econ-missing">
        {missing.map((entry) => (
          <li key={entry.what}>
            <span>{entry.what}</span>
            <span className="econ-missing__step">{entry.produced}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
