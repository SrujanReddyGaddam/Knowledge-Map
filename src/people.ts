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
// a date that exists on the calendar (04-31 does not); without a year, Feb 29 is allowed
export function validDate(s: string) {
  const m = (s || '').trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/); if (!m) return false;
  const d = new Date(m[1] ? +m[1] : 2000, +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}
// days until the next yearly date (YYYY-MM-DD or MM-DD), and the count it completes when the year is known; Feb 29 falls on Feb 28 in other years
export function nextYearly(s: string, now = Date.now()) {
  const m = (s || '').trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/);
  if (!m || !validDate(s)) return null;
  const t0 = dayStart(now), y = new Date(now).getFullYear(), mo = +m[2] - 1, d = +m[3];
  const on = (yr: number) => new Date(yr, mo, mo === 1 && d === 29 && new Date(yr, 1, 29).getMonth() !== 1 ? 28 : d).getTime();
  let at = on(y);
  if (at < t0) at = on(y + 1);
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

// contacts from a .vcf file (vCard 2.1, 3.0, 4.0: Apple and Google exports): the fields Add person knows. Unknown or broken lines are skipped.
export type Contact = { name: string; phone: string; email: string; birthday: string; location: string; address: string; company: string; role: string; about: string };
export function parseVcards(text: string): Contact[] {
  const lines: string[] = [];   // unfold continued lines, and quoted-printable soft breaks (a QP line ending in =)
  for (const l of text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')) {
    const prev = lines[lines.length - 1];
    if (prev !== undefined && /ENCODING=QUOTED-PRINTABLE/i.test(prev.split(':')[0]) && prev.endsWith('=')) lines[lines.length - 1] = prev.slice(0, -1) + l; else lines.push(l);
  }
  const unesc = (v: string) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
  const qp = (v: string) => { try { return decodeURIComponent(v.replace(/%/g, '%25').replace(/=([0-9A-F]{2})/gi, '%$1')); } catch { return v; } };
  const parts = (v: string) => v.split(/(?<!\\);/).map(unesc);
  const out: Contact[] = [];
  let c: (Contact & { n: string; tels: [string, boolean][] }) | null = null;
  for (const l of lines) {
    if (/^BEGIN:VCARD/i.test(l)) { c = { name: '', n: '', phone: '', email: '', birthday: '', location: '', address: '', company: '', role: '', about: '', tels: [] }; continue; }
    if (!c) continue;
    if (/^END:VCARD/i.test(l)) {
      const name = c.name || c.n;
      if (name) out.push({ name, phone: (c.tels.find(t => t[1]) || c.tels[0])?.[0] || '', email: c.email, birthday: c.birthday, location: c.location, address: c.address, company: c.company, role: c.role, about: c.about });
      c = null; continue;
    }
    const m = l.match(/^(?:[\w-]+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/); if (!m) continue;
    const key = m[1].toUpperCase(), params = m[2].toUpperCase();
    const val = /ENCODING=QUOTED-PRINTABLE/.test(params) ? qp(m[3]) : m[3];
    if (key === 'FN') c.name = unesc(val);
    else if (key === 'N' && !c.n) { const p = parts(val); c.n = [p[3], p[1], p[2], p[0], p[4]].filter(Boolean).join(' '); }
    else if (key === 'TEL' && unesc(val)) c.tels.push([unesc(val).replace(/^tel:/i, ''), /CELL|MOBILE|IPHONE/.test(params)]);
    else if (key === 'EMAIL' && !c.email) c.email = unesc(val).replace(/^mailto:/i, '');
    else if (key === 'ORG' && !c.company) c.company = parts(val)[0] || '';
    else if (key === 'TITLE' && !c.role) c.role = unesc(val);
    else if (key === 'NOTE' && !c.about) c.about = unesc(val).slice(0, 600);
    else if (key === 'ADR' && !c.address) {
      const p = parts(val);   // po box; extended; street; city; region; postal code; country
      c.location = [p[3], p[4] || p[6]].filter(Boolean).join(', ');
      c.address = [p[2], p[3], [p[4], p[5]].filter(Boolean).join(' '), p[6]].filter(Boolean).join(', ');
    } else if (key === 'BDAY' && !c.birthday) {
      // 1990-06-04, 19900604, --0604, --06-04; Apple writes 1604 (with X-APPLE-OMIT-YEAR) when the year is unknown
      const b = unesc(val).match(/^(?:(\d{4})|--)-?(\d{2})-?(\d{2})/);
      if (b) { const noYear = !b[1] || b[1] === '1604' || /OMIT-YEAR/.test(params); const s = (noYear ? '' : b[1] + '-') + b[2] + '-' + b[3]; if (validDate(s)) c.birthday = s; }
    }
  }
  return out;
}
