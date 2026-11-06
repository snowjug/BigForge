import type { Trace, TraceEvent, VerificationReport } from '@bigforge/schemas';

/**
 * Trace timeline view model. Events keep the recorder's virtual clock (`offsetMs`: simulated model latency
 * plus measured local time). Steps of a Reflex run become parent rows; the calls inside their time window
 * nest under them. Baseline traces have no steps and stay flat.
 */

export type EventCategory =
  'model' | 'tool' | 'step' | 'decision' | 'safety' | 'note' | 'boundary' | 'verification';

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  model: 'Model calls',
  tool: 'Tool calls',
  step: 'Reflex steps',
  decision: 'Decisions',
  safety: 'Safety',
  note: 'Notes',
  boundary: 'Boundaries',
  verification: 'Verification',
};

export const CATEGORY_ORDER: readonly EventCategory[] = [
  'model',
  'tool',
  'step',
  'boundary',
  'decision',
  'safety',
  'note',
  'verification',
];

export type RowTone = 'ember' | 'steel' | 'crimson' | 'ash' | 'molten' | 'jade' | 'amber';

export type RowPayload =
  { type: 'event'; event: TraceEvent } | { type: 'verification'; report: VerificationReport };

export interface TimelineRow {
  key: string;
  seq: number;
  /** Virtual start (ms). */
  at: number;
  /** Virtual end (ms); equal to `at` for instants. */
  end: number;
  category: EventCategory;
  /** The short headline: a purpose, a command, a step title. */
  title: string;
  /** What the thing acted on: the command, file path, operator or question. */
  detail: string;
  tone: RowTone;
  /** 1 when nested under a Reflex step. */
  depth: 0 | 1;
  parentStepId: string | null;
  blocked: boolean;
  failed: boolean;
  /** `[REDACTED:...]` markers found in what the event recorded. */
  redactions: number;
  payload: RowPayload;
}

export const humanize = (value: string): string => value.replace(/[_-]+/g, ' ').trim();

const MARKER = /\[REDACTED:[A-Za-z0-9_-]+\]/g;

export function countMarkers(text: string): number {
  return text.match(MARKER)?.length ?? 0;
}

function markersIn(event: TraceEvent): number {
  switch (event.kind) {
    case 'model_call':
      return countMarkers(event.responsePreview) + countMarkers(JSON.stringify(event.toolCalls));
    case 'tool_call':
      return countMarkers(event.outputPreview) + countMarkers(JSON.stringify(event.args));
    case 'decision':
      return countMarkers(JSON.stringify(event.output));
    case 'note':
      return countMarkers(event.message);
    case 'step':
      return countMarkers(event.summary);
    default:
      return 0;
  }
}

function commandOf(args: Record<string, unknown>, tool: string): string {
  for (const key of ['command', 'path', 'file']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return tool;
}

function describe(
  event: TraceEvent,
): Pick<TimelineRow, 'category' | 'title' | 'detail' | 'tone' | 'blocked' | 'failed' | 'end'> {
  const at = event.offsetMs;
  switch (event.kind) {
    case 'model_call':
      return {
        category: 'model',
        title: event.boundaryStepId ? 'Boundary call' : 'Model call',
        detail: event.purpose ? humanize(event.purpose) : event.provider.model,
        tone: event.boundaryStepId ? 'molten' : 'ember',
        blocked: false,
        failed: false,
        end: at + event.latency.ms,
      };
    case 'tool_call':
      return {
        category: 'tool',
        title: event.tool,
        detail: commandOf(event.args, event.tool),
        tone: event.status === 'blocked' ? 'crimson' : 'steel',
        blocked: event.status === 'blocked',
        failed: event.status === 'error',
        end: at + event.durationMs,
      };
    case 'step':
      return {
        category: 'step',
        title: humanize(event.stepId),
        detail: event.operator.replace(/^local\./, ''),
        tone:
          event.status === 'stopped'
            ? 'crimson'
            : event.status === 'escalated'
              ? 'molten'
              : 'steel',
        blocked: false,
        failed: event.status === 'stopped',
        end: at + event.durationMs,
      };
    case 'decision':
      return {
        category: 'decision',
        title: humanize(event.intent),
        detail:
          event.by === 'model'
            ? 'decided by the model'
            : `decided by operator ${event.operator ?? ''}`.trim(),
        tone: 'amber',
        blocked: false,
        failed: false,
        end: at,
      };
    case 'safety':
      return {
        category: 'safety',
        title: event.blocked ? 'Blocked by safety policy' : 'Checked by safety policy',
        detail: event.action,
        tone: event.blocked ? 'crimson' : 'jade',
        blocked: event.blocked,
        failed: false,
        end: at,
      };
    case 'note':
      return {
        category: 'note',
        title: event.level === 'warn' ? 'Warning' : 'Note',
        detail: event.message,
        tone: event.level === 'warn' ? 'amber' : 'ash',
        blocked: false,
        failed: false,
        end: at,
      };
    case 'boundary':
      return {
        category: 'boundary',
        title: 'Uncertainty boundary',
        detail: event.question,
        tone: 'molten',
        blocked: false,
        failed: false,
        end: at,
      };
  }
}

const rank = (category: EventCategory): number => (category === 'step' ? 0 : 1);

export function buildTimeline(trace: Pick<Trace, 'events' | 'verification'>): TimelineRow[] {
  const rows: TimelineRow[] = trace.events.map((event) => {
    const described = describe(event);
    return {
      key: event.id,
      seq: event.seq,
      at: event.offsetMs,
      depth: 0,
      parentStepId: null,
      redactions: markersIn(event),
      payload: { type: 'event', event },
      ...described,
    };
  });
  rows.sort((a, b) => a.at - b.at || rank(a.category) - rank(b.category) || a.seq - b.seq);

  const steps = rows.filter(
    (row) =>
      row.category === 'step' && row.payload.type === 'event' && row.payload.event.kind === 'step',
  );
  for (const row of rows) {
    if (row.category === 'step') continue;
    const parent = steps.find((step) => step.at <= row.at && row.at < step.end);
    if (parent && parent.payload.type === 'event' && parent.payload.event.kind === 'step') {
      row.depth = 1;
      row.parentStepId = parent.payload.event.stepId;
    }
  }

  const finish = rows.reduce((max, row) => Math.max(max, row.end), 0);
  rows.push({
    key: 'verification-report',
    seq: Number.MAX_SAFE_INTEGER,
    at: finish,
    end: finish,
    category: 'verification',
    title: 'Verification report',
    detail: trace.verification.verifier,
    tone:
      trace.verification.status === 'pass'
        ? 'jade'
        : trace.verification.status === 'fail'
          ? 'crimson'
          : 'ash',
    depth: 0,
    parentStepId: null,
    blocked: false,
    failed: trace.verification.status === 'fail',
    redactions: 0,
    payload: { type: 'verification', report: trace.verification },
  });
  return rows;
}

export function categoryCounts(rows: readonly TimelineRow[]): Map<EventCategory, number> {
  const counts = new Map<EventCategory, number>();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  return counts;
}

export function filterRows(
  rows: readonly TimelineRow[],
  hidden: ReadonlySet<EventCategory>,
): TimelineRow[] {
  return rows.filter((row) => !hidden.has(row.category));
}

/** Length of the time axis the rows are drawn on. */
export function timelineSpan(rows: readonly TimelineRow[]): number {
  return Math.max(1, ...rows.map((row) => row.end));
}

/** Left offset and width of a row's bar as fractions (0..1) of the axis. A minimum width keeps instants visible. */
export function barGeometry(
  row: Pick<TimelineRow, 'at' | 'end'>,
  span: number,
  minWidth = 0.006,
): { left: number; width: number } {
  const left = Math.min(1, Math.max(0, row.at / span));
  const width = Math.max(minWidth, (row.end - row.at) / span);
  return {
    left: Math.min(left, 1 - minWidth),
    width: Math.min(width, 1 - Math.min(left, 1 - minWidth)),
  };
}
