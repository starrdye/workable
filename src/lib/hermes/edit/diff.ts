/**
 * edit/diff.ts — line diff for the change preview. Plain LCS: the files it
 * sees (SOUL.md, small YAML) are tens of lines, so O(n·m) is fine.
 */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const n = a.length, m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ kind: 'del', text: a[i++] }); }
    else { out.push({ kind: 'add', text: b[j++] }); }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** Collapse long runs of unchanged lines, keeping `context` lines around each change. */
export function withContext(lines: DiffLine[], context = 3): Array<DiffLine | { kind: 'gap'; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.kind === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: Array<DiffLine | { kind: 'gap'; count: number }> = [];
  let gap = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (gap) { out.push({ kind: 'gap', count: gap }); gap = 0; }
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ kind: 'gap', count: gap });
  return out;
}
