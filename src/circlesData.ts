import type { Note } from 'virtual:vault';
import { journalContacts, nextYearly } from './people.ts';

// Circles view: people notes (type: person with relation: family|friend) placed on concentric shells around "me".
// Pure on purpose: no browser imports. Last contact is read from the newest "- YYYY-MM-DD ..." line under "## Log".

export const RINGS = [
  { n: 1, label: 'Inner', every: 7 },
  { n: 2, label: 'Close', every: 14 },
  { n: 3, label: 'Regular', every: 30 },
  { n: 4, label: 'Wider', every: 90 },
];
export type Status = 'fresh' | 'due' | 'overdue' | 'never';
// who the person is (color and shape); independent of the circle, which says how close they are
export const RELATIONS = [
  { key: 'family', label: 'Family' },
  { key: 'friend', label: 'Friends' },
  { key: 'colleague', label: 'Colleagues' },
  { key: 'ex-colleague', label: 'Ex-colleagues' },
  { key: 'acquaintance', label: 'Acquaintances' },
] as const;
export type Relation = typeof RELATIONS[number]['key'];
const ALIAS: Record<string, Relation> = { work: 'colleague', coworker: 'colleague', 'co-worker': 'colleague', excolleague: 'ex-colleague', 'former-colleague': 'ex-colleague', other: 'acquaintance', friends: 'friend' };
export function relationOf(v: string | undefined): Relation | null {
  const k = (v || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return RELATIONS.some(r => r.key === k) ? k as Relation : ALIAS[k] ?? null;
}
export const relOrder = (r: Relation) => RELATIONS.findIndex(x => x.key === r);
export type Person = {
  note: Note; name: string; relation: Relation; relationship: string; circle: number; every: number;
  last: string | null; lastKind: string; lastText: string; since: number | null; status: Status; urgency: number;
  birthday: string; bdayIn: number | null; turns: number | null; logs: number;
  anniversary: string; annIn: number | null; years: number | null;
};

const DAY = 864e5;
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const parseDay = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN; };
export const today = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// lines under "## Log" (until the next heading of the same or higher level), code blocks skipped
export function logLines(body: string) {
  const out: { date: string; kind: string; text: string }[] = [];
  let inLog = false, fence = false;
  for (const l of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const h = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) { inLog = h[1].length === 2 && h[2].toLowerCase() === 'log' ? true : h[1].length <= 2 ? false : inLog; continue; }
    if (!inLog) continue;
    const m = l.match(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s*(?:([a-z][\w ]{0,15}?)\s*:)?\s*(.*)$/i);
    if (m && !isNaN(parseDay(m[1]))) out.push({ date: m[1], kind: (m[2] || '').trim().toLowerCase(), text: m[3].trim() });
  }
  return out;
}

// next birthday from YYYY-MM-DD or MM-DD; days until it (0 = today) and the age turned when the year is known
export function nextBirthday(s: string, now = Date.now()) {
  const m = s.trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const t0 = dayStart(now), y = new Date(now).getFullYear(), mo = +m[2] - 1, d = +m[3];
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  let at = new Date(y, mo, d).getTime();
  if (at < t0) at = new Date(y + 1, mo, d).getTime();
  const year = new Date(at).getFullYear();
  return { days: Math.round((at - t0) / DAY), turns: m[1] ? year - +m[1] : null };
}

export function isPerson(n: Note) { return n.type === 'person' && relationOf(n.meta.relation) !== null; }

export function personOf(n: Note, now = Date.now(), journal?: Map<string, string>): Person {
  const circle = Math.min(4, Math.max(1, parseInt(n.meta.circle, 10) || 3));
  // checkin_days: none (or 0) for people you live with: no rhythm, never overdue
  const noRhythm = /^(none|0|no|never)$/i.test((n.meta.checkin_days || '').trim());
  const every = noRhythm ? Infinity : parseInt(n.meta.checkin_days, 10) > 0 ? parseInt(n.meta.checkin_days, 10) : RINGS[circle - 1].every;
  const logs = logLines(n.body).sort((a, b) => b.date.localeCompare(a.date));
  // a daily journal that links the person counts as contact when it is newer than the last Log line
  const j = journal?.get(n.id);
  const last = j && (!logs[0] || j > logs[0].date) ? { date: j, kind: 'journal', text: 'mentioned in the journal' } : logs[0] ?? null;
  const since = last ? Math.max(0, Math.round((dayStart(now) - parseDay(last.date)) / DAY)) : null;
  const ratio = since === null ? 1.05 : since / every;
  const status: Status = noRhythm ? 'fresh' : since === null ? 'never' : ratio > 1 ? 'overdue' : ratio >= 0.75 ? 'due' : 'fresh';
  const b = n.meta.birthday ? nextBirthday(n.meta.birthday, now) : null, an = n.meta.anniversary ? nextYearly(n.meta.anniversary, now) : null;
  return {
    note: n, name: n.title, relation: relationOf(n.meta.relation)!, relationship: n.meta.relationship || '', circle, every,
    last: last?.date ?? null, lastKind: last?.kind ?? '', lastText: last?.text ?? '', since, status, urgency: ratio,
    birthday: n.meta.birthday || '', bdayIn: b?.days ?? null, turns: b?.turns ?? null, logs: logs.length,
    anniversary: n.meta.anniversary || '', annIn: an?.days ?? null, years: an?.count ?? null,
  };
}

export function circlesData(notes: Note[], now = Date.now()) {
  const journal = journalContacts(notes);
  const people = notes.filter(isPerson).map(n => personOf(n, now, journal)).sort((a, b) => a.circle - b.circle || relOrder(a.relation) - relOrder(b.relation) || a.name.localeCompare(b.name));
  // who to reach out to: overdue first (most overdue relative to their rhythm), then never logged by closeness, then due soon
  const rank = (p: Person) => (p.status === 'overdue' ? 3 : p.status === 'never' ? 2 : p.status === 'due' ? 1 : 0);
  const reach = people.filter(p => p.status !== 'fresh').sort((a, b) => rank(b) - rank(a) || b.urgency - a.urgency || a.circle - b.circle || a.name.localeCompare(b.name));
  const birthdays = people.filter(p => p.bdayIn !== null && p.bdayIn <= 60).sort((a, b) => a.bdayIn! - b.bdayIn!);
  return { people, reach, birthdays, noBirthday: people.filter(p => p.bdayIn === null).length };
}

export const agoText = (d: number | null) => (d === null ? 'no contact logged' : d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? d + ' days ago' : Math.round(d / 30) + ' months ago');
export const bdayText = (p: Person) => (p.bdayIn === null ? '' : (p.bdayIn === 0 ? 'birthday today' : p.bdayIn === 1 ? 'birthday tomorrow' : 'birthday in ' + p.bdayIn + ' days') + (p.turns ? ` (turns ${p.turns})` : ''));
