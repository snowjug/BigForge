import type { ReflexSpec, ReflexStep, ReflexVersionDto } from '@bigforge/schemas';
import { type ReactNode, useMemo } from 'react';
import { Chip, Metric, Provenance, formatCount, formatPct, plural } from '../../../ui';
import { ForgeGraph } from '../../../viz';
import { describeGuard, describeOperand } from '../conditions';
import { ConfidenceBar } from '../parts';

const KIND_TONE = {
  known: 'steel',
  validation: 'steel',
  hybrid: 'steel',
  boundary: 'molten',
  verification: 'jade',
} as const;

const KIND_TEXT: Record<ReflexStep['kind'], string> = {
  known: 'Known: runs locally, no model call',
  validation: 'Validation: a local check',
  hybrid: 'Hybrid: local first, may cross its boundary',
  boundary: 'Boundary: always asks, one bounded model call',
  verification: 'Verification: independent evidence locks the result',
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

interface InspectorProps {
  spec: ReflexSpec;
  step: ReflexStep;
  tracesUsed: number;
  onSelect: (stepId: string) => void;
}

/** Why a step exists, what it is allowed to do, and when it hands control back. */
export function StepInspector({ spec, step, tracesUsed, onSelect }: InspectorProps) {
  const titles = useMemo(() => new Map(spec.steps.map((s) => [s.id, s.title])), [spec.steps]);
  const titleOf = (id: string) => titles.get(id);
  const { rationale, boundary } = step;
  const escalate = describeGuard(
    step.escalateWhen,
    'Crosses its uncertainty boundary when',
    titleOf,
  );
  const stop = describeGuard(step.stopWhen, 'Stops and hands control back when', titleOf);
  const args = Object.entries(step.args);
  const presentIn = Math.round(rationale.conservation * tracesUsed);

  return (
    <aside
      className="rfx-inspector"
      data-testid="step-inspector"
      aria-label={`Step inspector: ${step.title}`}
    >
      <header>
        <p className="micro">Step · {step.id}</p>
        <h3 className="rfx-inspector__title">{step.title}</h3>
        <div className="rfx-chips">
          <Chip tone={KIND_TONE[step.kind]} variant="outline" dashed={step.kind === 'validation'}>
            {step.kind}
          </Chip>
          <Chip tone="neutral" variant="outline" mono>
            {step.operator.id}@{step.operator.version}
          </Chip>
        </div>
        <p className="rfx-inspector__kind">{KIND_TEXT[step.kind]}</p>
      </header>

      <section aria-label="Why this step exists">
        <h4 className="rfx-h4">Why it exists</h4>
        <p>{rationale.selectedBecause}</p>
        <dl className="rfx-facts">
          <Fact label="Replaces">
            {rationale.replaces.length === 0 ? (
              'no recorded behaviour: added by the compiler as a guard or verification'
            ) : (
              <span className="rfx-chips">
                {rationale.replaces.map((purpose) => (
                  <Chip key={purpose} mono size="sm" tone="neutral" variant="outline">
                    {purpose}
                  </Chip>
                ))}
              </span>
            )}
          </Fact>
          <Fact label="Conservation">
            {formatPct(rationale.conservation, { digits: 0 })} of the aligned behaviours: present in{' '}
            {presentIn} of {plural(tracesUsed, 'source trace')}
          </Fact>
          <Fact label="Baseline tokens">
            {formatCount(rationale.baselineTokens)} replaced per task{' '}
            <Provenance kind="synthetic" />
          </Fact>
        </dl>
        {rationale.alternatives.length > 0 ? (
          <div
            className="rfx-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Operators that were considered"
          >
            <table className="rfx-table rfx-table--dense">
              <thead>
                <tr>
                  <th scope="col">Operator considered</th>
                  <th scope="col">Reproduces</th>
                  <th scope="col" className="rfx-table__end">
                    Matched
                  </th>
                </tr>
              </thead>
              <tbody>
                {rationale.alternatives.map((alt) => (
                  <tr key={alt.operator}>
                    <th scope="row" className="mono">
                      {alt.operator}
                      {alt.operator === `${step.operator.id}@${step.operator.version}`
                        ? ' (chosen)'
                        : ''}
                    </th>
                    <td>{alt.consistent ? 'Yes' : 'No'}</td>
                    <td className="rfx-table__end mono num">
                      {alt.matched} of {alt.of}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section aria-label="Inputs">
        <h4 className="rfx-h4">Inputs</h4>
        {args.length === 0 ? (
          <p className="dim">No arguments: the step reads the sandbox directly.</p>
        ) : (
          <ul className="rfx-args">
            {args.map(([name, binding]) => (
              <li key={name}>
                <span className="mono">{name}</span>
                <span className="faint"> from </span>
                <span>{describeOperand(binding, titleOf)}</span>
              </li>
            ))}
          </ul>
        )}
        {step.dependsOn.length > 0 ? (
          <p className="rfx-depends">
            <span className="faint">Runs after</span>{' '}
            {step.dependsOn.map((id) => (
              <button
                key={id}
                type="button"
                className="rfx-link-btn"
                onClick={() => {
                  onSelect(id);
                }}
              >
                {titles.get(id) ?? id}
              </button>
            ))}
          </p>
        ) : null}
      </section>

      <section aria-label="Guards">
        <h4 className="rfx-h4">Guards</h4>
        <ul className="rfx-guards">
          <li data-kind="escalate">
            {escalate ?? 'It never crosses a boundary: it always runs locally.'}
          </li>
          <li data-kind="stop">{stop ?? 'It has no stop condition of its own.'}</li>
        </ul>
      </section>

      {boundary ? (
        <section aria-label="Uncertainty boundary" className="rfx-boundary">
          <h4 className="rfx-h4">Uncertainty boundary</h4>
          <p className="rfx-boundary__q">{boundary.question}</p>
          <dl className="rfx-facts">
            <Fact label="Options from">
              <span className="mono">{boundary.optionsFrom}</span>
            </Fact>
            <Fact label="Evidence">
              <span className="rfx-chips">
                {boundary.evidenceSelectors.map((sel) => (
                  <Chip
                    key={sel.id}
                    mono
                    size="sm"
                    tone={sel.required ? 'molten' : 'neutral'}
                    variant="outline"
                  >
                    {sel.id}
                    {sel.required ? ' (required)' : ''}: {sel.tags.join(', ')}
                  </Chip>
                ))}
              </span>
            </Fact>
            <Fact label="Budget">{formatCount(boundary.budgetTokens)} tokens at most</Fact>
            <Fact label="Model needed">{boundary.minCapability} or larger</Fact>
            <Fact label="Answer shape">{boundary.evidenceRequired}</Fact>
            <Fact label="Verified by">{boundary.verifyBy}</Fact>
            <Fact label="Resolves into">
              <span className="mono">{boundary.resolveInto}</span>
            </Fact>
          </dl>
        </section>
      ) : null}
    </aside>
  );
}

interface OverviewProps {
  version: ReflexVersionDto;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}

function kindSummary(steps: readonly ReflexStep[]): string {
  const count = (kind: ReflexStep['kind']) => steps.filter((s) => s.kind === kind).length;
  const local = count('known') + count('validation');
  const parts = [`${local} local`];
  if (count('hybrid') > 0) parts.push(`${count('hybrid')} hybrid`);
  if (count('boundary') > 0) parts.push(`${count('boundary')} boundary`);
  if (count('verification') > 0) parts.push(`${count('verification')} verification`);
  return parts.join(' · ');
}

/** The Forge Graph of the Reflex (static) beside an inspector for the selected step, with the headline figures. */
export function OverviewTab({ version, selectedStepId, onSelectStep }: OverviewProps) {
  const { spec, compileReport, shadow, trust } = version;
  const selected = spec.steps.find((s) => s.id === selectedStepId) ?? null;
  const shadowed = shadow.runs > 0;

  return (
    <div className="rfx-overview">
      <div className="rfx-figures">
        <Metric
          label="Steps"
          value={spec.steps.length}
          provenance="none"
          hint={kindSummary(spec.steps)}
        />
        <Metric
          label="Baseline tokens per task"
          value={formatCount(compileReport.baselineTokensPerTask)}
          provenance="synthetic"
          definition="tokens_per_task"
          hint={`${compileReport.baselineModelCallsPerTask} model calls across ${plural(compileReport.tracesUsed, 'source trace')}`}
        />
        <Metric
          label="Reflex tokens per task"
          value={shadowed ? formatCount(shadow.reflex.meanTokens) : null}
          provenance={shadow.reflex.provenance}
          definition="tokens_per_task"
          tone={shadowed && shadow.reflex.meanTokens === 0 ? 'jade' : undefined}
          hint={
            shadowed
              ? `in shadow, against ${formatCount(shadow.baseline.meanTokens)} for the baseline over ${plural(shadow.runs, 'run')}`
              : 'No Shadow Brain runs yet'
          }
        />
        <div className="rfx-figure-conf">
          <p className="micro">Confidence</p>
          <ConfidenceBar trust={trust} withProvenance />
        </div>
        <Metric
          label="Verification rules"
          value={spec.verify.length}
          provenance="none"
          hint="An independent verifier must pass after every run"
        />
      </div>

      <div className="rfx-overview__split">
        <div className="rfx-overview__graph" data-testid="forge-graph">
          <ForgeGraph
            steps={spec.steps}
            selectedId={selected?.id ?? null}
            onSelect={onSelectStep}
            showTokens
            ariaLabel={`Forge Graph of ${spec.name} v${spec.version}: ${plural(spec.steps.length, 'step')}. Select a step to inspect it.`}
          />
        </div>
        {selected ? (
          <StepInspector
            spec={spec}
            step={selected}
            tracesUsed={compileReport.tracesUsed}
            onSelect={onSelectStep}
          />
        ) : (
          <aside
            className="rfx-inspector rfx-inspector--empty"
            data-testid="step-inspector"
            aria-label="Step inspector"
          >
            <p className="dim">
              Select a step in the graph to see why it exists, what it may do and when it hands
              control back.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
