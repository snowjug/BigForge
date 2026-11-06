import { Info, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { EconomicsReport } from '@bigforge/schemas';
import {
  Button,
  Chip,
  Field,
  Spinner,
  Switch,
  formatCount,
  formatTimestamp,
  formatTokens,
} from '../../ui';
import {
  EXECUTIONS_MAX,
  EXECUTIONS_MIN,
  EXECUTIONS_PRESETS,
  SLIDER_STEPS,
  executionsError,
  executionsToSlider,
  parseExecutions,
  sliderToExecutions,
} from './model';

interface AssumptionsPanelProps {
  report: EconomicsReport;
  /** The count the controls show (the person's, or the server's default until they change it). */
  executions: number;
  onExecutions: (value: number) => void;
  conservative: boolean;
  onConservative: (value: boolean) => void;
  /** A new report for the changed assumptions is being fetched. */
  recomputing: boolean;
  /** The person has changed something from the saved defaults. */
  changed: boolean;
  onReset: () => void;
}

/**
 * The assumptions the projection rests on. Anyone may explore them: they only change the query for this view,
 * nothing is saved. Cost is an assumption with a timestamp, and so is the human review time.
 */
export function AssumptionsPanel({
  report,
  executions,
  onExecutions,
  conservative,
  onConservative,
  recomputing,
  changed,
  onReset,
}: AssumptionsPanelProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const error = draft === null ? null : executionsError(draft);
  const learning = report.investment.lines.find((line) => line.id === 'learning');
  const review = report.investment.lines.find((line) => line.id === 'review');

  return (
    <section
      className="econ-assumptions"
      data-testid="econ-assumptions"
      aria-labelledby="econ-assumptions-title"
    >
      <header className="econ-assumptions__head">
        <h2 id="econ-assumptions-title" className="econ-panel-title">
          Assumptions
        </h2>
        <span className="econ-assumptions__status" role="status" aria-live="polite">
          {recomputing ? (
            <>
              <Spinner size={12} /> Recomputing
            </>
          ) : (
            ''
          )}
        </span>
      </header>
      <p className="econ-assumptions__lede">
        Explore freely: these only change this view. Nothing is saved.
      </p>

      <Field
        label="Projected executions"
        help={`Future runs of this task family to extrapolate, ${formatCount(EXECUTIONS_MIN)} to ${formatCount(EXECUTIONS_MAX)}. The result is not a forecast.`}
        error={error}
      >
        {(control) => (
          <input
            {...control}
            className="bf-input mono num"
            type="number"
            inputMode="numeric"
            min={EXECUTIONS_MIN}
            max={EXECUTIONS_MAX}
            step={1}
            data-testid="econ-executions"
            value={draft ?? String(executions)}
            onChange={(event) => {
              const text = event.target.value;
              setDraft(text);
              if (executionsError(text) === null) {
                const parsed = parseExecutions(text);
                if (parsed !== null) onExecutions(parsed);
              }
            }}
            onBlur={() => {
              setDraft(null);
            }}
          />
        )}
      </Field>

      <div className="econ-slider">
        <input
          className="bf-range"
          type="range"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={executionsToSlider(executions)}
          aria-label="Projected executions, logarithmic slider from 1 to 100,000"
          aria-valuetext={`${formatCount(executions)} executions`}
          data-testid="econ-executions-slider"
          onChange={(event) => {
            setDraft(null);
            onExecutions(sliderToExecutions(Number(event.target.value)));
          }}
        />
        <div className="econ-slider__scale" aria-hidden="true">
          <span>1</span>
          <span>100</span>
          <span>10,000</span>
          <span>100,000</span>
        </div>
      </div>
      <div className="econ-presets" role="group" aria-label="Quick volumes">
        {EXECUTIONS_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="econ-preset"
            aria-pressed={executions === preset}
            onClick={() => {
              setDraft(null);
              onExecutions(preset);
            }}
          >
            {formatCount(preset)}
          </button>
        ))}
        {report.projected.breakEvenExecutions !== null &&
        report.projected.breakEvenExecutions > 0 ? (
          <button
            type="button"
            className="econ-preset"
            aria-pressed={executions === report.projected.breakEvenExecutions}
            onClick={() => {
              setDraft(null);
              onExecutions(report.projected.breakEvenExecutions ?? executions);
            }}
          >
            at break-even ({formatCount(report.projected.breakEvenExecutions)})
          </button>
        ) : null}
      </div>

      <div className="econ-assumptions__group">
        <Switch
          label="Conservative view"
          checked={conservative}
          data-testid="econ-conservative"
          onChange={(event) => {
            onConservative(event.target.checked);
          }}
        />
        <p className="bf-help">
          Counts the learning-task baseline runs as investment
          {learning ? ` (${formatTokens(learning.tokens)} tokens in ${learning.runs} runs)` : ''},
          even though those tasks had to be solved anyway.{' '}
          {conservative ? 'Included now.' : 'Excluded by default.'}
        </p>
      </div>

      <dl className="econ-assumptions__facts">
        <div>
          <dt className="micro">Price sheet</dt>
          <dd>
            <span className="mono">{report.pricing.id}</span>
            <Chip tone="amber" size="sm" dashed>
              {report.pricing.source}
            </Chip>
          </dd>
          <dd className="faint">
            Assumed {formatTimestamp(report.pricing.assumedAt)}. {report.pricing.note}
          </dd>
        </div>
        {review ? (
          <div>
            <dt className="micro">Human review</dt>
            <dd>{review.note.replace(/^Assumption:\s*/i, '')}</dd>
            <dd className="faint">
              An assumption (estimated), not a measurement. Change the saved default in Settings
              (admin).
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="econ-assumptions__foot">
        <span className="faint">
          <Info size={12} aria-hidden="true" /> Query only
        </span>
        <Button
          size="sm"
          icon={<RotateCcw size={13} />}
          disabled={!changed}
          disabledReason="Already on the saved defaults"
          onClick={onReset}
        >
          Reset to saved defaults
        </Button>
      </div>
    </section>
  );
}
