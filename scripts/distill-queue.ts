// Work queue for distilling: which customer/project/component hubs have notes newer than their `## Current state`.
//
//   node scripts/distill-queue.ts <vault-path>                 status: every hub, its distilled_through and how much is pending
//   node scripts/distill-queue.ts <vault-path> --next [--chunk 12] [--hub <file-name>] [--json]
//                                                              the next chunk of work: one hub, the oldest pending notes, the date to set
//
// Progress lives in the hubs themselves (frontmatter `distilled_through: YYYY-MM-DD`), so a run that stops halfway loses nothing:
// the hub's date simply has not moved, and the next run picks up the same notes again.
// A hub owns the notes with its customer (+ project, + component); a note belongs to the most specific hub that exists.
// Hubs are worked bottom-up (component, project, customer), and a parent is also pending when a child hub was distilled after it.
// Note date = newest of: date in the file name, `date:`, `updated:`, last git commit that touched <= 10 markdown files
// (bulk commits like renames are ignored), the file date for uncommitted changes; else its first commit; else the file date.
// Skipped: hubs, sources/, archive/, _meta/, _templates/, dot-folders, `status: superseded`. Writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter } from '../frontmatter.ts';

const argv = process.argv.slice(2), root = argv[0];
const flag = (f: string) => argv.includes(f), opt = (f: string) => { const i = argv.indexOf(f); return i > 0 ? argv[i + 1] : undefined; };
if (!root || !fs.existsSync(root)) { console.error('usage: node scripts/distill-queue.ts <vault-path> [--next] [--chunk 12] [--hub <name>] [--json]'); process.exit(2); }
const CHUNK = Number(opt('--chunk')) || 12, BULK = 10;
const today = new Date().toLocaleDateString('sv');   // YYYY-MM-DD, local time
const DAY = /^\d{4}-\d{2}-\d{2}/;

const SCAFFOLD = new Set(['README.md', 'CLAUDE.md', 'AGENTS.md', 'PLAN.md', 'TODO.md', 'WORKLOG.md']);
const SKIP = /^(sources|archive|_meta|_templates)\//;
type N = { rel: string; base: string; fm: Record<string, any>; mtime: number };
const notes: N[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name), rel = path.relative(root, p).split(path.sep).join('/');
    if (e.isDirectory()) { if (!SKIP.test(rel + '/')) walk(p); continue; }
    if (!/\.md$/i.test(e.name) || /\.excalidraw\.md$/i.test(e.name) || (dir === root && SCAFFOLD.has(e.name))) continue;
    notes.push({ rel, base: e.name.replace(/\.md$/i, ''), fm: parseFrontmatter(fs.readFileSync(p, 'utf8')).fm, mtime: fs.statSync(p).mtimeMs });
  }
})(root);

// git: newest small commit and first commit per file, uncommitted files
const small = new Map<string, string>(), first = new Map<string, string>(), dirty = new Set<string>();
let git = false;
try {
  const log = execFileSync('git', ['-C', root, 'log', '--format=%x00%cs', '--name-only', '--no-renames'], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  for (const block of log.split('\0').slice(1)) {
    const [date, ...files] = block.trim().split('\n');
    const md = files.filter(f => /\.md$/i.test(f));
    for (const f of md) { if (md.length <= BULK && !small.has(f)) small.set(f, date); first.set(f, date); }   // log is newest first
  }
  const st = execFileSync('git', ['-C', root, 'status', '--porcelain', '-uall'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const l of st.split('\n')) if (l.trim()) dirty.add(l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
  git = true;
} catch { /* not a git repo: file dates only */ }

const d10 = (v: unknown) => (typeof v === 'string' && DAY.test(v) ? v.slice(0, 10) : '');
function noteDate(n: N) {
  const own = [n.rel.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '', d10(n.fm.date), d10(n.fm.updated), small.get(n.rel) || '', dirty.has(n.rel) ? new Date(n.mtime).toLocaleDateString('sv') : ''];
  const best = own.sort().pop();
  if (best) return best;
  return (git && first.get(n.rel)) || new Date(n.mtime).toLocaleDateString('sv');
}

const one = (v: unknown) => String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim().toLowerCase();
type Hub = N & { level: 0 | 1 | 2; customer: string; project: string; component: string; through: string; own: (N & { date: string })[]; parent?: Hub; children: Hub[] };
const LEVEL = ['component', 'project', 'customer'];
const hubs: Hub[] = notes.filter(n => one(n.fm.type) === 'hub' && one(n.fm.customer)).map(n => {
  const customer = one(n.fm.customer), project = one(n.fm.project), component = project ? one(n.fm.component) : '';
  return { ...n, customer, project, component, level: component ? 0 : project ? 1 : 2, through: d10(n.fm.distilled_through), own: [], children: [] };
});
const find = (c: string, p: string, k: string) => hubs.find(h => h.customer === c && h.project === p && h.component === k);
for (const h of hubs) {
  h.parent = h.level === 0 ? find(h.customer, h.project, '') : h.level === 1 ? find(h.customer, '', '') : undefined;
  h.parent?.children.push(h);
}
for (const n of notes) {
  if (one(n.fm.type) === 'hub' || one(n.fm.status) === 'superseded') continue;
  const c = one(n.fm.customer), p = one(n.fm.project), k = one(n.fm.component);
  if (!c) continue;
  const owner = (k && find(c, p, k)) || (p && find(c, p, '')) || find(c, '', '');
  owner?.own.push({ ...n, date: noteDate(n) });
}

const pendingOf = (h: Hub) => h.own.filter(n => !h.through || n.date > h.through).sort((a, b) => a.date.localeCompare(b.date) || a.rel.localeCompare(b.rel));
const childrenChanged = (h: Hub) => h.children.filter(c => c.through && (!h.through || c.through > h.through));
const rows = hubs.map(h => ({ h, pending: pendingOf(h), kids: childrenChanged(h) }));
const work = rows.filter(r => r.pending.length || r.kids.length).sort((a, b) => a.h.level - b.h.level || b.pending.length - a.pending.length || a.h.rel.localeCompare(b.h.rel));

if (!flag('--next')) {
  const done = rows.length - work.length, total = rows.reduce((s, r) => s + r.pending.length, 0);
  if (flag('--json')) { console.log(JSON.stringify({ hubs: rows.length, upToDate: done, notesPending: total, queue: work.map(r => ({ hub: r.h.rel, level: LEVEL[r.h.level], distilled_through: r.h.through || null, pending: r.pending.length, childrenChanged: r.kids.map(k => k.base) })) }, null, 2)); process.exit(0); }
  console.log(`${done} of ${rows.length} hubs up to date, ${total} notes pending\n`);
  for (const r of [...rows].sort((a, b) => a.h.level - b.h.level || a.h.rel.localeCompare(b.h.rel)))
    console.log(`${(r.pending.length || r.kids.length ? `${r.pending.length} pending` : 'up to date').padEnd(12)} ${LEVEL[r.h.level].padEnd(9)} ${(r.h.through || 'never').padEnd(10)}  ${r.h.rel}${r.kids.length ? `  (children distilled since: ${r.kids.map(k => k.base).join(', ')})` : ''}`);
  process.exit(0);
}

const forced = opt('--hub');
const pick = forced ? rows.find(r => r.h.base === forced.replace(/\.md$/, '')) : work[0];
if (!pick) { console.log(forced ? `no customer/project/component hub named ${forced}` : 'nothing to distill: every hub is up to date'); process.exit(forced ? 1 : 0); }
const { h, pending, kids } = pick;
let chunk = pending.slice(0, CHUNK);
if (chunk.length) { const last = chunk[chunk.length - 1].date; chunk = pending.filter(n => n.date <= last); }   // never split a date
const through = [chunk[chunk.length - 1]?.date || '', ...kids.map(k => k.through), h.through].sort().pop() || today;
const out = {
  hub: h.rel, level: LEVEL[h.level], distilled_through: h.through || null, set_distilled_through: through,
  childHubs: h.children.map(c => ({ path: c.rel, distilled_through: c.through || null })),
  chunk: chunk.map(n => ({ path: n.rel, date: n.date, type: n.fm.type || '', summary: String(n.fm.summary || '').replace(/\s+/g, ' ').trim() })),
  remainingAfterChunk: pending.length - chunk.length, hubsInQueue: work.length,
};
if (flag('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
console.log(`hub: ${out.hub} (${out.level}), distilled through ${out.distilled_through || 'never'}`);
console.log(`after this chunk set distilled_through: ${through}; ${out.remainingAfterChunk} notes left for this hub, ${out.hubsInQueue} hubs in the queue`);
if (out.childHubs.length) console.log(`child hubs (read their ## Current state):\n${out.childHubs.map(c => `  ${c.path} (${c.distilled_through || 'never'})`).join('\n')}`);
console.log(`notes (${chunk.length}):\n${out.chunk.map(n => `  ${n.date}  ${n.path}`).join('\n') || '  (none, only child hubs changed)'}`);
