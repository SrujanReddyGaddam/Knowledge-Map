import vault from './data';
import { appendLine, createNote, listTemplates } from './api';
import { fill } from './NewNote';

// Daily note and quick capture. The daily note is journal/<date>.md in the first writable vault (the Work vault),
// made from that vault's _templates/daily.md. Captures are inbox/<date>-<slug>.md from _templates/capture.md, linked from the daily note.
const pad = (n: number) => String(n).padStart(2, '0');
export const day = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const dailyVault = () => vault.writableVaults[0] || '';
export const dailyPath = (d = day()) => `journal/${d}`;
export const dailyNote = (v = dailyVault(), d = day()) => vault.notes.find(n => n.vault === v && n.path === dailyPath(d) + '.md') ?? null;
export const baseName = (path: string) => (path.split('/').pop() || '').replace(/\.md$/i, '');
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

const tplCache = new Map<string, Promise<{ name: string; text: string }[]>>();
const templates = (v: string) => {
  if (!tplCache.has(v)) tplCache.set(v, listTemplates(v).then(r => (r.status === 200 ? r.json.templates : [])).catch(() => []));
  return tplCache.get(v)!;
};
// an empty "summary:" in a template would fail the vault lint, so give the new note a plain one
const withSummary = (t: string, summary: string) => t.replace(/^summary:[ \t]*$/m, `summary: ${JSON.stringify(summary)}`);

export async function dailyInit(v: string, d = day()) {
  const t = (await templates(v)).find(x => x.name === 'daily');
  const text = t ? fill(t.text, d) : `---\ntitle: ${d}\ntype: daily\nsummary: \nsensitivity: internal\ntags: []\nstatus: draft\n---\n\n# ${d}\n`;
  return withSummary(text, `Daily journal for ${d}.`);
}

// add one line under a heading of today's daily note (created when missing)
export async function addToDaily(heading: string, line: string, v = dailyVault()) {
  const r = await appendLine(v, dailyPath(), heading, line, await dailyInit(v));
  if (r.status !== 200) throw new Error(r.json.error || 'HTTP ' + r.status);
  return r.json as { vault: string; path: string; created: boolean };
}

// create today's daily note without adding anything (the "What happened" heading already exists in the template)
export async function ensureDaily(v = dailyVault()) {
  if (dailyNote(v)) return { vault: v, path: dailyPath() + '.md', created: false };
  const r = await createNote(v, dailyPath(), await dailyInit(v));
  if (r.status !== 200 && r.status !== 409) throw new Error(r.json.error || 'HTTP ' + r.status);
  return { vault: v, path: dailyPath() + '.md', created: r.status === 200 };
}

// Quick capture: first line is the title, the rest the body. Returns the new note's path.
export async function capture(text: string, v = dailyVault()) {
  const lines = text.trim().split('\n'), title = lines[0].trim().slice(0, 120), rest = lines.slice(1).join('\n').trim();
  const t = (await templates(v)).find(x => x.name === 'capture');
  let body = t ? fill(t.text, title) : `---\ntitle: ${JSON.stringify(title)}\ntype: capture\nsummary: \nsensitivity: internal\ntags: []\nstatus: draft\n---\n\n# ${title}\n`;
  body = withSummary(body, text.trim().replace(/\s+/g, ' ').slice(0, 160));
  if (rest) body = body.replace(/\s*$/, '\n\n') + rest + '\n';
  const stem = `${day()}-${slug(title) || 'capture'}`;
  let path = '';
  for (let i = 1; i < 10 && !path; i++) {
    const p = `inbox/${stem}${i > 1 ? '-' + i : ''}`;
    const r = await createNote(v, p, body);
    if (r.status === 200) path = p;
    else if (r.status !== 409) throw new Error(r.json.error || 'HTTP ' + r.status);
  }
  if (!path) throw new Error('could not find a free file name in inbox/');
  let linked = true;
  try { await addToDaily('Captures', `- ${hhmm()} [[${baseName(path)}]]`, v); } catch { linked = false; }
  return { vault: v, path: path + '.md', linked };
}
