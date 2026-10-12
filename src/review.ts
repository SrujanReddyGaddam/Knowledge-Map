import type { Note } from 'virtual:vault';

// Staleness: when a note was last looked at = the later of its file time and a "reviewed: YYYY-MM-DD" frontmatter date.
// Used by the "age" color mode and the review queue in Today ("still true?").
const DAY = 864e5;
export const reviewedAt = (n: Note) => Math.max(n.mtime, Date.parse(n.meta.reviewed || '') || 0);

// four buckets, one hue getting paler with age (the oldest drops back to the neutral node color)
export const AGE_BUCKETS = [
  { label: 'under 2 weeks', days: 14, light: '#1f63b8', dark: '#5aa2f0' },
  { label: 'under 2 months', days: 60, light: '#4f8fdc', dark: '#3f7fc6' },
  { label: 'under 6 months', days: 180, light: '#9dbde6', dark: '#2f5785' },
  { label: 'older', days: Infinity, light: '', dark: '' },
];
export function ageTints(notes: Note[], dark: boolean, now = Date.now()) {
  const m = new Map<string, string>();
  for (const n of notes) {
    const age = (now - reviewedAt(n)) / DAY, b = AGE_BUCKETS.find(x => age < x.days)!;
    const c = dark ? b.dark : b.light; if (c) m.set(n.id, c);
  }
  return m;
}

// review queue: evergreen notes (knowledge/ or a knowledge-like type) in a writable vault, oldest review first, minus snoozed ones
const TYPES = new Set(['concept', 'reference', 'how-to', 'explainer', 'code-walkthrough', 'lesson', 'decision', 'bug', 'research']);
const DONE = new Set(['archived', 'deprecated', 'closed']);
const SNOOZE = 'kmReviewSnooze';
const snoozed = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(SNOOZE) || '{}') || {}; } catch { return {}; } };
export function snooze(id: string, days = 14) {
  const s = snoozed(), now = Date.now();
  for (const k of Object.keys(s)) if (s[k] < now) delete s[k];
  s[id] = now + days * DAY; try { localStorage.setItem(SNOOZE, JSON.stringify(s)); } catch {}
}
export function reviewQueue(notes: Note[], lintVaults: string[], max = 5, now = Date.now()) {
  const s = snoozed();
  return notes.filter(n => n.writable && n.kind !== 'drawing' && n.type !== 'hub' && lintVaults.includes(n.vault) && !DONE.has(n.status) && !(s[n.id] > now)
      && (n.path.startsWith('knowledge/') || TYPES.has(n.type)) && now - reviewedAt(n) > 30 * DAY)
    .sort((a, b) => reviewedAt(a) - reviewedAt(b)).slice(0, max);
}

// set scalar frontmatter keys in the exact file text (other lines, order and line endings untouched). null = refused:
// no frontmatter, mixed line endings, or the key holds a block list.
export function setFrontmatter(raw: string, kv: Record<string, string>): string | null {
  const crlf = raw.includes('\r\n');
  if (crlf && /(^|[^\r])\n/.test(raw)) return null;
  const t = crlf ? raw.replace(/\r\n/g, '\n') : raw;
  if (!t.startsWith('---\n')) return null;
  const end = t.indexOf('\n---', 3);
  if (end < 0 || t.slice(end + 1).split('\n')[0].trim() !== '---') return null;
  const fm = t.slice(4, end).split('\n');
  for (const [k, v] of Object.entries(kv)) {
    const i = fm.findIndex(l => new RegExp(`^${k}\\s*:`).test(l));
    if (i < 0) { fm.push(`${k}: ${v}`); continue; }
    if (!fm[i].replace(/^[^:]*:\s*/, '').trim() && /^\s+-/.test(fm[i + 1] || '')) return null;
    fm[i] = `${k}: ${v}`;
  }
  const out = '---\n' + fm.join('\n') + t.slice(end);
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}
