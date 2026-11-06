/**
 * Text metrics without a DOM: widths come from the measured advances of the UI font (Geist,
 * weight 560, ASCII) and exactly 0.6em for the mono font, so labels can be wrapped and truncated
 * deterministically (and unit-tested) before anything is painted. The graph renders its text with
 * `text-rendering: geometricPrecision`, which keeps advances fractional and platform independent.
 */

/** Advance widths in 1/100 em for the printable ASCII range, starting at the space character. */
const ASCII_ADVANCES = [
  24, 24, 37, 54, 65, 81, 67, 19, 30, 30, 43, 56, 22, 42, 22, 50, 68, 42, 64, 63, 64, 65, 61, 54,
  64, 61, 30, 30, 55, 55, 55, 58, 94, 70, 69, 72, 71, 61, 60, 72, 72, 29, 61, 67, 59, 90, 75, 76,
  66, 75, 69, 66, 58, 70, 70, 98, 65, 61, 57, 37, 48, 37, 45, 56, 26, 57, 62, 57, 62, 59, 42, 62,
  60, 26, 30, 62, 29, 89, 60, 60, 62, 62, 40, 55, 42, 59, 58, 84, 62, 56, 56, 40, 28, 40, 52,
] as const;

const FIRST_CHAR = 32;
const FALLBACK_EM = 0.62;
const ELLIPSIS = '…';

/** Mono advance in em. */
export const MONO_EM = 0.6;

function advance(char: string): number {
  if (char === ELLIPSIS) return 0.9;
  const code = char.charCodeAt(0);
  const table = ASCII_ADVANCES[code - FIRST_CHAR];
  return table === undefined ? FALLBACK_EM : table / 100;
}

/** Estimated rendered width in px. */
export function textWidth(text: string, fontSize: number, mono = false): number {
  if (mono) return [...text].length * MONO_EM * fontSize;
  let total = 0;
  for (const char of text) total += advance(char);
  return total * fontSize;
}

/**
 * Shortens `text` to fit `maxWidth`, ending in an ellipsis when something was cut. With
 * `wholeWords` a cut inside a word backs up to the previous word boundary, so the visible label
 * stays a prefix of the full text made of complete words.
 */
export function truncateToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  mono = false,
  wholeWords = false,
): string {
  if (textWidth(text, fontSize, mono) <= maxWidth) return text;
  const chars = [...text];
  let out = '';
  let used = 0;
  for (const char of chars) {
    if (textWidth(out + char + ELLIPSIS, fontSize, mono) > maxWidth) break;
    out += char;
    used += 1;
  }
  if (wholeWords) {
    const next = chars[used];
    const lastSpace = out.lastIndexOf(' ');
    if (next !== undefined && next !== ' ' && lastSpace > 0) out = out.slice(0, lastSpace);
  }
  return out.trimEnd() + ELLIPSIS;
}

export interface WrappedText {
  lines: string[];
  truncated: boolean;
}

/** Splits a word wider than `maxWidth` into the part that fits and the rest. */
function splitWord(word: string, maxWidth: number, fontSize: number): [string, string] {
  const chars = [...word];
  let head = '';
  let used = 0;
  for (const char of chars) {
    if (used > 0 && textWidth(head + char, fontSize) > maxWidth) break;
    head += char;
    used += 1;
  }
  return [head, chars.slice(used).join('')];
}

/**
 * Greedy word wrap into at most `maxLines` lines. Words wider than a line are split; whatever does
 * not fit ends the last line with an ellipsis (`truncated` is then true).
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
): WrappedText {
  const queue = text.split(/\s+/).filter(Boolean);
  if (queue.length === 0) return { lines: [''], truncated: false };
  const limit = Math.max(1, Math.floor(maxLines));
  const lines: string[] = [];
  let line = '';
  while (queue.length > 0) {
    const word = queue[0] as string;
    const candidate = line === '' ? word : `${line} ${word}`;
    if (textWidth(candidate, fontSize) <= maxWidth) {
      line = candidate;
      queue.shift();
      continue;
    }
    if (line !== '') {
      lines.push(line);
      line = '';
    } else {
      const [head, tail] = splitWord(word, maxWidth, fontSize);
      lines.push(head);
      if (tail === '') queue.shift();
      else queue[0] = tail;
    }
    if (lines.length === limit) break;
  }
  if (line !== '' && lines.length < limit) {
    lines.push(line);
    line = '';
  }
  if (queue.length === 0 && line === '') return { lines, truncated: false };

  const last = lines.length - 1;
  const rest = [lines[last] as string, ...queue, ...(line === '' ? [] : [line])].join(' ');
  lines[last] = truncateToWidth(rest, maxWidth, fontSize, false, true);
  return { lines, truncated: true };
}
