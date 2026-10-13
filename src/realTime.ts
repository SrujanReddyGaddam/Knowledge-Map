import type { Note } from 'virtual:vault';
import type { Commit } from './api';

// "Real" activity: file dates lie after bulk edits (a rename or re-tagging touches every note at once), so a note whose
// last change is explained by a bulk commit (> BULK markdown files) falls back to its own date (dated file name or date:)
// or its last small commit. Edits made after the bulk commit, committed or not, count as real. Without git: the file date.
export const BULK = 10;
export type Activity = { bulk: Map<string, number>; small: Map<string, number> };   // key "<vault>/<path>": newest commit time
const key = (vaultName: string, path: string) => vaultName + '/' + path;

export function activityFrom(byVault: Map<string, Commit[]>): Activity {
  const bulk = new Map<string, number>(), small = new Map<string, number>();
  for (const [v, commits] of byVault) for (const c of commits) {
    const t = Date.parse(c.date), m = c.files.length > BULK ? bulk : small;
    for (const f of c.files) { const k = key(v, f.path); if (t > (m.get(k) ?? 0)) m.set(k, t); }
  }
  return { bulk, small };
}

export const datedTime = (n: Note) => {
  const d = n.path.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || (/^\d{4}-\d{2}-\d{2}/.test(n.meta.date || '') ? n.meta.date.slice(0, 10) : '');
  return d ? Date.parse(d + 'T12:00:00') : 0;
};
// newest real activity on a note (0 = unknown)
export function realTime(n: Note, a: Activity | null) {
  if (!a) return n.mtime;
  const k = key(n.vault, n.path), b = a.bulk.get(k);
  if (b === undefined || n.mtime > b + 1500) return n.mtime;
  return Math.max(a.small.get(k) ?? 0, datedTime(n));
}
export const bulkOnly = (n: Note, a: Activity | null) => !!a && realTime(n, a) !== n.mtime;
