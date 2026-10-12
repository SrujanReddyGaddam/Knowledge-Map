import { useMemo, useState } from 'react';
import { marked } from 'marked';
import type { Project } from './projects';

// "Where you left off" card for one code project: plan, latest worklog entry and its Next line, open TODOs, git branch.
const ago = (ms: number) => {
  const d = Math.floor((Date.now() - ms) / 864e5);
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' mo ago' : Math.round(d / 365) + ' y ago';
};
// local files, but raw HTML and script links are dropped anyway (the text is shown, never run)
const md = (t: string) => (marked.parse(t.replace(/<[^>]*>/g, ''), { async: false }) as string).replace(/href="\s*(?:javascript|data|vbscript):[^"]*"/gi, '').replace(/<a href="(https?:)/g, '<a target="_blank" rel="noopener noreferrer" href="$1');
const shq = (s: string) => "'" + s.replace(/'/g, `'\\''`) + "'";

export default function ResumeCard({ p, customer, onCustomer }: { p: Project; customer?: string; onCustomer?: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1400); });
  const status = p.plan?.status || p.status;
  const detail = useMemo(() => (open ? { plan: p.planText ? md(p.planText) : '', log: p.logText ? md(p.logText) : '' } : null), [open, p]);
  return (
    <article className="rc">
      <div className="rc-head">
        <div>
          <div className="rc-title">{p.title}</div>
          <div className="rc-meta">{[p.name !== p.title && p.name, 'edited ' + ago(p.mtime)].filter(Boolean).join(' · ')}</div>
        </div>
        {p.branch && <span className="rc-branch" title="git branch">{p.branch}</span>}
      </div>
      {customer && <button className="rc-cust" onClick={() => onCustomer?.(customer)} title="Open the customer cockpit">{customer.replace(/-/g, ' ')}</button>}
      {p.plan?.title && <div className="rc-plan"><small>Plan</small>{p.plan.title}{p.plan.total > 0 && <b> {p.plan.done}/{p.plan.total}</b>}</div>}
      {status && <p className="rc-status">{status.length > 260 ? status.slice(0, 258) + '..' : status}</p>}
      {p.plan && p.plan.open.length > 0 && <ul className="rc-steps">{p.plan.open.slice(0, 3).map((s, i) => <li key={i}>{s.length > 140 ? s.slice(0, 138) + '..' : s}</li>)}</ul>}
      {p.last && <div className="rc-last"><small>Last entry {p.last.date}</small>{p.last.title}{p.last.next && <div className="rc-next"><b>Next:</b> {p.last.next}</div>}</div>}
      <div className="rc-actions">
        <button className="btn primary" onClick={() => copy('cmd', `cd ${shq(p.path)} && claude`)} title={`cd ${p.path} && claude`}>{copied === 'cmd' ? 'Copied' : 'Copy resume command'}</button>
        <button className="btn" onClick={() => copy('path', p.path)}>{copied === 'path' ? 'Copied' : 'Copy path'}</button>
        <button className="btn" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? 'Hide' : 'Plan and log'}</button>
        {p.todo > 0 && <span className="rc-todo">{p.todo} open in TODO</span>}
      </div>
      {detail && <div className="rc-detail">
        {detail.plan && <><div className="label">PLAN.md</div><div className="md expanded" dangerouslySetInnerHTML={{ __html: detail.plan }} /></>}
        {detail.log && <><div className="label">Latest WORKLOG entry</div><div className="md expanded" dangerouslySetInnerHTML={{ __html: detail.log }} /></>}
      </div>}
    </article>
  );
}
