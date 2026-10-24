// Reads one or more Obsidian vaults from disk into the data the map shows (notes, links, backlinks, broken links).
// Shared by the Vite plugin (vault-plugin.ts) and the MCP server (mcp-server.ts). Read-only: nothing here writes.
// Imports carry the .ts extension so Node can run this file directly (type stripping), outside Vite.
import fs from 'node:fs';
import path from 'node:path';
import LZString from 'lz-string';
import { outsideCode, withoutCode } from './rename-links.ts';
import { parseFrontmatter } from './frontmatter.ts';
import type { ProjectsCfg } from './projects.ts';
// sectionDepth: folders whose sections go one level deeper, e.g. { "projects": 2 } gives "projects/acme".
// lint: check notes against the vault schema (Health tab). sensitivity: default for notes that do not set one.
export type VaultCfg = { name?: string; path: string; exclude?: string[]; rootSection?: string; writable?: boolean; sectionDepth?: Record<string, number>; lint?: boolean; sensitivity?: string };
// projects: code folders whose PLAN/TODO/WORKLOG show as resume cards; jiraBase: ticket links (e.g. https://acme.atlassian.net/browse/)
export type Config = { vaults?: VaultCfg[]; vault?: string; exclude?: string[]; rootSection?: string; projects?: ProjectsCfg; jiraBase?: string };
export const IMG = /\.(png|jpe?g|gif|svg|webp)$/i;
export const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

export function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// fullKey keeps .excalidraw so x.md and x.excalidraw.md stay apart; key is the looser name ([[x]] may still mean a drawing x when there is no note x)
export const fullKey = (s: string) => s.trim().split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
export const key = (s: string) => fullKey(s).replace(/\.excalidraw$/i, '');
export const wikilinks = (t: string) => [...t.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(m => m[1].trim());
// [text](./other.md) style links between notes (never http, never images)
const mdlinks = (t: string) => [...t.matchAll(/(?<!!)\[[^\]]*\]\((?!https?:|mailto:|#)([^)\s]+?\.md)(?:#[^)]*)?\)/g)].map(m => decodeURIComponent(m[1]).trim());
export const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

function summaryOf(body: string) {
  const sec = body.match(/^##\s+Summary\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/im);
  const text = (sec ? sec[1] : body).replace(/!\[\[[^\]]*\]\]/g, '');
  const para = text.split(/\n\s*\n/).map(s => s.trim()).find(s => s && !/^(#|---|\||```|- |\* |>)/.test(s));
  return (para || '').replace(/\n/g, ' ').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/[*_`]/g, '')
    .replace(/^(.{140,320}?[.!?])\s.*$/, '$1').slice(0, 320);
}

export function vaultList(cfg: Config) {
  const list: VaultCfg[] = cfg.vaults?.length ? cfg.vaults : [{ path: cfg.vault!, exclude: cfg.exclude, rootSection: cfg.rootSection }];
  return list.map(v => ({ name: v.name || path.basename(v.path), path: v.path, exclude: v.exclude || [], rootSection: v.rootSection || 'General', writable: v.writable === true,
    sectionDepth: v.sectionDepth || {}, lint: v.lint === true, sensitivity: (v.sensitivity || '').toLowerCase() }));
}

// exclude entries: an exact path ("README.md"), a folder ("private/"), or a glob ("**/_templates/**", "drafts/*.md")
export function excluder(patterns: string[]) {
  const exact = new Set<string>(), res: RegExp[] = [];
  for (const p of patterns) {
    if (p.endsWith('/')) res.push(new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&')));
    else if (/[*?]/.test(p)) res.push(new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$'));
    else exact.add(p);
  }
  return (rel: string) => exact.has(rel) || res.some(r => r.test(rel));
}

// frontmatter values as short strings, for field:value search, facets and the schema lint
const META_SKIP = new Set(['title', 'body']);
function metaOf(fm: Record<string, any>) {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (META_SKIP.has(k)) continue;
    const s = (Array.isArray(v) ? v.join(', ') : String(v ?? '')).trim();
    if (s) m[k.toLowerCase()] = s.slice(0, 300);
  }
  return m;
}
export const one = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')).trim().replace(/^\[\[|\]\]$/g, '');

type RawNote = {
  vi: number; vault: string; base: string; fkey: string; path: string; abs: string; folder: string; title: string; tags: string[]; status: string; source: string; fetched: string;
  summary: string; body: string; related: string[]; rawLinks: string[]; id: string; links: string[]; backlinks: string[]; section: string;
  type: string; customer: string; project: string; component: string; sensitivity: string; meta: Record<string, string>;
  kind?: 'drawing'; scene?: { elements: any[]; appState?: any; files?: any }; mtime: number; writable: boolean;
};

// Excalidraw: the Obsidian plugin stores the scene LZ-compressed inside a ```compressed-json block; raw .excalidraw files are plain JSON.
function readScene(raw: string, isRawFile: boolean) {
  try {
    let json: string | null = null;
    if (isRawFile) json = raw;
    else {
      const c = raw.match(/```compressed-json\s*([\s\S]*?)```/), j = raw.match(/```json\s*([\s\S]*?)```/);
      json = c ? LZString.decompressFromBase64(c[1].replace(/\s+/g, '')) : j ? j[1] : null;
    }
    if (!json) return null;
    const s = JSON.parse(json);
    if (!Array.isArray(s.elements)) return null;
    return { elements: s.elements.filter((e: any) => !e.isDeleted), appState: { viewBackgroundColor: s.appState?.viewBackgroundColor }, files: s.files || {} };
  } catch { return null; }
}

export function loadVaults(cfg: Config) {
  const vaults = vaultList(cfg), multi = vaults.length > 1;
  const raws: RawNote[] = [];
  const assets: Map<string, string>[] = [];
  const usedAssets = new Set<string>();
  const broken: string[] = [];
  const brokenLinks: { from: string; target: string }[] = [];

  vaults.forEach((v, vi) => {
    if (!fs.existsSync(v.path)) { broken.push(`vault not found: ${v.path}`); assets.push(new Map()); return; }
    try { fs.readdirSync(v.path); } catch { broken.push(`vault not readable (macOS privacy?): ${v.path}`); assets.push(new Map()); return; }
    const files = walk(v.path);
    const images = new Map(files.filter(f => IMG.test(f)).map(f => [path.basename(f), f]));
    assets.push(images);
    const skip = excluder(v.exclude);
    for (const f of files.filter(f => (f.endsWith('.md') || f.endsWith('.excalidraw')) && !skip(path.relative(v.path, f).split(path.sep).join('/')))) {
      const rel = path.relative(v.path, f), parts = rel.split(path.sep), isRawXl = f.endsWith('.excalidraw');
      const base = path.basename(f).replace(/\.md$/i, '').replace(/\.excalidraw$/i, '');
      // one unreadable file (an iCloud file being downloaded or evicted, a permission problem) must not take the whole map down: skip it
      let text: string; try { text = fs.readFileSync(f, 'utf8'); } catch (e) { broken.push(`not readable, skipped: ${rel} (${(e as NodeJS.ErrnoException).code || e})`); continue; }
      let mtime = 0; try { mtime = Math.round(fs.statSync(f).mtimeMs); } catch {}
      const scene = isRawXl || /excalidraw-plugin:/.test(text.slice(0, 400)) ? readScene(text, isRawXl) : null;
      const parsed = isRawXl ? { fm: {} as Record<string, any>, body: '', hasFm: false } : parseFrontmatter(text);
      const { fm, hasFm } = parsed;
      // for drawings the searchable body is the text inside the drawing, not the compressed payload
      const drawingText: string = scene ? scene.elements.filter((e: any) => e.type === 'text' && e.text).map((e: any) => e.text).join('\n\n') : '';
      const body = scene ? drawingText : parsed.body;
      const h1 = body.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').match(/^#\s+(.+)$/m)?.[1]?.trim();   // a '# comment' inside a code block is not a heading
      const tags = [...new Set([...asList(fm.tags), ...(typeof fm.type === 'string' && fm.type ? [fm.type] : []), ...(scene ? ['excalidraw'] : [])])];
      const status = String(fm.status || '').toLowerCase().match(/current|stale|needs-verification|draft|closed|deprecated|archived|superseded/)?.[0] || (hasFm ? 'unknown' : 'none');
      const rewritten = outsideCode(body, s => s.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, name: string) => {
        const b = path.basename(name.trim());
        if (!images.has(b)) return m;
        usedAssets.add(`${vi}/${b}`);
        return `![${b}](/vault-assets/${vi}/${encodeURIComponent(b)})`;
      }));
      const depth = Math.max(1, Math.min(4, v.sectionDepth[parts[0]] || 1));
      const folder = parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/') : v.rootSection;
      raws.push({
        vi, vault: v.name, base, fkey: fullKey(path.basename(f)), path: rel, abs: path.resolve(v.path, rel), folder, id: base, section: multi ? `${v.name} / ${folder}` : folder,
        title: (fm.title as string) || h1 || base, tags, status,
        source: fm.source && fm.source !== 'none' ? String(fm.source) : '', fetched: String(fm.source_fetched || fm.updated || fm.date || ''),
        summary: scene ? `Excalidraw drawing, ${scene.elements.length} elements.${drawingText ? ' ' + drawingText.trim().split(/\n+/)[0].slice(0, 90) : ''}` : (typeof fm.summary === 'string' && fm.summary ? fm.summary.slice(0, 320) : summaryOf(body)),
        ...(scene ? { kind: 'drawing' as const, scene } : {}),
        type: one(fm.type).toLowerCase(), customer: one(fm.customer).toLowerCase(), project: one(fm.project).toLowerCase(), component: one(fm.component).toLowerCase(),
        sensitivity: (one(fm.sensitivity) || v.sensitivity).toLowerCase(), meta: metaOf(fm),
        mtime, writable: v.writable && !scene && f.endsWith('.md'), body: rewritten, related: asList(fm.related).flatMap(wikilinks), rawLinks: (prose => [...wikilinks(prose), ...mdlinks(prose)])(withoutCode(body)), links: [], backlinks: [],
      });
    }
  });

  // unique ids: bare filename when unique, otherwise "<vault>/<path>" so notes with the same name never collide
  const count = new Map<string, number>();
  raws.forEach(n => count.set(n.base, (count.get(n.base) || 0) + 1));
  raws.forEach(n => { if (count.get(n.base)! > 1) n.id = `${n.vault}/${n.path.replace(/\.md$/, '')}`; });

  // link resolution: same vault first, then any other vault
  // exact file name first ([[x.excalidraw]] is the drawing), then the loose name, where a note beats a drawing ([[x]] is x.md)
  const lookup = (list: RawNote[], lastWins: boolean) => {
    const exact = new Map<string, RawNote>(), loose = new Map<string, RawNote>();
    for (const n of list) {
      if (lastWins || !exact.has(n.fkey)) exact.set(n.fkey, n);
      const k = key(n.fkey), cur = loose.get(k);
      if (!cur || (cur.kind === 'drawing' && n.kind !== 'drawing') || (lastWins && (cur.kind === 'drawing') === (n.kind === 'drawing'))) loose.set(k, n);
    }
    return (t: string) => exact.get(fullKey(t)) ?? loose.get(key(t));
  };
  const perVaultFind = vaults.map((_, vi) => lookup(raws.filter(n => n.vi === vi), true));
  const globalFind = lookup(raws, false);
  const find = (n: RawNote, t: string) => perVaultFind[n.vi](t) ?? globalFind(t);
  const edges = new Set<string>();
  for (const n of raws) {
    for (const t of new Set([...n.related, ...n.rawLinks])) {
      const tn = find(n, t);
      if (!tn) { broken.push(`${n.vault}: ${n.path} -> [[${t}]]`); brokenLinks.push({ from: n.id, target: t }); continue; }
      if (tn.id === n.id) continue;
      if (!n.links.includes(tn.id)) n.links.push(tn.id);
      edges.add([n.id, tn.id].sort().join('\u0000'));
    }
  }
  // ![[some.excalidraw]] embeds: swap for a placeholder the panel renders as the drawing, and link the notes
  for (const n of raws) {
    n.body = outsideCode(n.body, s => s.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (m: string, name: string) => {
      const tn = find(n, name);
      if (!tn || tn.kind !== 'drawing') return m;
      if (tn.id !== n.id) { if (!n.links.includes(tn.id)) n.links.push(tn.id); edges.add([n.id, tn.id].sort().join('\u0000')); }
      return `\n\n<div class="xl-embed" data-id="${tn.id.replace(/"/g, '&quot;')}"></div>\n\n`;
    }));
  }
  for (const n of raws) n.backlinks = raws.filter(o => o.links.includes(n.id)).map(o => o.id);

  const sections = [...new Set(raws.map(n => n.section))].sort();
  raws.sort((a, b) => a.vi - b.vi || sections.indexOf(a.section) - sections.indexOf(b.section) || a.title.localeCompare(b.title));
  const data = {
    vaultName: vaults[0]?.name ?? '', vaults: vaults.map(v => v.name), lintVaults: vaults.filter(v => v.lint).map(v => v.name), writableVaults: vaults.filter(v => v.writable).map(v => v.name), generated: new Date().toISOString(), sections,
    notes: raws.map(({ vi, base, fkey, folder, related, rawLinks, ...n }) => n),
    edges: [...edges].map(e => e.split('\u0000')),
    broken, brokenLinks,
    jiraBase: typeof cfg.jiraBase === 'string' && /^https:\/\//.test(cfg.jiraBase) ? cfg.jiraBase : '',
    hasProjects: !!cfg.projects?.roots?.length, projectCustomers: cfg.projects?.customers || {},
  };
  return { data, assets, usedAssets, vaults };
}
