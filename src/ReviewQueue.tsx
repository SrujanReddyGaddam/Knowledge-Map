import { useMemo, useState } from 'react';
import type { Note } from 'virtual:vault';
import { rawNote, saveNote } from './api';
import { shortTitle } from './util';
import { isoDay } from './taskScan';
import { reviewQueue, reviewedAt, setFrontmatter, snooze } from './review';

// "Still true?": a few evergreen notes that nobody has looked at for the longest time. Still true writes reviewed: <today>
// (and sets a stale or needs-verification note back to current), Needs update sets status: needs-verification, Later hides it for 14 days.
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 864e5); return d < 60 ? d + ' days' : d < 365 ? Math.round(d / 30) + ' months' : Math.round(d / 365) + ' years'; };

export default function ReviewQueue({ notes, lintVaults, canWrite, onSelect }: { notes: Note[]; lintVaults: string[]; canWrite: boolean; onSelect: (id: string) => void }) {
  const [gone, setGone] = useState<Map<string, string>>(() => new Map());   // id -> what happened
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  const list = useMemo(() => reviewQueue(notes, lintVaults), [notes, lintVaults, n]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  const write = async (note: Note, kv: Record<string, string>, what: string) => {
    setErr(''); setBusy(note.id);
    try {
      const r = await rawNote(note.id);
      if (r.status !== 200) throw new Error(r.json.error || 'could not read the note');
      const text = setFrontmatter(r.json.text, kv);
      if (text === null) throw new Error('its frontmatter could not be updated safely, edit it by hand');
      const s = await saveNote(note.id, text, r.json.hash);
      if (s.status !== 200) throw new Error(s.json.error || 'save failed (HTTP ' + s.status + ')');
      setGone(g => new Map(g).set(note.id, what));
    } catch (e) { setErr(`${shortTitle(note.title)}: ${(e as Error).message}`); }
    finally { setBusy(''); }
  };
  return (
    <section className="pv-sec rq">
      <div className="pv-sec-head"><h2>Still true?</h2><small>{list.length}</small></div>
      <p className="rq-lead">Evergreen notes nobody has looked at for a while. A quick yes keeps the map honest.</p>
      {err && <div className="tv-err">{err}</div>}
      <ul className="rq-list">{list.map(x => {
        const what = gone.get(x.id), stuck = x.status === 'stale' || x.status === 'needs-verification';
        return <li key={x.id} className={what ? 'done' : ''}>
          <button className="rq-open" onClick={() => onSelect(x.id)}><b>{shortTitle(x.title)}</b><span>{x.summary}</span><small>{x.type || 'note'} · last looked at {ago(reviewedAt(x))} ago{stuck ? ' · ' + x.status.replace(/-/g, ' ') : ''}</small></button>
          {what ? <em>{what}</em> : <span className="rq-acts">
            {canWrite && <button className="btn" disabled={busy === x.id} onClick={() => write(x, { reviewed: isoDay(new Date()), ...(stuck ? { status: 'current' } : {}) }, 'marked reviewed')}>Still true</button>}
            {canWrite && x.status !== 'needs-verification' && <button className="btn" disabled={busy === x.id} onClick={() => write(x, { status: 'needs-verification' }, 'flagged for update')}>Needs update</button>}
            <button className="btn" onClick={() => { snooze(x.id); setGone(g => new Map(g).set(x.id, 'later')); setTimeout(() => setN(v => v + 1), 900); }}>Later</button>
          </span>}
        </li>;
      })}</ul>
    </section>
  );
}
