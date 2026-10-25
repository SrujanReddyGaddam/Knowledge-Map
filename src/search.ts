import type { Note } from 'virtual:vault';

// Search: every word must match somewhere (AND), names are matched fuzzily, text matches come with a snippet.
// Punctuation is loose: "release-22", "release 22" and "release22" find each other, a pasted [[link|alias]] searches its target,
// and a word of 5+ letters may have one typo (missing, extra, wrong or swapped letter) against a word of the name.
// Syntax:  word word   "exact phrase"   -exclude   tag:foo   vault:name   path:folder
//          any frontmatter field: type:bug  customer:acme  status:current  -sensitivity:personal  (substring match, case-insensitive)

export type Scope = 'names' | 'all';
export type Hit = { note: Note; score: number; where: 'name' | 'meta' | 'text'; snippet?: string };
export type Result = { hits: Hit[]; terms: string[] };

type Ix = { note: Note; fields: Record<string, string>; title: string; file: string; path: string; vault: string; tags: string[]; tagStr: string; summary: string; plain: string; plainLower: string;
  titleC: string; fileC: string; plainC: string; nameWords: string[] };

// compact form: letters and digits only, so separators never decide a match
const compact = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '');
const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3);

const strip = (md: string) => md
  .replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/(^|\n)\s*[-+*>]\s+/g, '$1').replace(/[#*_`|~]+/g, ' ').replace(/\s+/g, ' ').trim();

let fieldKeys = new Set<string>();   // only real frontmatter keys act as operators, so "https://..." stays a plain word
export function buildIndex(notes: Note[]): Ix[] {
  fieldKeys = new Set(['type', 'customer', 'project', 'sensitivity', 'status']);
  return notes.map(n => {
    const plain = strip(n.body);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.meta)) { fields[k] = v.toLowerCase(); fieldKeys.add(k); }
    Object.assign(fields, { type: n.type, customer: n.customer, project: n.project, component: n.component, sensitivity: n.sensitivity, status: n.status === 'none' || n.status === 'unknown' ? '' : n.status });
    const title = n.title.toLowerCase(), file = (n.path.split('/').pop() || '').replace(/\.md$/i, '').replace(/\.excalidraw$/i, '').toLowerCase(), plainLower = plain.toLowerCase();
    return {
      note: n, fields, title, file, titleC: compact(title), fileC: compact(file), plainC: compact(plainLower), nameWords: [...new Set([...wordsOf(title), ...wordsOf(file)])],
      path: n.path.toLowerCase(), vault: n.vault.toLowerCase(), tags: n.tags.map(t => t.toLowerCase()), tagStr: n.tags.join(' ').toLowerCase(),
      summary: n.summary.toLowerCase(), plain, plainLower,
    };
  });
}

type Field = { k: string; v: string; neg: boolean };
type Parsed = { terms: string[]; phrases: string[]; neg: string[]; tag: string[]; vault: string[]; path: string[]; fields: Field[] };
export function parse(q: string): Parsed {
  const p: Parsed = { terms: [], phrases: [], neg: [], tag: [], vault: [], path: [], fields: [] };
  q = q.replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, ' $1 ').replace(/\[\[|\]\]/g, ' ');   // a pasted [[link]] searches its target
  for (const m of q.matchAll(/(-?"[^"]+")|(\S+)/g)) {
    const tok = m[0];
    if (tok.startsWith('-"')) { p.neg.push(tok.slice(2, -1).toLowerCase()); continue; }
    if (tok.startsWith('"')) { p.phrases.push(tok.slice(1, -1).toLowerCase()); continue; }
    const t = tok.toLowerCase(), op = t.match(/^(tag|vault|path):(.+)$/);
    if (op) { p[op[1] as 'tag' | 'vault' | 'path'].push(op[2].replace(/^#/, '')); continue; }
    const fo = t.match(/^(-?)([a-z_][\w-]*):(.*)$/);
    if (fo && fieldKeys.has(fo[2])) { if (fo[3]) p.fields.push({ k: fo[2], v: fo[3].replace(/^"|"$/g, ''), neg: fo[1] === '-' }); continue; }
    if (t.startsWith('-') && t.length > 1) { p.neg.push(t.slice(1)); continue; }
    if (t === '-' || /^(tag|vault|path):$/.test(t)) continue;   // still typing an operator
    if (compact(t)) p.terms.push(t);   // lone punctuation is not a word
  }
  return p;
}

const boundary = /[\s\-_/.()]/;
const wordStart = (text: string, i: number) => i === 0 || boundary.test(text[i - 1]);

// letters in order, close together (so "dpr eval" finds "DeepRAG evals"); 0 means no match
function fuzzy(term: string, text: string): number {
  if (term.length < 3) return 0;
  let ti = 0, first = -1, last = -2, score = 0;
  for (let i = 0; i < text.length && ti < term.length; i++) {
    if (text[i] !== term[ti]) continue;
    if (first < 0) first = i;
    score += 1 + (i === last + 1 ? 2 : 0) + (wordStart(text, i) ? 3 : 0); last = i; ti++;
  }
  if (ti < term.length || last - first > term.length * 3 + 2) return 0;
  return Math.max(1, score - (text.length - term.length) * 0.04);
}

// at most one edit (insert, delete, substitute, swap neighbours) between a and b
function oneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0; while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
// a typo'd word against whole name words, or their start while still typing
const typoMatch = (t: string, words: string[]) => t.length >= 5 && words.some(w => oneEdit(t, w) || (w.length > t.length && oneEdit(t, w.slice(0, t.length))));

const RANK = { name: 0, meta: 1, text: 2 } as const;
const worse = (a: Hit['where'], b: Hit['where']): Hit['where'] => (RANK[b] > RANK[a] ? b : a);

type TS = { s: number; where: 'name' | 'meta' | 'text' } | null;
function scoreTerm(x: Ix, t: string, all: boolean): TS {
  let i = x.title.indexOf(t);
  if (i >= 0) return { s: i === 0 ? 100 : wordStart(x.title, i) ? 85 : 70, where: 'name' };
  i = x.file.indexOf(t);
  if (i >= 0) return { s: i === 0 ? 62 : 50, where: 'name' };
  const c = compact(t);
  if (c.length >= 3) {
    i = x.titleC.indexOf(c);
    if (i >= 0) return { s: i === 0 ? 90 : 65, where: 'name' };
    i = x.fileC.indexOf(c);
    if (i >= 0) return { s: i === 0 ? 58 : 46, where: 'name' };
  }
  const f = Math.max(fuzzy(t, x.title), fuzzy(t, x.file));
  if (f > 0) return { s: 20 + Math.min(25, f), where: 'name' };
  if (typoMatch(c, x.nameWords)) return { s: 30, where: 'name' };
  if (!all) return null;
  if (x.tagStr.includes(t)) return { s: 35, where: 'meta' };
  if (x.path.includes(t)) return { s: 25, where: 'meta' };
  if (x.summary.includes(t)) return { s: 22, where: 'meta' };
  const n = x.plainLower.split(t).length - 1;
  if (n > 0) return { s: 10 + Math.min(5, n), where: 'text' };
  return c.length >= 4 && x.plainC.includes(c) ? { s: 9, where: 'text' } : null;
}

function snippetOf(x: Ix, needles: string[]): string | undefined {
  let at = -1, len = 0;
  for (const nd of needles) { const i = x.plainLower.indexOf(nd); if (i >= 0 && (at < 0 || i < at)) { at = i; len = nd.length; } }
  if (at < 0) return undefined;
  let a = Math.max(0, at - 55), b = Math.min(x.plain.length, at + len + 95);
  if (a > 0) { const sp = x.plain.indexOf(' ', a); if (sp >= 0 && sp < at) a = sp + 1; }
  if (b < x.plain.length) { const sp = x.plain.lastIndexOf(' ', b); if (sp > at + len) b = sp; }
  return (a > 0 ? '... ' : '') + x.plain.slice(a, b) + (b < x.plain.length ? ' ...' : '');
}

export function runSearch(index: Ix[], query: string, scope: Scope): Result | null {
  const q = parse(query);
  const hasWork = q.terms.length || q.phrases.length || q.tag.length || q.vault.length || q.path.length || q.neg.length || q.fields.length;
  if (!hasWork) return null;
  const all = scope === 'all', hits: Hit[] = [];
  for (const x of index) {
    if (q.fields.some(f => (x.fields[f.k] || '').includes(f.v) === f.neg)) continue;
    if (q.vault.some(v => !x.vault.includes(v)) || q.path.some(p => !x.path.includes(p)) || q.tag.some(t => !x.tags.some(g => g.includes(t)))) continue;
    if (q.neg.some(w => x.title.includes(w) || x.file.includes(w) || (all && (x.plainLower.includes(w) || x.tagStr.includes(w))))) continue;
    let score = 0, where: Hit['where'] = 'name', ok = true; const need: string[] = [];
    for (const t of q.terms) {
      const r = scoreTerm(x, t, all);
      if (!r) { ok = false; break; }
      score += r.s; if (r.where !== 'name') need.push(t); where = worse(where, r.where);
    }
    if (!ok) continue;
    for (const ph of q.phrases) {
      const pc = compact(ph);
      if (x.title.includes(ph) || x.file.includes(ph) || (pc && (x.titleC.includes(pc) || x.fileC.includes(pc)))) score += 70;
      else if (all && x.summary.includes(ph)) { score += 25; where = worse(where, 'meta'); }
      else if (all && x.plainLower.includes(ph)) { score += 20; where = 'text'; need.push(ph); }
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (q.terms.length > 1 && q.terms.every(t => x.titleC.includes(compact(t)))) score += 40;
    const qc = compact(q.terms.join(''));   // the whole query is this note's file name or title: put it first
    if (qc && !q.phrases.length && (qc === x.fileC || qc === x.titleC)) score += 400;
    if (!q.terms.length && !q.phrases.length) score = 1;
    if (x.note.status === 'superseded') score *= 0.5;   // replaced notes stay findable but rank under the note that replaced them
    hits.push({ note: x.note, score, where, snippet: where === 'text' || (where === 'meta' && need.length) ? snippetOf(x, need.length ? need : q.terms) : undefined });
  }
  hits.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
  return { hits, terms: [...q.terms, ...q.phrases] };
}

// split text into plain and highlighted parts for rendering
export function highlight(text: string, terms: string[]): { t: string; m: boolean }[] {
  const ts = terms.map(compact).filter(t => t.length > 1);
  if (!ts.length) return [{ t: text, m: false }];
  // separators may differ between query and text: "release22" marks "Release-22"
  const re = new RegExp('(' + ts.map(t => [...t].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]?')).join('|') + ')', 'giu');
  return text.split(re).map((t, i) => ({ t, m: i % 2 === 1 })).filter(p => p.t);
}
