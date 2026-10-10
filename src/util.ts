const cut = (t: string) => t.split(/\s+[\u2014\u2013-]\s+|\s+\(/)[0];
export const shortTitle = (t: string) => { const c = cut(t); return c.length < 9 ? (t.length > 44 ? t.slice(0, 42) + '..' : t) : c; };
export const restTitle = (t: string) => { const s = shortTitle(t); return t.startsWith(s) && s.length < t.length && cut(t) === s ? t.slice(s.length).replace(/^\s+[\u2014\u2013-]\s+/, '').replace(/^\s*\(|\)\s*$/g, '') : ''; };
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
