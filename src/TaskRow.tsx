import { useState } from 'react';
import { shortTitle } from './util';
import { type Task, DUE_TEXT, plainTask, tickInRaw, setDueInRaw, isoDay, plusDays, nextMonday } from './taskScan';
import { rawNote, saveNote } from './api';
import { addToDaily, dailyVault, dailyPath, baseName } from './journal';

// One open task as a row (Tasks view, Today view, customer cockpit): tick it off, snooze it, or open its note.
// Every change reads the exact file, edits the one line (only if its text still matches) and saves with the hash, like the editor.
export const keyOf = (t: Task) => t.note.id + '#' + t.nth;

export function useTaskActions() {
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState<Map<string, string>>(() => new Map());   // key -> what happened ('done' or the new date)
  const [err, setErr] = useState('');
  const run = async (t: Task, edit: (raw: string) => string | null, what: string) => {
    const k = keyOf(t); if (busy.has(k) || done.has(k)) return;
    setErr(''); setBusy(s => new Set(s).add(k));
    try {
      const r = await rawNote(t.note.id);
      if (r.status !== 200) throw new Error(r.json.error || 'could not read the note');
      const text = edit(r.json.text);
      if (text === null) throw new Error('this task changed in the file, the list refreshes in a moment');
      const s = await saveNote(t.note.id, text, r.json.hash);
      if (s.status !== 200) throw new Error(s.json.error || 'save failed (HTTP ' + s.status + ')');
      setDone(d => new Map(d).set(k, what));   // the page refreshes from the server's update a moment later
      // a finished work task is logged in today's journal (not tasks of the journal itself, not other vaults)
      if (what === 'done' && t.note.vault === dailyVault() && t.note.path !== dailyPath() + '.md')
        addToDaily('Done', `- [x] ${plainTask(t.text).replace(DUE_TEXT, '').trim()} ([[${baseName(t.note.path)}]])`).catch(() => {});
    } catch (e) { setErr(`${shortTitle(t.note.title)}: ${(e as Error).message}`); }
    finally { setBusy(s => { const x = new Set(s); x.delete(k); return x; }); }
  };
  return {
    busy, done, err, setErr,
    tick: (t: Task) => run(t, raw => tickInRaw(raw, t.nth, t.text), 'done'),
    snooze: (t: Task, due: string | null) => run(t, raw => setDueInRaw(raw, t.nth, t.text, due), due || 'no date'),
  };
}

type RowProps = { t: Task; a: ReturnType<typeof useTaskActions>; canTick: boolean; onOpen: (id: string) => void; sub?: string };
export function TaskRow({ t, a, canTick, onOpen, sub }: RowProps) {
  const k = keyOf(t), what = a.done.get(k), isDone = what === 'done', tickable = canTick && t.note.writable;
  const [menu, setMenu] = useState(false);
  const today = isoDay(new Date());
  const pick = (d: string | null) => { setMenu(false); a.snooze(t, d); };
  return (
    <li className={'tv-task' + (isDone ? ' done' : '') + (what && !isDone ? ' moved' : '')}>
      <button className={'tv-box' + (a.busy.has(k) ? ' busy' : '')} disabled={!tickable || !!what} onClick={() => a.tick(t)}
        aria-label={isDone ? 'Done' : 'Mark done'} title={tickable ? 'Mark done (saves the note)' : canTick ? 'This vault is read-only' : 'Ticking is off in Safe mode'}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-6" /></svg>
      </button>
      <button className="tv-text" onClick={() => onOpen(t.note.id)} title={'Open ' + t.note.path}>
        <span>{plainTask(t.text).replace(DUE_TEXT, '').trim()}</span>
        {(t.due || sub || what) && <small>
          {what && !isDone ? <em>{what === 'no date' ? 'date removed' : 'moved to ' + what}</em> : t.due && <em className={t.due < today ? 'late' : ''}>{t.due === today ? 'today' : t.due}</em>}
          {sub}
        </small>}
      </button>
      {tickable && !what && <span className="tv-snooze">
        <button className="tv-snz-btn" onClick={() => setMenu(m => !m)} aria-label="Snooze" title="Set or move the due date">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 7h11M5.5 2v3M10.5 2v3" /></svg>
        </button>
        {menu && <span className="tv-snz-menu" onMouseLeave={() => setMenu(false)}>
          <button onClick={() => pick(plusDays(0))}>Today</button>
          <button onClick={() => pick(plusDays(1))}>Tomorrow</button>
          <button onClick={() => pick(nextMonday())}>Next Monday</button>
          <button onClick={() => pick(plusDays(7))}>In a week</button>
          <label>Pick <input type="date" min={today} onChange={e => e.target.value && pick(e.target.value)} /></label>
          {t.due && <button onClick={() => pick(null)}>Remove date</button>}
        </span>}
      </span>}
    </li>
  );
}
