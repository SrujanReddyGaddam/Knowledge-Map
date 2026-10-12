import type { Note } from 'virtual:vault';

// Open markdown checkboxes ("- [ ] ...") across all notes, for the Tasks drawer. Code blocks are skipped.
// `nth` is the task's position among the open tasks of its note: ticking one off finds the same nth open task in the raw file text.
export type Task = { note: Note; nth: number; text: string; heading: string; due: string };

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.*\S)\s*$/;
const FENCE = /^\s*(```|~~~)/;
const DUE = /(?:📅|due:?)\s*(\d{4}-\d{2}-\d{2})/i;
// the due date as written (with an optional ISO time), removed from the displayed text because it is shown as a chip
export const DUE_TEXT = /,?\s*(?:📅|@?\bdue:?)\s*\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/i;

// the open tasks of one markdown text (frontmatter already removed), as [line index, text]
export function openTasks(md: string): [number, string][] {
  const out: [number, string][] = []; let fence = '';
  md.split('\n').forEach((line, i) => {
    const f = line.match(FENCE);
    if (f) { if (!fence) fence = f[1]; else if (f[1] === fence) fence = ''; return; }
    if (fence) return;
    const m = line.replace(/\r$/, '').match(TASK);
    if (m) out.push([i, m[1]]);
  });
  return out;
}

export function collectTasks(notes: Note[]): Task[] {
  const all: Task[] = [];
  for (const note of notes) {
    if (note.kind === 'drawing' || !note.body.includes('[ ]')) continue;
    const lines = note.body.split('\n');
    openTasks(note.body).forEach(([i, text], nth) => {
      let heading = '';
      for (let j = i - 1; j >= 0; j--) { const h = lines[j].match(/^#{1,6}\s+(.+)$/); if (h) { heading = h[1].trim(); break; } }
      all.push({ note, nth, text, heading, due: text.match(DUE)?.[1] || '' });
    });
  }
  return all;
}

// plain text for display: [[x|y]] -> y, [[x]] -> x, [t](u) -> t, emphasis marks dropped
export const plainTask = (t: string) => t
  .replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a: string, b?: string) => (b || a.split('/').pop()!.replace(/#.*$/, '')))
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|`)/g, '').replace(/\s+/g, ' ').trim();

// mark the nth open task of a raw file as done; returns the new text, or null if that task is not there any more
export function tickInRaw(raw: string, nth: number, expect: string): string | null {
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n/);
  const head = fm ? fm[0] : '', rest = raw.slice(head.length);
  const t = openTasks(rest)[nth];
  if (!t || plainTask(t[1]) !== plainTask(expect)) return null;
  const lines = rest.split('\n');
  lines[t[0]] = lines[t[0]].replace('[ ]', '[x]');
  return head + lines.join('\n');
}

// ---- ticking a checkbox shown in the rendered note ----
// The rendered note drops the "## Summary" section and shows links as titles, so tasks are matched by their text with links
// (wikilinks and [text](url) links) removed, letters and digits only,, plus which occurrence of that text it is when the same task appears more than once.
export const taskKey = (t: string) => t.replace(/!?\[\[[^\]]*\]\]/g, ' ').replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const ANY_TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*\S)\s*$/;

// set the checkbox of the task with this key (the nth occurrence of it) to done or not; null if not found
// skipSummary: the panel does not show the first "## Summary" section, so tasks inside it are not counted
export function setTaskInRaw(raw: string, key: string, occurrence: number, done: boolean, skipSummary = false): string | null {
  const fm = raw.match(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n/);
  const head = fm ? fm[0] : '', lines = raw.slice(head.length).split('\n');
  let fence = '', seen = 0, inSummary = false, hadSummary = !skipSummary;
  for (let i = 0; i < lines.length; i++) {
    if (!fence && /^##\s/.test(lines[i])) { inSummary = !hadSummary && /^##\s+Summary\s*$/i.test(lines[i].replace(/\r$/, '')); if (inSummary) hadSummary = true; }
    if (inSummary) continue;
    const f = lines[i].match(FENCE);
    if (f) { if (!fence) fence = f[1]; else if (f[1] === fence) fence = ''; continue; }
    if (fence) continue;
    const m = lines[i].replace(/\r$/, '').match(ANY_TASK);
    if (!m || taskKey(m[4]) !== key) continue;
    if (seen++ < occurrence) continue;
    lines[i] = lines[i].replace(/\[[ xX]\]/, done ? '[x]' : '[ ]');
    return head + lines.join('\n');
  }
  return null;
}
