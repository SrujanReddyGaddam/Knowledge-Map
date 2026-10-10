// Tracks which version of each note the user has seen, so the app can flag notes edited since.
// base: notes are "updated" when their file changed after this time (set on first run, so nothing starts flagged).
// seen: per-note override, the mtime of the version last opened.
export type Seen = { base: number; seen: Record<string, number> };
const KEY = 'seenV1';
export const loadSeen = (): Seen => {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s.base === 'number') return { base: s.base, seen: s.seen || {} }; } catch {}
  return { base: Date.now(), seen: {} };
};
export const saveSeen = (s: Seen) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
