import { useState } from 'react';
import type { ComparisonDto, DriftCheckDto, EnvironmentDto, ReflexSpec } from '@bigforge/schemas';
import { Chip } from '../../ui';
import { ForgeGraph, type NodeBadge } from '../../viz';
import { describeFracture, fractureStates, stepAssumptions } from './model';
import { StageHead } from './parts';

interface FracturePanelProps {
  spec: ReflexSpec;
  check: DriftCheckDto | null;
  comparisons: readonly ComparisonDto[];
  environment: EnvironmentDto;
}

/** The Reflex's steps with a crimson fracture across the step that diverged most often; downstream is dimmed. */
export function FracturePanel({ spec, check, comparisons, environment }: FracturePanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const details = comparisons
    .filter((item) => !item.agree && item.comparison.divergence.kind !== 'none')
    .map((item) => item.comparison.divergence.detail);
  const info = describeFracture({
    check,
    steps: spec.steps,
    assumptions: spec.provenance.assumptions,
    details,
    environment,
  });
  const states = info ? fractureStates(spec.steps, info.stepId) : {};
  const badges: Record<string, NodeBadge> = {};
  if (check) {
    for (const entry of check.detail.firstDivergence) {
      if (entry.stepId)
        badges[entry.stepId] = {
          text: `${entry.count} of ${check.detail.sample}`,
          tone: 'crimson',
        };
    }
  }
  const selected = spec.steps.find((step) => step.id === selectedId) ?? null;
  const selectedAssumptions = selected
    ? stepAssumptions(spec.provenance.assumptions, selected.id)
    : [];

  return (
    <section className="drift-stage drift-stage--sub" aria-labelledby="drift-fracture-title">
      <StageHead
        id="drift-fracture-title"
        title="Where it broke"
        lede={
          info
            ? 'The step that diverged most often carries the fracture. Everything after it is dimmed: it never got a trustworthy input.'
            : 'The Reflex as compiled. Run the canary to see which step the changed world breaks.'
        }
        state={
          info
            ? { label: `fracture at ${info.stepId}`, tone: 'crimson' }
            : { label: 'no divergence', tone: 'ash' }
        }
      />
      <div className="drift-fracture">
        <div className="drift-fracture__graph" data-testid="forge-graph">
          <ForgeGraph
            steps={spec.steps}
            states={states}
            selectedId={selectedId}
            onSelect={setSelectedId}
            badges={badges}
            {...(info ? { fracture: { stepId: info.stepId, label: info.label } } : {})}
            ariaLabel={
              info
                ? `Reflex steps of ${spec.name}. Fracture at ${info.stepTitle}: ${info.label} canary tasks. Steps after it are dimmed.`
                : `Reflex steps of ${spec.name}. No drift has been detected.`
            }
          />
        </div>

        {info ? (
          <aside
            className="drift-fracture__why"
            data-testid="drift-fracture"
            aria-label="What diverged and why"
          >
            <div className="drift-fracture__col">
              <p className="micro">What diverged</p>
              <p className="drift-fracture__headline">{info.headline}</p>
              {info.detail ? <p className="drift-fracture__detail">{info.detail}</p> : null}
            </div>
            <div className="drift-fracture__col">
              <p className="micro">Why</p>
              {info.cause ? <p>{info.cause}</p> : null}
              {info.assumption ? (
                <p className="drift-fracture__assumption">
                  <Chip tone="amber" size="sm" dashed>
                    compiler assumption
                  </Chip>{' '}
                  The compiler recorded that this step <em>{info.assumption}</em>. The new toolchain
                  no longer honours it.
                </p>
              ) : null}
            </div>
            {info.stoppedAt ? (
              <div className="drift-fracture__col">
                <p className="micro">What the Reflex did</p>
                <p className="drift-fracture__stop">
                  It did not improvise: it stopped safely at &ldquo;{info.stoppedAt}&rdquo; and
                  handed back to the baseline.
                </p>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      {selected ? (
        <div className="drift-stepinfo" aria-live="polite">
          <p className="drift-stepinfo__title">
            {selected.title}{' '}
            <span className="mono faint">
              {selected.operator.id}@{selected.operator.version}
            </span>
          </p>
          <p className="faint">
            {selected.kind} step &middot; replaces{' '}
            {selected.rationale.replaces.length > 0
              ? selected.rationale.replaces.join(', ')
              : 'no baseline behaviour'}
            {selected.dependsOn.length > 0 ? ` · depends on ${selected.dependsOn.join(', ')}` : ''}
          </p>
          {selected.rationale.selectedBecause ? <p>{selected.rationale.selectedBecause}</p> : null}
          {selectedAssumptions.map((text) => (
            <p key={text} className="drift-stepinfo__assumption">
              {text}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
