// MCP server (stdio) so Claude Code can use the map's index instead of grepping the vault: ranked search, notes with their links
// and backlinks, link paths, customer briefs, open tasks, recent changes, context packs. Read-only: it never writes a file,
// opens no port and makes no network call. It reads the same config.json and uses the same loader and helpers as the app.
//
//   node mcp-server.ts [--config /abs/config.json] [--vaults "Work,Other"] [--safe]
//   claude mcp add --scope user knowledge-map -- node /abs/path/mcp-server.ts --vaults "general-knowledge"
//
// --vaults: only these vault names (default: every vault in the config). --safe: like Safe mode in the app, only notes marked
// public or internal, and [[links]] to hidden notes masked. Excluded files are never loaded. Data reloads when older than 15 s.
// Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP stdio transport). Logs go to stderr only.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Note } from 'virtual:vault';
import { loadVaults, type Config } from './vault-load.ts';
import { scanProjects } from './projects.ts';
import { applySafe } from './src/safe.ts';
import { buildIndex, runSearch } from './src/search.ts';
import { collectTasks, plainTask, DUE_TEXT } from './src/taskScan.ts';
import { cockpitData, briefText, customersOf, ofCustomer, projectCustomer, pretty } from './src/cockpitData.ts';
import { contextPack } from './src/contextPack.ts';
import { shortestPath } from './src/graphPath.ts';
import { shortTitle } from './src/util.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const CONFIG = path.resolve(arg('--config') || process.env.KM_CONFIG || path.join(here, 'config.json'));
const ONLY = (arg('--vaults') || '').split(',').map(s => s.trim()).filter(Boolean);
const SAFE = process.argv.includes('--safe');
const log = (...a: unknown[]) => console.error('[knowledge-map mcp]', ...a);
const TTL = 15_000, MAX_TEXT = 60_000;

type State = { cfg: Config; notes: Note[]; byId: Map<string, Note>; index: ReturnType<typeof buildIndex>; jiraBase: string; at: number };
let state: State | null = null;
function data(): State {
  if (state && Date.now() - state.at < TTL) return state;
  const cfg: Config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (ONLY.length) cfg.vaults = (cfg.vaults || []).filter(v => ONLY.includes(v.name || path.basename(v.path)));
  const raw = loadVaults(cfg).data as unknown as { notes: Note[]; sections: string[]; edges: [string, string][]; brokenLinks: { from: string; target: string }[]; broken: string[]; jiraBase: string };
  const d = SAFE ? applySafe(raw) : raw;
  state = { cfg, notes: d.notes, byId: new Map(d.notes.map(n => [n.id, n])), index: buildIndex(d.notes), jiraBase: raw.jiraBase, at: Date.now() };
  return state;
}

// a note from what a person or agent would type: its id, file name, path (relative or absolute) or title
function find(q: unknown): Note {
  const s = String(q ?? '').trim(), { notes, byId } = data();
  if (!s) throw new Error('give a note id, file name, path or title');
  const low = s.toLowerCase().replace(/\.md$/i, ''), base = low.split('/').pop()!;
  const n = byId.get(s)
    ?? notes.find(x => x.abs.toLowerCase().replace(/\.md$/i, '') === low || x.path.toLowerCase().replace(/\.md$/i, '') === low)
    ?? notes.find(x => x.path.toLowerCase().replace(/\.md$/i, '').split('/').pop() === base)
    ?? notes.find(x => x.title.toLowerCase() === low)
    ?? runSearch(data().index, s, 'names')?.hits[0]?.note;
  if (!n) throw new Error(`no note matches "${s}"`);
  return n;
}
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const facts = (n: Note) => [n.type, n.customer && 'customer ' + n.customer, n.project && 'project ' + n.project, n.component && 'component ' + n.component, n.status !== 'none' && n.status !== 'unknown' && n.status, 'edited ' + day(n.mtime)].filter(Boolean).join(', ');
const row = (n: Note) => `- ${n.title}  [id: ${n.id}]\n  ${facts(n)}${n.summary ? '\n  ' + n.summary : ''}\n  ${n.abs}`;
const titleOf = (id: string) => data().byId.get(id)?.title ?? id;
const tasksOf = (notes: Note[]) => collectTasks(notes).map(t => ({ ...t, plain: plainTask(t.text).replace(DUE_TEXT, '').trim() }));

const S = (props: Record<string, object>, required: string[] = []) => ({ type: 'object', properties: props, required });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const TOOLS: { name: string; description: string; inputSchema: object; run: (a: any) => string }[] = [
  {
    name: 'search', description: 'Ranked search over the vault notes (names, tags, summaries, text). Operators: "exact phrase", -exclude, tag:x, vault:x, path:x, and key:value for any frontmatter key (type:bug customer:acme -status:stale). Returns ids, facts, summaries and file paths.',
    inputSchema: S({ query: str('search text with optional operators'), limit: num('max results, default 10') }, ['query']),
    run: a => {
      const r = runSearch(data().index, String(a.query || ''), 'all'), lim = Math.min(50, Number(a.limit) || 10);
      if (!r || !r.hits.length) return 'No notes match.';
      return `${r.hits.length} matches${r.hits.length > lim ? `, first ${lim}` : ''}:\n` + r.hits.slice(0, lim).map(h => row(h.note) + (h.snippet ? `\n  > ${h.snippet}` : '')).join('\n');
    },
  },
  {
    name: 'read_note', description: 'One note: its facts, frontmatter, links, backlinks and full text. Accepts an id, file name, path or title.',
    inputSchema: S({ note: str('note id, file name, path or title') }, ['note']),
    run: a => {
      const n = find(a.note);
      // the exact file text when allowed; in --safe mode the masked body, so names of hidden notes never appear
      let text = n.body;
      if (!SAFE && n.kind !== 'drawing') { try { text = fs.readFileSync(n.abs, 'utf8'); } catch {} }
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `\n\n[cut at ${MAX_TEXT} characters; read the file for the rest]`;
      return [`# ${n.title}`, `id: ${n.id}`, `file: ${n.abs}`, `vault: ${n.vault}, section: ${n.section}`, `facts: ${facts(n)}`,
        `links to: ${n.links.map(titleOf).join('; ') || 'none'}`, `linked from: ${n.backlinks.map(titleOf).join('; ') || 'none'}`, '', '---', text].join('\n');
    },
  },
  {
    name: 'neighbors', description: 'Notes linked to or from a note, up to 2 hops away, with summaries and paths.',
    inputSchema: S({ note: str('note id, file name, path or title'), hops: num('1 (default) or 2') }, ['note']),
    run: a => {
      const n = find(a.note), hops = Number(a.hops) === 2 ? 2 : 1, { byId } = data();
      const dist = new Map([[n.id, 0]]); let ring = [n.id];
      for (let h = 1; h <= hops; h++) { const nx: string[] = []; for (const id of ring) { const o = byId.get(id); o && [...o.links, ...o.backlinks].forEach(x => { if (!dist.has(x) && byId.has(x)) { dist.set(x, h); nx.push(x); } }); } ring = nx; }
      const out = [...dist].filter(([id]) => id !== n.id).map(([id, h]) => ({ o: byId.get(id)!, h })).sort((x, y) => x.h - y.h || y.o.mtime - x.o.mtime);
      if (!out.length) return `${n.title} has no links.`;
      return `${out.length} notes within ${hops} ${hops === 1 ? 'hop' : 'hops'} of ${n.title}:\n` + out.slice(0, 60).map(({ o, h }) =>
        row(o) + `\n  ${h === 1 ? (n.links.includes(o.id) ? (n.backlinks.includes(o.id) ? 'links both ways' : 'linked from the note') : 'links to the note') : '2 hops'}`).join('\n');
    },
  },
  {
    name: 'find_path', description: 'Shortest chain of links between two notes (direction ignored), e.g. how a person connects to a project.',
    inputSchema: S({ from: str('start note'), to: str('target note') }, ['from', 'to']),
    run: a => {
      const f = find(a.from), t = find(a.to), p = shortestPath(data().notes, f.id, t.id);
      if (!p) return `No link path between ${f.title} and ${t.title}.`;
      return `${p.length - 1} ${p.length === 2 ? 'hop' : 'hops'}:\n` + p.map((id, i) => `${i + 1}. ${row(data().byId.get(id)!).slice(2)}`).join('\n');
    },
  },
  {
    name: 'list_customers', description: 'Customers that have notes (frontmatter customer:), with note counts and when they were last touched.',
    inputSchema: S({}),
    run: () => {
      const { notes } = data(), cs = customersOf(notes);
      if (!cs.length) return 'No note has a customer field.';
      return cs.map(c => { const m = notes.filter(n => ofCustomer(n, c)); return `- ${c}: ${m.length} notes, last touched ${day(Math.max(...m.map(n => n.mtime)))}`; }).join('\n');
    },
  },
  {
    name: 'customer_brief', description: 'A 30 second recap of one customer: hub summary, open tasks, open questions, notes needing attention, recent meetings, projects, code projects, people, tickets.',
    inputSchema: S({ customer: str('customer slug as in the customer: field, e.g. acme-corp') }, ['customer']),
    run: a => {
      const { notes, cfg, jiraBase } = data(), cs = customersOf(notes), q = String(a.customer || '').toLowerCase().trim();
      const c = cs.find(x => x === q) ?? cs.find(x => x.startsWith(q) || x.includes(q));
      if (!c) return `Unknown customer "${a.customer}". Known: ${cs.join(', ') || 'none'}.`;
      const code = SAFE ? [] : scanProjects(cfg.projects).filter(p => projectCustomer(p, cs, cfg.projects?.customers || {}) === c);
      return briefText(c, cockpitData(c, notes, collectTasks(notes), new Set(), code), jiraBase).replace(/^## Changed since you last looked \(0\)\n/m, '');
    },
  },
  {
    name: 'open_tasks', description: 'Open "- [ ]" tasks across the notes, dated ones first. Optional filters: customer, due on or before a date, text.',
    inputSchema: S({ customer: str('customer slug'), due_before: str('YYYY-MM-DD, only tasks due on or before'), text: str('words the task must contain'), limit: num('default 40') }),
    run: a => {
      const { notes } = data();
      let ts = tasksOf(a.customer ? notes.filter(n => ofCustomer(n, String(a.customer).toLowerCase())) : notes);
      if (a.due_before) ts = ts.filter(t => t.due && t.due <= String(a.due_before));
      if (a.text) { const w = String(a.text).toLowerCase(); ts = ts.filter(t => t.plain.toLowerCase().includes(w)); }
      ts.sort((x, y) => (x.due || '9').localeCompare(y.due || '9') || y.note.mtime - x.note.mtime);
      const lim = Math.min(200, Number(a.limit) || 40);
      if (!ts.length) return 'No open tasks match.';
      return `${ts.length} open tasks${ts.length > lim ? `, first ${lim}` : ''}:\n` + ts.slice(0, lim).map(t => `- [ ] ${t.plain}${t.due ? ` (due ${t.due})` : ''}  [${shortTitle(t.note.title)}: ${t.note.abs}]`).join('\n');
    },
  },
  {
    name: 'recent_changes', description: 'Notes edited in the last N days (default 7), newest first, optionally for one customer.',
    inputSchema: S({ days: num('default 7'), customer: str('customer slug') }),
    run: a => {
      const since = Date.now() - (Number(a.days) || 7) * 864e5;
      const ns = data().notes.filter(n => n.mtime >= since && (!a.customer || ofCustomer(n, String(a.customer).toLowerCase()))).sort((x, y) => y.mtime - x.mtime);
      return ns.length ? `${ns.length} notes edited since ${day(since)}:\n` + ns.slice(0, 80).map(row).join('\n') : `No notes edited since ${day(since)}.`;
    },
  },
  {
    name: 'context_pack', description: 'Everything around one note for starting a task: the note, its links and backlinks (paths and summaries), open tasks, open questions and tickets nearby.',
    inputSchema: S({ note: str('note id, file name, path or title') }, ['note']),
    run: a => contextPack(data().notes, find(a.note).id, data().jiraBase),
  },
];

const INSTRUCTIONS = `Read-only access to the user's knowledge vault (Obsidian notes about customers, projects, people and product knowledge${SAFE ? ', Safe mode: only public and internal notes' : ''}). `
  + 'Prefer these tools over grepping the vault folder: search ranks by name, tags and summary and understands frontmatter (type:meeting customer:acme). '
  + 'Typical flow: search or customer_brief, then read_note on 1 to 3 notes, neighbors or find_path for how things connect. Notes are files: edit them with your normal file tools, following the vault README.';

const reply = (id: unknown, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id: unknown, code: number, message: string) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

function handle(msg: any) {
  const { id, method, params } = msg ?? {};
  const isCall = id !== undefined && id !== null;
  if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'knowledge-map', version: '1.0.0' }, instructions: INSTRUCTIONS });
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
  if (method === 'tools/call') {
    const t = TOOLS.find(x => x.name === params?.name);
    if (!t) return fail(id, -32602, `unknown tool ${params?.name}`);
    try { return reply(id, { content: [{ type: 'text', text: t.run(params?.arguments ?? {}) }] }); }
    catch (e) { return reply(id, { content: [{ type: 'text', text: String((e as Error).message || e) }], isError: true }); }
  }
  if (isCall) fail(id, -32601, `method not found: ${method}`);   // notifications (no id) are ignored
}

try { const d = data(); log(`${d.notes.length} notes from ${CONFIG}${ONLY.length ? ` (vaults: ${ONLY.join(', ')})` : ''}${SAFE ? ', safe mode' : ''}`); }
catch (e) { log('cannot load the vaults:', (e as Error).message); }
readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let msg: any; try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
  for (const m of Array.isArray(msg) ? msg : [msg]) { try { handle(m); } catch (e) { log(e); if (m?.id != null) fail(m.id, -32603, 'internal error'); } }
});
