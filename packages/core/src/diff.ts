import type { DiffLine } from '@bigforge/schemas';

/** Line diff (LCS) with a few lines of context, for showing patches to a reviewer. */
export function diffLines(before: string, after: string, context = 3): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = lcs[i] as number[];
      row[j] =
        a[i] === b[j]
          ? (lcs[i + 1] as number[])[j + 1]! + 1
          : Math.max((lcs[i + 1] as number[])[j]!, row[j + 1]!);
    }
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      all.push({ kind: 'context', text: a[i] as string, oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number)) {
      all.push({ kind: 'remove', text: a[i] as string, oldLine: i + 1, newLine: null });
      i += 1;
    } else {
      all.push({ kind: 'add', text: b[j] as string, oldLine: null, newLine: j + 1 });
      j += 1;
    }
  }
  for (; i < n; i += 1)
    all.push({ kind: 'remove', text: a[i] as string, oldLine: i + 1, newLine: null });
  for (; j < m; j += 1)
    all.push({ kind: 'add', text: b[j] as string, oldLine: null, newLine: j + 1 });

  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((line, idx) => {
    if (line.kind === 'context') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(all.length - 1, idx + context); k += 1)
      keep[k] = true;
  });
  return all.filter((_, idx) => keep[idx]);
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'remove').length,
  };
}
