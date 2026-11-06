import type {
  Comparison,
  ExecSummary,
  FileChangeDto,
  RunDetailDto,
  RunSummaryDto,
  UsageSummary,
} from '@bigforge/schemas';
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  FileDiff,
  ListChecks,
  OctagonX,
  ScrollText,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useSystem } from '../../api/hooks';
import { useDemoTarget } from '../../demo/useDemo';
import { runPath, tracePath } from '../../routes';
import {
  ButtonLink,
  Chip,
  Metric,
  type MetricDelta,
  Provenance,
  VerificationChip,
  formatMs,
  formatPct,
  formatTimestamp,
  formatTokens,
  formatUsd,
  plural,
  shortHash,
} from '../../ui';
import { KIND_LABEL, type RunRelations, isReflexKind } from './selectors';

function DiffView({ change }: { change: FileChangeDto }) {
  return (
    <div className="run-diff-wrap" role="region" aria-label={`Diff of ${change.file}`} tabIndex={0}>
      <table className="run-diff">
        <caption className="sr-only">
          Changes to {change.file}: {change.added} added, {change.removed} removed
        </caption>
        <tbody>
          {change.diff.map((line, index) => (
            <tr key={index} data-kind={line.kind}>
              <td className="run-diff__n num" aria-hidden="true">
                {line.oldLine ?? ''}
              </td>
              <td className="run-diff__n num" aria-hidden="true">
                {line.newLine ?? ''}
              </td>
              <td className="run-diff__mark" aria-hidden="true">
                {line.kind === 'add' ? '+' : line.kind === 'remove' ? '\u2212' : ''}
              </td>
              <td className="run-diff__text mono">
                <span className="sr-only">
                  {line.kind === 'add' ? 'Added: ' : line.kind === 'remove' ? 'Removed: ' : ''}
                </span>
                {line.text || ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RULE_ICON = {
  pass: <CircleCheck size={15} aria-hidden="true" />,
  fail: <CircleX size={15} aria-hidden="true" />,
  skipped: <CircleDashed size={15} aria-hidden="true" />,
} as const;

function headline(
  run: RunSummaryDto,
  relation: RunRelations['role'],
): { text: string; tone: 'jade' | 'crimson' | 'amber' | 'ash'; icon: ReactNode } {
  const who = isReflexKind(run.kind) ? 'The Reflex' : 'The baseline agent';
  if (run.status === 'stopped') {
    return {
      text: 'The Reflex stopped and did not improvise',
      tone: 'amber',
      icon: <OctagonX size={22} aria-hidden="true" />,
    };
  }
  if (run.status === 'failed') {
    return {
      text: `${who} did not solve it`,
      tone: 'crimson',
      icon: <CircleX size={22} aria-hidden="true" />,
    };
  }
  if (run.status === 'success') {
    const suffix =
      relation === 'fallback'
        ? ' as the fallback'
        : relation === 'reference'
          ? ' as the reference'
          : '';
    return {
      text: `${who} solved it${suffix}`,
      tone: run.verification === 'pass' ? 'jade' : 'amber',
      icon: <CircleCheck size={22} aria-hidden="true" />,
    };
  }
  return {
    text: `Run ${run.status}`,
    tone: 'ash',
    icon: <CircleDashed size={22} aria-hidden="true" />,
  };
}

export interface ResultHeaderProps {
  run: RunDetailDto;
  exec: ExecSummary | null;
  relations: RunRelations;
  /** The baseline reference this Reflex run was measured against, with the API's comparison. */
  versus: { comparison: Comparison; baseline: UsageSummary } | null;
}

/** "11 fewer than the baseline's 12": a difference read from the comparison, never recomputed here. */
function against(
  delta: number,
  amount: string,
  baseline: string,
  agree: boolean,
  word: 'fewer' | 'less',
): MetricDelta {
  if (delta === 0)
    return { text: `same as the baseline (${baseline})`, direction: 'flat', sentiment: 'neutral' };
  const fewer = delta < 0;
  return {
    text: `${amount} ${fewer ? word : 'more'} than the baseline's ${baseline}`,
    direction: fewer ? 'down' : 'up',
    // A smaller number is only good news when both runs reached the same result.
    sentiment: agree && fewer ? 'good' : 'neutral',
  };
}

export function ResultHeader({ run, exec, relations, versus }: ResultHeaderProps) {
  const verifiedTarget = useDemoTarget('verified');
  const system = useSystem();
  const { usage, trace } = run;
  const head = headline(run, relations.role);
  const root = run.rootFailure;
  const report = trace.verification;
  const reflexRun = isReflexKind(run.kind);
  const pricing = system.data?.pricing;
  const deltas = versus
    ? {
        calls: against(
          versus.comparison.deltas.modelCalls,
          String(Math.abs(versus.comparison.deltas.modelCalls)),
          String(versus.baseline.modelCalls),
          versus.comparison.agree,
          'fewer',
        ),
        tokens: against(
          versus.comparison.deltas.tokens,
          versus.baseline.totalTokens > 0
            ? formatPct(Math.abs(versus.comparison.deltas.tokens) / versus.baseline.totalTokens, {
                digits: 1,
              })
            : formatTokens(Math.abs(versus.comparison.deltas.tokens)),
          formatTokens(versus.baseline.totalTokens),
          versus.comparison.agree,
          'less',
        ),
        cost: against(
          versus.comparison.deltas.costUsd,
          formatUsd(Math.abs(versus.comparison.deltas.costUsd)),
          formatUsd(versus.baseline.costUsd),
          versus.comparison.agree,
          'less',
        ),
        latency: against(
          versus.comparison.deltas.modelLatencyMs,
          formatMs(Math.abs(versus.comparison.deltas.modelLatencyMs)),
          formatMs(versus.baseline.modelLatencyMs),
          versus.comparison.agree,
          'less',
        ),
      }
    : null;

  return (
    <section
      className="run-region run-result"
      data-testid="run-result"
      aria-labelledby="run-result-title"
      data-status={run.status}
    >
      <header className="run-result__head">
        <div className="run-result__headline" data-tone={head.tone}>
          <span className="run-result__icon">{head.icon}</span>
          <div>
            <h2 id="run-result-title" className="run-result__title">
              {head.text}
            </h2>
            <p className="run-result__sub dim">{run.outcomeSummary}</p>
          </div>
        </div>
        <div className="run-result__chips">
          <Chip tone={reflexRun ? 'steel' : 'ember'} variant="outline">
            {KIND_LABEL[run.kind]}
          </Chip>
          <Chip tone="ash" variant="outline" mono title={run.id}>
            {run.agent.name}
            {run.agent.reflexVersion ? ` v${run.agent.reflexVersion}` : ''}
          </Chip>
          <Chip
            tone="ash"
            variant="outline"
            dashed
            title={`Provider ${run.provider.id}, model ${run.provider.model}`}
          >
            {run.provider.mode === 'deterministic'
              ? 'Deterministic provider, synthetic'
              : `Live provider ${run.provider.model}`}
          </Chip>
          <ButtonLink size="sm" to={tracePath(run.id)} icon={<ScrollText size={14} />}>
            Open trace
          </ButtonLink>
        </div>
      </header>

      {relations.role && relations.partner ? (
        <p className="run-result__relation">
          {relations.role === 'fallback'
            ? 'This baseline run took over after the Reflex stopped. '
            : 'This baseline run is the measured reference for a Reflex run. '}
          <Link to={runPath({ task: run.taskId, run: relations.partner.id })}>
            Open the Reflex run
          </Link>
        </p>
      ) : null}

      {root ? (
        <p className="run-result__root">
          <span className="micro">Root cause</span>
          <span className="mono run-result__code">{root.code}</span>
          <span className="mono">{root.workspace}</span>
          {root.file ? (
            <span className="mono dim">
              {root.file}
              {root.line !== null ? `:${root.line}` : ''}
            </span>
          ) : null}
          <span className="dim">{root.message}</span>
        </p>
      ) : (
        <p className="run-result__root dim">
          <span className="micro">Root cause</span> none was identified.
        </p>
      )}

      <div className="run-metrics">
        <Metric
          label="Model calls"
          size="sm"
          value={formatTokens(usage.modelCalls)}
          provenance={usage.tokenProvenance}
          definition="model_calls"
          tone={usage.modelCalls === 0 ? 'steel' : 'ember'}
          delta={deltas?.calls}
        />
        <Metric
          label="Tokens"
          size="sm"
          value={formatTokens(usage.totalTokens)}
          provenance={usage.tokenProvenance}
          definition="tokens_per_task"
          tone={usage.totalTokens === 0 ? 'steel' : 'ember'}
          delta={deltas?.tokens}
          hint={
            usage.totalTokens > 0
              ? `${formatTokens(usage.inputTokens)} in (${formatTokens(usage.cachedInputTokens)} cached) + ${formatTokens(usage.outputTokens)} out`
              : undefined
          }
        />
        <Metric
          label="Cost"
          size="sm"
          value={formatUsd(usage.costUsd)}
          provenance={usage.costProvenance}
          definition="cost_usd"
          delta={deltas?.cost}
        />
        <Metric
          label="Commands"
          size="sm"
          value={formatTokens(usage.commands)}
          provenance="measured"
          definition="commands"
        />
        <Metric
          label="Model latency"
          size="sm"
          value={formatMs(usage.modelLatencyMs)}
          provenance={usage.modelLatencyProvenance}
          definition="model_latency"
          delta={deltas?.latency}
        />
        <Metric
          label="Local time"
          size="sm"
          value={formatMs(usage.localMs)}
          provenance={usage.localMsProvenance}
          definition="local_time"
        />
        {exec && exec.crr !== null ? (
          <Metric
            label="Reuse (CRR)"
            size="sm"
            value={formatPct(exec.crr, { digits: 1 })}
            provenance="synthetic"
            definition="crr"
            tone="steel"
            hint="Share of the workflow done without a model, weighted by what the baseline spent"
          />
        ) : null}
      </div>
      {pricing ? (
        <p className="run-result__pricing faint">
          Cost is tokens times a price assumption ({pricing.id}, assumed{' '}
          {formatTimestamp(pricing.assumedAt).slice(0, 10)}): {pricing.note}
        </p>
      ) : null}

      <div className="run-result__cols">
        <div
          className="run-verify"
          data-testid="run-verification"
          {...verifiedTarget}
          data-status={report.status}
        >
          <div className="run-verify__head">
            <p className="run-h">
              <ListChecks size={15} aria-hidden="true" /> Objective verification
            </p>
            <VerificationChip status={report.status} />
          </div>
          <p className="run-verify__sub faint">
            Produced by {report.verifier}, not by the agent. {formatTimestamp(report.verifiedAt)}
          </p>
          <ul className="run-rules">
            {report.rules.map((rule) => (
              <li key={rule.id} data-status={rule.status}>
                <span className="run-rules__icon">{RULE_ICON[rule.status]}</span>
                <div>
                  <p className="run-rules__label">
                    {rule.label}
                    <span className="sr-only">: {rule.status}</span>
                  </p>
                  <p className="run-rules__evidence dim">{rule.evidence}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="run-changes">
          <p className="run-h">
            <FileDiff size={15} aria-hidden="true" /> Changes
          </p>
          {run.changes.length === 0 ? (
            <p className="dim">No files were changed.</p>
          ) : (
            <ul className="run-files">
              {run.changes.map((change) => (
                <li key={change.file}>
                  <details open={run.changes.length === 1}>
                    <summary>
                      <span className="mono">{change.file}</span>
                      <span className="run-files__stat num">
                        <span className="run-files__add">+{change.added}</span>{' '}
                        <span className="run-files__del">&minus;{change.removed}</span>
                      </span>
                    </summary>
                    <DiffView change={change} />
                  </details>
                </li>
              ))}
            </ul>
          )}
          <p className="run-blocked" data-count={usage.blockedActions}>
            <span className="micro">Blocked actions</span>
            <span className="num run-blocked__n">{usage.blockedActions}</span>
            <span className="dim">
              {usage.blockedActions === 0
                ? 'The safety policy blocked nothing in this run.'
                : `${plural(usage.blockedActions, 'action')} refused by the safety policy and never executed.`}
            </span>
            <Provenance kind="measured" />
          </p>
          <p className="faint run-changes__id">
            Run <span className="mono">{shortHash(run.id.replace(/^run_/, ''), 8)}</span> &middot;
            task {run.task.scenarioId}
          </p>
        </div>
      </div>
    </section>
  );
}
