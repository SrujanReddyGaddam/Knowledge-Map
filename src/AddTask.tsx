import { useMemo, useState } from 'react';
import type { Note } from 'virtual:vault';
import { type Task } from './taskScan';
import { appendLine } from './api';
import { addToDaily, dailyVault } from './journal';
import { shortTitle } from './util';

// "Add a task" bar: appends "- [ ] text @due:date" to today's journal (default) or to a note that already holds tasks,
// under the heading where that note's last open task sits.
type Props = { tasks: Task[]; current: Note | null; onAdded: () => void };

export default function AddTask({ tasks, current, onAdded }: Props) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [target, setTarget] = useState('daily');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const targets = useMemo(() => {
    const m = new Map<string, { note: Note; n: number; heading: string }>();
    for (const t of tasks) if (t.note.writable) { const c = m.get(t.note.id); m.set(t.note.id, { note: t.note, n: (c?.n || 0) + 1, heading: t.heading }); }
    const list = [...m.values()].sort((a, b) => b.n - a.n).slice(0, 15);
    if (current?.writable && current.kind !== 'drawing' && !m.has(current.id)) list.unshift({ note: current, n: 0, heading: '' });
    return list;
  }, [tasks, current]);
  if (!dailyVault()) return null;

  const add = async () => {
    const t = text.trim().replace(/\s+/g, ' ');
    if (!t || busy) return;
    const line = `- [ ] ${t}${due ? ` @due:${due}` : ''}`;
    setBusy(true); setMsg('');
    try {
      if (target === 'daily') await addToDaily('Tasks', line);
      else {
        const x = targets.find(x => x.note.id === target);
        if (!x) throw new Error('pick where the task goes');
        const r = await appendLine(x.note.vault, x.note.path.replace(/\.md$/i, ''), x.heading.trim() || 'Tasks', line);
        if (r.status !== 200) throw new Error(r.json.error || 'HTTP ' + r.status);
      }
      setText(''); setDue(''); setMsg('Added'); onAdded();
      setTimeout(() => setMsg(''), 1800);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="add-task">
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Add a task..." spellCheck={false} aria-label="New task"
        onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setText(''); (e.target as HTMLElement).blur(); } }} />
      <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" title="Due date (optional)" />
      <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Add to" title="Which note the task is added to">
        <option value="daily">Today's journal</option>
        {targets.map(x => <option key={x.note.id} value={x.note.id}>{shortTitle(x.note.title)}{x.n ? ` (${x.n})` : ''}</option>)}
      </select>
      <button className="btn primary" onClick={add} disabled={!text.trim() || busy}>{busy ? 'Adding...' : 'Add'}</button>
      {msg && <span className={'add-msg' + (msg === 'Added' ? ' ok' : '')}>{msg}</span>}
    </div>
  );
}
