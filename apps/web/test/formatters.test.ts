import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  formatCount,
  formatDuration,
  formatMs,
  formatMultiple,
  formatPct,
  formatTimestamp,
  formatTokens,
  formatUsd,
  initials,
  plural,
  relativeTime,
  shortHash,
} from '../src/ui/formatters';

describe('formatTokens / formatCount', () => {
  it('groups thousands and keeps exact values by default', () => {
    expect(formatTokens(18400)).toBe('18,400');
    expect(formatTokens(1050)).toBe('1,050');
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('abbreviates in compact mode with three significant digits', () => {
    expect(formatTokens(18400, { compact: true })).toBe('18.4k');
    expect(formatTokens(1050, { compact: true })).toBe('1.05k');
    expect(formatTokens(184000, { compact: true })).toBe('184k');
    expect(formatTokens(100000, { compact: true })).toBe('100k');
    expect(formatTokens(1_240_000, { compact: true })).toBe('1.24M');
    expect(formatTokens(950, { compact: true })).toBe('950');
  });

  it('uses a true minus sign and renders missing data as an em dash', () => {
    expect(formatTokens(-1200)).toBe('\u22121,200');
    expect(formatTokens(null)).toBe(EMPTY);
    expect(formatTokens(undefined)).toBe(EMPTY);
    expect(formatTokens(Number.NaN)).toBe(EMPTY);
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe(EMPTY);
  });

  it('does not render negative zero', () => {
    expect(formatTokens(-0.2)).toBe('0');
  });
});

describe('formatUsd', () => {
  it('uses two decimals from one dollar and adaptive precision below', () => {
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(0.034)).toBe('$0.034');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
  });

  it('renders negative cost ROI with a minus sign that cannot wrap away from the dollar sign', () => {
    expect(formatUsd(-12.5)).toBe('\u2212\u2060$12.50');
    expect(formatUsd(-0.00001)).toBe('\u2212\u2060<$0.0001');
  });

  it('supports compact and fixed-digit modes', () => {
    expect(formatUsd(1250, { compact: true })).toBe('$1.25k');
    expect(formatUsd(2_400_000, { compact: true })).toBe('$2.4M');
    expect(formatUsd(3.14159, { digits: 3 })).toBe('$3.142');
    expect(formatUsd(null)).toBe(EMPTY);
  });
});

describe('formatMs / formatDuration', () => {
  it('scales latency units', () => {
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(0.4)).toBe('<1 ms');
    expect(formatMs(842)).toBe('842 ms');
    expect(formatMs(1840)).toBe('1.84 s');
    expect(formatMs(12340)).toBe('12.3 s');
    expect(formatMs(125000)).toBe('2 m 05 s');
    expect(formatMs(undefined)).toBe(EMPTY);
  });

  it('formats long spans coarsely', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(125_000)).toBe('2 m 05 s');
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12 m');
    expect(formatDuration(4 * 86_400_000 + 2 * 3_600_000)).toBe('4 d 2 h');
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(null)).toBe(EMPTY);
  });
});

describe('formatPct / formatMultiple', () => {
  it('formats ratios and trims needless zeros', () => {
    expect(formatPct(0.943)).toBe('94.3%');
    expect(formatPct(0.95)).toBe('95%');
    expect(formatPct(1)).toBe('100%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(0.9432, { digits: 2 })).toBe('94.32%');
    expect(formatPct(0.943, { digits: 0 })).toBe('94%');
    expect(formatPct(null)).toBe(EMPTY);
  });

  it('supports percent-scale input and signed deltas', () => {
    expect(formatPct(94.3, { scale: 'percent' })).toBe('94.3%');
    expect(formatPct(0.052, { signed: true })).toBe('+5.2%');
    expect(formatPct(-0.1, { signed: true })).toBe('\u221210%');
    expect(formatPct(0, { signed: true })).toBe('0%');
  });

  it('formats multiples', () => {
    expect(formatMultiple(5.52)).toBe('5.5\u00d7');
    expect(formatMultiple(10)).toBe('10\u00d7');
    expect(formatMultiple(-2)).toBe('\u22122\u00d7');
    expect(formatMultiple(null)).toBe(EMPTY);
  });
});

describe('shortHash', () => {
  it('shortens hashes and strips algorithm prefixes', () => {
    expect(shortHash('e34f77d98a4e6d84cdab65e501a1f3bd')).toBe('e34f77d9');
    expect(shortHash('sha256:e34f77d98a4e6d84')).toBe('e34f77d9');
    expect(shortHash('e34f77d98a4e6d84', 12)).toBe('e34f77d98a4e');
    expect(shortHash('e34f77d98a4e6d84', 8, { ellipsis: true })).toBe('e34f77d9\u2026');
  });

  it('leaves short or missing values alone', () => {
    expect(shortHash('abc123')).toBe('abc123');
    expect(shortHash('')).toBe(EMPTY);
    expect(shortHash(null)).toBe(EMPTY);
  });
});

describe('relativeTime / formatTimestamp', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('describes the recent past in the largest sensible unit', () => {
    expect(relativeTime(ago(2_000), now)).toBe('just now');
    expect(relativeTime(ago(12_000), now)).toBe('12 s ago');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2 d ago');
  });

  it('falls back to the calendar date after a week and handles the future', () => {
    expect(relativeTime(ago(10 * 86_400_000), now)).toBe('2026-10-27');
    expect(relativeTime(new Date(now + 5 * 60_000).toISOString(), now)).toBe('in 5 min');
  });

  it('is safe for missing and invalid input', () => {
    expect(relativeTime(null, now)).toBe(EMPTY);
    expect(relativeTime('not a date', now)).toBe(EMPTY);
    expect(formatTimestamp('2026-11-06T08:39:20.822Z')).toBe('2026-11-06 08:39:20 UTC');
    expect(formatTimestamp(undefined)).toBe(EMPTY);
  });
});

describe('text helpers', () => {
  it('pluralises with grouping', () => {
    expect(plural(1, 'run')).toBe('1 run');
    expect(plural(3, 'run')).toBe('3 runs');
    expect(plural(1200, 'family', 'families')).toBe('1,200 families');
  });

  it('derives avatar initials', () => {
    expect(initials('Grace Lindqvist')).toBe('GL');
    expect(initials('ada')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(initials('Mary Jane Watson')).toBe('MW');
  });
});
