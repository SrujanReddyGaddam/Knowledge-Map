import type { Note } from 'virtual:vault';

// Safe mode filter as a pure function, shared by the page (src/data.ts) and the MCP server (mcp-server.ts --safe).
// Only notes explicitly marked public or internal stay; a note without a sensitivity is dropped (fail closed).
export const SAFE_OK = new Set(['public', 'internal']);
const base = (s: string) => s.split('/').pop()!.replace(/\.(md|excalidraw)$/i, '').toLowerCase();

type Data = { notes: Note[]; sections: string[]; edges: [string, string][]; brokenLinks: { from: string; target: string }[]; broken: string[] };
export function applySafe<D extends Data>(raw: D): D & { hiddenCount: number } {
  const keep = raw.notes.filter(n => SAFE_OK.has(n.sensitivity));
  const ids = new Set(keep.map(n => n.id));
  const hiddenNames = new Set(raw.notes.filter(n => !ids.has(n.id)).map(n => base(n.path)));
  // a [[link]] to a hidden note would still print its name (often customer-first) in visible text: replace it with a neutral label.
  // Display only: the editor and saves work on the exact file text from /api/raw, never on this copy.
  const mask = (t: string) => t.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (m, target: string) => (hiddenNames.has(base(target.trim())) ? '(hidden note)' : m));
  const notes: Note[] = keep.map(n => ({
    ...n, body: mask(n.body), summary: mask(n.summary), source: mask(n.source),
    meta: Object.fromEntries(Object.entries(n.meta).map(([k, v]) => [k, mask(v)])),
    links: n.links.filter(i => ids.has(i)), backlinks: n.backlinks.filter(i => ids.has(i)),
  }));
  return {
    ...raw, notes, hiddenCount: raw.notes.length - keep.length,
    sections: raw.sections.filter(s => notes.some(n => n.section === s)),
    edges: raw.edges.filter(([a, b]) => ids.has(a) && ids.has(b)),
    // links from visible notes to hidden ones are not "broken", and broken links inside hidden notes are not shown
    brokenLinks: raw.brokenLinks.filter(b => ids.has(b.from) && !hiddenNames.has(base(b.target))),
    broken: [],
  };
}
