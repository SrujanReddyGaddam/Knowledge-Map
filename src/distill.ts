import type { Note } from 'virtual:vault';

// Distilled hubs (vault README "Current state"): a customer/project/component hub carries `## Current state` and
// `distilled_through: YYYY-MM-DD`; replaced notes carry `status: superseded` and `superseded_by: "[[note]]"`.
// Pure (MCP-safe). Ownership mirrors scripts/distill-queue.ts: a note belongs to the most specific hub that exists.

export const isSuperseded = (n: Note) => n.status === 'superseded';
// the bare note name in superseded_by ("[[x]]", [[x|alias]], x), '' if none
export const supersededBy = (n: Note) => (n.meta.superseded_by || '').replace(/^["']|["']$/g, '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();

const DAY = /^\d{4}-\d{2}-\d{2}/;
export const distilledThrough = (n: Note) => (DAY.test(n.meta.distilled_through || '') ? n.meta.distilled_through.slice(0, 10) : '');

// the body of "## Current state" (to the next heading of level 1 or 2, code blocks respected); '' when absent or still the template placeholder
export function currentState(n: Note) {
  const lines = n.body.split('\n'), out: string[] = [];
  let on = false, fence = false;
  for (const l of lines) {
    if (/^(```|~~~)/.test(l)) fence = !fence;
    if (!fence && /^#{1,2}\s/.test(l)) { if (on) break; on = /^##\s+current state\s*$/i.test(l); continue; }
    if (on) out.push(l);
  }
  const text = out.join('\n').trim();
  return /^_?not distilled yet/i.test(text) ? '' : text;
}

const low = (s: string) => (s || '').toLowerCase();
export const isStateHub = (n: Note) => n.type === 'hub' && !!n.customer;
export function ownerHub(n: Note, notes: Note[]): Note | null {
  if (!n.customer || n.type === 'hub') return null;
  const hubs = notes.filter(h => isStateHub(h) && low(h.customer) === low(n.customer));
  const find = (p: string, k: string) => hubs.find(h => low(h.project) === low(p) && low(h.component) === low(k));
  return (n.component && find(n.project, n.component)) || (n.project && find(n.project, '')) || find('', '') || null;
}
// notes of this hub newer than its distilled_through (all of them if it was never distilled), oldest first.
// dayOf gives a note's YYYY-MM-DD (callers pass real activity, so bulk commits do not count).
export function pendingFor(hub: Note, notes: Note[], dayOf: (n: Note) => string) {
  const since = distilledThrough(hub);
  return notes.filter(n => !isSuperseded(n) && ownerHub(n, notes)?.id === hub.id && (!since || dayOf(n) > since)).sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
}
export const distillPrompt = (hub: Note) => `/distill ${hub.path.split('/').pop()!.replace(/\.md$/i, '')}`;
