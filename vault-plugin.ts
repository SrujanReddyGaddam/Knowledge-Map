// Vite plugin: reads one or more Obsidian vaults (read-only) and exposes them as the virtual module "virtual:vault".
// Re-reads on any vault change (live reload) and serves/copies vault images under /vault-assets/<vaultIndex>/<name>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import LZString from 'lz-string';
import type { Plugin } from 'vite';

type VaultCfg = { name?: string; path: string; exclude?: string[]; rootSection?: string };
type Config = { vaults?: VaultCfg[]; vault?: string; exclude?: string[]; rootSection?: string };
const IMG = /\.(png|jpe?g|gif|svg|webp)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

function walk(dir: string, acc: string[] = []): string[] {
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

function parseFrontmatter(raw: string) {
  if (!raw.startsWith('---\n')) return { fm: {} as Record<string, any>, body: raw, hasFm: false };
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return { fm: {} as Record<string, any>, body: raw, hasFm: false };
  const block = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n/, '');
  const fm: Record<string, any> = {};
  let listKey: string | null = null;
  for (const line of block.split('\n')) {
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && listKey) { fm[listKey].push(li[1].trim().replace(/^["']|["']$/g, '')); continue; }
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (v === '') { fm[k] = []; listKey = k; continue; }
    listKey = null;
    if (v.startsWith('[') && v.endsWith(']')) fm[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else fm[k] = v.replace(/^["']|["']$/g, '');
  }
  return { fm, body, hasFm: true };
}

const key = (s: string) => s.trim().split('/').pop()!.replace(/\.md$/i, '').replace(/\.excalidraw$/i, '').toLowerCase();
const wikilinks = (t: string) => [...t.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(m => m[1].trim());
// [text](./other.md) style links between notes (never http, never images)
const mdlinks = (t: string) => [...t.matchAll(/(?<!!)\[[^\]]*\]\((?!https?:|mailto:|#)([^)\s]+?\.md)(?:#[^)]*)?\)/g)].map(m => decodeURIComponent(m[1]).trim());
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

function summaryOf(body: string) {
  const sec = body.match(/^##\s+Summary\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/im);
  const text = (sec ? sec[1] : body).replace(/!\[\[[^\]]*\]\]/g, '');
  const para = text.split(/\n\s*\n/).map(s => s.trim()).find(s => s && !/^(#|---|\||```|- |\* |>)/.test(s));
  return (para || '').replace(/\n/g, ' ').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/[*_`]/g, '')
    .replace(/^(.{140,320}?[.!?])\s.*$/, '$1').slice(0, 320);
}

function vaultList(cfg: Config): Required<Pick<VaultCfg, 'name' | 'path' | 'exclude' | 'rootSection'>>[] {
  const list: VaultCfg[] = cfg.vaults?.length ? cfg.vaults : [{ path: cfg.vault!, exclude: cfg.exclude, rootSection: cfg.rootSection }];
  return list.map(v => ({ name: v.name || path.basename(v.path), path: v.path, exclude: v.exclude || [], rootSection: v.rootSection || 'General' }));
}

type RawNote = {
  vi: number; vault: string; base: string; path: string; abs: string; folder: string; title: string; tags: string[]; status: string; source: string; fetched: string;
  summary: string; body: string; related: string[]; rawLinks: string[]; id: string; links: string[]; backlinks: string[]; section: string;
  kind?: 'drawing'; scene?: { elements: any[]; appState?: any; files?: any }; mtime: number;
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

function loadVaults(cfg: Config) {
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
    for (const f of files.filter(f => (f.endsWith('.md') || f.endsWith('.excalidraw')) && !v.exclude.includes(path.relative(v.path, f)))) {
      const rel = path.relative(v.path, f), parts = rel.split(path.sep), isRawXl = f.endsWith('.excalidraw');
      const base = path.basename(f).replace(/\.md$/i, '').replace(/\.excalidraw$/i, '');
      const text = fs.readFileSync(f, 'utf8');
      let mtime = 0; try { mtime = Math.round(fs.statSync(f).mtimeMs); } catch {}
      const scene = isRawXl || /excalidraw-plugin:/.test(text.slice(0, 400)) ? readScene(text, isRawXl) : null;
      const parsed = isRawXl ? { fm: {} as Record<string, any>, body: '', hasFm: false } : parseFrontmatter(text);
      const { fm, hasFm } = parsed;
      // for drawings the searchable body is the text inside the drawing, not the compressed payload
      const drawingText: string = scene ? scene.elements.filter((e: any) => e.type === 'text' && e.text).map((e: any) => e.text).join('\n\n') : '';
      const body = scene ? drawingText : parsed.body;
      const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const tags = [...new Set([...asList(fm.tags), ...(typeof fm.type === 'string' && fm.type ? [fm.type] : []), ...(scene ? ['excalidraw'] : [])])];
      const status = String(fm.status || '').toLowerCase().match(/current|stale|needs-verification|draft/)?.[0] || (hasFm ? 'unknown' : 'none');
      const rewritten = body.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, name: string) => {
        const b = path.basename(name.trim());
        if (!images.has(b)) return m;
        usedAssets.add(`${vi}/${b}`);
        return `![${b}](/vault-assets/${vi}/${encodeURIComponent(b)})`;
      });
      const folder = parts.length > 1 ? parts[0] : v.rootSection;
      raws.push({
        vi, vault: v.name, base, path: rel, abs: path.resolve(v.path, rel), folder, id: base, section: multi ? `${v.name} / ${folder}` : folder,
        title: (fm.title as string) || h1 || base, tags, status,
        source: fm.source && fm.source !== 'none' ? String(fm.source) : '', fetched: String(fm.source_fetched || fm.updated || fm.date || ''),
        summary: scene ? `Excalidraw drawing, ${scene.elements.length} elements.${drawingText ? ' ' + drawingText.trim().split(/\n+/)[0].slice(0, 90) : ''}` : (typeof fm.summary === 'string' && fm.summary ? fm.summary.slice(0, 320) : summaryOf(body)),
        ...(scene ? { kind: 'drawing' as const, scene } : {}),
        mtime, body: rewritten, related: asList(fm.related).flatMap(wikilinks), rawLinks: [...wikilinks(body), ...mdlinks(body)], links: [], backlinks: [],
      });
    }
  });

  // unique ids: bare filename when unique, otherwise "<vault>/<path>" so notes with the same name never collide
  const count = new Map<string, number>();
  raws.forEach(n => count.set(n.base, (count.get(n.base) || 0) + 1));
  raws.forEach(n => { if (count.get(n.base)! > 1) n.id = `${n.vault}/${n.path.replace(/\.md$/, '')}`; });

  // link resolution: same vault first, then any other vault
  const perVault = vaults.map((_, vi) => new Map(raws.filter(n => n.vi === vi).map(n => [key(n.base), n])));
  const global = new Map<string, RawNote>();
  raws.forEach(n => { if (!global.has(key(n.base))) global.set(key(n.base), n); });
  const edges = new Set<string>();
  for (const n of raws) {
    for (const t of new Set([...n.related, ...n.rawLinks])) {
      const tn = perVault[n.vi].get(key(t)) ?? global.get(key(t));
      if (!tn) { broken.push(`${n.vault}: ${n.path} -> [[${t}]]`); brokenLinks.push({ from: n.id, target: t }); continue; }
      if (tn.id === n.id) continue;
      if (!n.links.includes(tn.id)) n.links.push(tn.id);
      edges.add([n.id, tn.id].sort().join('\u0000'));
    }
  }
  // ![[some.excalidraw]] embeds: swap for a placeholder the panel renders as the drawing, and link the notes
  for (const n of raws) {
    n.body = n.body.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (m: string, name: string) => {
      const tn = perVault[n.vi].get(key(name)) ?? global.get(key(name));
      if (!tn || tn.kind !== 'drawing') return m;
      if (tn.id !== n.id) { if (!n.links.includes(tn.id)) n.links.push(tn.id); edges.add([n.id, tn.id].sort().join('\u0000')); }
      return `\n\n<div class="xl-embed" data-id="${tn.id.replace(/"/g, '&quot;')}"></div>\n\n`;
    });
  }
  for (const n of raws) n.backlinks = raws.filter(o => o.links.includes(n.id)).map(o => o.id);

  const sections = [...new Set(raws.map(n => n.section))].sort();
  raws.sort((a, b) => a.vi - b.vi || sections.indexOf(a.section) - sections.indexOf(b.section) || a.title.localeCompare(b.title));
  const data = {
    vaultName: vaults[0]?.name ?? '', vaults: vaults.map(v => v.name), generated: new Date().toISOString(), sections,
    notes: raws.map(({ vi, base, folder, related, rawLinks, ...n }) => n),
    edges: [...edges].map(e => e.split('\u0000')),
    broken, brokenLinks,
  };
  return { data, assets, usedAssets, vaults };
}

export default function vault(): Plugin {
  const cfg: Config = JSON.parse(fs.readFileSync(path.resolve('config.json'), 'utf8'));
  const ID = 'virtual:vault', RID = '\0' + ID;
  let current = loadVaults(cfg);
  const report = () => console.log(`[vault] ${current.data.vaults.join(', ')}: ${current.data.notes.length} notes, ${current.data.edges.length} links, ${current.data.broken.length} unresolved`);
  report();
  const roots = current.vaults.map(v => v.path);
  return {
    name: 'vault',
    resolveId(id) { if (id === ID) return RID; },
    load(id) { if (id === RID) return `export default ${JSON.stringify(current.data)}`; },
    configureServer(server) {
      roots.forEach(r => fs.existsSync(r) && server.watcher.add(r));
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onChange = (f: string) => {
        if (!roots.some(r => f.startsWith(r)) || /[\\/]\./.test(f.slice(roots.find(r => f.startsWith(r))!.length)) || !/\.(md|excalidraw|png|jpe?g|gif|svg|webp)$/i.test(f)) return;
        // batch bursts of saves (Obsidian autosave, iCloud sync) into one reload
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null; current = loadVaults(cfg); report();
          const m = server.moduleGraph.getModuleById(RID);
          if (m) server.moduleGraph.invalidateModule(m);
          server.ws.send({ type: 'full-reload' });
        }, 700);
      };
      server.watcher.on('change', onChange).on('add', onChange).on('unlink', onChange);
      // The only write path: move one note to the macOS Trash (recoverable). The client sends a note id, never a path.
      // CSRF guard: localhost servers are reachable from any web page, so require our own Origin and a custom header (forces a CORS preflight we never answer).
      server.middlewares.use('/api/delete', (req, res) => {
        const send = (code: number, body: object) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        const origin = req.headers.origin || '';
        if (req.method !== 'POST' || req.headers['x-km'] !== '1' || !/^http:\/\/(knowledge\.)?localhost:7777$/.test(origin)) return send(403, { error: 'forbidden' });
        let raw = '';
        req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
        req.on('end', () => {
          try {
            const { id } = JSON.parse(raw || '{}');
            const n = current.data.notes.find((x: { id: string }) => x.id === id);
            if (!n) return send(404, { error: 'unknown note' });
            const root = current.vaults.find(v => v.name === n.vault)?.path;
            const abs = path.resolve(n.abs);
            if (!root || !abs.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(abs)) return send(400, { error: 'file not inside a vault' });
            const trash = path.join(os.homedir(), '.Trash');
            const ext = path.extname(abs);
            let dest = path.join(trash, path.basename(abs));
            if (fs.existsSync(dest)) dest = path.join(trash, `${path.basename(abs, ext)} ${Date.now()}${ext}`);
            try { fs.renameSync(abs, dest); } catch { fs.copyFileSync(abs, dest); fs.unlinkSync(abs); }
            console.log(`[vault] trashed ${abs} -> ${dest}`);
            send(200, { ok: true, trashedTo: dest });
          } catch (e) { send(500, { error: String((e as Error).message || e) }); }
        });
      });
      server.middlewares.use('/vault-assets', (req, res, next) => {
        const [vi, ...rest] = (req.url || '').slice(1).split('/');
        const p = current.assets[Number(vi)]?.get(decodeURIComponent(rest.join('/')));
        if (!p) return next();
        res.setHeader('Content-Type', MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream');
        fs.createReadStream(p).pipe(res);
      });
    },
    generateBundle() {
      for (const k of current.usedAssets) { const [vi, ...n] = k.split('/'); const p = current.assets[Number(vi)]?.get(n.join('/')); if (p) this.emitFile({ type: 'asset', fileName: `vault-assets/${k}`, source: fs.readFileSync(p) }); }
    },
  };
}
