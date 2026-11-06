import type { ConfidencePoint, DriftCheckDto, DriftVerdict } from '@bigforge/schemas';
import { niceFloor } from './scale';

export type ComparisonKind = 'shadow' | 'canary';

/** `ConfidencePoint.label` is "<kind> agree" or "<kind> disagree". Anything else is ignored. */
export function parseComparisonLabel(
  label: string,
): { kind: ComparisonKind; agree: boolean } | null {
  const match = /^(shadow|canary) (agree|disagree)$/.exec(label.trim());
  if (!match) return null;
  return { kind: match[1] === 'canary' ? 'canary' : 'shadow', agree: match[2] === 'agree' };
}

export interface TimelinePoint {
  /** 1-based position in time order across all comparisons. */
  index: number;
  /** Position on the x axis: the index plus a one-unit gap before each group after the first. */
  x: number;
  kind: ComparisonKind;
  agree: boolean;
  at: string;
  /** Agreement of its group up to and including this comparison (0..1). */
  running: number;
  groupId: string;
}

export interface TimelineGroup {
  id: string;
  kind: ComparisonKind;
  title: string;
  points: TimelinePoint[];
  checkId: string | null;
  verdict: DriftVerdict | null;
  envVersion: string | null;
  environmentChange: { from: string; to: string } | null;
}

export interface TimelineModel {
  groups: TimelineGroup[];
  points: TimelinePoint[];
  /** Right edge of the x domain. */
  xMax: number;
  /** Agreement of the shadow history (or the verdict's, when one exists). Null without either. */
  historic: number | null;
  floor: number;
  /** historic minus the drop threshold: the lowest agreement that is not yet a confirmed drop. */
  dropLine: number | null;
  dropThreshold: number;
  /** Lower bound of the y axis (a round 0..0.8). */
  yMin: number;
  /** Where the world changed: between the last shadow comparison and the first canary one. */
  environmentMarker: { x: number; label: string } | null;
}

interface TimelineInput {
  history: readonly ConfidencePoint[];
  checks: readonly DriftCheckDto[];
  config: { floor: number; dropThreshold: number };
}

const time = (iso: string): number => Date.parse(iso);

/**
 * Turns the confidence history (every shadow and canary comparison in time order) and the drift checks
 * into the agreement timeline: a running shadow agreement, then one running canary agreement per check,
 * with the floor and the maximum-drop lines the verdict is judged against.
 */
export function buildTimeline({ history, checks, config }: TimelineInput): TimelineModel {
  const sortedChecks = [...checks].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const parsed = history.flatMap((point, offset) => {
    const meta = parseComparisonLabel(point.label);
    return meta ? [{ ...meta, at: point.at, offset }] : [];
  });

  const bucketOf = (item: (typeof parsed)[number]): string => {
    if (item.kind === 'shadow') return 'shadow';
    const owner = sortedChecks.find((check) => time(check.createdAt) >= time(item.at));
    return owner ? owner.id : 'canary-pending';
  };

  const order: string[] = [];
  const buckets = new Map<string, typeof parsed>();
  for (const item of parsed) {
    const key = bucketOf(item);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)?.push(item);
  }

  const canaryGroups = order.filter((key) => key !== 'shadow');
  const groups: TimelineGroup[] = [];
  const points: TimelinePoint[] = [];
  let index = 0;
  order.forEach((key, groupIndex) => {
    const items = buckets.get(key) ?? [];
    const check = sortedChecks.find((c) => c.id === key) ?? null;
    let agreed = 0;
    const groupPoints = items.map((item, i): TimelinePoint => {
      index += 1;
      if (item.agree) agreed += 1;
      return {
        index,
        x: index + groupIndex,
        kind: item.kind,
        agree: item.agree,
        at: item.at,
        running: agreed / (i + 1),
        groupId: key,
      };
    });
    points.push(...groupPoints);
    const ordinal = canaryGroups.indexOf(key) + 1;
    groups.push({
      id: key,
      kind: key === 'shadow' ? 'shadow' : 'canary',
      title:
        key === 'shadow'
          ? 'Shadow history'
          : canaryGroups.length > 1
            ? `Canary ${ordinal}`
            : 'Drift Canary',
      points: groupPoints,
      checkId: check?.id ?? null,
      verdict: check?.verdict ?? null,
      envVersion: check?.envVersion ?? null,
      environmentChange: check?.detail.environmentChange ?? null,
    });
  });

  const shadow = groups.find((group) => group.kind === 'shadow');
  const latestVerdict = [...groups].reverse().find((group) => group.verdict)?.verdict ?? null;
  const shadowFinal = shadow?.points[shadow.points.length - 1]?.running ?? null;
  const historic = latestVerdict ? latestVerdict.historicAgreement : shadowFinal;

  const firstCanary = groups.find((group) => group.kind === 'canary');
  const firstCanaryPoint = firstCanary?.points[0];
  const lastShadowPoint = shadow?.points[shadow.points.length - 1];
  const environmentMarker =
    firstCanary && firstCanaryPoint && lastShadowPoint
      ? {
          x: (lastShadowPoint.x + firstCanaryPoint.x) / 2,
          label: firstCanary.environmentChange
            ? `forge-ci ${firstCanary.environmentChange.from} \u2192 ${firstCanary.environmentChange.to}`
            : `canary on forge-ci ${firstCanary.envVersion ?? '?'}`,
        }
      : null;

  const dropLine = historic === null ? null : historic - config.dropThreshold;
  const lowest = Math.min(
    1,
    config.floor,
    dropLine ?? 1,
    ...points.map((p) => p.running),
    ...groups.map((g) => g.verdict?.interval.low ?? 1),
  );
  const yMin = Math.min(0.8, Math.max(0, niceFloor(lowest - 0.06, 0.1)));
  const last = points[points.length - 1];

  return {
    groups,
    points,
    xMax: (last?.x ?? 0) + 1,
    historic,
    floor: config.floor,
    dropLine,
    dropThreshold: config.dropThreshold,
    yMin,
    environmentMarker,
  };
}

/** True when the floor and the maximum-drop line are close enough that one label should carry both. */
export function linesCoincide(model: TimelineModel): boolean {
  return model.dropLine !== null && Math.abs(model.dropLine - model.floor) < 0.005;
}
