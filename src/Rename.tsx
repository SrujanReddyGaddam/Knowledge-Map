import { useEffect, useState } from 'react';
import { planRename, renameNote, type RenamePlan } from './api';
import type { Note } from 'virtual:vault';

type Props = { note: Note; onClose: () => void };

// Rename or move a note inside its vault. The preview is a dry run on the server; Apply sends back the exact plan it showed,
// so if any note changed in between the server refuses and shows a fresh preview.
export default function Rename({ note, onClose }: Props) {
  const [to, setTo] = useState(note.path.replace(/\.md$/i, ''));
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [done, setDone] = useState(false);
  const same = to.trim() === note.path.replace(/\.md$/i, '');

  useEffect(() => {
    setPlan(null); setErr(''); setAck(false);
    if (same || !to.trim()) return;
    let live = true;
    const t = setTimeout(() => {
      planRename(note.id, to).then(r => { if (!live) return; if (r.status === 200) setPlan(r.json); else setErr(r.json.error || 'HTTP ' + r.status); }).catch(e => live && setErr(String(e)));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [to, note.id, same]);

  const apply = async () => {
    if (!plan || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await renameNote(note.id, to, plan.planHash, ack);
      if (r.status === 200) {
        setDone(true);
        if (r.json.newId) history.replaceState(null, '', '#' + encodeURIComponent(r.json.newId));
        setTimeout(() => location.reload(), 2500);   // the server also reloads the page when it sees the files move
      } else { setErr(r.json.message || r.json.error || 'HTTP ' + r.status); if (r.json.plan) setPlan(r.json.plan); setAck(false); }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  };

  if (done) return <div className="ed-msg">Renamed. Reloading the map...</div>;
  const blocked = !!plan && plan.blocked.length > 0, needAck = !!plan && plan.readOnly.length > 0;
  return (
    <div className="rename">
      <label className="rn-label" htmlFor="rn-to">New name or path in this vault (use / for folders, .md is added for you)</label>
      <input id="rn-to" className="rn-input" value={to} autoFocus spellCheck={false} onChange={e => setTo(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } else if (e.key === 'Enter' && plan && !blocked && (!needAck || ack)) apply(); }} />
      {err && <div className="ed-err" role="alert">{err}</div>}
      {plan && (
        <div className="rn-plan">
          <div><b>{plan.from}</b> &rarr; <b>{plan.to}</b></div>
          {plan.links === 0 ? <p>No links need updating.</p> : (
            <>
              <p>{plan.links} link{plan.links === 1 ? '' : 's'} will be updated{plan.updates.length ? ` in ${plan.updates.length} other note${plan.updates.length === 1 ? '' : 's'}` : ''}{plan.selfCount ? (plan.updates.length ? ', and' : ' inside') + ' this note' : ''}:</p>
              {plan.updates.length > 0 && <ul>{plan.updates.map(u => <li key={u.id}>{u.title} <small>{u.count}</small></li>)}</ul>}
            </>
          )}
          <p className="rn-note">Each changed note is backed up first (see History). Links inside code blocks are left alone.</p>
          {plan.extraRefs > 0 && <p className="rn-warn">{plan.extraRefs} relative reference{plan.extraRefs === 1 ? '' : 's'} in this note (images or other files) are not rewritten and may break after moving to another folder.</p>}
          {needAck && (
            <div className="rn-warn">
              <p>These notes are in read-only vaults and link here. They will not be updated, so those links will break:</p>
              <ul>{plan.readOnly.map(u => <li key={u.id}>{u.title} <small>{u.vault} &middot; {u.count}</small></li>)}</ul>
              <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> Rename anyway</label>
            </div>
          )}
          {blocked && <div className="rn-warn"><p>Cannot rename safely:</p><ul>{plan.blocked.map(b => <li key={b}>{b}</li>)}</ul></div>}
        </div>
      )}
      <div className="rn-actions">
        <button className="btn primary" disabled={!plan || busy || blocked || (needAck && !ack)} onClick={apply}>{busy ? 'Renaming...' : 'Rename'}</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
