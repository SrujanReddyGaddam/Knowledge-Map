import type { Note } from 'virtual:vault';
import { type Task, plainTask, DUE_TEXT } from './taskScan.ts';
import { shortTitle } from './util.ts';
import type { Project } from './projects';

// Data for the customer cockpit and its "Brief me" text. Everything is derived from the notes' frontmatter and text, nothing is stored.
export const pretty = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const DAY = 864e5;
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;
export const withoutCode = (t: string) => t.split(CODE).filter((_, i) => i % 2 === 0).join(' ');

// a note belongs to a customer by its frontmatter, or by living under projects/<customer>/
export const ofCustomer = (n: Note, c: string) => n.customer === c || n.path.toLowerCase().startsWith(`projects/${c}/`);
// which customer a code project belongs to: config "projects.customers" ({"acme": ["acme", "acme-portal"]}) first,
// else the first word of the customer slug found in the folder or branch name (acme-corp -> "acme")
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function projectCustomer(p: { name: string; branch: string }, customers: string[], map: Record<string, string[]>): string {
  const hay = squash(p.name) + ' ' + squash(p.branch);
  for (const [c, words] of Object.entries(map)) if (words.some(w => squash(w) && hay.includes(squash(w)))) return c;
  for (const c of customers) { const w = squash(c.split('-')[0]); if (w.length >= 3 && hay.includes(w)) return c; }
  return '';
}
export const customersOf = (notes: Note[]) => [...new Set(notes.map(n => n.customer).filter(c => /^[a-z0-9][a-z0-9-]*$/.test(c)))].sort();

// Jira-style keys (EAPR-5374). Common non-ticket codes are skipped.
const NOT_TICKET = new Set(['ICD', 'ISO', 'SHA', 'UTF', 'RFC', 'CPT', 'HTTP', 'COVID', 'TLS', 'AES', 'RSA', 'SOC', 'HL', 'FHIR', 'PHI', 'GPT', 'ES', 'MD', 'CVE', 'IEC', 'NIST', 'PCI', 'SSL', 'X', 'ID', 'V', 'HIPAA', 'W', 'Q', 'H', 'FY', 'GA', 'P', 'T', 'R']);
const TICKET = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
export function ticketsIn(notes: Note[]) {
  const m = new Map<string, { key: string; count: number; notes: Set<string> }>();
  for (const n of notes) for (const x of withoutCode(n.body).matchAll(TICKET)) {
    if (NOT_TICKET.has(x[1]) || /^\d+$/.test(x[1])) continue;
    const k = x[0], e = m.get(k) ?? { key: k, count: 0, notes: new Set<string>() };
    e.count++; e.notes.add(n.id); m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.notes.size - a.notes.size || b.count - a.count || a.key.localeCompare(b.key));
}

// "Open questions" style sections: their unanswered list items
const QHEAD = /^#{2,4}\s+(open questions|questions|unknowns|open items|to clarify)\b/i;
export function openQuestions(n: Note) {
  const out: string[] = []; let inQ = false, lvl = 0;
  for (const l of withoutCode(n.body).split('\n')) {
    const h = l.match(/^(#{1,6})\s/);
    if (h) { if (QHEAD.test(l)) { inQ = true; lvl = h[1].length; continue; } if (inQ && h[1].length <= lvl) inQ = false; }
    if (!inQ) continue;
    const it = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(?!\[[xX]\])(?:\[ \]\s+)?(.*\S)/);
    if (it && !/~~/.test(it[1]) && !/\b(answered|resolved)\b/i.test(it[1])) out.push(plainTask(it[1]));
  }
  return out;
}

const dateOf = (n: Note) => n.path.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || n.meta.date || new Date(n.mtime).toISOString().slice(0, 10);
const NEEDS = new Set(['draft', 'needs-verification', 'stale']);

export function cockpitData(c: string, notes: Note[], tasks: Task[], changed: Set<string>, projects: Project[]) {
  const mine = notes.filter(n => ofCustomer(n, c));
  const ids = new Set(mine.map(n => n.id));
  const hub = mine.find(n => n.type === 'hub' && !n.project) ?? mine.find(n => n.type === 'hub') ?? null;
  const byProject = new Map<string, Note[]>();
  for (const n of mine) if (n.project) byProject.set(n.project, [...(byProject.get(n.project) || []), n]);
  const projectList = [...byProject].map(([p, list]) => {
    const sorted = [...list].sort((a, b) => b.mtime - a.mtime);
    return { project: p, hub: list.find(n => n.type === 'hub') ?? null, count: list.length, newest: sorted.find(n => n.type !== 'hub') ?? sorted[0], notes: list, mtime: sorted[0].mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  const people = new Map<string, { note: Note; n: number }>();
  const byId = new Map(notes.map(n => [n.id, n]));
  for (const n of mine) for (const o of [...n.links, ...n.backlinks]) { const p = byId.get(o); if (p && p.type === 'person') people.set(p.id, { note: p, n: (people.get(p.id)?.n || 0) + 1 }); }
  const questions = mine.map(n => ({ note: n, items: openQuestions(n) })).filter(x => x.items.length);
  return {
    mine, hub,
    changed: mine.filter(n => changed.has(n.id)).sort((a, b) => b.mtime - a.mtime),
    tasks: tasks.filter(t => ids.has(t.note.id)).sort((a, b) => (a.due || '9') .localeCompare(b.due || '9') || b.note.mtime - a.note.mtime),
    attention: mine.filter(n => NEEDS.has(n.status)).sort((a, b) => b.mtime - a.mtime),
    questions,
    meetings: mine.filter(n => n.type === 'meeting').sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, 8),
    projects: projectList,
    people: [...people.values()].sort((a, b) => b.n - a.n).map(x => x.note),
    tickets: ticketsIn(mine),
    code: projects,
    lastTouched: Math.max(0, ...mine.map(n => n.mtime)),
    dateOf,
  };
}
export type CockpitData = ReturnType<typeof cockpitData>;

// the ticket a weekly update is about: the hub's jira/ticket/epic field, else the key mentioned in most of these notes
export const ticketFor = (hub: Note | null, notes: Note[]) =>
  (hub && (hub.meta.jira || hub.meta.ticket || hub.meta.epic || '').match(/[A-Z][A-Z0-9]+-\d+/)?.[0]) || ticketsIn(notes)[0]?.key || '<TICKET>';

// prompt for the /fde-weekly-jira-update skill: the ticket plus the notes changed in the last 7 days (paths, so the agent reads the files)
export function weeklyPrompt(label: string, ticket: string, notes: Note[]) {
  const since = Date.now() - 7 * DAY, list = notes.filter(n => n.mtime >= since).sort((a, b) => b.mtime - a.mtime);
  const sinceDay = new Date(since).toISOString().slice(0, 10);
  return [`/fde-weekly-jira-update ${ticket}`, '',
    `Weekly update for ${label}. Use what changed since ${sinceDay} in these notes${list.length ? '' : ' (none changed this week, so check the hub and Jira)'}:`,
    ...list.map(n => `- ${n.abs}  (${shortTitle(n.title)}, edited ${new Date(n.mtime).toISOString().slice(0, 10)})`)].join('\n');
}

export function briefText(c: string, d: CockpitData, jiraBase: string) {
  const L: string[] = [`# ${pretty(c)}: brief (${new Date().toISOString().slice(0, 10)})`, ''];
  if (d.hub?.summary) L.push(d.hub.summary, '');
  const sec = (title: string, rows: string[], max = 8) => { if (!rows.length) return; L.push(`## ${title}`, ...rows.slice(0, max), ...(rows.length > max ? [`- ...and ${rows.length - max} more`] : []), ''); };
  sec(`Changed since you last looked (${d.changed.length})`, d.changed.map(n => `- ${shortTitle(n.title)} (edited ${new Date(n.mtime).toISOString().slice(0, 10)})`));
  sec(`Open tasks (${d.tasks.length})`, d.tasks.map(t => `- [ ] ${plainTask(t.text).replace(DUE_TEXT, '').trim()}${t.due ? ` (due ${t.due})` : ''} [${shortTitle(t.note.title)}]`), 10);
  sec('Open questions', d.questions.flatMap(q => q.items.slice(0, 3).map(i => `- ${i} [${shortTitle(q.note.title)}]`)), 10);
  sec('Needs attention', d.attention.map(n => `- ${shortTitle(n.title)}: ${n.status}`));
  sec('Recent meetings', d.meetings.map(n => `- ${d.dateOf(n)} ${shortTitle(n.title)}${n.summary ? ': ' + n.summary : ''}`), 5);
  sec('Projects', d.projects.map(p => `- ${pretty(p.project)}: ${p.hub?.summary || p.count + ' notes'}${p.newest ? ` Latest: ${shortTitle(p.newest.title)}.` : ''}`));
  sec('Code projects', d.code.map(p => `- ${p.title}: ${p.plan?.status || p.status || 'no status'}${p.last?.next ? ` Next: ${p.last.next}` : ''}`));
  sec('People', d.people.map(n => `- ${shortTitle(n.title)}${n.summary ? ': ' + n.summary : ''}`), 10);
  sec('Tickets', d.tickets.map(t => `- ${jiraBase ? `[${t.key}](${jiraBase}${t.key})` : t.key} (${t.notes.size} ${t.notes.size === 1 ? 'note' : 'notes'})`), 10);
  return L.join('\n').trim() + '\n';
}
