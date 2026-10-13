import { useMemo, useState } from 'react';
import { marked } from 'marked';
import type { Note } from 'virtual:vault';
import vault from './data';
import { shortTitle } from './util';
import type { Task } from './taskScan';
import { TaskRow, useTaskActions, keyOf } from './TaskRow';
import ResumeCard from './ResumeCard';
import Crumbs, { crumbsFor } from './Crumbs';
import type { Facet } from './facets';
import { useProjects, projectsOn, customerOf } from './projects';
import { cockpitData, briefText, weeklyPrompt, ticketFor, pretty, ofCustomer, decisionsIn, type Scope } from './cockpitData';
import { plainTask, DUE_TEXT } from './taskScan';
import { useActivity, realTime } from './activity';

// Customer cockpit (key k): one page per customer with everything open or new, so a call can start from a 30 second recap.
type Props = {
  customer: string | null; customers: string[]; right: number; notes: Note[]; tasks: Task[]; changed: Set<string>; canTick: boolean; selected: string | null;
  scope: Scope; onScope: (s: Scope) => void;
  onCustomer: (c: string | null) => void; onSelect: (id: string) => void; onFacet: (f: Facet, v: string) => void; onClose: () => void;
};
const ago = (ms: number) => {
  if (!ms) return 'no dated activity';
  const d = Math.floor((Date.now() - ms) / 864e5);
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' mo ago' : Math.round(d / 365) + ' y ago';
};

export default function Cockpit({ customer, customers, right, notes, tasks, changed, canTick, selected, scope, onScope, onCustomer, onSelect, onFacet, onClose }: Props) {
  const a = useTaskActions();
  const { list } = useProjects();
  const act = useActivity();
  const [brief, setBrief] = useState(false);
  const [copied, setCopied] = useState('');
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1600); });
  const code = useMemo(() => (customer && list ? list.filter(p => customerOf(p, customers) === customer) : []), [customer, list, customers]);
  const d = useMemo(() => (customer ? cockpitData(customer, notes, tasks, changed, code, scope, act) : null), [customer, notes, tasks, changed, code, scope, act]);
  const crumbs = useMemo(() => (customer ? crumbsFor(notes, { customer, ...scope }) : []), [customer, notes, scope]);
  const scopeLabel = crumbs.map(c => c.label).join(' > ');
  const text = useMemo(() => (customer && d && brief ? briefText(customer, d, vault.jiraBase, scopeLabel) : ''), [customer, d, brief, scopeLabel]);
  // shown rendered; Copy as markdown still copies the text. Raw HTML in note titles or summaries is escaped, links open in a new tab.
  const html = useMemo(() => (text ? (marked.parse(text.replace(/&/g, '&amp;').replace(/</g, '&lt;'), { async: false }) as string).replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=') : ''), [text]);
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
  const scoped = !!scope.project;
  // project and component names as their hubs title them
  const nameOf = (project: string, component?: string) => crumbsFor(notes, { customer, project, component }).at(-1)!.label;
  return (
    <div className="tasks-view page-view" style={{ right }} role="dialog" aria-label={'Cockpit: ' + label}>
      <div className="tv-scroll">
        <header className="tv-head">
          <div>
            <div className="label ck-crumbs"><button className="link" onClick={() => onCustomer(null)}>Customers</button><span className="crumb-sep" aria-hidden>&rsaquo;</span><Crumbs parts={crumbs} onOpen={onSelect} onFacet={onFacet} current onPick={(_, i) => onScope(i === 0 ? {} : { project: scope.project })} /><span className="crumb-sep" aria-hidden>/</span>cockpit</div>
            <h1>{(() => { const l = crumbs.at(-1); return !l ? label : l.facet === 'component' && !l.hub ? pretty(l.value) : l.label; })()}</h1>
            <p>{scoped && <><button className="link" onClick={() => onScope({})}>whole customer</button> · </>}{d.mine.length} notes · last touched {ago(d.lastTouched)}{d.changed.length ? <> · <b className="accent">{d.changed.length} changed since you last looked</b></> : ''}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close  (k or Esc)">&times;</button>
        </header>
        {d.hub?.summary && <p className="ck-lead">{d.hub.summary}</p>}
        <div className="pv-actions">
          <button className="btn primary" onClick={() => setBrief(v => !v)} aria-expanded={brief}>{brief ? 'Hide brief' : 'Brief me'}</button>
          {d.hub && <button className="btn" onClick={() => onSelect(d.hub!.id)}>Open hub note</button>}
          <button className="btn" onClick={() => copy('weekly', weeklyPrompt(crumbs.map(c => c.label).join(', '), ticketFor(d.hub, d.mine), d.mine))} title="Copies a prompt for the /fde-weekly-jira-update skill with the notes changed this week. Paste it into Claude Code.">{copied === 'weekly' ? 'Prompt copied' : 'Weekly Jira update prompt'}</button>
        </div>
        {brief && <section className="ck-brief">
          <div className="pv-sec-head"><h2>Brief</h2><button className="link" onClick={() => copy('brief', text)}>{copied === 'brief' ? 'Copied' : 'Copy as markdown'}</button></div>
          <div className="ck-brief-md" dangerouslySetInnerHTML={{ __html: html }} />
        </section>}

        {d.projects.length > 0 && <section className="pv-sec ck-projects">
          <div className="pv-sec-head"><h2>Projects</h2><small>{d.projects.length}</small>{scoped && <button className="link" onClick={() => onScope({})}>show all of {crumbs[0].label}</button>}</div>
          <div className="ck-cards">{d.projects.map(p => {
            const on = scope.project === p.project, name = nameOf(p.project);
            const toggle = () => onScope(on && !scope.component ? {} : { project: p.project });
            const open = (id: string) => (e: React.MouseEvent) => { e.stopPropagation(); onSelect(id); };
            const txt = (t: { text: string }) => plainTask(t.text).replace(DUE_TEXT, '').trim();
            const dec = p.meeting ? decisionsIn(p.meeting).slice(0, 2) : [];
            return <div key={p.project} className={'ck-card' + (on ? ' on' : '')} role="button" tabIndex={0} aria-pressed={on} onClick={toggle}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggle(); } }}
              title={on && !scope.component ? 'Back to the whole customer' : `Scope the cockpit to ${name}`}>
              <div className="ck-card-head"><b>{name}</b>{p.status && <span className={'ck-status s-' + p.status}>{p.status.replace(/-/g, ' ')}</span>}</div>
              <dl className="ck-rows">
                <dt>Next step</dt>
                <dd>{p.next ? <button className="ck-row" onClick={open(p.next.note.id)} title={txt(p.next)}><span className="ck-t c3">{txt(p.next)}</span>{p.next.due && <small className="ck-due">due {p.next.due}</small>}<small>{shortTitle(p.next.note.title)}</small></button> : <span className="ck-none">No open tasks</span>}</dd>
                {(p.waiting.length > 0 || p.questions > 0) && <><dt>Waiting on</dt>
                <dd>{p.waiting[0] ? <button className="ck-row" onClick={open(p.waiting[0].note.id)} title={txt(p.waiting[0])}><span className="ck-t c2">{txt(p.waiting[0])}</span><small>{[p.waiting.length > 1 && `+${p.waiting.length - 1} more`, p.questions > 0 && `${p.questions} open ${p.questions === 1 ? 'question' : 'questions'}`].filter(Boolean).join(' · ')}</small></button>
                  : <span className="ck-none">{p.questions} open {p.questions === 1 ? 'question' : 'questions'}</span>}</dd></>}
                <dt>Last worked on</dt>
                <dd>{p.worked ? <button className="ck-row" onClick={open(p.worked.id)}>{shortTitle(p.worked.title)}<small>{ago(p.mtime)}</small></button> : <span className="ck-none">no dated activity</span>}</dd>
                {p.meeting && <><dt>Last meeting</dt>
                <dd><button className="ck-row" onClick={open(p.meeting.id)}>{shortTitle(p.meeting.title)}<small>{d.dateOf(p.meeting)}</small></button>
                  {dec.length > 0 && <ul className="ck-dec">{dec.map((x, i) => <li key={i} title={x}>{x}</li>)}</ul>}</dd></>}
              </dl>
              {p.components.length > 0 && <div className="ck-comps">{p.components.map(([k, n]) => {
                const con = on && scope.component === k;
                return <button key={k} className={'chip' + (con ? ' active' : '')} aria-pressed={con} onClick={e => { e.stopPropagation(); onScope(con ? { project: p.project } : { project: p.project, component: k }); }} title={con ? `Back to ${name}` : 'Scope the cockpit to this component'}>{nameOf(p.project, k)} <small>{n}</small></button>;
              })}</div>}
              <div className="ck-card-foot"><span>{p.count} notes · {p.tasks} open {p.tasks === 1 ? 'task' : 'tasks'}</span>
                <button className="link ck-weekly" onClick={e => { e.stopPropagation(); copy('w-' + p.project, weeklyPrompt(`${label} ${name}`, ticketFor(p.hub, p.notes), p.notes)); }} title="Copy a /fde-weekly-jira-update prompt for this project">{copied === 'w-' + p.project ? 'copied' : 'weekly update'}</button></div>
            </div>;
          })}</div>
        </section>}

        <div className="ck-grid">
          <section className="pv-sec ck-wide">
            <div className="pv-sec-head"><h2>Open tasks</h2><small>{d.tasks.length}</small></div>
            {a.err && <div className="tv-err">{a.err}</div>}
            {d.taskGroups.length > 1 ? <div className="ck-tgroups">{d.taskGroups.map(g => <div key={g.component || '-'} className="ck-tgroup">
              <div className="ck-tgroup-head">{g.component ? <button className="link" onClick={() => onScope({ project: scope.project, component: g.component })} title="Scope the cockpit to this component">{nameOf(scope.project!, g.component)}</button> : <span>Project-wide</span>}<small>{g.tasks.length}</small></div>
              <ul className="pv-list">{g.tasks.slice(0, 4).map(t => <TaskRow key={keyOf(t)} t={t} a={a} canTick={canTick} onOpen={onSelect} sub={shortTitle(t.note.title)} />)}</ul>
              {g.tasks.length > 4 && (g.component ? <button className="link ck-more" onClick={() => onScope({ project: scope.project, component: g.component })}>{g.tasks.length - 4} more</button> : <div className="pv-empty">{g.tasks.length - 4} more</div>)}
            </div>)}</div>
            : d.tasks.length ? <ul className="pv-list two">{d.tasks.slice(0, 30).map(t => <TaskRow key={keyOf(t)} t={t} a={a} canTick={canTick} onOpen={onSelect} sub={shortTitle(t.note.title)} />)}</ul> : <div className="pv-empty">No open tasks here.</div>}
            {d.taskGroups.length <= 1 && d.tasks.length > 30 && <div className="pv-empty">{d.tasks.length - 30} more in Tasks (filter by the customer name).</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Changed since you last looked</h2><small>{d.changed.length}</small></div>
            {d.changed.length ? <ul className="pv-notes">{d.changed.slice(0, 10).map(n => nlink(n, 'edited ' + ago(n.mtime)))}</ul> : <div className="pv-empty">Nothing new.</div>}
          </section>

          <section className="pv-sec">
            <div className="pv-sec-head"><h2>Needs attention</h2><small>{d.attention.length + d.questions.length}</small></div>
            {d.questions.length > 0 && <ul className="pv-notes">{d.questions.slice(0, 6).map(q => <li key={q.note.id}><button onClick={() => onSelect(q.note.id)}><b>{shortTitle(q.note.title)}</b><span>{q.items.length} open {q.items.length === 1 ? 'question' : 'questions'}: {q.items[0]}</span></button></li>)}</ul>}
            {d.attention.length > 0 && <ul className="pv-notes">{d.attention.slice(0, 8).map(n => nlink(n, n.status.replace(/-/g, ' ') + ' · ' + (realTime(n, act) ? 'active ' + ago(realTime(n, act)) : 'no dated activity')))}</ul>}
            {!d.attention.length && !d.questions.length && <div className="pv-empty">No drafts, stale notes or open questions.</div>}
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

        {projectsOn && !scoped && <section className="pv-sec">
          <div className="pv-sec-head"><h2>Code projects</h2><small>{code.length}</small></div>
          {code.length ? <div className="rc-grid">{code.map(p => <ResumeCard key={p.path} p={p} />)}</div>
            : <div className="pv-empty">{list ? `No folder under the projects roots matches "${customer}". Map folders in config.json under projects.customers.` : 'Reading project files...'}</div>}
        </section>}
      </div>
    </div>
  );
}
