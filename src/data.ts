import raw, { type Note } from 'virtual:vault';
import { applySafe } from './safe';

// Safe mode (for screen sharing) is applied here, once, before anything renders: hidden notes are removed from the data itself,
// so they cannot show up on the map, in search, Browse, backlinks, hover cards or link suggestions. Toggling it reloads the page.
// Only notes explicitly marked public or internal stay visible; a note without a sensitivity is hidden (fail closed).
export { SAFE_OK } from './safe';
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

const data = safeMode ? applySafe(raw) : { ...raw, hiddenCount: 0 };
export default data;
export type { Note };
