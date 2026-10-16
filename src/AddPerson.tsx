import { useMemo, useState } from 'react';
import vault from './data';
import { createNote } from './api';
import { RINGS, isPerson, type Relation } from './circlesData';
import { RELATIONSHIPS, slugify, yamlValue } from './people';
import { RelationPicker, DateField } from './PersonProfile';

// Add person (key a, Circles + button, palette): one short form that classifies the person (who they are, how close)
// and writes a full people/<name>.md profile in the vault that already holds people (else the first writable vault).
type Props = { onClose: () => void };

// the vault that holds most person notes among the writable ones, else one named Personal, else the first writable
export function peopleVault() {
  const w = vault.writableVaults, count = (v: string) => vault.notes.filter(n => n.vault === v && isPerson(n)).length;
  const best = [...w].sort((a, b) => count(b) - count(a))[0];
  return best && count(best) > 0 ? best : w.find(v => /personal/i.test(v)) || w[0] || '';
}
const CIRCLE_FOR: Record<Relation, number> = { family: 2, friend: 2, colleague: 3, 'ex-colleague': 4, acquaintance: 4 };
const DATE_RE = /^(\d{4}-)?\d{1,2}-\d{1,2}$/;

export function personText(f: Record<string, string>, today: string) {
  const y = (k: string) => yamlValue(f[k] || '');
  const about = (f.about || '').trim();
  return `---
title: ${yamlValue(f.name)}
type: person
summary: ${yamlValue(f.summary || `${f.name}, ${f.relationship || f.relation}.`)}
sensitivity: personal
tags: [people]
relation: ${f.relation}
relationship: ${y('relationship')}
circle: ${f.circle}
birthday: ${y('birthday')}
anniversary:
checkin_days:
location: ${y('location')}
hometown:
address:
company: ${y('company')}
role: ${y('role')}
phone: ${y('phone')}
email: ${y('email')}
linkedin:
partner:
kids:
how_met: ${y('how_met')}
since:
interests: []
status: current
---

## About
${about ? '\n' + about.replace(/\r/g, '') + '\n' : ''}
## Family

## Worth remembering

## Gift ideas

## Ask next time

## Log
${f.first ? `\n- ${today} ${f.firstKind || 'call'}: ${f.first.replace(/\s+/g, ' ').trim()}\n` : ''}`;
}

export default function AddPerson({ onClose }: Props) {
  const target = useMemo(peopleVault, []);
  const [f, setF] = useState<Record<string, string>>({ name: '', relation: 'friend', relationship: '', circle: '2', birthday: '', location: '', company: '', role: '', phone: '', email: '', how_met: '', summary: '', about: '', first: '', firstKind: 'call' });
  const [circleTouched, setCircleTouched] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF(o => ({ ...o, [k]: v }));
  const setRel = (r: Relation) => setF(o => ({ ...o, relation: r, circle: circleTouched ? o.circle : String(CIRCLE_FOR[r]), relationship: RELATIONSHIPS[o.relation]?.includes(o.relationship) ? '' : o.relationship }));
  // spouse, kids and parents start in the inner circle
  const setRelationship = (v: string) => setF(o => ({ ...o, relationship: v, circle: !circleTouched && /^(spouse|wife|husband|son|daughter|mother|father|mom|dad)$/i.test(v.trim()) ? '1' : o.circle }));
  const base = slugify(f.name);
  const taken = new Set(vault.notes.filter(n => n.vault === target).map(n => n.path.split('/').pop()!.replace(/\.md$/, '')));
  const file = base ? (taken.has(base) ? [2, 3, 4, 5, 6, 7, 8, 9].map(i => `${base}-${i}`).find(x => !taken.has(x)) || '' : base) : '';
  const dup = vault.notes.find(n => isPerson(n) && n.title.trim().toLowerCase() === f.name.trim().toLowerCase());

  const create = async () => {
    if (!f.name.trim() || !file || busy) return;
    if (f.birthday.trim() && !DATE_RE.test(f.birthday.trim())) { setErr('Birthday: YYYY-MM-DD, or MM-DD without the year'); return; }
    setBusy(true); setErr('');
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // the server reloads the page when it sees the new file; App opens the note (in view mode) after the reload
    try { sessionStorage.setItem('kmOpen', JSON.stringify({ vault: target, path: `people/${file}.md`, view: true })); } catch {}
    try {
      const r = await createNote(target, `people/${file}`, personText({ ...f, name: f.name.trim() }, today));
      if (r.status === 200) { setTimeout(() => location.reload(), 2500); return; }
      setErr(r.json.error || 'HTTP ' + r.status);
    } catch (e) { setErr(String(e)); }
    try { sessionStorage.removeItem('kmOpen'); } catch {}
    setBusy(false);
  };

  if (!target) return null;
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="newnote rename ap" role="dialog" aria-label="Add person" onSubmit={e => { e.preventDefault(); create(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ed-title">Add a person<small>{target} / people</small></div>
        <label className="rn-label">Name
          <input className="rn-input" autoFocus value={f.name} onChange={e => set('name', e.target.value)} placeholder="First name, or full name" /></label>
        {dup && <div className="rn-note">There is already a {dup.title} in your people. This adds another one.</div>}
        <div className="rn-label">Who they are<RelationPicker value={f.relation as Relation} onChange={setRel} /></div>
        <label className="rn-label">Relationship
          <input className="rn-input" list="ap-rel" value={f.relationship} onChange={e => setRelationship(e.target.value)} placeholder={RELATIONSHIPS[f.relation][0]} />
          <datalist id="ap-rel">{RELATIONSHIPS[f.relation].map(x => <option key={x} value={x} />)}</datalist></label>
        <div className="rn-label">How close
          <div className="ap-circles">{RINGS.map(r => <button type="button" key={r.n} className={f.circle === String(r.n) ? 'on' : ''} onClick={() => { set('circle', String(r.n)); setCircleTouched(true); }}><b>{r.n} {r.label}</b><small>check in every {r.every}d</small></button>)}</div></div>
        <div className="ap-two">
          <div className="rn-label">Birthday<DateField className="rn-input" value={f.birthday} onChange={v => set('birthday', v)} /></div>
          <label className="rn-label">Lives in<input className="rn-input" value={f.location} onChange={e => set('location', e.target.value)} placeholder="City, state" /></label>
        </div>
        {!more && <button type="button" className="link ap-more" onClick={() => setMore(true)}>More: work, phone, email, how you met, a first note</button>}
        {more && <>
          <div className="ap-two">
            <label className="rn-label">Company<input className="rn-input" value={f.company} onChange={e => set('company', e.target.value)} /></label>
            <label className="rn-label">Role<input className="rn-input" value={f.role} onChange={e => set('role', e.target.value)} /></label>
            <label className="rn-label">Phone<input className="rn-input" type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
            <label className="rn-label">Email<input className="rn-input" type="email" value={f.email} onChange={e => set('email', e.target.value)} /></label>
          </div>
          <label className="rn-label">How you met<input className="rn-input" value={f.how_met} onChange={e => set('how_met', e.target.value)} placeholder="college, work, neighbors..." /></label>
          <label className="rn-label">One line about them<input className="rn-input" value={f.summary} onChange={e => set('summary', e.target.value)} placeholder="Shown under the name and in search" /></label>
          <label className="rn-label">About<textarea className="rn-input" rows={3} value={f.about} onChange={e => set('about', e.target.value)} placeholder="Anything worth knowing" /></label>
          <label className="rn-label">Last contact today (optional)
            <span className="ap-row"><select className="rn-input" value={f.firstKind} onChange={e => set('firstKind', e.target.value)}>{['call', 'text', 'video', 'met'].map(k => <option key={k}>{k}</option>)}</select>
              <input className="rn-input" value={f.first} onChange={e => set('first', e.target.value)} placeholder="What did you talk about?" /></span></label>
        </>}
        <div className="rn-note">File: <code>{file ? `people/${file}.md` : '...'}</code> · edit everything later with Edit profile</div>
        {err && <div className="ed-err">{err}</div>}
        <div className="rn-actions">
          <button type="submit" className="btn primary" disabled={!f.name.trim() || !file || busy}>{busy ? 'Adding...' : 'Add person'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
