import type { RootFailure } from '@bigforge/schemas';

/**
 * CI log view model: line numbers, severity, redaction markers and the lines that carry the root cause.
 * Everything is derived from the stored (already redacted) log and the run's recorded `rootFailure`.
 */

export type LogLevel = 'error' | 'warn' | 'ok' | 'info' | 'plain';

export interface LogSegment {
  text: string;
  /** Set for a `[REDACTED:kind]` marker. */
  redacted: string | null;
}

export interface LogLine {
  n: number;
  text: string;
  level: LogLevel;
  segments: LogSegment[];
  /** The line is part of the recorded root-cause error (its message or its location). */
  root: boolean;
  /** An error line other than the root cause: a consequence or a sibling failure. */
  consequence: boolean;
}

export interface LogModel {
  lines: LogLine[];
  /** Redaction markers per kind, most frequent first. */
  redactions: { kind: string; count: number }[];
  totalRedactions: number;
  errorCount: number;
  rootLines: number[];
}

export const REDACTION_PATTERN = /\[REDACTED:([A-Za-z0-9_-]+)\]/g;

export function splitRedactions(text: string): LogSegment[] {
  const segments: LogSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(REDACTION_PATTERN)) {
    const index = match.index;
    if (index > last) segments.push({ text: text.slice(last, index), redacted: null });
    segments.push({ text: match[0], redacted: match[1] ?? 'secret' });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), redacted: null });
  return segments.length > 0 ? segments : [{ text, redacted: null }];
}

export function countRedactions(text: string): { kind: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(REDACTION_PATTERN)) {
    const kind = match[1] ?? 'secret';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

export function levelOf(text: string): LogLevel {
  if (text.includes('\u2716')) return 'error';
  if (text.includes('\u26a0')) return 'warn';
  if (text.includes('\u2714')) return 'ok';
  if (text.includes('\u25b8')) return 'info';
  return 'plain';
}

const isContinuation = (text: string): boolean => /^\s+at\s/.test(text);
/** "[00:00.152] packages/auth  \u2716 error TS2305: ..." but not "\u2716 build failed". */
const isErrorHead = (text: string): boolean => /\u2716\s+error\b/.test(text);

/**
 * Marks the root-cause lines: the error line that names the recorded error code inside the root workspace,
 * and the `at file:line` line that follows it. Nothing is marked when no root failure is known.
 */
export function parseLog(log: string | null, root: RootFailure | null): LogModel {
  const raw = log === null ? [] : log.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const lines: LogLine[] = raw.map((text, index) => ({
    n: index + 1,
    text,
    level: isContinuation(text) ? 'error' : levelOf(text),
    segments: splitRedactions(text),
    root: false,
    consequence: false,
  }));

  const rootLines: number[] = [];
  if (root) {
    const location = root.file ? `${root.file}${root.line !== null ? `:${root.line}` : ''}` : null;
    const headIndex = lines.findIndex(
      (line) =>
        isErrorHead(line.text) &&
        line.text.includes(root.code) &&
        line.text.includes(root.workspace),
    );
    if (headIndex >= 0) {
      const head = lines[headIndex];
      if (head) {
        head.root = true;
        rootLines.push(head.n);
      }
      const next = lines[headIndex + 1];
      if (
        next &&
        isContinuation(next.text) &&
        (location === null || next.text.includes(location))
      ) {
        next.root = true;
        rootLines.push(next.n);
      }
    }
  }
  let errorCount = 0;
  for (const [index, line] of lines.entries()) {
    if (!isErrorHead(line.text)) continue;
    errorCount += 1;
    const next = lines[index + 1];
    if (!line.root) {
      line.consequence = true;
      if (next && isContinuation(next.text) && !next.root) next.consequence = true;
    }
  }
  const redactions = countRedactions(log ?? '');
  return {
    lines,
    redactions,
    totalRedactions: redactions.reduce((sum, entry) => sum + entry.count, 0),
    errorCount,
    rootLines,
  };
}
