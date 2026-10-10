// Pure link rewriting for rename/move (no file access, so it can be tested on its own).
// Rewrites [[wikilinks]] and ![[embeds]] to the renamed note, and relative [text](x.md) links, skipping code blocks and code spans.
import path from 'node:path';

export type LinkCtx = {
  oldKey: string;          // lower-case old file name without .md
  newBase: string;         // new file name without .md
  newRelNoExt: string;     // new path inside the vault without .md, for path-style links
  wiki: boolean;           // do this note's [[links]] to oldKey resolve to the moved note?
  samePath: boolean;       // is this note in the same vault (path-style links use the new path)?
  oldAbs: string;          // moved note, before and after
  newAbs: string;
  selfOld: string;         // the note being rewritten, where it is now and where it will be
  selfNew: string;
};

const key = (s: string) => s.trim().split('/').pop()!.replace(/\.md$/i, '').replace(/\.excalidraw$/i, '').toLowerCase();
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;
export const outsideCode = (t: string, fn: (s: string) => string) => t.split(CODE).map((s, i) => (i % 2 ? s : fn(s))).join('');
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

const WIKI = /(!?\[\[)([^\]|#\n]+?)((?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\])/g;
const MD = /(?<!!)(\[[^\]\n]*\]\()(?!https?:|mailto:|#)([^)\s]+?\.md)((?:#[^)\s]*)?\))/g;

export function rewriteLinks(text: string, c: LinkCtx): { text: string; wiki: number; md: number } {
  let wiki = 0, md = 0;
  const out = outsideCode(text, seg => seg
    .replace(WIKI, (m, open: string, target: string, rest: string) => {
      if (!c.wiki || key(target) !== c.oldKey) return m;
      const t = target.trim();
      let nt = t.includes('/') && c.samePath ? c.newRelNoExt : c.newBase;
      if (/\.md$/i.test(t)) nt += '.md';
      if (nt === t) return m;
      wiki++; return open + nt + rest;
    })
    .replace(MD, (m, open: string, p: string, rest: string) => {
      if (p.startsWith('/')) return m;
      const abs = path.resolve(path.dirname(c.selfOld), dec(p));
      const target = abs === c.oldAbs ? c.newAbs : abs;
      let rel = path.relative(path.dirname(c.selfNew), target).split(path.sep).join('/');
      if (p.startsWith('./') && !rel.startsWith('.')) rel = './' + rel;
      if (p.includes('%') || / /.test(rel)) rel = rel.split('/').map(s => (s === '.' || s === '..' ? s : encodeURIComponent(s))).join('/');
      if (rel === p) return m;
      md++; return open + rel + rest;
    }));
  return { text: out, wiki, md };
}

// relative references we do not rewrite (images, other file types); used to warn when a note moves to another folder
export const otherRelativeRefs = (text: string) => {
  let n = 0;
  outsideCode(text, s => { n += (s.match(/\]\((?!https?:|mailto:|#|\/)[^)\s]+\)/g) || []).filter(x => !/\.md(#[^)]*)?\)$/i.test(x)).length; return s; });
  return n;
};
