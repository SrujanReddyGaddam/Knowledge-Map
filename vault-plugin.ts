// Vite plugin: reads one or more Obsidian vaults (read-only) and exposes them as the virtual module "virtual:vault".
// Re-reads on any vault change (live reload) and serves/copies vault images under /vault-assets/<vaultIndex>/<name>.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import LZString from 'lz-string';
import type { Plugin } from 'vite';
import { rewriteLinks, otherRelativeRefs } from './rename-links';
import { parseFrontmatter } from './frontmatter';

// sectionDepth: folders whose sections go one level deeper, e.g. { "projects": 2 } gives "projects/acme".
// lint: check notes against the vault schema (Health tab). sensitivity: default for notes that do not set one.
type VaultCfg = { name?: string; path: string; exclude?: string[]; rootSection?: string; writable?: boolean; sectionDepth?: Record<string, number>; lint?: boolean; sensitivity?: string };
type Config = { vaults?: VaultCfg[]; vault?: string; exclude?: string[]; rootSection?: string };
// Port, config and backup location can be overridden by env so tests can run a throwaway instance beside the real one.
const PORT = Number(process.env.KM_PORT) || 7777;
const HOSTS = new Set([`localhost:${PORT}`, `knowledge.localhost:${PORT}`]);          // Host allowlist (blocks DNS rebinding)
const ORIGINS = new Set([...HOSTS].map(h => `http://${h}`));
const BACKUP_DIR = process.env.KM_BACKUP_DIR || path.join(os.homedir(), '.knowledge-map', 'backups');
const MAX_EDIT_BYTES = 2 * 1024 * 1024, KEEP_VERSIONS = 50, KEEP_DAYS = 90;
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

function vaultList(cfg: Config) {
  const list: VaultCfg[] = cfg.vaults?.length ? cfg.vaults : [{ path: cfg.vault!, exclude: cfg.exclude, rootSection: cfg.rootSection }];
  return list.map(v => ({ name: v.name || path.basename(v.path), path: v.path, exclude: v.exclude || [], rootSection: v.rootSection || 'General', writable: v.writable === true,
    sectionDepth: v.sectionDepth || {}, lint: v.lint === true, sensitivity: (v.sensitivity || '').toLowerCase() }));
}

// exclude entries: an exact path ("README.md"), a folder ("private/"), or a glob ("**/_templates/**", "drafts/*.md")
function excluder(patterns: string[]) {
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
const one = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')).trim().replace(/^\[\[|\]\]$/g, '');

type RawNote = {
  vi: number; vault: string; base: string; path: string; abs: string; folder: string; title: string; tags: string[]; status: string; source: string; fetched: string;
  summary: string; body: string; related: string[]; rawLinks: string[]; id: string; links: string[]; backlinks: string[]; section: string;
  type: string; customer: string; project: string; sensitivity: string; meta: Record<string, string>;
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
    const skip = excluder(v.exclude);
    for (const f of files.filter(f => (f.endsWith('.md') || f.endsWith('.excalidraw')) && !skip(path.relative(v.path, f).split(path.sep).join('/')))) {
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
      const h1 = body.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').match(/^#\s+(.+)$/m)?.[1]?.trim();   // a '# comment' inside a code block is not a heading
      const tags = [...new Set([...asList(fm.tags), ...(typeof fm.type === 'string' && fm.type ? [fm.type] : []), ...(scene ? ['excalidraw'] : [])])];
      const status = String(fm.status || '').toLowerCase().match(/current|stale|needs-verification|draft|closed|deprecated|archived/)?.[0] || (hasFm ? 'unknown' : 'none');
      const rewritten = body.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, name: string) => {
        const b = path.basename(name.trim());
        if (!images.has(b)) return m;
        usedAssets.add(`${vi}/${b}`);
        return `![${b}](/vault-assets/${vi}/${encodeURIComponent(b)})`;
      });
      const depth = Math.max(1, Math.min(4, v.sectionDepth[parts[0]] || 1));
      const folder = parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/') : v.rootSection;
      raws.push({
        vi, vault: v.name, base, path: rel, abs: path.resolve(v.path, rel), folder, id: base, section: multi ? `${v.name} / ${folder}` : folder,
        title: (fm.title as string) || h1 || base, tags, status,
        source: fm.source && fm.source !== 'none' ? String(fm.source) : '', fetched: String(fm.source_fetched || fm.updated || fm.date || ''),
        summary: scene ? `Excalidraw drawing, ${scene.elements.length} elements.${drawingText ? ' ' + drawingText.trim().split(/\n+/)[0].slice(0, 90) : ''}` : (typeof fm.summary === 'string' && fm.summary ? fm.summary.slice(0, 320) : summaryOf(body)),
        ...(scene ? { kind: 'drawing' as const, scene } : {}),
        type: one(fm.type).toLowerCase(), customer: one(fm.customer).toLowerCase(), project: one(fm.project).toLowerCase(),
        sensitivity: (one(fm.sensitivity) || v.sensitivity).toLowerCase(), meta: metaOf(fm),
        mtime, writable: v.writable && !scene && f.endsWith('.md'), body: rewritten, related: asList(fm.related).flatMap(wikilinks), rawLinks: [...wikilinks(body), ...mdlinks(body)], links: [], backlinks: [],
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
    vaultName: vaults[0]?.name ?? '', vaults: vaults.map(v => v.name), lintVaults: vaults.filter(v => v.lint).map(v => v.name), writableVaults: vaults.filter(v => v.writable).map(v => v.name), generated: new Date().toISOString(), sections,
    notes: raws.map(({ vi, base, folder, related, rawLinks, ...n }) => n),
    edges: [...edges].map(e => e.split('\u0000')),
    broken, brokenLinks,
  };
  return { data, assets, usedAssets, vaults };
}

export default function vault(): Plugin {
  const cfg: Config = JSON.parse(fs.readFileSync(path.resolve(process.env.KM_CONFIG || 'config.json'), 'utf8'));
  const TOKEN = crypto.randomBytes(24).toString('hex');   // per server start; only our own page can obtain it (see guard)
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
      let timer: ReturnType<typeof setTimeout> | null = null, external = false;
      const selfWrites = new Map<string, number>();   // real path -> when this server saved it (so our own saves do not reload the page mid-edit)
      const onChange = (f: string) => {
        if (!roots.some(r => f.startsWith(r)) || /[\\/]\./.test(f.slice(roots.find(r => f.startsWith(r))!.length)) || !/\.(md|excalidraw|png|jpe?g|gif|svg|webp)$/i.test(f)) return;
        let own = false; try { const t = selfWrites.get(fs.realpathSync(f)); own = !!t && Date.now() - t < 5000; } catch {}
        if (!own) external = true;
        // batch bursts of saves (Obsidian autosave, iCloud sync) into one update
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null; current = loadVaults(cfg); report();
          const m = server.moduleGraph.getModuleById(RID);
          if (m) server.moduleGraph.invalidateModule(m);
          // external edits reload the page; our own saves only tell the page (it refreshes when the editor closes)
          server.ws.send(external ? { type: 'full-reload' } : { type: 'custom', event: 'km:self-write', data: {} });
          external = false;
        }, 700);
      };
      server.watcher.on('change', onChange).on('add', onChange).on('unlink', onChange);
      // ---- write paths -------------------------------------------------------------------------------------------
      // Localhost servers are reachable from any web page in the browser, so every /api call must pass guard():
      //  - Host must be ours (blocks DNS rebinding), X-KM header (forces a CORS preflight we never answer, so other origins cannot send it),
      //  - writes also need our own Origin and the per-start token, which only our page can fetch (cross-origin pages cannot read /api/session).
      const send = (res: import('node:http').ServerResponse, code: number, body: object) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
      const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
      const guard = (req: import('node:http').IncomingMessage, o: { post: boolean; token: boolean }) => {
        if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return 'bad host';
        if (req.headers['x-km'] !== '1') return 'forbidden';
        if (o.post && !ORIGINS.has(String(req.headers.origin || ''))) return 'forbidden';
        if (o.token && !safeEq(String(req.headers['x-km-token'] || ''), TOKEN)) return 'bad token';
        return null;
      };
      const readBody = (req: import('node:http').IncomingMessage, max: number) => new Promise<string>((resolve, reject) => {
        let raw = '', size = 0;
        // past the limit keep draining without storing, so the client gets a clean 413 instead of a dropped connection
        req.on('data', c => { size += c.length; if (size <= max) raw += c; });
        req.on('end', () => (size > max ? reject(new Error('too large')) : resolve(raw))); req.on('error', reject);
      });
      const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
      type Found = { err: [number, string] } | { n: any; abs: string; root: string };
      // note id -> real file inside a writable vault; the client never supplies a path
      const editable = (id: unknown): Found => {
        const n = typeof id === 'string' ? current.data.notes.find((x: { id: string }) => x.id === id) : null;
        if (!n) return { err: [404, 'unknown note'] };
        const root = current.vaults.find(v => v.name === n.vault);
        if (!root || !root.writable) return { err: [403, 'vault is read-only (set "writable": true in config.json)'] };
        if (n.kind === 'drawing' || !/\.md$/i.test(n.abs)) return { err: [400, 'only markdown notes can be edited'] };
        try {
          const real = fs.realpathSync(n.abs), rootReal = fs.realpathSync(root.path);
          if (!real.startsWith(rootReal + path.sep)) return { err: [400, 'file not inside the vault'] };
          if (fs.statSync(real).size > MAX_EDIT_BYTES) return { err: [413, 'file too large to edit'] };
          return { n, abs: real, root: rootReal };
        } catch { return { err: [404, 'file not found on disk (iCloud not downloaded?)'] }; }
      };
      const backupDirFor = (vault: string, rel: string) => path.join(BACKUP_DIR, vault.replace(/[^\w.-]/g, '_'), rel + '.history');
      const prune = (dir: string) => {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();          // names are sortable timestamps
        const cutoff = Date.now() - KEEP_DAYS * 864e5;
        files.slice(0, -1).forEach((f, i) => {                                             // always keep the newest
          const old = files.length - i > KEEP_VERSIONS || fs.statSync(path.join(dir, f)).mtimeMs < cutoff;
          if (old) fs.unlinkSync(path.join(dir, f));
        });
      };

      server.middlewares.use('/api/session', (req, res) => {
        const bad = guard(req, { post: false, token: false });
        if (req.method !== 'GET' || bad) return send(res, 403, { error: bad || 'forbidden' });
        send(res, 200, { token: TOKEN });
      });

      // Exact file text for the editor (frontmatter included, line endings untouched) plus a hash used for conflict detection.
      server.middlewares.use('/api/raw', (req, res) => {
        const bad = guard(req, { post: false, token: true });
        if (req.method !== 'GET' || bad) return send(res, 403, { error: bad || 'forbidden' });
        const f = editable(new URL(req.url || '/', 'http://x').searchParams.get('id'));
        if ('err' in f) return send(res, f.err[0], { error: f.err[1] });
        try { const buf = fs.readFileSync(f.abs); send(res, 200, { text: buf.toString('utf8'), hash: sha(buf), mtime: fs.statSync(f.abs).mtimeMs }); }
        catch (e) { send(res, 500, { error: String((e as Error).message || e) }); }
      });

      // Save: refuse if the file changed since it was loaded (409), back up the old version first, then write atomically (temp file + fsync + rename).
      server.middlewares.use('/api/save', async (req, res) => {
        const bad = guard(req, { post: true, token: true });
        if (req.method !== 'POST' || bad) return send(res, 403, { error: bad || 'forbidden' });
        let tmp = '';
        try {
          if (Number(req.headers['content-length'] || 0) > MAX_EDIT_BYTES + 4096) { res.setHeader('Connection', 'close'); return send(res, 413, { error: 'file too large to edit' }); }
          const { id, text, baseHash, force } = JSON.parse(await readBody(req, MAX_EDIT_BYTES + 4096) || '{}');
          if (typeof text !== 'string' || typeof baseHash !== 'string') return send(res, 400, { error: 'bad request' });
          if (Buffer.byteLength(text) > MAX_EDIT_BYTES) return send(res, 413, { error: 'file too large to edit' });
          const f = editable(id);
          if ('err' in f) return send(res, f.err[0], { error: f.err[1] });
          const cur = fs.readFileSync(f.abs), curHash = sha(cur), st = fs.statSync(f.abs);
          if (curHash !== baseHash && force !== true) return send(res, 409, { error: 'conflict', text: cur.toString('utf8'), hash: curHash, mtime: st.mtimeMs });
          const next = Buffer.from(text, 'utf8');
          if (next.equals(cur)) return send(res, 200, { ok: true, unchanged: true, hash: curHash, mtime: st.mtimeMs });
          // 1. backup of what is on disk right now
          const dir = backupDirFor(f.n.vault, path.relative(f.root, f.abs));
          fs.mkdirSync(dir, { recursive: true });
          const bname = new Date().toISOString().replace(/[:.]/g, '-') + '.md';
          fs.writeFileSync(path.join(dir, bname), cur, { flag: 'wx' });
          // 2. atomic replace: dotfile temp in the same folder (ignored by the vault scan), same mode, flushed before the rename
          tmp = path.join(path.dirname(f.abs), `.${path.basename(f.abs)}.km-tmp-${process.pid}-${Date.now()}`);
          const fd = fs.openSync(tmp, 'wx', st.mode & 0o777);
          try { fs.writeSync(fd, next); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          fs.renameSync(tmp, f.abs); tmp = ''; selfWrites.set(f.abs, Date.now());
          try { prune(dir); } catch {}
          const after = fs.statSync(f.abs);
          console.log(`[vault] saved ${f.abs} (backup ${bname})`);
          send(res, 200, { ok: true, hash: sha(next), mtime: after.mtimeMs, backup: bname });
        } catch (e) {
          if (tmp) try { fs.unlinkSync(tmp); } catch {}
          send(res, (e as Error).message === 'too large' ? 413 : 500, { error: String((e as Error).message || e) });
        }
      });

      // History: saved versions of one note (newest first) and the text of one version. Names are validated, never used as paths.
      const BNAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.md$/;
      const histDir = (f: { n: any; abs: string; root: string }) => backupDirFor(f.n.vault, path.relative(f.root, f.abs));
      server.middlewares.use('/api/history', (req, res) => {
        const bad = guard(req, { post: false, token: true });
        if (req.method !== 'GET' || bad) return send(res, 403, { error: bad || 'forbidden' });
        const f = editable(new URL(req.url || '/', 'http://x').searchParams.get('id'));
        if ('err' in f) return send(res, f.err[0], { error: f.err[1] });
        try {
          const dir = histDir(f);
          const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => BNAME.test(n)).sort().reverse() : [];
          send(res, 200, { versions: names.map(name => ({ name, time: name.replace(/\.md$/, '').replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/, 'T$1:$2:$3.$4Z'), size: fs.statSync(path.join(dir, name)).size })) });
        } catch (e) { send(res, 500, { error: String((e as Error).message || e) }); }
      });
      server.middlewares.use('/api/version', (req, res) => {
        const bad = guard(req, { post: false, token: true });
        if (req.method !== 'GET' || bad) return send(res, 403, { error: bad || 'forbidden' });
        const q = new URL(req.url || '/', 'http://x').searchParams, name = q.get('name') || '';
        const f = editable(q.get('id'));
        if ('err' in f) return send(res, f.err[0], { error: f.err[1] });
        if (!BNAME.test(name)) return send(res, 400, { error: 'bad version name' });
        try { send(res, 200, { text: fs.readFileSync(path.join(histDir(f), name), 'utf8') }); }
        catch { send(res, 404, { error: 'version not found' }); }
      });

      // ---- rename / move ---------------------------------------------------------------------------------------
      // Same vault only. Plans first (dry run, no writes), then applies the exact plan: every touched file is backed up, links in other
      // writable notes are rewritten atomically, the note is renamed, and its history follows it. Anything that fails is rolled back.
      const BADNAME = /[\\:*?"<>|\u0000-\u001f]/;
      const baseOf = (rel: string) => (rel.split('/').pop() || '').replace(/\.md$/i, '');
      const NAME_RULE = 'That name is not allowed (no empty parts, dots at the start, or the characters \\ : * ? " < > |).';
      const segsOk = (segs: string[]) => segs.length <= 12 && !segs.some(sg => !sg || sg === '.' || sg === '..' || sg.startsWith('.') || BADNAME.test(sg) || /[ .]$/.test(sg) || sg.length > 200);
      // a folder path that may not exist yet: its deepest existing ancestor must be a real folder inside the vault (symlinks cannot lead out)
      const insideVault = (target: string, rootReal: string) => {
        let anc = path.dirname(target);
        while (!fs.existsSync(anc) && anc.length > rootReal.length) anc = path.dirname(anc);
        try { return fs.statSync(anc).isDirectory() && (fs.realpathSync(anc) + path.sep).startsWith(rootReal + path.sep); } catch { return false; }
      };
      const atomicWrite = (abs: string, buf: Buffer) => {
        const mode = fs.statSync(abs).mode & 0o777;
        const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.km-tmp-${process.pid}-${Date.now()}`);
        const fd = fs.openSync(tmp, 'wx', mode);
        try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        try { fs.renameSync(tmp, abs); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
        selfWrites.set(abs, Date.now());
      };
      type Edit = { id: string; title: string; path: string; vault: string; abs: string; root: string; orig: Buffer; next: Buffer; wiki: number; md: number };
      const planRename = (id: unknown, toRaw: unknown) => {
        const f = editable(id);
        if ('err' in f) return { err: f.err };
        if (typeof toRaw !== 'string' || toRaw.length > 400) return { err: [400, 'bad request'] as [number, string] };
        const segs = toRaw.trim().replace(/\.md$/i, '').split('/');
        if (!segsOk(segs)) return { err: [400, NAME_RULE] as [number, string] };
        const vaultCfg = current.vaults.find(v => v.name === f.n.vault)!;
        const oldRel = path.relative(f.root, f.abs).split(path.sep).join('/'), newRel = segs.join('/') + '.md';
        if (newRel === oldRel) return { err: [400, 'That is the current name.'] as [number, string] };
        const caseOnly = newRel.toLowerCase() === oldRel.toLowerCase();
        const newReal = path.join(f.root, ...segs) + '.md';
        if (!insideVault(newReal, f.root)) return { err: [400, 'That folder is not inside the vault.'] as [number, string] };
        if (fs.existsSync(newReal) && !(caseOnly && fs.statSync(newReal).ino === fs.statSync(f.abs).ino)) return { err: [409, 'A file already exists at that path.'] as [number, string] };
        const oldBase = baseOf(oldRel), newBase = baseOf(newRel), oldKey = key(oldBase), baseChanged = key(newBase) !== oldKey || newBase !== oldBase;
        const sameVault = current.data.notes.filter((x: any) => x.vault === f.n.vault && x.id !== f.n.id);
        if (baseChanged) {
          const clash = sameVault.find((x: any) => key(baseOf(x.path)) === key(newBase) && !(caseOnly));
          if (clash) return { err: [409, `A note named "${newBase}" already exists in this vault (${clash.path}). Two notes with one name make [[links]] ambiguous.`] as [number, string] };
          if (sameVault.some((x: any) => key(baseOf(x.path)) === oldKey)) return { err: [409, 'Another note in this vault has the same name, so links to it are ambiguous. Rename it in Obsidian.'] as [number, string] };
        }
        const vIdx = current.vaults.findIndex(v => v.name === f.n.vault);
        const earlier = (vn: string) => current.vaults.findIndex(v => v.name === vn) < vIdx;
        const oldAbsN = path.resolve(f.n.abs), newAbsN = path.resolve(vaultCfg.path, ...segs) + '.md';
        const edits: Edit[] = [], readOnly: { id: string; title: string; vault: string; path: string; count: number }[] = [], blocked: string[] = [];
        let self = null as Edit | null, extraRefs = 0;
        for (const n of current.data.notes as any[]) {
          if (n.kind === 'drawing') continue;
          const isSelf = n.id === f.n.id;
          const wiki = n.vault === f.n.vault || (!current.data.notes.some((x: any) => x.vault === n.vault && key(baseOf(x.path)) === oldKey)
            && !current.data.notes.some((x: any) => x.vault !== f.n.vault && earlier(x.vault) && key(baseOf(x.path)) === oldKey));
          let orig: Buffer; try { orig = fs.readFileSync(isSelf ? f.abs : n.abs); } catch { continue; }
          if (orig.length > MAX_EDIT_BYTES) { if (orig.toString('utf8').toLowerCase().includes(oldKey)) blocked.push(`${n.path} is too large to update`); continue; }
          const text = orig.toString('utf8');
          const r = rewriteLinks(text, { oldKey, newBase, newRelNoExt: segs.join('/'), wiki, samePath: n.vault === f.n.vault, oldAbs: oldAbsN, newAbs: newAbsN, selfOld: isSelf ? oldAbsN : path.resolve(n.abs), selfNew: isSelf ? newAbsN : path.resolve(n.abs) });
          if (isSelf) extraRefs = path.dirname(oldRel) !== path.dirname(newRel) ? otherRelativeRefs(text) : 0;
          if (r.wiki + r.md === 0) { if (isSelf) self = { id: n.id, title: n.title, path: n.path, vault: n.vault, abs: f.abs, root: f.root, orig, next: orig, wiki: 0, md: 0 }; continue; }
          if (isSelf) { self = { id: n.id, title: n.title, path: n.path, vault: n.vault, abs: f.abs, root: f.root, orig, next: Buffer.from(r.text), wiki: r.wiki, md: r.md }; continue; }
          const e = editable(n.id);
          if ('err' in e) { if (e.err[0] === 403) readOnly.push({ id: n.id, title: n.title, vault: n.vault, path: n.path, count: r.wiki + r.md }); else blocked.push(`${n.path}: ${e.err[1]}`); continue; }
          edits.push({ id: n.id, title: n.title, path: n.path, vault: n.vault, abs: e.abs, root: e.root, orig, next: Buffer.from(r.text), wiki: r.wiki, md: r.md });
        }
        const planHash = sha(JSON.stringify([oldRel, newRel, self ? sha(self.orig) : '', edits.map(e => [e.abs, sha(e.orig), sha(e.next)])]));
        const selfCount = self ? self.wiki + self.md : 0;
        return {
          f, self, edits, oldRel, newRel, newReal, caseOnly,
          plan: {
            from: oldRel, to: newRel, planHash, selfCount, blocked,
            updates: edits.map(e => ({ id: e.id, title: e.title, path: e.path, vault: e.vault, count: e.wiki + e.md })),
            readOnly, extraRefs,
            links: edits.reduce((a, e) => a + e.wiki + e.md, 0) + selfCount,
          },
        };
      };
      server.middlewares.use('/api/rename', async (req, res) => {
        const bad = guard(req, { post: true, token: true });
        if (req.method !== 'POST' || bad) return send(res, 403, { error: bad || 'forbidden' });
        try {
          const { id, to, dryRun, planHash, ack } = JSON.parse(await readBody(req, 8192) || '{}');
          const p = planRename(id, to);
          if ('err' in p) return send(res, p.err![0], { error: p.err![1] });
          if (dryRun === true) return send(res, 200, p.plan);
          if (p.plan.blocked.length) return send(res, 409, { error: 'Cannot rename safely: ' + p.plan.blocked.join('; ') });
          if (planHash !== p.plan.planHash) return send(res, 409, { error: 'changed', message: 'Notes changed since the preview. Review the updated preview and try again.', plan: p.plan });
          if (p.plan.readOnly.length && ack !== true) return send(res, 409, { error: 'ack', message: 'Links in read-only vaults will break. Confirm to continue.', plan: p.plan });
          // 1. back up everything we are about to touch (history of the moved note travels with it in step 4)
          const bname = new Date().toISOString().replace(/[:.]/g, '-') + '.md';
          const touched = [...p.edits, ...(p.self && p.self.next !== p.self.orig ? [p.self] : [])];
          for (const e of touched) {
            const dir = backupDirFor(e.vault, path.relative(e.root, e.abs));
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, bname), e.orig, { flag: 'wx' });
          }
          // 2. rewrite linking notes, 3. rewrite and rename the note; roll everything back if any step fails
          const written: Edit[] = [];
          try {
            for (const e of p.edits) { atomicWrite(e.abs, e.next); written.push(e); }
            if (p.self && p.self.next !== p.self.orig) { atomicWrite(p.self.abs, p.self.next); written.push(p.self); }
            fs.mkdirSync(path.dirname(p.newReal), { recursive: true });
            if (p.caseOnly) { const t = path.join(path.dirname(p.f.abs), `.${path.basename(p.f.abs)}.km-rename-${process.pid}`); fs.renameSync(p.f.abs, t); fs.renameSync(t, p.newReal); }
            else { if (fs.existsSync(p.newReal)) throw new Error('A file already exists at that path.'); fs.renameSync(p.f.abs, p.newReal); }
          } catch (err) {
            for (const e of written.reverse()) try { atomicWrite(e.abs, e.orig); } catch {}
            throw err;
          }
          // 4. the note's saved versions follow it
          try {
            const oh = backupDirFor(p.f.n.vault, p.oldRel), nh = backupDirFor(p.f.n.vault, p.newRel);
            if (fs.existsSync(oh)) {
              fs.mkdirSync(nh, { recursive: true });
              for (const v of fs.readdirSync(oh)) if (!fs.existsSync(path.join(nh, v))) fs.renameSync(path.join(oh, v), path.join(nh, v));
              try { fs.rmdirSync(oh); } catch {}
            }
          } catch (e) { console.log('[vault] rename: could not move history: ' + (e as Error).message); }
          console.log(`[vault] renamed ${p.oldRel} -> ${p.newRel} in ${p.f.n.vault} (${p.plan.links} link(s) updated in ${p.edits.length + (p.plan.selfCount ? 1 : 0)} note(s))`);
          current = loadVaults(cfg);
          const nn = (current.data.notes as any[]).find(x => x.vault === p.f.n.vault && x.path.split(path.sep).join('/') === p.newRel);
          send(res, 200, { ok: true, newId: nn?.id ?? null, to: p.newRel, links: p.plan.links });
        } catch (e) { send(res, (e as Error).message === 'too large' ? 413 : 500, { error: String((e as Error).message || e) }); }
      });

      // Move one note to the macOS Trash (recoverable). Same guard as the other write paths.
      // New notes. Templates are the .md files in <vault>/_templates/ (exclude that folder from the map in config.json).
      const writableRoot = (name: unknown) => {
        const v = current.vaults.find(x => x.name === name);
        if (!v) return { err: [404, 'unknown vault'] as [number, string] };
        if (!v.writable) return { err: [403, 'vault is read-only (set "writable": true in config.json)'] as [number, string] };
        try { return { v, root: fs.realpathSync(v.path) }; } catch { return { err: [404, 'vault not readable'] as [number, string] }; }
      };
      server.middlewares.use('/api/templates', (req, res) => {
        const bad = guard(req, { post: false, token: true });
        if (req.method !== 'GET' || bad) return send(res, 403, { error: bad || 'forbidden' });
        const w = writableRoot(new URL(req.url || '/', 'http://x').searchParams.get('vault'));
        if ('err' in w) return send(res, w.err![0], { error: w.err![1] });
        const dir = path.join(w.root, '_templates'), templates: { name: string; text: string }[] = [];
        try {
          if (fs.existsSync(dir) && (fs.realpathSync(dir) + path.sep).startsWith(w.root + path.sep)) {
            for (const f of fs.readdirSync(dir).filter(f => /\.md$/i.test(f) && !f.startsWith('.')).sort().slice(0, 50)) {
              const p = path.join(dir, f), st = fs.lstatSync(p);
              if (st.isFile() && st.size <= 64 * 1024) templates.push({ name: f.replace(/\.md$/i, ''), text: fs.readFileSync(p, 'utf8') });
            }
          }
        } catch (e) { return send(res, 500, { error: String((e as Error).message || e) }); }
        send(res, 200, { templates });
      });
      server.middlewares.use('/api/create', async (req, res) => {
        const bad = guard(req, { post: true, token: true });
        if (req.method !== 'POST' || bad) return send(res, 403, { error: bad || 'forbidden' });
        let tmp = '';
        try {
          if (Number(req.headers['content-length'] || 0) > MAX_EDIT_BYTES + 4096) { res.setHeader('Connection', 'close'); return send(res, 413, { error: 'note too large' }); }
          const { vault: vn, path: rawPath, text } = JSON.parse(await readBody(req, MAX_EDIT_BYTES + 4096) || '{}');
          if (typeof text !== 'string' || typeof rawPath !== 'string' || rawPath.length > 400) return send(res, 400, { error: 'bad request' });
          if (Buffer.byteLength(text) > MAX_EDIT_BYTES) return send(res, 413, { error: 'note too large' });
          const w = writableRoot(vn);
          if ('err' in w) return send(res, w.err![0], { error: w.err![1] });
          const segs = rawPath.trim().replace(/\.md$/i, '').split('/');
          if (!segsOk(segs)) return send(res, 400, { error: NAME_RULE });
          const dest = path.join(w.root, ...segs) + '.md', rel = segs.join('/') + '.md';
          if (!insideVault(dest, w.root)) return send(res, 400, { error: 'That folder is not inside the vault.' });
          if (fs.existsSync(dest)) return send(res, 409, { error: 'A file already exists at that path.' });
          const clash = current.data.notes.find((x: any) => x.vault === w.v.name && key(baseOf(x.path)) === key(segs[segs.length - 1]));
          if (clash) return send(res, 409, { error: `A note named "${segs[segs.length - 1]}" already exists in this vault (${clash.path}). Two notes with one name make [[links]] ambiguous.` });
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (!(fs.realpathSync(path.dirname(dest)) + path.sep).startsWith(w.root + path.sep)) return send(res, 400, { error: 'That folder is not inside the vault.' });
          // claim the name with an exclusive create (an existing file is never replaced), then rename a flushed temp file over the empty claim.
          // Not a hard link: the macOS file watcher misses hard-linked files and their later deletion.
          try { fs.closeSync(fs.openSync(dest, 'wx', 0o644)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return send(res, 409, { error: 'A file already exists at that path.' }); throw e; }
          selfWrites.set(fs.realpathSync(dest), Date.now());
          try {
            tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.km-tmp-${process.pid}-${Date.now()}`);
            const fd = fs.openSync(tmp, 'wx', 0o644);
            try { fs.writeSync(fd, Buffer.from(text, 'utf8')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            fs.renameSync(tmp, dest); tmp = '';
          } catch (e) { try { if (fs.statSync(dest).size === 0) fs.unlinkSync(dest); } catch {} throw e; }
          selfWrites.set(fs.realpathSync(dest), Date.now());
          console.log(`[vault] created ${dest}`);
          send(res, 200, { ok: true, vault: w.v.name, path: rel });
        } catch (e) {
          send(res, (e as Error).message === 'too large' ? 413 : 500, { error: String((e as Error).message || e) });
        } finally { if (tmp) try { fs.unlinkSync(tmp); } catch {} }
      });
      server.middlewares.use('/api/delete', async (req, res) => {
        const bad = guard(req, { post: true, token: true });
        if (req.method !== 'POST' || bad) return send(res, 403, { error: bad || 'forbidden' });
        try {
          const { id } = JSON.parse(await readBody(req, 4096) || '{}');
          const n = current.data.notes.find((x: { id: string }) => x.id === id);
          if (!n) return send(res, 404, { error: 'unknown note' });
          const root = current.vaults.find(v => v.name === n.vault)?.path;
          const abs = path.resolve(n.abs);
          if (!root || !abs.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(abs)) return send(res, 400, { error: 'file not inside a vault' });
          const trash = path.join(os.homedir(), '.Trash');
          const ext = path.extname(abs);
          let dest = path.join(trash, path.basename(abs));
          if (fs.existsSync(dest)) dest = path.join(trash, `${path.basename(abs, ext)} ${Date.now()}${ext}`);
          try { fs.renameSync(abs, dest); } catch { fs.copyFileSync(abs, dest); fs.unlinkSync(abs); }
          console.log(`[vault] trashed ${abs} -> ${dest}`);
          send(res, 200, { ok: true, trashedTo: dest });
        } catch (e) { send(res, 500, { error: String((e as Error).message || e) }); }
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
