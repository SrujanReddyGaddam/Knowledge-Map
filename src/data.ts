import raw, { type Note } from 'virtual:vault';

// Safe mode (for screen sharing) is applied here, once, before anything renders: hidden notes are removed from the data itself,
// so they cannot show up on the map, in search, Browse, backlinks, hover cards or link suggestions. Toggling it reloads the page.
// Only notes explicitly marked public or internal stay visible; a note without a sensitivity is hidden (fail closed).
export const SAFE_OK = new Set(['public', 'internal']);
export const safeMode = (() => {
  const p = new URLSearchParams(location.search).get('safe');
  if (p !== null) return p !== '0';
  try { return localStorage.getItem('safeMode') === '1'; } catch { return false; }
})();
export const setSafeMode = (on: boolean) => {
  try { localStorage.setItem('safeMode', on ? '1' : '0'); } catch {}
  const u = new URL(location.href); u.searchParams.delete('safe'); u.hash = '';
  location.replace(u.toString());
};

const base = (s: string) => s.split('/').pop()!.replace(/\.(md|excalidraw)$/i, '').toLowerCase();

function filtered(): typeof raw & { hiddenCount: number } {
  if (!safeMode) return { ...raw, hiddenCount: 0 };
  const keep = raw.notes.filter(n => SAFE_OK.has(n.sensitivity));
  const ids = new Set(keep.map(n => n.id));
  const hiddenNames = new Set(raw.notes.filter(n => !ids.has(n.id)).map(n => base(n.path)));
  const notes: Note[] = keep.map(n => ({ ...n, links: n.links.filter(i => ids.has(i)), backlinks: n.backlinks.filter(i => ids.has(i)) }));
  return {
    ...raw, notes, hiddenCount: raw.notes.length - keep.length,
    sections: raw.sections.filter(s => notes.some(n => n.section === s)),
    edges: raw.edges.filter(([a, b]) => ids.has(a) && ids.has(b)),
    // links from visible notes to hidden ones are not "broken", and broken links inside hidden notes are not shown
    brokenLinks: raw.brokenLinks.filter(b => ids.has(b.from) && !hiddenNames.has(base(b.target))),
    broken: [],
  };
}

const data = filtered();
export default data;
export type { Note };
