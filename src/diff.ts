// Minimal line diff (longest common subsequence). Inputs are normalized to LF by the caller.
export type Line = { t: 'same' | 'add' | 'del'; s: string };
export function lineDiff(a: string, b: string): Line[] | null {
  const x = a.split('\n'), y = b.split('\n');
  // trim the shared head and tail first so small edits in big files stay cheap
  let h = 0; while (h < x.length && h < y.length && x[h] === y[h]) h++;
  let e = 0; while (e < x.length - h && e < y.length - h && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const A = x.slice(h, x.length - e), B = y.slice(h, y.length - e);
  if (A.length * B.length > 4_000_000) return null;                      // too big to diff here
  const w = B.length + 1, L = new Uint32Array((A.length + 1) * w);
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const out: Line[] = x.slice(0, h).map(s => ({ t: 'same' as const, s }));
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ t: 'same', s: A[i] }); i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) out.push({ t: 'del', s: A[i++] });
    else out.push({ t: 'add', s: B[j++] });
  }
  while (i < A.length) out.push({ t: 'del', s: A[i++] });
  while (j < B.length) out.push({ t: 'add', s: B[j++] });
  return out.concat(x.slice(x.length - e).map(s => ({ t: 'same' as const, s })));
}
