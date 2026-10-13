const cut = (t: string) => t.split(/\s+[\u2014\u2013-]\s+|\s+\(/)[0];
export const shortTitle = (t: string) => { const c = cut(t); return c.length < 9 ? (t.length > 44 ? t.slice(0, 42) + '..' : t) : c; };
// map label: words greedily packed into lines of about `cols` chars, at most `max` lines, '..' only past the last line
export const wrapLabel = (t: string, cols = 26, max = 3) => {
  const words = t.split(/\s+/).filter(Boolean).flatMap(w => w.length > cols ? w.match(new RegExp(`.{1,${cols}}`, 'g'))! : [w]);
  const lines: string[] = [];
  for (const w of words) { const l = lines.length - 1; if (l >= 0 && lines[l].length + 1 + w.length <= cols) lines[l] += ' ' + w; else lines.push(w); }
  if (lines.length > max) { lines.length = max; const last = lines[max - 1]; lines[max - 1] = (last.length > cols - 2 ? last.slice(0, cols - 2).trimEnd() : last) + '..'; }
  return lines.length ? lines : [''];
};
export const restTitle = (t: string) => { const s = shortTitle(t); return t.startsWith(s) && s.length < t.length && cut(t) === s ? t.slice(s.length).replace(/^\s+[\u2014\u2013-]\s+/, '').replace(/^\s*\(|\)\s*$/g, '') : ''; };
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
