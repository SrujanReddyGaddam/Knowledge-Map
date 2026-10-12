// Resume cards: reads the tracking files of code projects (README.md, PLAN.md, TODO.md, WORKLOG.md in each direct child of a root folder,
// e.g. ~/Developer/*) so the map can show where each project was left off. Read-only: nothing here ever writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ProjectsCfg = { roots?: string[]; exclude?: string[]; customers?: Record<string, string[]> };
export type Project = {
  name: string; path: string; title: string; status: string;
  plan: { title: string; status: string; open: string[]; done: number; total: number } | null;
  last: { date: string; title: string; next: string } | null;
  todo: number; branch: string; mtime: number; files: string[];
  planText: string; logText: string;
};

const TRACK = ['PLAN.md', 'TODO.md', 'WORKLOG.md'];
const FENCE = /^\s*(```|~~~)/;
const home = (p: string) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
const read = (f: string, max = 200_000) => { try { const st = fs.statSync(f); if (!st.isFile() || st.size > max) return ''; return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const clean = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/^_+|_+$/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

function proseLines(t: string) {
  const out: string[] = []; let fence = '';
  for (const l of t.split(/\r?\n/)) {
    const f = l.match(FENCE);
    if (f) { if (!fence) fence = f[1]; else if (f[1] === fence) fence = ''; continue; }
    if (!fence) out.push(l);
  }
  return out;
}

function parsePlan(t: string) {
  if (!t.trim()) return null;
  const lines = proseLines(t);
  const title = clean((lines.find(l => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').replace(/^Plan:\s*/i, ''));
  // a "> **RESUME HERE ...**" block wins, else a "_Status: ..._" line
  let status = '';
  const ri = lines.findIndex(l => /^>\s*\**\s*RESUME HERE/i.test(l));
  if (ri >= 0) { const q: string[] = []; for (let i = ri; i < lines.length && /^>/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, '')); status = clean(q.join(' ').replace(/^\**\s*RESUME HERE[^:]*:\**\s*/i, '')); }
  if (!status) { const s = lines.find(l => /^\s*_?\**Status:?\**:?\s*/i.test(l)); if (s) status = clean(s.replace(/^\s*_?\**Status:?\**:?\s*/i, '')); }
  const steps = lines.filter(l => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l));
  const open = steps.filter(l => /\[ \]/.test(l)).map(l => clean(l.replace(/^\s*[-*+]\s+\[ \]\s+/, '')));
  return { title, status: status.slice(0, 420), open: open.slice(0, 6), done: steps.length - open.length, total: steps.length };
}

function parseLog(t: string) {
  const lines = proseLines(t);
  const hi = lines.findIndex(l => /^##\s+/.test(l));
  if (hi < 0) return { last: null, text: '' };
  let end = lines.findIndex((l, i) => i > hi && /^##\s+/.test(l)); if (end < 0) end = lines.length;
  const entry = lines.slice(hi, end), h = clean(entry[0].replace(/^##\s+/, ''));
  const date = h.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
  const title = h.replace(/^\d{4}-\d{2}-\d{2}\s*[-—–:]*\s*/, '').replace(/^\(|\)$/g, '');
  const nl = entry.find(l => /^\s*[-*]?\s*\**Next:?\**:?/i.test(l));
  return { last: { date, title, next: nl ? clean(nl.replace(/^\s*[-*]?\s*\**Next:?\**:?\s*/i, '')).slice(0, 400) : '' }, text: entry.join('\n').slice(0, 12_000) };
}

export function scanProjects(cfg: ProjectsCfg | undefined): Project[] {
  if (!cfg?.roots?.length) return [];
  const skip = new Set((cfg.exclude || []).map(s => s.toLowerCase()));
  const out: Project[] = [];
  for (const r of cfg.roots) {
    const root = home(r);
    let dirs: fs.Dirent[] = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) {
      if (!d.isDirectory() || d.name.startsWith('.') || skip.has(d.name.toLowerCase())) continue;
      const dir = path.join(root, d.name);
      const files = TRACK.filter(f => fs.existsSync(path.join(dir, f)));
      if (!files.length) continue;
      const readme = read(path.join(dir, 'README.md')), planT = read(path.join(dir, 'PLAN.md')), todoT = read(path.join(dir, 'TODO.md')), logT = read(path.join(dir, 'WORKLOG.md'));
      const rl = proseLines(readme);
      const log = parseLog(logT);
      let branch = '';
      try { const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim(); branch = head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 8); } catch {}
      let mtime = 0;
      for (const f of [...files, 'README.md']) { try { mtime = Math.max(mtime, fs.statSync(path.join(dir, f)).mtimeMs); } catch {} }
      out.push({
        name: d.name, path: dir,
        title: clean((rl.find(l => /^#\s+/.test(l)) || '').replace(/^#\s+/, '')) || d.name,
        status: clean((rl.find(l => /^\s*\**Status:?\**:?/i.test(l)) || '').replace(/^\s*\**Status:?\**:?\s*/i, '')).slice(0, 200),
        plan: parsePlan(planT), last: log.last,
        todo: proseLines(todoT).filter(l => /^\s*[-*+]\s+\[ \]\s+\S/.test(l)).length,
        branch, mtime: Math.round(mtime), files,
        planText: planT.slice(0, 30_000), logText: log.text,
      });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
