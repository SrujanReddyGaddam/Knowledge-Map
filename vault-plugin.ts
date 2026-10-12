// Vite plugin: reads one or more Obsidian vaults (read-only) and exposes them as the virtual module "virtual:vault".
// Re-reads on any vault change (live reload) and serves/copies vault images under /vault-assets/<vaultIndex>/<name>.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Plugin } from 'vite';
import { rewriteLinks, otherRelativeRefs } from './rename-links.ts';
import { appendUnder } from './append-text.ts';
import { scanProjects } from './projects.ts';
import { execFile } from 'node:child_process';
import { loadVaults, excluder, fullKey, key, one, MIME, type Config } from './vault-load.ts';

// Port, config and backup location can be overridden by env so tests can run a throwaway instance beside the real one.
const PORT = Number(process.env.KM_PORT) || 7777;
const HOSTS = new Set([`localhost:${PORT}`, `knowledge.localhost:${PORT}`]);          // Host allowlist (blocks DNS rebinding)
const ORIGINS = new Set([...HOSTS].map(h => `http://${h}`));
const BACKUP_DIR = process.env.KM_BACKUP_DIR || path.join(os.homedir(), '.knowledge-map', 'backups');
const MAX_EDIT_BYTES = 2 * 1024 * 1024, KEEP_VERSIONS = 50, KEEP_DAYS = 90;


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
          if (sameVault.some((x: any) => fullKey(baseOf(x.path)) === oldKey)) return { err: [409, 'Another note in this vault has the same name, so links to it are ambiguous. Rename it in Obsidian.'] as [number, string] };
        }
        const vIdx = current.vaults.findIndex(v => v.name === f.n.vault);
        const earlier = (vn: string) => current.vaults.findIndex(v => v.name === vn) < vIdx;
        const oldAbsN = path.resolve(f.n.abs), newAbsN = path.resolve(vaultCfg.path, ...segs) + '.md';
        const edits: Edit[] = [], readOnly: { id: string; title: string; vault: string; path: string; count: number }[] = [], blocked: string[] = [];
        let self = null as Edit | null, extraRefs = 0;
        for (const n of current.data.notes as any[]) {
          if (n.kind === 'drawing') continue;
          const isSelf = n.id === f.n.id;
          const wiki = n.vault === f.n.vault || (!current.data.notes.some((x: any) => x.vault === n.vault && fullKey(baseOf(x.path)) === oldKey)
            && !current.data.notes.some((x: any) => x.vault !== f.n.vault && earlier(x.vault) && fullKey(baseOf(x.path)) === oldKey));
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
      // Append one line under a "## Heading" of a note (quick capture, daily note, add task). Creates the file from `init` if it is missing.
      // Same rules as save and create: writable vault, file must be a known note (excluded files are never written), backup first, atomic write.
      server.middlewares.use('/api/append', async (req, res) => {
        const bad = guard(req, { post: true, token: true });
        if (req.method !== 'POST' || bad) return send(res, 403, { error: bad || 'forbidden' });
        let tmp = '';
        try {
          if (Number(req.headers['content-length'] || 0) > 128 * 1024) { res.setHeader('Connection', 'close'); return send(res, 413, { error: 'too large' }); }
          const { vault: vn, path: rawPath, heading, line, init } = JSON.parse(await readBody(req, 128 * 1024) || '{}');
          if (typeof rawPath !== 'string' || rawPath.length > 400 || typeof heading !== 'string' || !heading.trim() || heading.length > 120 || /[\r\n]/.test(heading)
            || typeof line !== 'string' || !line.trim() || line.length > 4000 || /[\r\n]/.test(line) || (init !== undefined && typeof init !== 'string')) return send(res, 400, { error: 'bad request' });
          const w = writableRoot(vn);
          if ('err' in w) return send(res, w.err![0], { error: w.err![1] });
          const segs = rawPath.trim().replace(/\.md$/i, '').split('/');
          if (!segsOk(segs)) return send(res, 400, { error: NAME_RULE });
          const dest = path.join(w.root, ...segs) + '.md', rel = segs.join('/') + '.md';
          if (!insideVault(dest, w.root)) return send(res, 400, { error: 'That folder is not inside the vault.' });
          if (fs.existsSync(dest)) {
            const n = current.data.notes.find((x: any) => x.vault === w.v.name && x.path.split(path.sep).join('/') === rel);
            // a file this server created seconds ago is not in the map yet (the reload is debounced): allow it, nothing else outside the map
            let real = ''; try { real = fs.realpathSync(dest); } catch {}
            const fresh = !n && real && Date.now() - (selfWrites.get(real) || 0) < 30_000 && real.startsWith(w.root + path.sep);
            if (!n && !fresh) return send(res, 409, { error: 'That file exists but is not a note in the map (excluded?).' });
            const f = n ? editable(n.id) : { n: { vault: w.v.name, id: '' }, abs: real, root: w.root };
            if ('err' in f) return send(res, f.err[0], { error: f.err[1] });
            const cur = fs.readFileSync(f.abs);
            if (/\r(?!\n)/.test(cur.toString('utf8'))) return send(res, 400, { error: 'This file mixes line endings; edit it in Obsidian.' });
            const next = Buffer.from(appendUnder(cur.toString('utf8'), heading, line), 'utf8');
            if (next.length > MAX_EDIT_BYTES) return send(res, 413, { error: 'file too large to edit' });
            const dir = backupDirFor(f.n.vault, path.relative(f.root, f.abs));
            fs.mkdirSync(dir, { recursive: true });
            const bname = new Date().toISOString().replace(/[:.]/g, '-') + '.md';
            fs.writeFileSync(path.join(dir, bname), cur, { flag: 'wx' });
            atomicWrite(f.abs, next);
            try { prune(dir); } catch {}
            console.log(`[vault] appended to ${f.abs} (backup ${bname})`);
            return send(res, 200, { ok: true, vault: w.v.name, path: rel, created: false, id: n?.id ?? null });
          }
          if (typeof init !== 'string') return send(res, 404, { error: 'note not found' });
          const clash = current.data.notes.find((x: any) => x.vault === w.v.name && key(baseOf(x.path)) === key(segs[segs.length - 1]));
          if (clash) return send(res, 409, { error: `A note named "${segs[segs.length - 1]}" already exists in this vault (${clash.path}).` });
          const text = appendUnder(init, heading, line);
          if (Buffer.byteLength(text) > MAX_EDIT_BYTES) return send(res, 413, { error: 'note too large' });
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (!(fs.realpathSync(path.dirname(dest)) + path.sep).startsWith(w.root + path.sep)) return send(res, 400, { error: 'That folder is not inside the vault.' });
          try { fs.closeSync(fs.openSync(dest, 'wx', 0o644)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return send(res, 409, { error: 'A file already exists at that path.' }); throw e; }
          selfWrites.set(fs.realpathSync(dest), Date.now());
          try {
            tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.km-tmp-${process.pid}-${Date.now()}`);
            const fd = fs.openSync(tmp, 'wx', 0o644);
            try { fs.writeSync(fd, Buffer.from(text, 'utf8')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            fs.renameSync(tmp, dest); tmp = '';
          } catch (e) { try { if (fs.statSync(dest).size === 0) fs.unlinkSync(dest); } catch {} throw e; }
          selfWrites.set(fs.realpathSync(dest), Date.now());
          console.log(`[vault] created ${dest} (append)`);
          send(res, 200, { ok: true, vault: w.v.name, path: rel, created: true });
        } catch (e) {
          send(res, (e as Error).message === 'too large' ? 413 : 500, { error: String((e as Error).message || e) });
        } finally { if (tmp) try { fs.unlinkSync(tmp); } catch {} }
      });

      // Pasted or dropped images: saved beside the note as <note>-<timestamp>.<ext>, never replacing a file. Only real png/jpeg/gif/webp bytes.
      const IMG_MAX = 10 * 1024 * 1024;
      const MAGIC: Record<string, (b: Buffer) => boolean> = {
        png: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
        gif: b => /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1')),
        webp: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
      };
      server.middlewares.use('/api/attach', async (req, res) => {
        const bad = guard(req, { post: true, token: true });
        if (req.method !== 'POST' || bad) return send(res, 403, { error: bad || 'forbidden' });
        let tmp = '';
        try {
          const lim = Math.ceil(IMG_MAX * 4 / 3) + 4096;
          if (Number(req.headers['content-length'] || 0) > lim) { res.setHeader('Connection', 'close'); return send(res, 413, { error: 'image too large (10 MB max)' }); }
          const { id, ext: rawExt, data } = JSON.parse(await readBody(req, lim) || '{}');
          const ext = String(rawExt || '').toLowerCase().replace(/^jpeg$/, 'jpg');
          if (typeof data !== 'string' || !MAGIC[ext]) return send(res, 400, { error: 'only png, jpg, gif or webp images' });
          const f = editable(id);
          if ('err' in f) return send(res, f.err[0], { error: f.err[1] });
          const buf = Buffer.from(data, 'base64');
          if (!buf.length || buf.length > IMG_MAX) return send(res, 413, { error: 'image too large (10 MB max)' });
          if (!MAGIC[ext](buf)) return send(res, 400, { error: 'the file is not a ' + ext + ' image' });
          const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
          const stem = path.basename(f.abs).replace(/\.md$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 80);
          let name = '', dest = '';
          for (let i = 1; i < 50; i++) {
            name = `${stem}-${stamp}${i > 1 ? '-' + i : ''}.${ext}`; dest = path.join(path.dirname(f.abs), name);
            try { fs.closeSync(fs.openSync(dest, 'wx', 0o644)); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; name = ''; }
          }
          if (!name) return send(res, 409, { error: 'could not pick a free file name' });
          selfWrites.set(fs.realpathSync(dest), Date.now());
          try {
            tmp = path.join(path.dirname(dest), `.${name}.km-tmp-${process.pid}-${Date.now()}`);
            const fd = fs.openSync(tmp, 'wx', 0o644);
            try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            fs.renameSync(tmp, dest); tmp = '';
          } catch (e) { try { if (fs.statSync(dest).size === 0) fs.unlinkSync(dest); } catch {} throw e; }
          selfWrites.set(fs.realpathSync(dest), Date.now());
          console.log(`[vault] attached ${dest}`);
          send(res, 200, { ok: true, name });
        } catch (e) {
          send(res, (e as Error).message === 'too large' ? 413 : 500, { error: String((e as Error).message || e) });
        } finally { if (tmp) try { fs.unlinkSync(tmp); } catch {} }
      });

      // Resume cards: read-only view of code projects' tracking files (see projects.ts). Token required, like every call that returns file text.
      server.middlewares.use('/api/projects', (req, res) => {
        const bad = guard(req, { post: false, token: true });
        if (req.method !== 'GET' || bad) return send(res, 403, { error: bad || 'forbidden' });
        try { send(res, 200, { projects: scanProjects(cfg.projects) }); }
        catch (e) { send(res, 500, { error: String((e as Error).message || e) }); }
      });
      // Weekly review: a vault's own git history for a date range (read-only, only for vaults that are git repos). Dates must be
      // YYYY-MM-DD and are passed to git as separate arguments (no shell). Paths are filtered like the loader does (markdown only,
      // no dot-folders, the vault's exclude list), so excluded files never reach the page. Token required: commit messages are vault text.
      server.middlewares.use('/api/gitlog', (req, res) => {
        const bad = guard(req, { post: false, token: true });
        if (req.method !== 'GET' || bad) return send(res, 403, { error: bad || 'forbidden' });
        const q = new URL(req.url || '/', 'http://x').searchParams, since = q.get('since') || '', until = q.get('until') || '';
        const DAY = /^\d{4}-\d{2}-\d{2}$/;
        if (!DAY.test(since) || !DAY.test(until)) return send(res, 400, { error: 'since and until must be YYYY-MM-DD' });
        const v = current.vaults.find(x => x.name === q.get('vault'));
        if (!v) return send(res, 404, { error: 'unknown vault' });
        if (!fs.existsSync(path.join(v.path, '.git'))) return send(res, 200, { git: false, commits: [] });
        const skip = excluder(v.exclude);
        execFile('git', ['-C', v.path, 'log', '--no-merges', '--no-renames', '--name-status', `--since=${since} 00:00:00`, `--until=${until} 23:59:59`, '--format=%x1e%H%x1f%aI%x1f%s'],
          { timeout: 8000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) => {
            if (err) return send(res, 500, { error: 'git log failed' });
            const commits = out.split('\x1e').filter(c => c.trim()).map(c => {
              const [head, ...rest] = c.split('\n'), [hash, date, subject] = head.split('\x1f');
              const files = rest.map(l => l.split('\t')).filter(p => p.length === 2 && /^[AMD]$/.test(p[0]))
                .map(([status, file]) => ({ status, path: file })).filter(f => f.path.endsWith('.md') && !/(^|\/)\./.test(f.path) && !skip(f.path));
              return { hash: hash.slice(0, 10), date, subject, files };
            });
            send(res, 200, { git: true, commits });
          });
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
