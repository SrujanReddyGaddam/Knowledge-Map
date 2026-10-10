import { useEffect, useMemo, useState } from 'react';
import { historyOf, rawNote, saveNote, versionOf, type Version } from './api';
import { lineDiff } from './diff';
import type { Note } from 'virtual:vault';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const kb = (n: number) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
const lf = (t: string) => t.replace(/\r\n/g, '\n');

type Props = { note: Note; onClose: () => void; onRestored: (mtime: number) => void };

// Saved versions of a note: pick one to see what differs from the file on disk now, and restore it.
// Restoring is an ordinary save, so the server backs up the current text first and nothing is ever lost.
export default function History({ note, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [cur, setCur] = useState<{ text: string; hash: string } | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    historyOf(note.id).then(r => { if (!live) return; if (r.status === 200) setVersions(r.json.versions); else setErr(r.json.error || 'HTTP ' + r.status); }).catch(e => live && setErr(String(e)));
    return () => { live = false; };
  }, [note.id]);

  const pick = async (name: string) => {
    setSel(name); setVer(null); setErr('');
    const [a, b] = await Promise.all([rawNote(note.id), versionOf(note.id, name)]);
    if (a.status !== 200 || b.status !== 200) { setErr((a.status !== 200 ? a : b).json.error || 'could not load'); return; }
    setCur({ text: a.json.text, hash: a.json.hash }); setVer(b.json.text);
  };

  const diff = useMemo(() => (cur && ver != null ? lineDiff(lf(ver), lf(cur.text)) : null), [cur, ver]);
  const rows = useMemo(() => {
    if (!diff) return null;
    // show changed lines with 2 lines of context, fold the rest
    const keep = new Set<number>(); diff.forEach((l, i) => { if (l.t !== 'same') for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
    const out: ({ gap: number } | { t: string; s: string })[] = []; let gap = 0;
    diff.forEach((l, i) => { if (keep.has(i)) { if (gap) { out.push({ gap }); gap = 0; } out.push(l); } else gap++; });
    if (gap) out.push({ gap });
    return out;
  }, [diff]);
  const added = diff?.filter(l => l.t === 'add').length ?? 0, removed = diff?.filter(l => l.t === 'del').length ?? 0;
  const same = ver != null && cur != null && lf(ver) === lf(cur.text);

  const restore = async () => {
    if (ver == null || !cur || !confirm('Restore this version? The current text is backed up first, so you can undo this from History.')) return;
    setBusy(true); setErr('');
    const r = await saveNote(note.id, ver, cur.hash);
    if (r.status === 200) { setDone(true); onRestored(Math.round(r.json.mtime)); }
    else setErr(r.status === 409 ? 'The file changed on disk while you were looking. Reopen History and try again.' : (r.json.error || 'HTTP ' + r.status));
    setBusy(false);
  };

  return (
    <div className="hist">
      <div className="ed-bar">
        <span className="ed-status">History, newest first</span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Back</button>
      </div>
      {err && <div className="ed-err">{err}</div>}
      {done && <div className="hist-done">Restored. The page refreshes in a moment.</div>}
      {versions === null && !err && <div className="ed-msg">Loading...</div>}
      {versions && versions.length === 0 && <div className="ed-msg">No saved versions yet. A version is kept each time you save an edit.</div>}
      {versions && versions.length > 0 && (
        <div className="hist-list">
          {versions.map(v => (
            <button key={v.name} className={'hist-row' + (v.name === sel ? ' cur' : '')} onClick={() => pick(v.name)}>
              <span>{fmt(v.time)}</span><small>{kb(v.size)}</small>
            </button>
          ))}
        </div>
      )}
      {sel && ver != null && cur && (
        <div className="hist-view">
          <div className="hist-head">
            {same ? <span>Same as the current version.</span> : diff ? <span>Compared with now: <b className="add">+{added}</b> <b className="del">&minus;{removed}</b> lines (green = in the current file, red = only in this version)</span> : <span>Too large to compare line by line.</span>}
            <button className="btn primary" disabled={busy || done || same} onClick={restore}>Restore this version</button>
          </div>
          {rows && !same && <pre className="diff">{rows.map((r, i) => 'gap' in r ? <div key={i} className="gap">... {r.gap} unchanged lines ...</div> : <div key={i} className={r.t}>{r.t === 'add' ? '+ ' : r.t === 'del' ? '- ' : '  '}{r.s}</div>)}</pre>}
          {!diff && !same && <pre className="diff">{ver}</pre>}
        </div>
      )}
    </div>
  );
}
