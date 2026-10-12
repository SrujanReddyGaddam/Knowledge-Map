import type { Note } from 'virtual:vault';
import { shortTitle } from './util';

// Unlinked mentions: other notes whose text names this note (its title or file name) without linking to it,
// and the one-click fix that turns the first such mention into a [[link]].
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GENERIC = new Set(['index', 'readme', 'notes', 'people', 'research', 'todo', 'plan', 'worklog', 'summary', 'overview', 'tasks', 'inbox', 'active']);
const baseOf = (n: Note) => (n.path.split('/').pop() || '').replace(/\.(md|excalidraw)$/i, '').replace(/\.excalidraw$/i, '');

// names a mention can use: the short title and the file name with dashes as spaces; dates, short or generic names are skipped
export function namesOf(n: Note): string[] {
  const out = new Set<string>();
  for (const s of [shortTitle(n.title), baseOf(n).replace(/[-_]+/g, ' ')]) {
    const t = s.trim();
    if (t.length < 5 || /^\d{4}-\d{2}-\d{2}/.test(t) || GENERIC.has(t.toLowerCase()) || !/[a-z]/i.test(t) || t.split(/\s+/).length > 8) continue;
    out.add(t);
  }
  return [...out];
}
const wordRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escRe(name).replace(/\s+/g, '[\\s-]+')}(?![\\p{L}\\p{N}_-])`, 'iu');

// ranges that must never be linked: frontmatter, code, existing links, URLs, headings
function protectedRanges(t: string) {
  const r: [number, number][] = [];
  const add = (re: RegExp) => { for (const m of t.matchAll(re)) r.push([m.index!, m.index! + m[0].length]); };
  const fm = t.match(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n/); if (fm) r.push([0, fm[0].length]);
  add(/```[\s\S]*?```|~~~[\s\S]*?~~~/g); add(/`[^`\n]*`/g); add(/!?\[\[[^\]\n]*\]\]/g); add(/!?\[[^\]\n]*\]\([^)\n]*\)/g); add(/<[^>\n]+>/g);
  add(/\bhttps?:\/\/\S+/g); add(/^#{1,6}\s.*$/gm);
  return r;
}
const inside = (r: [number, number][], a: number, b: number) => r.some(([x, y]) => a < y && b > x);

// first unprotected match of any of the names in a text
function firstMatch(text: string, names: string[]) {
  const prot = protectedRanges(text);
  let best: { at: number; len: number; name: string } | null = null;
  for (const name of names) {
    const re = new RegExp(wordRe(name).source, 'giu');
    for (const m of text.matchAll(re)) {
      if (inside(prot, m.index!, m.index! + m[0].length)) continue;
      if (!best || m.index! < best.at) best = { at: m.index!, len: m[0].length, name };
      break;
    }
  }
  return best;
}

export function unlinkedMentions(target: Note, notes: Note[]) {
  const names = namesOf(target);
  if (!names.length || target.kind === 'drawing') return [];
  const quick = names.map(wordRe);
  const out: { note: Note; ctx: string }[] = [];
  for (const n of notes) {
    if (n.id === target.id || n.kind === 'drawing' || n.links.includes(target.id) || !quick.some(re => re.test(n.body))) continue;
    const m = firstMatch(n.body, names);
    if (!m) continue;
    const s = n.body.lastIndexOf('\n', m.at) + 1, e = n.body.indexOf('\n', m.at);
    let ctx = n.body.slice(s, e < 0 ? undefined : e).replace(/^[\s>#*+-]+/, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/[*_`]/g, '').trim();
    if (ctx.length > 170) { const i = Math.max(0, ctx.toLowerCase().indexOf(m.name.toLowerCase()) - 60); ctx = (i ? '..' : '') + ctx.slice(i, i + 166) + '..'; }
    out.push({ note: n, ctx });
  }
  return out.sort((a, b) => b.note.mtime - a.note.mtime);
}

// turn the first unprotected mention of the target in a raw file into [[file name|as written]]; null when there is none
export function linkFirstMention(raw: string, target: Note): string | null {
  const m = firstMatch(raw, namesOf(target));
  if (!m) return null;
  const said = raw.slice(m.at, m.at + m.len), base = baseOf(target);
  const link = said.toLowerCase() === base.toLowerCase() ? `[[${base}]]` : `[[${base}|${said}]]`;
  return raw.slice(0, m.at) + link + raw.slice(m.at + m.len);
}
