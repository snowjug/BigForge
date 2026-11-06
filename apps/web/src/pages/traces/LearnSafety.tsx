import {
  Ban,
  CircleCheck,
  CircleX,
  Info,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Chip, Provenance } from '../../ui';
import type { CheckStatus, LearnAssessment, Verdict } from './safety';

const CHECK_ICON: Record<CheckStatus, { icon: ReactNode; word: string }> = {
  pass: { icon: <CircleCheck size={16} aria-hidden="true" />, word: 'Pass' },
  fail: { icon: <CircleX size={16} aria-hidden="true" />, word: 'Fail' },
  warn: { icon: <TriangleAlert size={16} aria-hidden="true" />, word: 'Note' },
  info: { icon: <Info size={16} aria-hidden="true" />, word: 'Info' },
};

const VERDICT: Record<Verdict, { tone: 'jade' | 'crimson' | 'ash'; icon: ReactNode }> = {
  safe: { tone: 'jade', icon: <ShieldCheck size={22} aria-hidden="true" /> },
  safe_with_exclusions: { tone: 'jade', icon: <ShieldCheck size={22} aria-hidden="true" /> },
  not_safe: { tone: 'crimson', icon: <ShieldAlert size={22} aria-hidden="true" /> },
  not_a_source: { tone: 'ash', icon: <Ban size={22} aria-hidden="true" /> },
};

/** The answer to "is this trace safe to learn from?", read from the recorded fields and named as such. */
export function LearnSafety({
  assessment,
  loadingCompile,
}: {
  assessment: LearnAssessment;
  loadingCompile: boolean;
}) {
  const verdict = VERDICT[assessment.verdict];
  return (
    <aside
      className="trace-safety"
      data-testid="learn-safety"
      data-verdict={assessment.verdict}
      aria-labelledby="trace-safety-title"
    >
      <header className="trace-safety__head" data-tone={verdict.tone}>
        <span className="trace-safety__icon">{verdict.icon}</span>
        <div>
          <p className="micro">Safe to learn from?</p>
          <h2 id="trace-safety-title" className="trace-safety__title">
            {assessment.headline}
          </h2>
          <p className="trace-safety__sum dim">{assessment.summary}</p>
        </div>
      </header>

      <ol className="trace-checks" aria-label="What was checked">
        {assessment.checks.map((check) => (
          <li key={check.id} data-status={check.status}>
            <span className="trace-checks__icon">
              {CHECK_ICON[check.status].icon}
              <span className="sr-only">{CHECK_ICON[check.status].word}: </span>
            </span>
            <div>
              <p className="trace-checks__q">{check.question}</p>
              <p className="trace-checks__a dim">{check.answer}</p>
              <p className="trace-checks__f faint mono">{check.field}</p>
            </div>
          </li>
        ))}
      </ol>
      {loadingCompile ? (
        <p className="faint trace-safety__loading">
          Reading the Reflex registry for compile provenance.
        </p>
      ) : null}

      {assessment.blocked.length > 0 ? (
        <section className="trace-excluded" aria-labelledby="trace-blocked-title">
          <h3 id="trace-blocked-title" className="trace-h">
            Excluded behaviour
          </h3>
          <ul>
            {assessment.blocked.map((action) => (
              <li key={`${action.seq}-${action.action}`}>
                <code className="mono trace-excluded__cmd">{action.action}</code>
                <p className="dim">
                  <Chip tone="crimson" variant="outline" size="sm" mono>
                    {action.rule}
                  </Chip>{' '}
                  {action.reason}
                </p>
                {action.purpose ? (
                  <p className="faint">
                    Purpose <span className="mono">{action.purpose}</span>
                    {assessment.excludedConfirmed.some((entry) => entry.purpose === action.purpose)
                      ? ': confirmed in the compile report as an excluded behaviour.'
                      : '.'}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="trace-prov-title">
        <h3 id="trace-prov-title" className="trace-h">
          Where each number comes from
        </h3>
        <ul className="trace-prov">
          {assessment.provenance.map((row) => (
            <li key={row.value}>
              <span className="trace-prov__fig">{row.figure}</span>
              <Provenance kind={row.provenance} metric={row.value} />
              <span className="faint trace-prov__note">{row.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
