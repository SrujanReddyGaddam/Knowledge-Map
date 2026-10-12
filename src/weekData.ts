import type { Note } from 'virtual:vault';
import type { Commit } from './api';
import type { Project } from './projects';
import { plainTask } from './taskScan';
import { shortTitle } from './util';
import { pretty, projectCustomer } from './cockpitData';
import { customerOfNote } from './workspace';

// Weekly review: what happened in one week, per customer, from the notes (mtime, type, dates), the vault git history when there is one,
// the "## Done" lists of the daily journals and the code projects' last WORKLOG entry. Nothing is stored.
const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Monday to Sunday of the week that is `back` weeks before this one
export function weekRange(back = 0) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7);
  const end = new Date(d); end.setDate(d.getDate() + 6); end.setHours(23, 59, 59, 999);
  // ISO week number: the week that holds this Monday's Thursday
  const th = new Date(d); th.setDate(d.getDate() + 3); const jan4 = new Date(th.getFullYear(), 0, 4);
  const week = 1 + Math.round(((th.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return { start: iso(d), end: iso(end), from: d.getTime(), to: end.getTime(), week, year: th.getFullYear() };
}
export type Range = ReturnType<typeof weekRange>;

const dateOf = (n: Note) => n.path.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || n.meta.date || '';
const isJournal = (n: Note) => /^journal\/\d{4}-\d{2}-\d{2}\.md$/.test(n.path);
const doneIn = (n: Note) => {
  const out: string[] = []; let on = false;
  for (const l of n.body.split('\n')) {
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { on = h[1].length === 2 && /^done\b/i.test(h[2].trim()); continue; }
    const m = on && l.match(/^\s*[-*+]\s+\[[xX]\]\s+(.*\S)/);
    if (m) out.push(m[1]);
  }
  return out;
};

export type Group = { customer: string; label: string; created: Note[]; edited: Note[]; meetings: Note[]; decisions: Note[]; done: { text: string; day: string }[]; code: Project[] };
export function weekData(notes: Note[], commits: Map<string, Commit[]>, r: Range, projects: Project[], customers: string[], projectMap: Record<string, string[]>) {
  const inRange = (d: string) => !!d && d >= r.start && d <= r.end;
  const at = new Map(notes.map(n => [n.vault + '\u0000' + n.path, n]));
  const byBase = new Map<string, Note>(); notes.forEach(n => { const b = n.path.split('/').pop()!.replace(/\.md$/i, '').toLowerCase(); if (!byBase.has(b)) byBase.set(b, n); });
  const created = new Set<string>(), edited = new Set<string>();
  let commitCount = 0; const deleted: string[] = [];
  for (const [vault, list] of commits) for (const c of list) {
    commitCount++;
    for (const f of c.files) {
      const n = at.get(vault + '\u0000' + f.path);
      if (f.status === 'D') { if (!n) deleted.push(f.path); continue; }
      if (n) (f.status === 'A' ? created : edited).add(n.id);
    }
  }
  const gitVaults = new Set(commits.keys());
  for (const n of notes) {
    if (!gitVaults.has(n.vault) && inRange(dateOf(n)) && !isJournal(n)) created.add(n.id);
    if (n.mtime >= r.from && n.mtime <= r.to) edited.add(n.id);
  }
  created.forEach(id => edited.delete(id));
  const groups = new Map<string, Group>();
  const g = (c: string) => { if (!groups.has(c)) groups.set(c, { customer: c, label: c ? pretty(c) : 'General', created: [], edited: [], meetings: [], decisions: [], done: [], code: [] }); return groups.get(c)!; };
  const byId = new Map(notes.map(n => [n.id, n]));
  const newest = (a: Note, b: Note) => b.mtime - a.mtime;
  [...created].map(id => byId.get(id)!).filter(n => !isJournal(n)).sort(newest).forEach(n => g(customerOfNote(n, customers)).created.push(n));
  [...edited].map(id => byId.get(id)!).filter(n => !isJournal(n)).sort(newest).forEach(n => g(customerOfNote(n, customers)).edited.push(n));
  notes.filter(n => n.type === 'meeting' && inRange(dateOf(n) || iso(new Date(n.mtime)))).sort((a, b) => dateOf(a).localeCompare(dateOf(b))).forEach(n => g(customerOfNote(n, customers)).meetings.push(n));
  notes.filter(n => n.type === 'decision' && (inRange(dateOf(n)) || created.has(n.id))).forEach(n => g(customerOfNote(n, customers)).decisions.push(n));
  // ticked tasks: the daily journals' "## Done" lines; a [[link]] in the line says which customer it was for
  const journals = notes.filter(n => isJournal(n) && inRange(dateOf(n))).sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  for (const j of journals) for (const t of doneIn(j)) {
    const link = t.match(/\[\[([^\]|#]+)/)?.[1], ln = link ? byBase.get(link.trim().split('/').pop()!.toLowerCase()) : null;
    g(ln ? customerOfNote(ln, customers) : '').done.push({ text: plainTask(t), day: dateOf(j) });
  }
  for (const p of projects) if (p.last && inRange(p.last.date)) g(projectCustomer(p, customers, projectMap)).code.push(p);
  const list = [...groups.values()].sort((a, b) => (a.customer ? 0 : 1) - (b.customer ? 0 : 1) || a.label.localeCompare(b.label));
  const sum = (k: keyof Omit<Group, 'customer' | 'label'>) => list.reduce((s, x) => s + x[k].length, 0);
  return {
    groups: list, commitCount, deleted, journals: journals.length, git: gitVaults.size > 0,
    totals: { created: sum('created'), edited: sum('edited'), meetings: sum('meetings'), decisions: sum('decisions'), done: sum('done'), code: sum('code') },
  };
}
export type WeekData = ReturnType<typeof weekData>;

export function weekMarkdown(d: WeekData, r: Range) {
  const t = d.totals, L = [`# Week ${r.week} review (${r.start} to ${r.end})`, '',
    `${t.created} notes created, ${t.edited} edited, ${t.meetings} meetings, ${t.decisions} decisions, ${t.done} tasks done${d.git ? `, ${d.commitCount} vault commits` : ''}.`, ''];
  const sec = (title: string, rows: string[]) => { if (rows.length) L.push(`### ${title}`, ...rows, ''); };
  for (const x of d.groups) {
    L.push(`## ${x.label}`, '');
    sec('Meetings', x.meetings.map(n => `- ${dateOf(n)} ${shortTitle(n.title)}${n.summary ? ': ' + n.summary : ''}`));
    sec('Decisions', x.decisions.map(n => `- ${shortTitle(n.title)}${n.summary ? ': ' + n.summary : ''}`));
    sec('Done', x.done.map(t => `- ${t.text} (${t.day})`));
    sec('New notes', x.created.map(n => `- ${shortTitle(n.title)}${n.type ? ` (${n.type})` : ''}`));
    sec('Edited', x.edited.slice(0, 15).map(n => `- ${shortTitle(n.title)}`).concat(x.edited.length > 15 ? [`- ...and ${x.edited.length - 15} more`] : []));
    sec('Code', x.code.map(p => `- ${p.title}: ${p.last!.title}${p.last!.next ? `. Next: ${p.last!.next}` : ''}`));
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
