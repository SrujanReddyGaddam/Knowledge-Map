import { useMemo, useState } from 'react';
import vault from './data';
import { createNote, reloadHold } from './api';
import { RINGS, RELATIONS, isPerson, type Relation } from './circlesData';
import { parseVcards, slugify, type Contact } from './people';
import { RelationPicker } from './PersonProfile';
import { peopleVault, personText, CIRCLE_FOR } from './AddPerson';

// Import contacts (palette, Circles, Add person): read a .vcf export in the browser, pick who to add, and create one
// people/<name>.md profile each through /api/create (the same path as Add person). The file itself is never uploaded or kept.
// People already in the vault (same name) start unticked. Own writes hold the page reload until the last note is written.
type Props = { onClose: () => void };
type Row = Contact & { key: number; on: boolean; dup: boolean; relation: Relation };
const MAX = 500;

export default function ImportContacts({ onClose }: Props) {
  const target = useMemo(peopleVault, []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [relation, setRelation] = useState<Relation>('acquaintance');
  const [circle, setCircle] = useState('');   // '' = by each person's relation (family and friends Close, colleagues Regular, others Wider)
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [errs, setErrs] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const known = useMemo(() => new Set(vault.notes.filter(isPerson).map(n => n.title.trim().toLowerCase())), []);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    if (f.size > 20 * 1024 * 1024) { setErr('That file is over 20 MB. Export fewer contacts, or without photos.'); return; }
    const cs = parseVcards(await f.text());
    if (!cs.length) { setErr('No contacts found. Pick a .vcf (vCard) file.'); return; }
    if (cs.length > MAX) setErr(`The file has ${cs.length} contacts; the first ${MAX} are shown. Import those, then the rest from a smaller export.`);
    setRows(cs.slice(0, MAX).sort((a, b) => a.name.localeCompare(b.name)).map((c, i) => { const dup = known.has(c.name.trim().toLowerCase()); return { ...c, key: i, on: !dup, dup, relation }; }));
  };
  const setAllRel = (r: Relation) => { setRelation(r); setRows(rs => rs && rs.map(x => ({ ...x, relation: r }))); };
  const edit = (key: number, o: Partial<Row>) => setRows(rs => rs && rs.map(x => (x.key === key ? { ...x, ...o } : x)));
  const qq = q.trim().toLowerCase();
  const shown = (rows || []).filter(r => !qq || (r.name + ' ' + r.company + ' ' + r.location).toLowerCase().includes(qq));
  const picked = (rows || []).filter(r => r.on);

  const run = async () => {
    if (!picked.length || busy) return;
    setBusy(true); setErrs([]); setDone(0);
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // the server refuses a file name that exists anywhere in the vault, so names already used there or earlier in this batch get -2, -3...
    const taken = new Set(vault.notes.filter(n => n.vault === target).map(n => n.path.split('/').pop()!.replace(/\.md$/, '')));
    const bad: string[] = [];
    let ok = 0;
    reloadHold.n++;
    try {
      for (const r of picked) {
        const base = slugify(r.name) || 'person';
        let file = base;
        for (let i = 2; taken.has(file); i++) file = `${base}-${i}`;
        taken.add(file);
        try {
          const res = await createNote(target, `people/${file}`, personText({ name: r.name.trim(), relation: r.relation, relationship: '', circle: circle || String(CIRCLE_FOR[r.relation]), birthday: r.birthday, location: r.location, address: r.address, company: r.company, role: r.role, phone: r.phone, email: r.email, how_met: '', summary: '', about: r.about, first: '' }, today));
          if (res.status === 200) ok++; else bad.push(`${r.name}: ${res.json.error || 'HTTP ' + res.status}`);
        } catch (e) { bad.push(`${r.name}: ${String(e)}`); }
        setDone(d => d + 1);
      }
    } finally { reloadHold.n--; }
    setErrs(bad);
    if (ok) {
      try { localStorage.setItem('view', 'circles'); } catch {}
      setTimeout(() => location.reload(), bad.length ? 4000 : 900);
    } else setBusy(false);
  };

  if (!target) return null;
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="newnote rename ap ic" role="dialog" aria-label="Import contacts" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); } }}>
        <div className="ed-title">Import contacts<small>{target} / people</small></div>
        {!rows && <>
          <p className="rn-note">Pick a vCard file (<code>.vcf</code>). It is read here in the browser; only the people you tick become notes.</p>
          <label className="btn primary ic-file">Choose a .vcf file<input type="file" accept=".vcf,text/vcard,text/x-vcard" onChange={e => read(e.target.files?.[0])} /></label>
          <ul className="ic-help">
            <li><b>Mac or iPhone Contacts:</b> select people (or a list), then File, Export, Export vCard.</li>
            <li><b>Google Contacts:</b> select people, then Export, vCard.</li>
            <li><b>Outlook:</b> open a contact, then File, Save As, vCard.</li>
          </ul>
        </>}
        {rows && <>
          <div className="rn-label">Who they are (for everyone, change per person below)<RelationPicker value={relation} onChange={setAllRel} /></div>
          <div className="rn-label">How close {!circle && <small className="ic-dim">by who they are; pick one to use it for everyone</small>}
            <div className="ap-circles">{RINGS.map(r => <button type="button" key={r.n} className={circle === String(r.n) ? 'on' : ''} onClick={() => setCircle(c => (c === String(r.n) ? '' : String(r.n)))}><b>{r.n} {r.label}</b><small>check in every {r.every}d</small></button>)}</div></div>
          <div className="ic-bar">
            {rows.length > 12 && <input className="rn-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a contact" aria-label="Find a contact" />}
            <button type="button" className="link" onClick={() => setRows(rs => rs && rs.map(x => (shown.includes(x) ? { ...x, on: true } : x)))}>Tick all</button>
            <button type="button" className="link" onClick={() => setRows(rs => rs && rs.map(x => (shown.includes(x) ? { ...x, on: false } : x)))}>None</button>
          </div>
          <ul className="ic-list">{shown.map(r => (
            <li key={r.key} className={r.on ? 'on' : ''}>
              <label><input type="checkbox" checked={r.on} disabled={busy} onChange={e => edit(r.key, { on: e.target.checked })} />
                <b>{r.name}</b><span>{r.dup ? 'already in your people' : [r.company, r.location, r.birthday && 'birthday', r.phone && 'phone', r.email && 'email'].filter(Boolean).join(' · ')}</span></label>
              <select value={r.relation} disabled={busy} onChange={e => edit(r.key, { relation: e.target.value as Relation })} aria-label={'Who ' + r.name + ' is'}>
                {RELATIONS.map(x => <option key={x.key} value={x.key}>{x.label.replace(/s$/, '')}</option>)}</select>
            </li>))}
            {!shown.length && <li className="ci-none">Nobody matches.</li>}
          </ul>
        </>}
        {err && <div className="ed-err">{err}</div>}
        {busy && <div className="rn-note">{done < picked.length ? `Adding ${done + 1} of ${picked.length}...` : errs.length ? `Done, ${errs.length} not added. Refreshing in a moment.` : 'Done, refreshing.'}</div>}
        {errs.length > 0 && <ul className="ic-errs">{errs.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        <div className="rn-actions">
          {rows && <button type="button" className="btn primary" onClick={run} disabled={!picked.length || busy}>{busy ? 'Importing...' : `Add ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`}</button>}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
