import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from 'virtual:vault';
import { shortTitle } from './util';
import { type Task, DUE_TEXT, plainTask, tickInRaw } from './taskScan';
import { rawNote, saveNote } from './api';

// Tasks view: a full page over the map with every open checkbox, as cards per note (or per customer).
// Clicking a task opens its note in the side panel, which slides in over the right side of this view.
type Props = { tasks: Task[]; vaults: string[]; right: number; selected: string | null; onSelect: (id: string) => void; onClose: () => void; canTick: boolean };
type By = 'note' | 'customer';
type Card = { key: string; title: string; meta: string; note?: Note; items: Task[]; mtime: number };

const today = () => new Date().toISOString().slice(0, 10);
const ago = (ms: number) => {
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' mo ago' : Math.round(d / 365) + ' y ago';
};
const pretty = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
const load = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

export default function Tasks({ tasks, vaults, right, selected, onSelect, onClose, canTick }: Props) {
  const [q, setQ] = useState('');
  // vaults switched off in this view; by default the read-only ones (e.g. an inbox vault whose tasks get triaged elsewhere)
  const [off, setOff] = useState<Set<string>>(() => {
    const saved = load('tasksOff');
    if (saved) { try { return new Set((JSON.parse(saved) as string[]).filter(v => vaults.includes(v))); } catch {} }
    return new Set(vaults.filter(v => !tasks.some(t => t.note.vault === v && t.note.writable)));
  });
  const flip = (v: string) => setOff(o => { const x = new Set(o); x.has(v) ? x.delete(v) : x.add(v); return x; });
  const [by, setBy] = useState<By>(() => (load('tasksBy') === 'customer' ? 'customer' : 'note'));
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { store('tasksOff', JSON.stringify([...off])); }, [off]);
  useEffect(() => { store('tasksBy', by); }, [by]);
  const key = (t: Task) => t.note.id + '#' + t.nth;

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return tasks.filter(t => !off.has(t.note.vault) &&
      words.every(w => [t.text, t.note.title, t.heading, t.note.customer, t.note.project, t.note.section].join(' ').toLowerCase().includes(w)));
  }, [tasks, q, off]);
  const dated = useMemo(() => shown.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due)), [shown]);
  const late = dated.filter(t => t.due < today()).length;

  const cards = useMemo(() => {
    const m = new Map<string, Card>();
    for (const t of shown) {
      const n = t.note;
      const k = by === 'note' ? n.id : (n.customer || (n.sensitivity === 'personal' ? '~personal' : '~none'));
      if (!m.has(k)) m.set(k, by === 'note'
        ? { key: k, title: shortTitle(n.title), meta: [n.customer && pretty(n.customer), n.section.split(' / ').pop()!.replace(/-/g, ' '), 'edited ' + ago(n.mtime)].filter(Boolean).join(' · '), note: n, items: [], mtime: n.mtime }
        : { key: k, title: k === '~none' ? 'No customer' : k === '~personal' ? 'Personal' : pretty(k), meta: '', items: [], mtime: 0 });
      const c = m.get(k)!; c.items.push(t); c.mtime = Math.max(c.mtime, n.mtime);
    }
    for (const c of m.values()) if (by === 'customer') { const notes = new Set(c.items.map(t => t.note.id)).size; c.meta = `${notes} ${notes === 1 ? 'note' : 'notes'} · edited ${ago(c.mtime)}`; }
    return [...m.values()].sort((a, b) => (a.key.startsWith('~') ? 1 : 0) - (b.key.startsWith('~') ? 1 : 0) || b.mtime - a.mtime);
  }, [shown, by]);

  const tick = async (t: Task) => {
    const k = key(t); if (busy.has(k) || done.has(k)) return;
    setErr(''); setBusy(s => new Set(s).add(k));
    try {
      const r = await rawNote(t.note.id);
      if (r.status !== 200) throw new Error(r.json.error || 'could not read the note');
      const text = tickInRaw(r.json.text, t.nth, t.text);
      if (text === null) throw new Error('this task changed in the file, the list refreshes in a moment');
      const s = await saveNote(t.note.id, text, r.json.hash);
      if (s.status !== 200) throw new Error(s.json.error || 'save failed (HTTP ' + s.status + ')');
      setDone(d => new Set(d).add(k));   // the page refreshes from the server's update a moment later
    } catch (e) { setErr(`${shortTitle(t.note.title)}: ${(e as Error).message}`); }
    finally { setBusy(s => { const x = new Set(s); x.delete(k); return x; }); }
  };

  const row = (t: Task, opts: { note?: boolean; heading?: boolean }) => {
    const k = key(t), isDone = done.has(k), tickable = canTick && t.note.writable;
    return (
      <li key={k} className={'tv-task' + (isDone ? ' done' : '')}>
        <button className={'tv-box' + (busy.has(k) ? ' busy' : '')} disabled={!tickable || isDone} onClick={() => tick(t)}
          aria-label={isDone ? 'Done' : 'Mark done'} title={tickable ? 'Mark done (saves the note)' : canTick ? 'This vault is read-only' : 'Ticking is off in Safe mode'}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-6" /></svg>
        </button>
        <button className="tv-text" onClick={() => onSelect(t.note.id)} title={'Open ' + t.note.path}>
          <span>{plainTask(t.text).replace(DUE_TEXT, '').trim()}</span>
          {(t.due || opts.note || (opts.heading && t.heading)) && <small>
            {t.due && <em className={t.due < today() ? 'late' : ''}>{t.due}</em>}
            {opts.note ? shortTitle(t.note.title) : opts.heading && plainTask(t.heading)}
          </small>}
        </button>
      </li>
    );
  };

  // inside a note card, a subheading appears wherever the tasks move to a different section of the note
  const cardBody = (c: Card) => {
    if (by === 'customer') return <ul>{c.items.map(t => row(t, { note: true }))}</ul>;
    const many = new Set(c.items.map(t => t.heading)).size > 1;
    if (!many) return <ul>{c.items.map(t => row(t, {}))}</ul>;
    const out: React.ReactNode[] = []; let list: React.ReactNode[] = []; let last: string | null = null;
    const flush = () => { if (list.length) out.push(<ul key={'l' + out.length}>{list}</ul>); list = []; };
    for (const t of c.items) {
      if (t.heading !== last) { flush(); out.push(<div key={'h' + out.length} className="tv-sub">{t.heading ? plainTask(t.heading) : 'Top of the note'}</div>); last = t.heading; }
      list.push(row(t, {}));
    }
    flush(); return out;
  };

  const open = shown.length - shown.filter(t => done.has(key(t))).length;
  const notes = new Set(shown.map(t => t.note.id)).size;
  return (
    <div className="tasks-view" style={{ right }} role="dialog" aria-label="Tasks">
      <div className="tv-scroll">
        <header className="tv-head">
          <div>
            <div className="label">Tasks</div>
            <h1>{open ? `${open} open` : 'All clear'}</h1>
            <p>across {notes} {notes === 1 ? 'note' : 'notes'}{late ? <> &middot; <b className="late">{late} past due</b></> : ''}{dated.length ? ` · ${dated.length} with a date` : ''}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close tasks" title="Close  (t or Esc)">&times;</button>
        </header>
        <div className="tv-tools">
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by task, note, customer or project" spellCheck={false}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); if (q) setQ(''); else inputRef.current?.blur(); } }} />
          {vaults.length > 1 && <div className="tv-vaults" role="group" aria-label="Vaults">
            {vaults.map(v => { const n = tasks.filter(t => t.note.vault === v).length, ro = !tasks.some(t => t.note.vault === v && t.note.writable);
              return <button key={v} className={'tv-vault' + (off.has(v) ? '' : ' on')} aria-pressed={!off.has(v)} onClick={() => flip(v)}
                title={(off.has(v) ? 'Show' : 'Hide') + ` tasks from ${v}` + (ro ? ' (read-only: ticking is off)' : '')}>{v}<small>{n}</small></button>; })}
          </div>}
          <div className="seg" role="group" aria-label="Group by">
            <button className={by === 'note' ? 'on' : ''} onClick={() => setBy('note')}>By note</button>
            <button className={by === 'customer' ? 'on' : ''} onClick={() => setBy('customer')}>By customer</button>
          </div>
        </div>
        {err && <div className="tv-err">{err}</div>}
        {!shown.length && <div className="tv-empty">{tasks.length ? 'No task matches the filter.' : 'No open tasks. Any "- [ ]" checkbox in a note shows up here.'}</div>}
        {dated.length > 0 && <section className="tv-dated">
          <div className="label">With a date</div>
          <ul>{dated.map(t => row(t, { note: true }))}</ul>
        </section>}
        <div className="tv-cards">
          {cards.map(c => (
            <article key={c.key} className={'tv-card' + (c.note && c.note.id === selected ? ' cur' : '')}>
              <div className="tv-card-head">
                {c.note ? <button className="tv-card-title" onClick={() => onSelect(c.note!.id)} title={'Open ' + c.note.path}>{c.title}</button> : <span className="tv-card-title">{c.title}</span>}
                <span className="tv-n">{c.items.length}</span>
              </div>
              {c.meta && <div className="tv-meta">{c.meta}</div>}
              {cardBody(c)}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
