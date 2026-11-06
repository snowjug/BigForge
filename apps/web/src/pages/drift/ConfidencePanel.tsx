import type {
  ConfidencePoint,
  DriftCheckDto,
  DriftViewDto,
  ReflexVersionSummaryDto,
} from '@bigforge/schemas';
import { Provenance, Sparkline, Summary, formatPct, formatTimestamp } from '../../ui';
import { AgreementTimeline, ConfidenceGauge, buildTimeline } from '../../viz/charts';
import { useDemoTarget } from '../../demo/useDemo';
import { confidenceFall } from './model';
import { StageHead } from './parts';

interface ConfidencePanelProps {
  version: ReflexVersionSummaryDto | null;
  history: readonly ConfidencePoint[];
  checks: readonly DriftCheckDto[];
  latest: DriftCheckDto | null;
  config: DriftViewDto['config'];
}

const pct = (value: number): string => formatPct(value, { digits: 0 });

/** Trust is earned and expires: agreement over time against the floor, and the confidence that falls with it. */
export function ConfidencePanel({
  version,
  history,
  checks,
  latest,
  config,
}: ConfidencePanelProps) {
  const target = useDemoTarget('confidence_falls');
  const model = buildTimeline({ history, checks, config });
  const confidence = version ? confidenceFall(latest, version.confidence, config.watchBelow) : null;
  const verdict = latest?.verdict ?? null;
  const interval = version?.trust.interval ?? null;

  const timelineLabel = (() => {
    const shadow = model.groups.find((group) => group.kind === 'shadow');
    const canary = [...model.groups].reverse().find((group) => group.kind === 'canary');
    const parts: string[] = [];
    if (shadow) {
      const agreed = shadow.points.filter((p) => p.agree).length;
      parts.push(`Shadow history: ${agreed} of ${shadow.points.length} comparisons agreed`);
    }
    if (canary) {
      const agreed = canary.points.filter((p) => p.agree).length;
      parts.push(`Canary: ${agreed} of ${canary.points.length} agreed`);
    }
    if (verdict) {
      parts.push(
        `The drop is ${Math.round(verdict.drop * 100)} points against a maximum of ${Math.round(config.dropThreshold * 100)} and a floor of ${pct(config.floor)}`,
      );
    }
    return `Agreement timeline. ${parts.join('. ')}.`;
  })();

  return (
    <section
      className="drift-stage"
      id="drift-confidence"
      aria-labelledby="drift-confidence-title"
      {...target}
    >
      <StageHead
        n={3}
        id="drift-confidence-title"
        title="Confidence falls"
        lede="Trust is earned and it expires. Recent agreement drops below the floor, and the Reflex's confidence drops with it."
        state={
          confidence?.fell
            ? {
                label: `down ${Math.abs(Math.round((confidence.delta ?? 0) * 100))} points`,
                tone: 'crimson',
              }
            : model.points.length > 0
              ? { label: 'holding', tone: 'jade' }
              : { label: 'no history yet', tone: 'ash' }
        }
      />
      {model.points.length === 0 ? (
        <p className="drift-empty-line">
          No shadow or canary comparisons exist for this Reflex yet. Run Shadow Brain (demo steps 8
          to 10), then the Drift Canary.
        </p>
      ) : (
        <div className="drift-confidence">
          <div className="drift-confidence__timeline" data-testid="agreement-timeline">
            <AgreementTimeline model={model} ariaLabel={timelineLabel} />
            <Summary
              caption="Agreement per comparison"
              description={`${timelineLabel} Each row is one comparison in time order with the running agreement of its group.`}
              rows={model.points}
              getRowId={(point) => String(point.index)}
              columns={[
                { id: 'n', header: '#', cell: (point) => point.index, mono: true, align: 'end' },
                {
                  id: 'group',
                  header: 'Group',
                  cell: (point) =>
                    model.groups.find((g) => g.id === point.groupId)?.title ?? point.kind,
                },
                {
                  id: 'at',
                  header: 'When',
                  cell: (point) => formatTimestamp(point.at),
                  mono: true,
                },
                {
                  id: 'agree',
                  header: 'Result',
                  cell: (point) => (point.agree ? 'agree' : 'disagree'),
                },
                {
                  id: 'running',
                  header: 'Running agreement',
                  cell: (point) => pct(point.running),
                  mono: true,
                  align: 'end',
                },
              ]}
            />
          </div>

          {confidence && version ? (
            <div className="drift-confidence__gauge" data-testid="confidence-gauge">
              <ConfidenceGauge
                before={confidence.before}
                after={confidence.after}
                watchBelow={config.watchBelow}
                interval={interval}
                ariaLabel={`Confidence ${pct(confidence.after)}${confidence.before !== null ? `, was ${pct(confidence.before)} before the canary` : ''}. An active Reflex goes on watch below ${pct(config.watchBelow)}.`}
              />
              <Sparkline
                data={history.map((point) => point.confidence)}
                label="Confidence after each comparison"
                width={300}
                height={44}
                min={0}
                max={1}
                threshold={config.watchBelow}
                tone={confidence.belowWatch ? 'crimson' : 'steel'}
                format={pct}
              />
              <p className="drift-confidence__note">
                confidence = (agreements + 1) &divide; (n + 2) over the most recent 12 comparisons.{' '}
                <Provenance kind="estimated" metric="reflex_confidence" />
              </p>
              {interval ? (
                <p className="drift-confidence__note">
                  90% interval {pct(interval.low)} to {pct(interval.high)}. Watch below{' '}
                  {pct(config.watchBelow)}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
