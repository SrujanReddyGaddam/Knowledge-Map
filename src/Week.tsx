import { useEffect, useMemo, useState } from 'react';
import type { Note } from 'virtual:vault';
import vault, { safeMode } from './data';
import { gitLog, type Commit } from './api';
import { shortTitle } from './util';
import { useProjects } from './projects';
import { weekRange, weekData, weekMarkdown } from './weekData';
import { weeklyPrompt, ticketFor, ofCustomer } from './cockpitData';

// Weekly review (key w): one week, Monday to Sunday, grouped by customer. Arrows go back in time. Copy as markdown for the weekly ritual.
// The vault git history is read only outside Safe mode (commit messages have no sensitivity).
type Props = { right: number; notes: Note[]; customers: string[]; selected: string | null; onSelect: (id: string) => void; onClose: () => void; onCockpit: (c: string) => void };

export default function Week({ right, notes, customers, selected, onSelect, onClose, onCockpit }: Props) {
  const [back, setBack] = useState(0);
  const r = useMemo(() => weekRange(back), [back]);
  const { list } = useProjects();
  const [commits, setCommits] = useState<Map<string, Commit[]> | null>(safeMode ? new Map() : null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (safeMode) return;
    let live = true; setCommits(null); setErr('');
    Promise.all(vault.vaults.map(v => gitLog(v, r.start, r.end).then(x => [v, x] as const)))
      .then(rs => { if (!live) return; const m = new Map<string, Commit[]>(); rs.forEach(([v, x]) => { if (x.status === 200 && x.json.git) m.set(v, x.json.commits); else if (x.status !== 200) setErr(x.json.error || 'HTTP ' + x.status); }); setCommits(m); })
      .catch(e => { if (live) { setErr(String(e.message || e)); setCommits(new Map()); } });
    return () => { live = false; };
  }, [r.start, r.end]);
  const d = useMemo(() => (commits ? weekData(notes, commits, r, list || [], customers, vault.projectCustomers) : null), [notes, commits, r, list, customers]);
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1600); });
  const nlink = (n: Note, extra?: string) => <li key={n.id} className={n.id === selected ? 'cur' : ''}><button onClick={() => onSelect(n.id)}><b>{shortTitle(n.title)}</b><span>{extra ?? n.summary}</span></button></li>;
  const fmt = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <div className="tasks-view page-view" style={{ right }} role="dialog" aria-label="Weekly review">
      <div className="tv-scroll">
        <header className="tv-head">
          <div>
            <div className="label">Weekly review</div>
            <h1>Week {r.week} <small className="wk-range">{fmt(r.start)} to {fmt(r.end)}</small></h1>
            {d && <p>{[`${d.totals.meetings} meetings`, `${d.totals.decisions} decisions`, `${d.totals.done} tasks done`, `${d.totals.created} new notes`, `${d.totals.edited} edited`, d.git && `${d.commitCount} vault commits`].filter(Boolean).join(' · ')}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close  (w or Esc)">&times;</button>
        </header>
        <div className="pv-actions">
          <button className="btn" onClick={() => setBack(b => b + 1)} title="Earlier week">&larr; Earlier</button>
          <button className="btn" onClick={() => setBack(b => Math.max(0, b - 1))} disabled={back === 0} title="Later week">Later &rarr;</button>
          {back > 0 && <button className="btn" onClick={() => setBack(0)}>This week</button>}
          {d && <button className="btn primary" onClick={() => copy('md', weekMarkdown(d, r))}>{copied === 'md' ? 'Copied' : 'Copy as markdown'}</button>}
        </div>
        {err && <div className="tv-err">Vault history: {err}</div>}
        {safeMode && <div className="tv-note">Safe mode: the vault git history is not read, so new notes are guessed from dates in file names.</div>}
        {!d && <div className="pv-empty">Reading the vault history...</div>}
        {d && !d.groups.length && <div className="pv-empty">Nothing recorded in this week.</div>}
        {d?.groups.map(g => (
          <section key={g.customer || '-'} className="pv-sec wk-group">
            <div className="pv-sec-head"><h2>{g.label}</h2>
              <small>{[g.meetings.length && `${g.meetings.length} meetings`, g.done.length && `${g.done.length} done`, g.created.length && `${g.created.length} new`, g.edited.length && `${g.edited.length} edited`].filter(Boolean).join(' · ')}</small>
              {g.customer && <button className="link" onClick={() => onCockpit(g.customer)}>cockpit</button>}
              {g.customer && back === 0 && <button className="link" onClick={() => { const mine = notes.filter(n => ofCustomer(n, g.customer)); const hub = mine.find(n => n.type === 'hub' && !n.project) ?? null; copy('w-' + g.customer, weeklyPrompt(g.label, ticketFor(hub, mine), mine)); }}
                title="Copy a /fde-weekly-jira-update prompt with this customer's notes changed in the last 7 days">{copied === 'w-' + g.customer ? 'prompt copied' : 'weekly Jira prompt'}</button>}
            </div>
            <div className="wk-cols">
              {g.meetings.length > 0 && <div><h3>Meetings</h3><ul className="pv-notes">{g.meetings.map(n => nlink(n, (n.path.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '') + (n.summary ? ' · ' + n.summary : '')))}</ul></div>}
              {g.decisions.length > 0 && <div><h3>Decisions</h3><ul className="pv-notes">{g.decisions.map(n => nlink(n))}</ul></div>}
              {g.done.length > 0 && <div><h3>Done</h3><ul className="wk-done">{g.done.map((t, i) => <li key={i}><span>{t.text}</span><small>{fmt(t.day)}</small></li>)}</ul></div>}
              {g.created.length > 0 && <div><h3>New notes</h3><ul className="pv-notes">{g.created.slice(0, 12).map(n => nlink(n, n.type || n.section.replace(/-/g, ' ')))}</ul>{g.created.length > 12 && <div className="pv-empty">and {g.created.length - 12} more</div>}</div>}
              {g.edited.length > 0 && <div><h3>Edited</h3><ul className="pv-notes">{g.edited.slice(0, 10).map(n => nlink(n, n.type || n.section.replace(/-/g, ' ')))}</ul>{g.edited.length > 10 && <div className="pv-empty">and {g.edited.length - 10} more</div>}</div>}
              {g.code.length > 0 && <div><h3>Code</h3><ul className="wk-done">{g.code.map(p => <li key={p.path}><span><b>{p.title}</b>: {p.last!.title}{p.last!.next ? <> · Next: {p.last!.next}</> : ''}</span><small>{fmt(p.last!.date)}</small></li>)}</ul></div>}
            </div>
          </section>
        ))}
        {d && d.deleted.length > 0 && <div className="tv-note">{d.deleted.length} notes deleted or moved this week.</div>}
      </div>
    </div>
  );
}
