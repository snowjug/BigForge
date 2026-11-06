/** Pure geometry for sparklines (unit-tested). Coordinates are in the SVG viewBox. */

export interface SparklineGeometry {
  /** `M x y L x y ...` for the line, or an empty string when there are fewer than two points. */
  line: string;
  /** Closed path under the line, for an area fill. */
  area: string;
  points: { x: number; y: number }[];
  /** The y coordinate of the threshold, when one was given and lies inside the range. */
  thresholdY: number | null;
  min: number;
  max: number;
}

export interface SparklineInput {
  data: readonly number[];
  width: number;
  height: number;
  /** Space kept free around the line so the stroke and end dot are not clipped. */
  padding?: number;
  /** Fixed scale bounds. Defaults to the data range (expanded when flat). */
  min?: number;
  max?: number;
  threshold?: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

export function sparklineGeometry(input: SparklineInput): SparklineGeometry {
  const { width, height } = input;
  const padding = input.padding ?? 3;
  const values = input.data.filter((value) => Number.isFinite(value));
  const dataMin = values.length ? Math.min(...values) : 0;
  const dataMax = values.length ? Math.max(...values) : 1;
  let min = input.min ?? dataMin;
  let max = input.max ?? dataMax;
  if (max - min < Number.EPSILON) {
    // A flat series is drawn mid-height instead of collapsing onto an edge.
    min -= 0.5;
    max += 0.5;
  }

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const xAt = (index: number): number =>
    values.length === 1 ? width / 2 : padding + (innerWidth * index) / (values.length - 1);
  const yAt = (value: number): number => {
    const ratio = (value - min) / (max - min);
    return padding + innerHeight * (1 - Math.min(Math.max(ratio, 0), 1));
  };

  const points = values.map((value, index) => ({ x: round(xAt(index)), y: round(yAt(value)) }));
  const line =
    points.length >= 2
      ? points.map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
      : '';
  const first = points[0];
  const last = points[points.length - 1];
  const area =
    line && first && last
      ? `${line} L${last.x} ${height - padding} L${first.x} ${height - padding} Z`
      : '';
  const thresholdY =
    input.threshold !== undefined && input.threshold >= min && input.threshold <= max
      ? round(yAt(input.threshold))
      : null;

  return { line, area, points, thresholdY, min, max };
}
