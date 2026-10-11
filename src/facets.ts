import type { Note } from 'virtual:vault';

// Frontmatter facets shown in the Filter popover. Values are lower-cased by the vault plugin.
export const FACETS = ['type', 'customer', 'project', 'status', 'sensitivity'] as const;
export type Facet = typeof FACETS[number];
export type FacetSel = Partial<Record<Facet, string[]>>;
export const facetOf = (n: Note, f: Facet) => {
  const v = f === 'status' ? (n.status === 'none' || n.status === 'unknown' ? '' : n.status) : n[f];
  return v || '';
};
export function facetCounts(notes: Note[]) {
  const out = {} as Record<Facet, [string, number][]>;
  for (const f of FACETS) {
    const m = new Map<string, number>();
    notes.forEach(n => { const v = facetOf(n, f); if (v) m.set(v, (m.get(v) || 0) + 1); });
    out[f] = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }
  return out;
}
// OR inside one facet, AND across facets
export const facetMatch = (n: Note, sel: FacetSel) => FACETS.every(f => !sel[f]?.length || sel[f]!.includes(facetOf(n, f)));

// Color by type: three groups only (a 3D scatter can only keep three categorical hues apart for every reader),
// everything else stays neutral. Hues are the validated dataviz categorical slots 1-3, stepped per theme.
export const TYPE_GROUPS: { key: string; label: string; types: string[]; light: string; dark: string }[] = [
  { key: 'knowledge', label: 'Knowledge', types: ['concept', 'reference', 'how-to', 'explainer', 'code-walkthrough', 'research'], light: '#2a78d6', dark: '#3987e5' },
  { key: 'problems', label: 'Bugs and incidents', types: ['bug', 'incident'], light: '#eb6834', dark: '#d95926' },
  { key: 'learning', label: 'Lessons and decisions', types: ['lesson', 'decision'], light: '#1baf7a', dark: '#199e70' },
];
export function typeTints(notes: Note[], dark: boolean) {
  const byType = new Map<string, string>();
  TYPE_GROUPS.forEach(g => g.types.forEach(t => byType.set(t, dark ? g.dark : g.light)));
  const m = new Map<string, string>();
  notes.forEach(n => { const c = byType.get(n.type); if (c) m.set(n.id, c); });
  return m;
}

// Schema lint for vaults with "lint": true (see the vault AGENTS.md). Returns the problems of one note.
const DAY = 864e5;
export function lintNote(n: Note, hubs: Set<string>, now = Date.now()): string[] {
  if (n.kind === 'drawing') return [];
  const p: string[] = [], m = n.meta;
  const top = n.path.split('/')[0];
  if (top === 'inbox') { if (now - n.mtime > 7 * DAY) p.push('in inbox for over 7 days'); return p; }
  if (top === 'sources' || top === 'archive') return p;
  if (!m.type) p.push('no type');
  if (!m.summary) p.push('no summary');
  if (!m.sensitivity) p.push('no sensitivity');
  const fetched = Date.parse(m.source_fetched || '');
  if (n.status === 'current' && m.source && m.source !== 'none' && fetched && now - fetched > 90 * DAY) p.push('source older than 90 days');
  if (n.type !== 'hub' && top !== 'journal' && !n.links.some(i => hubs.has(i)) && !n.backlinks.some(i => hubs.has(i))) p.push('not linked to a hub');
  return p;
}
