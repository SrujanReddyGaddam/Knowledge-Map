import { useMemo, useState, type ReactNode } from 'react';
import type { Note } from 'virtual:vault';
import vault from './data';
import { personOf, logLines, RINGS, RELATIONS, agoText, today, type Relation } from './circlesData';
import { PROFILE_FIELDS, RELATIONSHIPS, age, asks, datedItems, journalContacts, nextYearly, yamlValue, yamlList, fmtDate } from './people';
import { appendLine, rawNote, saveNote } from './api';
import { setFrontmatter } from './review';

// Profile card above a person note (type: person with a relation): the facts from frontmatter, tap to call or mail,
// a before-you-call brief, quick adds into the note's sections and an Edit profile form. Every write goes through the
// existing guarded paths (/api/append for one line under a heading, raw + setFrontmatter + /api/save for fields).
type Props = { note: Note; canWrite: boolean; resolve: (from: Note, name: string) => Note | undefined; onNav: (id: string) => void };

const journal = journalContacts(vault.notes);   // the page reloads on every vault change, so once per load is enough
const ADD = [
  { key: 'log', label: 'Log', heading: 'Log', ph: 'What did you talk about?' },
  { key: 'remember', label: 'Remember', heading: 'Worth remembering', ph: 'Something worth remembering' },
  { key: 'gift', label: 'Gift idea', heading: 'Gift ideas', ph: 'A gift idea' },
  { key: 'ask', label: 'Ask next time', heading: 'Ask next time', ph: 'Ask about...' },
] as const;
const KINDS = ['call', 'text', 'video', 'met', 'event'];
const DATE_RE = /^(\d{4}-)?\d{1,2}-\d{1,2}$/;
const when = (days: number | null, what: string, n: number | null, unit: string) =>
  days === null ? '' : `${what} ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days'}${n ? ` (${n}${unit})` : ''}`;

export default function PersonProfile({ note, canWrite, resolve, onNav }: Props) {
  const p = useMemo(() => personOf(note, Date.now(), journal), [note]);
  const m = note.meta;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const save = async (kv: Record<string, string>, done: string) => {
    if (busy) return false;
    setBusy(true); setErr('');
    try {
      const r = await rawNote(note.id);
      if (r.status !== 200) throw new Error(r.json.error || 'could not read the note');
      const out = setFrontmatter(r.json.text, kv);
      if (out === null) throw new Error('the frontmatter of this note cannot be edited safely (a field written as a block list?)');
      if (out === r.json.text) { setMsg('Nothing changed'); return true; }
      const s = await saveNote(note.id, out, r.json.hash);
      if (s.status !== 200) throw new Error(s.json.error || 'save failed (HTTP ' + s.status + ')');
      setMsg(done + ', refreshing'); return true;   // the page reloads from the server's update a moment later
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  const add = async (heading: string, line: string, done: string) => {
    if (busy) return false;
    setBusy(true); setErr('');
    try {
      const r = await appendLine(note.vault, note.path, heading, line);
      if (r.status !== 200) throw new Error(r.json.error || 'could not save (HTTP ' + r.status + ')');
      setMsg(done + ', refreshing'); return true;
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };

  const ring = RINGS[p.circle - 1];
  const relLabel = RELATIONS.find(r => r.key === p.relation)!.label.replace(/s$/, '');
  const a = age(m.birthday || ''), ann = m.anniversary ? nextYearly(m.anniversary) : null;
  const linkOr = (v: string) => {
    const w = v.match(/^\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]$/);
    const t = w && resolve(note, w[1].trim());
    return t ? <button className="link" onClick={() => onNav(t.id)}>{w![2] || t.title}</button> : <>{v.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, x, y) => y || x)}</>;
  };
  const facts: [string, ReactNode][] = [];
  if (m.birthday) facts.push(['Birthday', <>{fmtDate(m.birthday)}{a !== null && <> · {a} years</>}{p.bdayIn !== null && p.bdayIn <= 60 && <small>{when(p.bdayIn, 'birthday', p.turns, '')}</small>}</>]);
  if (m.anniversary) facts.push(['Anniversary', <>{fmtDate(m.anniversary)}{ann && ann.days <= 60 && <small>{when(ann.days, 'anniversary', ann.count, ' years')}</small>}</>]);
  if (m.location) facts.push(['Lives in', m.location]);
  if (m.hometown) facts.push(['Hometown', m.hometown]);
  if (m.role || m.company) facts.push(['Work', [m.role, m.company].filter(Boolean).join(' at ')]);
  if (m.partner) facts.push(['Partner', linkOr(m.partner)]);
  if (m.kids) facts.push(['Kids', linkOr(m.kids)]);
  if (m.how_met || m.since) facts.push(['Known', [m.how_met, m.since && 'since ' + m.since].filter(Boolean).join(', ')]);
  if (m.interests) facts.push(['Interests', <span className="pp-tags">{m.interests.split(',').map(x => x.trim()).filter(Boolean).map(x => <em key={x}>{x}</em>)}</span>]);
  const logs = useMemo(() => logLines(note.body).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 3), [note]);
  const open = useMemo(() => asks(note.body), [note]);
  const remember = useMemo(() => datedItems(note.body, 'Worth remembering').slice(0, 3), [note]);
  const tel = m.phone?.replace(/[^\d+]/g, '');

  return (
    <section className={'pp rel-' + p.relation} aria-label="Profile">
      <div className="pp-head">
        <i className={'ci-sw rel-' + p.relation} />
        <span>{[p.relationship, relLabel.toLowerCase()].filter((x, i, l) => x && l.indexOf(x) === i).join(', ')}</span>
        <div className="pp-ring" role="group" aria-label="Circle" title="How close: sets the shell in Circles and how often to check in">
          {RINGS.map(r => <button key={r.n} className={r.n === p.circle ? 'on' : ''} disabled={!canWrite || busy} onClick={() => r.n !== p.circle && save({ circle: String(r.n) }, 'Moved to ' + r.label)} title={`${r.label}: every ${r.every} days`}>{r.label}</button>)}
        </div>
      </div>

      {(tel || m.email || m.linkedin || m.address) && <div className="pp-contact">
        {tel && <a className="btn" href={'tel:' + tel}>Call</a>}
        {tel && <a className="btn" href={'sms:' + tel}>Text</a>}
        {m.email && <a className="btn" href={'mailto:' + m.email}>Email</a>}
        {m.linkedin && /^https?:\/\//.test(m.linkedin) && <a className="btn" href={m.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
        {m.address && <button className="btn" onClick={() => navigator.clipboard.writeText(m.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })} title={m.address}>{copied ? 'Copied' : 'Copy address'}</button>}
        {m.phone && <span className="pp-dim">{m.phone}</span>}
      </div>}

      {facts.length > 0 ? <dl className="pp-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        : !editing && <p className="pp-dim">No profile details yet.{canWrite && <> <button className="link" onClick={() => setEditing(true)}>Add birthday, city, work...</button></>}</p>}

      <div className="pp-brief">
        <div className="label">Before you call</div>
        <p className={'pp-last ' + p.status}>Last contact {agoText(p.since)}{p.last && ` (${fmtDate(p.last)}${p.lastKind ? ', ' + p.lastKind : ''})`} · {ring.label.toLowerCase()}, {isFinite(p.every) ? `every ${p.every} days` : 'no check-in rhythm'}{p.status === 'overdue' && p.since !== null ? `, ${p.since - p.every} days late` : ''}</p>
        {open.length > 0 && <><h4>Ask about</h4><ul>{open.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
        {logs.length > 0 && <><h4>Recent</h4><ul>{logs.map((l, i) => <li key={i}><small>{fmtDate(l.date)}{l.kind && ', ' + l.kind}</small> {l.text}</li>)}</ul></>}
        {remember.length > 0 && <><h4>Worth remembering</h4><ul>{remember.map((l, i) => <li key={i}>{l.date && <small>{fmtDate(l.date)}</small>} {l.text}</li>)}</ul></>}
      </div>

      {canWrite && !editing && <QuickAdd busy={busy} onAdd={add} />}
      {canWrite && (editing ? <EditProfile note={note} busy={busy} onCancel={() => setEditing(false)} onSave={kv => save(kv, 'Profile saved')} />
        : <div className="pp-actions"><button className="link" onClick={() => setEditing(true)}>Edit profile</button></div>)}
      {msg && <p className="ci-done">{msg}</p>}
      {err && <p className="tv-err">{err}</p>}
    </section>
  );
}

function QuickAdd({ busy, onAdd }: { busy: boolean; onAdd: (heading: string, line: string, done: string) => Promise<boolean> }) {
  const [what, setWhat] = useState<typeof ADD[number]['key']>('log');
  const [kind, setKind] = useState('call');
  const [date, setDate] = useState(today());
  const [text, setText] = useState('');
  const cur = ADD.find(x => x.key === what)!;
  const go = async () => {
    const t = text.replace(/\s+/g, ' ').trim(); if (!t) return;
    const line = what === 'log' ? `- ${date} ${kind}: ${t}` : what === 'ask' ? `- [ ] ${t}` : `- ${date} ${t}`;
    if (await onAdd(cur.heading, line, cur.label === 'Log' ? 'Logged' : 'Added to ' + cur.heading)) setText('');
  };
  return (
    <form className="pp-add" onSubmit={e => { e.preventDefault(); go(); }}>
      <div className="seg" role="group" aria-label="Add">{ADD.map(x => <button type="button" key={x.key} className={what === x.key ? 'on' : ''} onClick={() => setWhat(x.key)}>{x.label}</button>)}</div>
      <div className="pp-add-row">
        {what === 'log' && <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">{KINDS.map(k => <option key={k}>{k}</option>)}</select>}
        {what !== 'ask' && <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value || today())} aria-label="Date" />}
        <input className="pp-text" value={text} onChange={e => setText(e.target.value)} placeholder={cur.ph} maxLength={400} aria-label={cur.ph} />
        <button type="submit" className="btn primary" disabled={!text.trim() || busy}>{busy ? 'Saving' : 'Add'}</button>
      </div>
    </form>
  );
}

function EditProfile({ note, busy, onCancel, onSave }: { note: Note; busy: boolean; onCancel: () => void; onSave: (kv: Record<string, string>) => Promise<boolean> }) {
  const m = note.meta;
  const init = () => Object.fromEntries([...PROFILE_FIELDS.map(f => [f.key, m[f.key] || '']), ['relation', m.relation || 'friend'], ['relationship', m.relationship || ''], ['summary', note.summary || '']]);
  const [v, setV] = useState<Record<string, string>>(init);
  const [bad, setBad] = useState('');
  const set = (k: string, x: string) => setV(o => ({ ...o, [k]: x }));
  const submit = async () => {
    for (const k of ['birthday', 'anniversary']) if (v[k].trim() && !DATE_RE.test(v[k].trim())) { setBad(`${k}: use YYYY-MM-DD, or MM-DD without the year`); return; }
    if (v.since.trim() && !/^\d{4}$/.test(v.since.trim())) { setBad('Known since: a year like 2010'); return; }
    setBad('');
    const before = init(), kv: Record<string, string> = {};
    for (const [k, x] of Object.entries(v)) {
      if (x.trim() === (before[k] || '').trim()) continue;
      const f = PROFILE_FIELDS.find(y => y.key === k);
      kv[k] = f?.kind === 'list' ? yamlList(x) : yamlValue(x);
    }
    if (!Object.keys(kv).length) { onCancel(); return; }
    if (await onSave(kv)) onCancel();
  };
  const groups: [string, string][] = [['basics', 'Basics'], ['work', 'Work'], ['contact', 'Contact'], ['family', 'Family and interests']];
  return (
    <form className="pp-edit" onSubmit={e => { e.preventDefault(); submit(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <div className="label">Edit profile</div>
      <RelationPicker value={v.relation as Relation} onChange={r => set('relation', r)} />
      <div className="pp-grid">
        <label>Relationship<input list="pp-rel-list" value={v.relationship} onChange={e => set('relationship', e.target.value)} placeholder={RELATIONSHIPS[v.relation]?.[0] || ''} /></label>
        <datalist id="pp-rel-list">{(RELATIONSHIPS[v.relation] || []).map(x => <option key={x} value={x} />)}</datalist>
        <label className="wide">One line about them<input value={v.summary} onChange={e => set('summary', e.target.value)} placeholder="Shown under the name and in search" /></label>
      </div>
      {groups.map(([g, title]) => <fieldset key={g}><legend>{title}</legend><div className="pp-grid">
        {PROFILE_FIELDS.filter(f => f.group === g).map(f => <label key={f.key} className={f.key === 'address' || f.key === 'interests' || f.key === 'kids' ? 'wide' : ''}>{f.label}
          {f.kind === 'date' ? <DateField value={v[f.key]} onChange={x => set(f.key, x)} /> : <input type={f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : f.kind === 'url' ? 'url' : 'text'} inputMode={f.kind === 'number' ? 'numeric' : undefined} value={v[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.hint || ''} />}</label>)}
      </div></fieldset>)}
      {bad && <p className="tv-err">{bad}</p>}
      <div className="pp-actions"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving' : 'Save profile'}</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export function RelationPicker({ value, onChange }: { value: Relation; onChange: (r: Relation) => void }) {
  return (
    <div className="pp-rel" role="radiogroup" aria-label="Who they are">
      {RELATIONS.map(r => <button type="button" key={r.key} role="radio" aria-checked={value === r.key} className={'rel-' + r.key + (value === r.key ? ' on' : '')} onClick={() => onChange(r.key)}>
        <i className={'ci-sw rel-' + r.key} />{r.label.replace(/s$/, '')}</button>)}
    </div>
  );
}

// calendar picker for a yearly date; "Year unknown" stores MM-DD (the picker still needs a year, 2000 is used while it is ticked)
export function DateField({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const noYear = /^\d{1,2}-\d{1,2}$/.test(value.trim());
  const pad = (x: string) => x.padStart(2, '0');
  const iso = (() => { const m = value.trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/); return m ? `${m[1] || '2000'}-${pad(m[2])}-${pad(m[3])}` : ''; })();
  return (
    <span className="date-field">
      <input type="date" className={className} value={iso} onChange={e => { const x = e.target.value; onChange(!x ? '' : noYear ? x.slice(5) : x); }} />
      <label className="date-noyear"><input type="checkbox" checked={noYear} disabled={!iso} onChange={e => onChange(e.target.checked ? iso.slice(5) : iso)} />Year unknown</label>
      {iso && <small>{fmtDate(value)}</small>}
    </span>
  );
}
