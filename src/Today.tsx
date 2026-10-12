import { useMemo, useState } from 'react';
import type { Note } from 'virtual:vault';
import { shortTitle } from './util';
import { type Task, isoDay } from './taskScan';
import { TaskRow, useTaskActions, keyOf } from './TaskRow';
import AddTask from './AddTask';
import ResumeCard from './ResumeCard';
import { useProjects, projectsOn, customerOf } from './projects';
import { day, dailyNote, dailyVault } from './journal';
import ReviewQueue from './ReviewQueue';
import vault from './data';

// Today view (key h): what needs doing today, where each code project was left off, and what was captured or edited today.
type Props = {
  right: number; notes: Note[]; tasks: Task[]; current: Note | null; customers: string[]; canTick: boolean;
  onSelect: (id: string) => void; onClose: () => void; onCockpit: (c: string) => void; onCapture: () => void; onDaily: () => void; onWeek: () => void;
};
const OLD = 30 * 864e5;

export default function Today({ right, notes, tasks, current, customers, canTick, onSelect, onClose, onCockpit, onCapture, onDaily, onWeek }: Props) {
  const a = useTaskActions();
  const { list, err, refresh } = useProjects();
  const [older, setOlder] = useState(false);
  const [added, setAdded] = useState(false);
  const today = isoDay(new Date());
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const due = useMemo(() => tasks.filter(t => t.due && t.due <= today).sort((x, y) => x.due.localeCompare(y.due)), [tasks, today]);
  const late = due.filter(t => t.due < today).length;
  const daily = dailyNote();
  const captured = useMemo(() => notes.filter(n => n.path.startsWith('inbox/') && (n.path.startsWith(`inbox/${day()}`) || n.mtime >= start.getTime())).sort((x, y) => y.mtime - x.mtime), [notes]);   // eslint-disable-line react-hooks/exhaustive-deps
  const edited = useMemo(() => notes.filter(n => n.mtime >= start.getTime() && !n.path.startsWith('inbox/') && n.id !== daily?.id).sort((x, y) => y.mtime - x.mtime), [notes, daily]);   // eslint-disable-line react-hooks/exhaustive-deps
  const recent = (list || []).filter(p => Date.now() - p.mtime < OLD), stale = (list || []).filter(p => Date.now() - p.mtime >= OLD);
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="tasks-view page-view" style={{ right }} role="dialog" aria-label="Today">
      <div className="tv-scroll">
        <header className="tv-head">
          <div>
            <div className="label">Today</div>
            <h1>{dateLine}</h1>
            <p>{[due.length ? `${due.length} due` : 'nothing due', late && `${late} overdue`, captured.length && `${captured.length} captured`, edited.length && `${edited.length} edited`].filter(Boolean).join(' · ')}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close  (h or Esc)">&times;</button>
        </header>
        <div className="pv-actions">
          {dailyVault() && <button className="btn primary" onClick={onDaily} title="Open today's journal note  (d)">{daily ? "Open today's journal" : "Start today's journal"}</button>}
          {dailyVault() && <button className="btn" onClick={onCapture} title="Quick capture into the inbox  (c)">Quick capture</button>}
          <button className="btn" onClick={onWeek} title="This week per customer  (w)">Weekly review</button>
        </div>

        <section className="pv-sec">
          <div className="pv-sec-head"><h2>Due today and overdue</h2><small>{due.length}</small></div>
          {canTick && <AddTask tasks={tasks} current={current} onAdded={() => setAdded(true)} />}
          {added && <div className="tv-note">Added. The list refreshes in a moment.</div>}
          {a.err && <div className="tv-err">{a.err}</div>}
          {due.length ? <ul className="pv-list">{due.map(t => <TaskRow key={keyOf(t)} t={t} a={a} canTick={canTick} onOpen={onSelect} sub={shortTitle(t.note.title)} />)}</ul>
            : <div className="pv-empty">Nothing due. Tasks get a date with <code>@due:YYYY-MM-DD</code> or the calendar button in Tasks.</div>}
        </section>

        {projectsOn && <section className="pv-sec">
          <div className="pv-sec-head"><h2>Where you left off</h2><small>{list ? recent.length : ''}</small><button className="link" onClick={refresh}>Refresh</button></div>
          {err && <div className="tv-err">{err}</div>}
          {!list && !err && <div className="pv-empty">Reading project files...</div>}
          {list && !list.length && <div className="pv-empty">No projects with PLAN.md, TODO.md or WORKLOG.md in the folders set under "projects" in config.json.</div>}
          <div className="rc-grid">{recent.map(p => { const c = customerOf(p, customers); return <ResumeCard key={p.path} p={p} customer={c} onCustomer={onCockpit} />; })}</div>
          {stale.length > 0 && <button className="link pv-more" onClick={() => setOlder(v => !v)}>{older ? 'Hide' : 'Show'} {stale.length} idle for 30+ days</button>}
          {older && <div className="rc-grid">{stale.map(p => <ResumeCard key={p.path} p={p} customer={customerOf(p, customers)} onCustomer={onCockpit} />)}</div>}
        </section>}

        <ReviewQueue notes={notes} lintVaults={vault.lintVaults} canWrite={canTick} onSelect={onSelect} />

        <div className="pv-two">
          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Captured today</h2><small>{captured.length}</small></div>
            {captured.length ? <ul className="pv-notes">{captured.map(n => <li key={n.id}><button onClick={() => onSelect(n.id)}><b>{shortTitle(n.title)}</b><span>{n.summary}</span></button></li>)}</ul>
              : <div className="pv-empty">Nothing yet. Press <kbd>c</kbd> to capture a thought.</div>}
          </section>
          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Edited today</h2><small>{edited.length}</small></div>
            {edited.length ? <ul className="pv-notes">{edited.slice(0, 14).map(n => <li key={n.id}><button onClick={() => onSelect(n.id)}><b>{shortTitle(n.title)}</b><span>{n.section.replace(/-/g, ' ')}</span></button></li>)}</ul>
              : <div className="pv-empty">No notes edited today.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
