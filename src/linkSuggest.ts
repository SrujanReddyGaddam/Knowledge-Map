import data, { type Note } from 'virtual:vault';

// [[ autocomplete candidates: suggest notes by file name, then title, then path; same-vault notes first.
export type Cand = { base: string; title: string; path: string; vault: string };
const baseOf = (n: Note) => (n.path.split('/').pop() || '').replace(/\.md$/i, '');
let all: Cand[] | null = null;
export const candidates = () => (all ??= data.notes.filter(n => n.kind !== 'drawing').map(n => ({ base: baseOf(n), title: n.title, path: n.path, vault: n.vault })));
const subseq = (q: string, t: string) => { let i = 0; for (const c of t) if (c === q[i] && ++i === q.length) return true; return q.length === 0; };
export function suggest(q: string, vault: string, limit = 8): Cand[] {
  const ql = q.trim().toLowerCase(), out: { c: Cand; s: number }[] = [];
  for (const c of candidates()) {
    const b = c.base.toLowerCase(), t = c.title.toLowerCase();
    let s = 0;
    if (!ql) s = 1;
    else if (b === ql) s = 100;
    else if (b.startsWith(ql)) s = 80;
    else if (b.includes(ql)) s = 60;
    else if (t.includes(ql)) s = 50;
    else if (c.path.toLowerCase().includes(ql)) s = 30;
    else if (subseq(ql, b)) s = 15;
    if (s) out.push({ c, s: s + (c.vault === vault ? 5 : 0) });
  }
  return out.sort((a, b) => b.s - a.s || a.c.base.length - b.c.base.length || a.c.base.localeCompare(b.c.base)).slice(0, limit).map(x => x.c);
}
