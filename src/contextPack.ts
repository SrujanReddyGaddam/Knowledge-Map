import type { Note } from 'virtual:vault';
import { collectTasks, plainTask, DUE_TEXT } from './taskScan.ts';
import { openQuestions, ticketsIn, pretty } from './cockpitData.ts';
import { shortTitle } from './util.ts';

// "Hand to Claude": a context pack for a Claude Code session about one note. It lists files (absolute paths) with their summaries
// rather than pasting whole bodies, so the agent reads only what it needs. Shared by the panel button and the MCP tool context_pack.
// Works on whatever notes it is given: in Safe mode the page passes only the visible notes.
const MAX = 12;
export function contextPack(notes: Note[], id: string, jiraBase = '') {
  const byId = new Map(notes.map(n => [n.id, n]));
  const n = byId.get(id);
  if (!n) return '';
  const line = (o: Note) => `- ${shortTitle(o.title)}${o.type ? ` (${o.type})` : ''}: ${o.summary || 'no summary'}\n  ${o.abs}`;
  const list = (ids: string[]) => ids.map(i => byId.get(i)).filter((o): o is Note => !!o).sort((a, b) => b.mtime - a.mtime);
  const links = list(n.links), back = list(n.backlinks.filter(i => !n.links.includes(i)));
  const near = [n, ...links, ...back];
  const tasks = collectTasks(near);
  const questions = near.map(o => ({ o, q: openQuestions(o) })).filter(x => x.q.length);
  const tickets = ticketsIn(near).slice(0, 10);
  const facts = [n.type && `type ${n.type}`, n.customer && `customer ${pretty(n.customer)}`, n.project && `project ${pretty(n.project)}`, n.status !== 'none' && n.status !== 'unknown' && `status ${n.status}`, `edited ${new Date(n.mtime).toISOString().slice(0, 10)}`].filter(Boolean).join(', ');
  const L = [
    `Context from my knowledge vault for this session. Start by reading the main note, then open the linked notes that matter for the task.`, '',
    `## Main note: ${n.title}`, `File: ${n.abs}`, facts ? `Facts: ${facts}` : '', n.summary ? `Summary: ${n.summary}` : '', '',
  ];
  const sec = (title: string, rows: string[]) => { if (rows.length) L.push(`## ${title}`, ...rows.slice(0, MAX), ...(rows.length > MAX ? [`- ...and ${rows.length - MAX} more`] : []), ''); };
  sec(`Links to (${links.length})`, links.map(line));
  sec(`Linked from (${back.length})`, back.map(line));
  sec(`Open tasks (${tasks.length})`, tasks.map(t => `- [ ] ${plainTask(t.text).replace(DUE_TEXT, '').trim()}${t.due ? ` (due ${t.due})` : ''} [${shortTitle(t.note.title)}]`));
  sec('Open questions', questions.flatMap(x => x.q.slice(0, 4).map(q => `- ${q} [${shortTitle(x.o.title)}]`)));
  sec('Tickets mentioned', tickets.map(t => `- ${jiraBase ? jiraBase + t.key : t.key}`));
  L.push('## Task', '<describe what you want to do>', '');
  return L.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
