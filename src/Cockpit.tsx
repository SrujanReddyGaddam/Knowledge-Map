import { useMemo, useState } from 'react';
import type { Note } from 'virtual:vault';
import vault from './data';
import { shortTitle } from './util';
import type { Task } from './taskScan';
import { TaskRow, useTaskActions, keyOf } from './TaskRow';
import ResumeCard from './ResumeCard';
import { useProjects, projectsOn, customerOf } from './projects';
import { cockpitData, briefText, weeklyPrompt, ticketFor, pretty, ofCustomer } from './cockpitData';

// Customer cockpit (key k): one page per customer with everything open or new, so a call can start from a 30 second recap.
type Props = {
  customer: string | null; customers: string[]; right: number; notes: Note[]; tasks: Task[]; changed: Set<string>; canTick: boolean; selected: string | null;
  onCustomer: (c: string | null) => void; onSelect: (id: string) => void; onClose: () => void;
};
const ago = (ms: number) => {
  const d = Math.floor((Date.now() - ms) / 864e5);
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' mo ago' : Math.round(d / 365) + ' y ago';
};

export default function Cockpit({ customer, customers, right, notes, tasks, changed, canTick, selected, onCustomer, onSelect, onClose }: Props) {
  const a = useTaskActions();
  const { list } = useProjects();
  const [brief, setBrief] = useState(false);
  const [copied, setCopied] = useState('');
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1600); });
  const code = useMemo(() => (customer && list ? list.filter(p => customerOf(p, customers) === customer) : []), [customer, list, customers]);
  const d = useMemo(() => (customer ? cockpitData(customer, notes, tasks, changed, code) : null), [customer, notes, tasks, changed, code]);
  const text = useMemo(() => (customer && d && brief ? briefText(customer, d, vault.jiraBase) : ''), [customer, d, brief]);
  const counts = useMemo(() => new Map(customers.map(c => [c, notes.filter(n => ofCustomer(n, c)).length])), [customers, notes]);

  const nlink = (n: Note, extra?: string) => (
    <li key={n.id} className={n.id === selected ? 'cur' : ''}><button onClick={() => onSelect(n.id)}><b>{shortTitle(n.title)}</b><span>{extra ?? n.summary}</span></button></li>
  );

  if (!customer || !d) return (
    <div className="tasks-view page-view" style={{ right }} role="dialog" aria-label="Customer cockpit">
      <div className="tv-scroll">
        <header className="tv-head"><div><div className="label">Customer cockpit</div><h1>Pick a customer</h1><p>{customers.length} customers with notes</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close  (k or Esc)">&times;</button></header>
        {customers.length ? <div className="ck-pick">{customers.map(c => <button key={c} onClick={() => onCustomer(c)}><b>{pretty(c)}</b><small>{counts.get(c)} notes</small></button>)}</div>
          : <div className="pv-empty">No note has a <code>customer:</code> field yet.</div>}
      </div>
    </div>
  );

  const label = pretty(customer);
  return (
    <div className="tasks-view page-view" style={{ right }} role="dialog" aria-label={'Cockpit: ' + label}>
      <div className="tv-scroll">
        <header className="tv-head">
          <div>
            <div className="label"><button className="link" onClick={() => onCustomer(null)}>Customers</button> / cockpit</div>
            <h1>{label}</h1>
            <p>{d.mine.length} notes · last touched {ago(d.lastTouched)}{d.changed.length ? <> · <b className="accent">{d.changed.length} changed since you last looked</b></> : ''}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close  (k or Esc)">&times;</button>
        </header>
        {d.hub?.summary && <p className="ck-lead">{d.hub.summary}</p>}
        <div className="pv-actions">
          <button className="btn primary" onClick={() => setBrief(v => !v)} aria-expanded={brief}>{brief ? 'Hide brief' : 'Brief me'}</button>
          {d.hub && <button className="btn" onClick={() => onSelect(d.hub!.id)}>Open hub note</button>}
          <button className="btn" onClick={() => copy('weekly', weeklyPrompt(label, ticketFor(d.hub, d.mine), d.mine))} title="Copies a prompt for the /fde-weekly-jira-update skill with the notes changed this week. Paste it into Claude Code.">{copied === 'weekly' ? 'Prompt copied' : 'Weekly Jira update prompt'}</button>
        </div>
        {brief && <section className="ck-brief">
          <div className="pv-sec-head"><h2>Brief</h2><button className="link" onClick={() => copy('brief', text)}>{copied === 'brief' ? 'Copied' : 'Copy as markdown'}</button></div>
          <pre>{text}</pre>
        </section>}

        <div className="ck-grid">
          <section className="pv-sec ck-wide">
            <div className="pv-sec-head"><h2>Open tasks</h2><small>{d.tasks.length}</small></div>
            {a.err && <div className="tv-err">{a.err}</div>}
            {d.tasks.length ? <ul className="pv-list two">{d.tasks.slice(0, 30).map(t => <TaskRow key={keyOf(t)} t={t} a={a} canTick={canTick} onOpen={onSelect} sub={shortTitle(t.note.title)} />)}</ul> : <div className="pv-empty">No open tasks in this customer's notes.</div>}
            {d.tasks.length > 30 && <div className="pv-empty">{d.tasks.length - 30} more in Tasks (filter by the customer name).</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Changed since you last looked</h2><small>{d.changed.length}</small></div>
            {d.changed.length ? <ul className="pv-notes">{d.changed.slice(0, 10).map(n => nlink(n, 'edited ' + ago(n.mtime)))}</ul> : <div className="pv-empty">Nothing new.</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Needs attention</h2><small>{d.attention.length + d.questions.length}</small></div>
            {d.questions.length > 0 && <ul className="pv-notes">{d.questions.slice(0, 6).map(q => <li key={q.note.id}><button onClick={() => onSelect(q.note.id)}><b>{shortTitle(q.note.title)}</b><span>{q.items.length} open {q.items.length === 1 ? 'question' : 'questions'}: {q.items[0]}</span></button></li>)}</ul>}
            {d.attention.length > 0 && <ul className="pv-notes">{d.attention.slice(0, 8).map(n => nlink(n, n.status.replace(/-/g, ' ') + ' · edited ' + ago(n.mtime)))}</ul>}
            {!d.attention.length && !d.questions.length && <div className="pv-empty">No drafts, stale notes or open questions.</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Projects</h2><small>{d.projects.length}</small></div>
            {d.projects.length ? <ul className="pv-notes">{d.projects.map(p => <li key={p.project}>
              <button onClick={() => onSelect((p.hub ?? p.newest).id)}><b>{pretty(p.project)}</b><span>{p.count} notes · latest: {shortTitle(p.newest.title)} ({ago(p.newest.mtime)})</span></button>
              <button className="link ck-weekly" onClick={() => copy('w-' + p.project, weeklyPrompt(`${label} ${pretty(p.project)}`, ticketFor(p.hub, p.notes), p.notes))} title="Copy a /fde-weekly-jira-update prompt for this project">{copied === 'w-' + p.project ? 'copied' : 'weekly update'}</button>
            </li>)}</ul> : <div className="pv-empty">No notes with a <code>project:</code> field.</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Recent meetings</h2><small>{d.meetings.length}</small></div>
            {d.meetings.length ? <ul className="pv-notes">{d.meetings.map(n => nlink(n, d.dateOf(n) + (n.summary ? ' · ' + n.summary : '')))}</ul> : <div className="pv-empty">No meeting notes (type: meeting).</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>People</h2><small>{d.people.length}</small></div>
            {d.people.length ? <ul className="pv-notes">{d.people.slice(0, 12).map(n => nlink(n))}</ul> : <div className="pv-empty">No people notes linked to this customer.</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Tickets</h2><small>{d.tickets.length}</small></div>
            {d.tickets.length ? <div className="ck-tickets">{d.tickets.slice(0, 24).map(t => vault.jiraBase
              ? <a key={t.key} href={vault.jiraBase + t.key} target="_blank" rel="noopener noreferrer" className="chip" title={`${t.notes.size} notes mention it`}>{t.key} <small>{t.notes.size}</small></a>
              : <span key={t.key} className="chip" title={`${t.notes.size} notes mention it. Set "jiraBase" in config.json to make these links`}>{t.key} <small>{t.notes.size}</small></span>)}</div>
              : <div className="pv-empty">No ticket keys found in the notes.</div>}
          </section>
        </div>

        {projectsOn && <section className="pv-sec">
          <div className="pv-sec-head"><h2>Code projects</h2><small>{code.length}</small></div>
          {code.length ? <div className="rc-grid">{code.map(p => <ResumeCard key={p.path} p={p} />)}</div>
            : <div className="pv-empty">{list ? `No folder under the projects roots matches "${customer}". Map folders in config.json under projects.customers.` : 'Reading project files...'}</div>}
        </section>}
      </div>
    </div>
  );
}
