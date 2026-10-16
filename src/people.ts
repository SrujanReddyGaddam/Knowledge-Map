import type { Note } from 'virtual:vault';

// Person profiles (Personal vault people/ notes): the frontmatter fields the profile card shows and edits, and pure helpers
// over the note body. No browser imports.

export type FieldKind = 'date' | 'text' | 'tel' | 'email' | 'url' | 'list' | 'number';
export const PROFILE_FIELDS: { key: string; label: string; kind: FieldKind; hint?: string; group: 'basics' | 'work' | 'contact' | 'family' }[] = [
  { key: 'birthday', label: 'Birthday', kind: 'date', hint: 'YYYY-MM-DD, or MM-DD without the year', group: 'basics' },
  { key: 'anniversary', label: 'Anniversary', kind: 'date', hint: 'YYYY-MM-DD or MM-DD', group: 'basics' },
  { key: 'location', label: 'Lives in', kind: 'text', hint: 'City, state', group: 'basics' },
  { key: 'hometown', label: 'Hometown', kind: 'text', group: 'basics' },
  { key: 'how_met', label: 'How we met', kind: 'text', hint: 'college, work, neighbors...', group: 'basics' },
  { key: 'since', label: 'Known since', kind: 'number', hint: 'year', group: 'basics' },
  { key: 'checkin_days', label: 'Check in every', kind: 'text', hint: 'days (default by circle), or none', group: 'basics' },
  { key: 'company', label: 'Company', kind: 'text', group: 'work' },
  { key: 'role', label: 'Role', kind: 'text', group: 'work' },
  { key: 'phone', label: 'Phone', kind: 'tel', group: 'contact' },
  { key: 'email', label: 'Email', kind: 'email', group: 'contact' },
  { key: 'linkedin', label: 'LinkedIn', kind: 'url', hint: 'profile URL', group: 'contact' },
  { key: 'address', label: 'Address', kind: 'text', hint: 'one line', group: 'contact' },
  { key: 'partner', label: 'Partner', kind: 'text', hint: 'a name or [[note]]', group: 'family' },
  { key: 'kids', label: 'Kids', kind: 'text', hint: 'Maya (2021), Leo (2024)', group: 'family' },
  { key: 'interests', label: 'Interests', kind: 'list', hint: 'comma separated', group: 'family' },
];

export const RELATIONSHIPS: Record<string, string[]> = {
  family: ['spouse', 'son', 'daughter', 'mother', 'father', 'brother', 'sister', 'cousin', 'uncle', 'aunt', 'nephew', 'niece', 'grandparent', 'in-law'],
  friend: ['close friend', 'college friend', 'school friend', 'childhood friend', 'neighbor', 'friend'],
  colleague: ['teammate', 'manager', 'report', 'peer', 'customer', 'partner'],
  'ex-colleague': ['former teammate', 'former manager', 'former peer'],
  acquaintance: ['neighbor', 'parent at school', 'community', 'met once'],
};

const DAY = 864e5;
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

// lines under "## Heading" (until the next heading of level 1 or 2), code blocks skipped
export function sectionLines(body: string, heading: string) {
  const out: string[] = [], want = heading.toLowerCase();
  let inSec = false, fence = false;
  for (const l of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const h = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) { if (h[1].length <= 2) inSec = h[1].length === 2 && h[2].toLowerCase() === want; continue; }
    if (inSec && l.trim()) out.push(l);
  }
  return out;
}
// "- 2026-10-15 text" items of a section, newest first
export const datedItems = (body: string, heading: string) => sectionLines(body, heading)
  .map(l => l.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(\d{4}-\d{2}-\d{2})?\s*(.*)$/)).filter(Boolean)
  .map(m => ({ date: m![1] || '', text: m![2].trim() })).filter(x => x.text).sort((a, b) => b.date.localeCompare(a.date));
// open "- [ ] ..." items under Ask next time
export const asks = (body: string) => sectionLines(body, 'Ask next time').map(l => l.match(/^\s*[-*]\s+\[ \]\s+(.*)$/)?.[1]?.trim()).filter((x): x is string => !!x);

export function age(birthday: string, now = Date.now()) {
  const m = (birthday || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (!m) return null;
  const d = new Date(now); let a = d.getFullYear() - +m[1];
  if (d.getMonth() + 1 < +m[2] || (d.getMonth() + 1 === +m[2] && d.getDate() < +m[3])) a--;
  return a >= 0 && a < 130 ? a : null;
}
// days until the next yearly date (YYYY-MM-DD or MM-DD), and the count it completes when the year is known
export function nextYearly(s: string, now = Date.now()) {
  const m = (s || '').trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const t0 = dayStart(now), y = new Date(now).getFullYear(), mo = +m[2] - 1, d = +m[3];
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  let at = new Date(y, mo, d).getTime();
  if (at < t0) at = new Date(y + 1, mo, d).getTime();
  return { days: Math.round((at - t0) / DAY), count: m[1] ? new Date(at).getFullYear() - +m[1] : null };
}

// a daily journal (journal/YYYY-MM-DD.md) that links a person counts as contact on that day
export function journalContacts(notes: Note[]) {
  const out = new Map<string, string>();
  for (const n of notes) {
    const m = n.path.match(/(?:^|\/)journal\/(\d{4}-\d{2}-\d{2})\.md$/); if (!m) continue;
    for (const id of n.links) if ((out.get(id) || '') < m[1]) out.set(id, m[1]);
  }
  return out;
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
// yaml-safe scalar for a frontmatter value written by the app: quoted when it could be read as something else
export function yamlValue(v: string) {
  const s = v.replace(/[\r\n]+/g, ' ').trim();
  if (!s) return '';
  return /^[\w .,'()/@+-]+$/.test(s) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/:\s|\s#/.test(s) && !/^(true|false|null|yes|no|~)$/i.test(s) ? s : JSON.stringify(s);
}
export const yamlList = (v: string) => '[' + v.split(',').map(x => x.trim()).filter(Boolean).map(x => yamlValue(x).replace(/^([^"].*[,\]].*)$/, '"$1"')).join(', ') + ']';

// display a stored date (YYYY-MM-DD, or MM-DD when the year is unknown) as "June 4, 1992" / "June 4"
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtDate(s: string) {
  const m = (s || '').trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) return s;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}${m[1] ? ', ' + m[1] : ''}`;
}
