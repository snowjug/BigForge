import type { FamilyMatch, TaskDto } from '@bigforge/schemas';
import { CircleCheck, CircleX, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { useDemoTarget } from '../../demo/useDemo';
import { reflexPath } from '../../routes';
import { Button, Chip, Meter, Panel, Provenance, StatusChip, formatPct } from '../../ui';
import { ReflexGlyph } from '../../viz';
import { type ReflexChoice, pathVerdict } from './selectors';

const GATE_LABEL: Record<string, string> = {
  evidence_present: 'Evidence present',
  intent: 'Same intent',
  toolchain: 'Same toolchain',
  failure_type: 'Same failure type',
  known_error_classes: 'Known error classes',
};

const DECISION = {
  match: { label: 'Match', tone: 'jade' },
  no_match: { label: 'No match', tone: 'ash' },
  ambiguous: { label: 'Ambiguous', tone: 'amber' },
} as const;

const gateLabel = (id: string): string => GATE_LABEL[id] ?? id.replace(/_/g, ' ');

export interface MatchPanelProps {
  task: Pick<TaskDto, 'id' | 'match'>;
  choice: ReflexChoice | null;
  newest: ReflexChoice | null;
  rematch: { onRun: () => void; running: boolean; disabledReason: string | null };
}

export function MatchPanel({ task, choice, newest, rematch }: MatchPanelProps) {
  const target = useDemoTarget('recognized');
  const match: FamilyMatch | null = task.match;
  const verdict = pathVerdict({ match, choice });
  const decision = match ? DECISION[match.decision] : null;
  const failedGates = match ? match.hardGates.filter((gate) => !gate.passed) : [];

  return (
    <section {...target} aria-labelledby="run-match-title" className="run-region">
      <Panel
        title={<span id="run-match-title">Match decision</span>}
        subtitle="Which task family is this, and which Reflex would run?"
        actions={
          <Button
            size="sm"
            icon={<RefreshCw size={14} />}
            loading={rematch.running}
            disabled={rematch.disabledReason !== null}
            {...(rematch.disabledReason ? { disabledReason: rematch.disabledReason } : {})}
            onClick={rematch.onRun}
          >
            Re-run matching
          </Button>
        }
      >
        <div
          className="run-match"
          data-testid="match-decision"
          data-decision={match?.decision ?? 'unmatched'}
        >
          {!match || !decision ? (
            <p className="dim">
              This task has not been matched yet. Re-run matching to compare it with the known task
              families.
            </p>
          ) : (
            <>
              <div className="run-match__top">
                <div className="run-match__decision">
                  <Chip
                    tone={decision.tone}
                    variant="soft"
                    icon={
                      match.decision === 'match' ? <CircleCheck size={13} /> : <CircleX size={13} />
                    }
                  >
                    {decision.label}
                  </Chip>
                  <p className="run-match__family">{match.familyName ?? 'No task family'}</p>
                </div>
                <div className="run-match__score">
                  <p className="run-match__num num">{formatPct(match.score, { digits: 1 })}</p>
                  <div className="run-match__meter">
                    <Meter
                      label="Similarity to the family"
                      value={match.score}
                      valueText={formatPct(match.score, { digits: 1 })}
                      threshold={match.threshold}
                      thresholdLabel={`Match threshold ${formatPct(match.threshold, { digits: 1 })}`}
                      tone={match.decision === 'match' ? 'jade' : 'ash'}
                    />
                    <p className="run-match__scale">
                      <span>similarity</span>
                      <span>threshold {formatPct(match.threshold, { digits: 0 })}</span>
                    </p>
                  </div>
                  <Provenance kind="measured" />
                </div>
              </div>
              <p className="faint run-match__note">
                Rule-based score from the task&rsquo;s fingerprint (intent, toolchain, failure type,
                error classes). No model is called to match.
              </p>

              {match.hardGates.length > 0 ? (
                <div>
                  <p className="micro run-match__h">Hard gates: every one must pass</p>
                  <ul className="run-gates">
                    {match.hardGates.map((gate) => (
                      <li key={gate.id} data-passed={gate.passed ? 'true' : 'false'}>
                        <span className="run-gates__icon" aria-hidden="true">
                          {gate.passed ? <CircleCheck size={15} /> : <CircleX size={15} />}
                        </span>
                        <span className="run-gates__label">
                          {gateLabel(gate.id)}
                          <span className="sr-only">{gate.passed ? ': passed' : ': failed'}</span>
                        </span>
                        <span className="run-gates__detail dim">{gate.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {match.decision !== 'match' ? (
                <div className="run-match__plain" role="note">
                  <p>
                    <strong>
                      {match.decision === 'no_match'
                        ? 'No family matched.'
                        : 'The match is ambiguous.'}
                    </strong>{' '}
                    {match.reasons.length > 0
                      ? match.reasons.join(' ')
                      : 'Similarity stayed below the threshold.'}
                    {failedGates.length > 0
                      ? ` Failed: ${failedGates.map((gate) => gateLabel(gate.id).toLowerCase()).join(', ')}.`
                      : ''}
                  </p>
                  <p>
                    The baseline agent will handle this task: it reads, decides and verifies with a
                    model call on every turn.
                  </p>
                </div>
              ) : (
                <p className="dim run-match__reason">{match.reasons.join(' ')}</p>
              )}

              <div className="run-match__reflex" data-path={verdict.path}>
                <p className="micro run-match__h">Selected path</p>
                {choice ? (
                  <div className="run-reflexrow">
                    <ReflexGlyph
                      hash={choice.version.contentHash}
                      size={40}
                      title={`Identity glyph of ${choice.reflexName} ${choice.version.version}`}
                    />
                    <div className="run-reflexrow__text">
                      <p>
                        <Link to={reflexPath(choice.version.id)} className="run-reflexrow__name">
                          {choice.reflexName}{' '}
                          <span className="mono">v{choice.version.version}</span>
                        </Link>
                      </p>
                      <p className="dim">
                        Known steps run locally; unknowns cross the Token Firewall.
                      </p>
                    </div>
                    <StatusChip status={choice.version.status} />
                  </div>
                ) : match.decision === 'match' && newest ? (
                  <div className="run-reflexrow">
                    <ReflexGlyph
                      hash={newest.version.contentHash}
                      size={40}
                      title={`Identity glyph of ${newest.reflexName} ${newest.version.version}`}
                    />
                    <div className="run-reflexrow__text">
                      <p>
                        <Link to={reflexPath(newest.version.id)} className="run-reflexrow__name">
                          {newest.reflexName}{' '}
                          <span className="mono">v{newest.version.version}</span>
                        </Link>
                      </p>
                      <p className="dim">
                        Matched, but it may not run live in this status. The baseline agent will
                        handle the task.
                      </p>
                    </div>
                    <StatusChip status={newest.version.status} />
                  </div>
                ) : (
                  <p>
                    <strong>Baseline agent.</strong>{' '}
                    <span className="dim">No Reflex applies to this task.</span>
                  </p>
                )}
              </div>

              {match.features.length > 0 ? (
                <details className="run-match__features">
                  <summary>How the score is made ({match.features.length} features)</summary>
                  <table className="run-features">
                    <thead>
                      <tr>
                        <th scope="col">Feature</th>
                        <th scope="col" className="num">
                          Score
                        </th>
                        <th scope="col" className="num">
                          Weight
                        </th>
                        <th scope="col">Compared</th>
                      </tr>
                    </thead>
                    <tbody>
                      {match.features.map((feature) => (
                        <tr key={feature.name}>
                          <th scope="row">{feature.name.replace(/_/g, ' ')}</th>
                          <td className="num mono">{feature.score.toFixed(2)}</td>
                          <td className="num mono">{feature.weight.toFixed(2)}</td>
                          <td className="dim">{feature.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </>
          )}
        </div>
      </Panel>
    </section>
  );
}
