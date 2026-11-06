/**
 * Pure formatting helpers. No React, no DOM, no clock access unless a `now` argument is omitted.
 * Every function renders `null`, `undefined` and non-finite numbers as an em dash so tables stay honest
 * about missing data instead of showing a misleading zero.
 */

export const EMPTY = '\u2014';
const MINUS = '\u2212';

type Maybe<T> = T | null | undefined;

const isNumber = (value: Maybe<number>): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Drops trailing zeros after a decimal point only: "95.0" -> "95", but "100" stays "100". */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** Rounds to 3 significant digits and drops trailing zeros: 18.4, 1.05, 184. */
function threeSignificant(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return trimZeros(value.toFixed(digits));
}

function withSign(negative: boolean, text: string): string {
  return negative ? `${MINUS}${text}` : text;
}

/** A word joiner keeps the minus attached to the currency symbol, which would otherwise be a line-break point. */
function withUsdSign(negative: boolean, text: string): string {
  return negative ? `${MINUS}\u2060${text}` : text;
}

/** Whole numbers with thousands separators: 18400 -> "18,400". `compact` gives "18.4k" / "1.24M". */
export function formatCount(value: Maybe<number>, options: { compact?: boolean } = {}): string {
  if (!isNumber(value)) return EMPTY;
  const negative = value < 0;
  const abs = Math.abs(value);
  if (options.compact && abs >= 1_000_000) {
    return withSign(negative, `${threeSignificant(abs / 1_000_000)}M`);
  }
  if (options.compact && abs >= 1_000) {
    return withSign(negative, `${threeSignificant(abs / 1_000)}k`);
  }
  return withSign(negative && Math.round(abs) !== 0, grouped.format(Math.round(abs)));
}

/** Token counts. The unit is rendered by the caller (a `Metric` unit or a column header). */
export function formatTokens(value: Maybe<number>, options: { compact?: boolean } = {}): string {
  return formatCount(value, options);
}

/**
 * US dollars with adaptive precision, because model costs are tiny: >= $1 two decimals, >= $0.01 three,
 * below that four. Negative values use a true minus sign (cost ROI can be negative).
 */
export function formatUsd(
  value: Maybe<number>,
  options: { compact?: boolean; digits?: number } = {},
): string {
  if (!isNumber(value)) return EMPTY;
  const negative = value < 0;
  const abs = Math.abs(value);
  if (options.digits !== undefined) {
    return withUsdSign(
      negative,
      `$${abs.toLocaleString('en-US', { minimumFractionDigits: options.digits, maximumFractionDigits: options.digits })}`,
    );
  }
  if (abs === 0) return '$0.00';
  if (abs < 0.0001) return withUsdSign(negative, '<$0.0001');
  if (options.compact && abs >= 1_000_000) {
    return withUsdSign(negative, `$${threeSignificant(abs / 1_000_000)}M`);
  }
  if (options.compact && abs >= 1_000) {
    return withUsdSign(negative, `$${threeSignificant(abs / 1_000)}k`);
  }
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  const text = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return withUsdSign(negative, `$${text}`);
}

/** Latency-scale durations: "842 ms", "1.84 s", "12.3 s", then "2 m 05 s". */
export function formatMs(value: Maybe<number>): string {
  if (!isNumber(value)) return EMPTY;
  const negative = value < 0;
  const abs = Math.abs(value);
  if (abs === 0) return '0 ms';
  if (abs < 1) return withSign(negative, '<1 ms');
  if (abs < 1_000) return withSign(negative, `${Math.round(abs)} ms`);
  if (abs < 10_000) return withSign(negative, `${(abs / 1_000).toFixed(2)} s`);
  if (abs < 60_000) return withSign(negative, `${(abs / 1_000).toFixed(1)} s`);
  return withSign(negative, formatDuration(abs));
}

/** Coarse human durations for longer spans: "45 s", "2 m 05 s", "3 h 12 m", "4 d 2 h". */
export function formatDuration(value: Maybe<number>): string {
  if (!isNumber(value)) return EMPTY;
  const negative = value < 0;
  const totalSeconds = Math.round(Math.abs(value) / 1_000);
  if (totalSeconds < 60) return withSign(negative && totalSeconds > 0, `${totalSeconds} s`);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return withSign(negative, `${minutes} m ${String(seconds).padStart(2, '0')} s`);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return withSign(negative, `${hours} h ${String(minutes % 60).padStart(2, '0')} m`);
  }
  return withSign(negative, `${Math.floor(hours / 24)} d ${hours % 24} h`);
}

/**
 * Ratios (0..1) as percentages: 0.943 -> "94.3%", 0.95 -> "95%". Pass `scale: 'percent'` for values
 * that are already 0..100. `signed` adds an explicit "+" for deltas.
 */
export function formatPct(
  value: Maybe<number>,
  options: { digits?: number; scale?: 'ratio' | 'percent'; signed?: boolean } = {},
): string {
  if (!isNumber(value)) return EMPTY;
  const percent = options.scale === 'percent' ? value : value * 100;
  const digits = options.digits ?? 1;
  const text = Math.abs(percent).toFixed(digits);
  const trimmed = trimZeros(text);
  if (percent < 0 && Number(text) !== 0) return `${MINUS}${trimmed}%`;
  return `${options.signed && Number(text) !== 0 ? '+' : ''}${trimmed}%`;
}

/** Multiples such as ROI: 5.52 -> "5.5\u00d7". */
export function formatMultiple(value: Maybe<number>, digits = 1): string {
  if (!isNumber(value)) return EMPTY;
  const text = trimZeros(Math.abs(value).toFixed(digits));
  return `${value < 0 ? MINUS : ''}${text}\u00d7`;
}

/** First characters of a hash, without an algorithm prefix: "sha256:e34f77d9\u2026" -> "e34f77d9". */
export function shortHash(
  hash: Maybe<string>,
  length = 8,
  options: { ellipsis?: boolean } = {},
): string {
  if (!hash) return EMPTY;
  const bare = hash.replace(/^(sha\d+|blake\d*|md5):/i, '');
  if (bare.length <= length) return bare;
  return options.ellipsis ? `${bare.slice(0, length)}\u2026` : bare.slice(0, length);
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toMillis(input: string | number | Date): number {
  if (input instanceof Date) return input.getTime();
  return typeof input === 'number' ? input : Date.parse(input);
}

/** "just now", "12 s ago", "5 min ago", "3 h ago", "2 d ago", then the calendar date. Future times use "in ...". */
export function relativeTime(
  input: Maybe<string | number | Date>,
  now: number | Date = Date.now(),
): string {
  if (input === null || input === undefined) return EMPTY;
  const then = toMillis(input);
  if (!Number.isFinite(then)) return EMPTY;
  const diff = toMillis(now) - then;
  const abs = Math.abs(diff);
  if (abs < 5 * SECOND) return 'just now';
  let text: string;
  if (abs < MINUTE) text = `${Math.round(abs / SECOND)} s`;
  else if (abs < HOUR) text = `${Math.round(abs / MINUTE)} min`;
  else if (abs < DAY) text = `${Math.round(abs / HOUR)} h`;
  else if (abs < 7 * DAY) text = `${Math.round(abs / DAY)} d`;
  else return new Date(then).toISOString().slice(0, 10);
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** Precise UTC timestamp for logs: "2026-11-06 08:39:20 UTC". */
export function formatTimestamp(input: Maybe<string | number | Date>): string {
  if (input === null || input === undefined) return EMPTY;
  const then = toMillis(input);
  if (!Number.isFinite(then)) return EMPTY;
  return `${new Date(then).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** "1 run", "3 runs"; pass the plural form for irregular words. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${grouped.format(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Up to two initials for avatars: "Grace Lindqvist" -> "GL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}
