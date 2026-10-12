import type { Note } from 'virtual:vault';

// Workspaces: a customer as the current context. The "where was I" trail keeps the last notes opened per customer (this browser only).
const KEY = 'kmTrail', KEEP = 8;
type Trails = Record<string, string[]>;
const load = (): Trails => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
export const trailOf = (c: string) => load()[c] ?? [];
export function pushTrail(c: string, id: string) {
  const t = load(), list = [id, ...(t[c] ?? []).filter(x => x !== id)].slice(0, KEEP);
  t[c] = list; try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
  return list;
}
// the customer a note belongs to: its customer: field, else the folder under projects/
export const customerOfNote = (n: Note, customers: string[]) => {
  if (n.customer && customers.includes(n.customer)) return n.customer;
  const m = n.path.toLowerCase().match(/^projects\/([^/]+)\//);
  return m && customers.includes(m[1]) ? m[1] : '';
};
