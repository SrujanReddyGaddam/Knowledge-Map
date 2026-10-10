import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rawNote, saveNote } from './api';
import data, { type Note } from 'virtual:vault';

// [[ autocomplete: suggest notes by file name, then title, then path; same-vault notes first.
type Cand = { base: string; title: string; path: string; vault: string; };
const baseOf = (n: Note) => (n.path.split('/').pop() || '').replace(/\.md$/i, '');
const subseq = (q: string, t: string) => { let i = 0; for (const c of t) if (c === q[i] && ++i === q.length) return true; return q.length === 0; };
function suggest(cands: Cand[], q: string, vault: string): Cand[] {
  const ql = q.trim().toLowerCase(), out: { c: Cand; s: number }[] = [];
  for (const c of cands) {
    const b = c.base.toLowerCase(), t = c.title.toLowerCase();
    let s = 0;
    if (!ql) s = 1;
    else if (b === ql) s = 100;
    else if (b.startsWith(ql)) s = 80;
    else if (b.includes(ql)) s = 60;
    else if (t.includes(ql)) s = 50;
    else if (c.path.toLowerCase().includes(ql)) s = 30;
    else if (subseq(ql, b)) s = 15;
    if (s) out.push({ c, s: s + (c.vault === vault ? 5 : 0) });
  }
  return out.sort((a, b) => b.s - a.s || a.c.base.length - b.c.base.length || a.c.base.localeCompare(b.c.base)).slice(0, 8).map(x => x.c);
}


export type Draft = { id: string; text: string; baseHash: string; eol: 'lf' | 'crlf' };
const DRAFT = 'kmDraft';
export const readDraft = (): Draft | null => { try { const d = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); return d && typeof d.id === 'string' && typeof d.text === 'string' ? d : null; } catch { return null; } };
export const clearDraft = () => { try { sessionStorage.removeItem(DRAFT); } catch {} };
const writeDraft = (d: Draft) => { try { sessionStorage.setItem(DRAFT, JSON.stringify(d)); } catch {} };

// Text boxes silently turn CRLF into LF. Detect the file's style, edit as LF, and convert back on save so line endings never change.
const eolOf = (t: string): 'lf' | 'crlf' | 'mixed' => {
  const crlf = (t.match(/\r\n/g) || []).length, lf = (t.match(/\n/g) || []).length;
  if (/\r(?!\n)/.test(t) || (crlf && crlf !== lf)) return 'mixed';
  return crlf ? 'crlf' : 'lf';
};
const toUi = (t: string) => t.replace(/\r\n/g, '\n');

type Props = { note: Note; draft: Draft | null; onEnd: (saved: boolean) => void; onSaved: (mtime: number) => void; onDirty: (d: boolean) => void };

export default function Editor({ note, draft, onEnd, onSaved, onDirty }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'blocked'>('loading');
  const [msg, setMsg] = useState('');
  const [base, setBase] = useState({ text: '', hash: '' });
  const [text, setText] = useState('');
  const [eol, setEol] = useState<'lf' | 'crlf'>('lf');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ text: string; hash: string } | null>(null);
  const [showTheirs, setShowTheirs] = useState(false);
  const everSaved = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const cands = useMemo<Cand[]>(() => data.notes.filter(n => n.kind !== 'drawing').map(n => ({ base: baseOf(n), title: n.title, path: n.path, vault: n.vault })), []);
  const [ac, setAc] = useState<{ start: number; q: string } | null>(null);   // start = index right after "[["
  const [pick, setPick] = useState(0);
  const caret = useRef<number | null>(null);
  const dismissed = useRef(-1);   // Esc hides the list for this [[ until the user leaves it
  const items = useMemo(() => (ac ? suggest(cands, ac.q, note.vault) : []), [ac, cands, note.vault]);
  useLayoutEffect(() => { if (caret.current != null && area.current) { area.current.setSelectionRange(caret.current, caret.current); caret.current = null; } });
  const refresh = (el: HTMLTextAreaElement) => {
    const pos = el.selectionStart;
    if (el.selectionEnd !== pos) { setAc(null); return; }
    const m = el.value.slice(0, pos).match(/\[\[([^\[\]\n|#]*)$/);
    if (!m) { dismissed.current = -1; setAc(null); return; }
    const start = pos - m[1].length;
    if (start === dismissed.current) return;
    setAc(a => { if (a && a.start === start && a.q === m[1]) return a; setPick(0); return { start, q: m[1] }; });
  };
  const accept = (c: Cand) => {
    const el = area.current; if (!el || !ac) return;
    const end = el.selectionStart, after = el.value.slice(end);
    const close = after.startsWith(']]') ? '' : ']]';
    const next = el.value.slice(0, ac.start) + c.base + close + after;
    caret.current = ac.start + c.base.length + 2; dismissed.current = -1;
    setText(next); setAc(null);
  };

  useEffect(() => {
    let live = true;
    rawNote(note.id).then(r => {
      if (!live) return;
      if (r.status !== 200) { setMsg(r.json.error || 'HTTP ' + r.status); setPhase('blocked'); return; }
      const e = eolOf(r.json.text);
      if (e === 'mixed') { setMsg('This file mixes line endings (CRLF and LF). Editing here would change them, so edit it in Obsidian.'); setPhase('blocked'); return; }
      const disk = toUi(r.json.text);
      setEol(e); setBase({ text: disk, hash: r.json.hash });
      if (draft && draft.id === note.id) {
        setText(draft.text);
        if (draft.baseHash !== r.json.hash) setConflict({ text: disk, hash: r.json.hash });   // file changed on disk since the draft started
      } else setText(disk);
      setPhase('ready'); setTimeout(() => area.current?.focus(), 30);
    }).catch(e => { if (live) { setMsg(String(e)); setPhase('blocked'); } });
    return () => { live = false; };
  }, [note.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = phase === 'ready' && (text !== base.text || !!conflict);
  useEffect(() => { onDirty(dirty); }, [dirty]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty(false), []);        // eslint-disable-line react-hooks/exhaustive-deps
  // keep a draft so an external reload or crash cannot lose typing
  useEffect(() => {
    if (phase !== 'ready') return;
    if (!dirty) { clearDraft(); return; }
    const t = setTimeout(() => writeDraft({ id: note.id, text, baseHash: base.hash, eol }), 300);
    return () => clearTimeout(t);
  }, [text, dirty, phase, base.hash, eol, note.id]);

  const save = useCallback(async (force = false, hash = base.hash) => {
    if (saving || phase !== 'ready') return;
    setSaving(true); setMsg('');
    try {
      const r = await saveNote(note.id, eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text, hash, force);
      if (r.status === 200) { setBase({ text, hash: r.json.hash }); setConflict(null); setShowTheirs(false); setSavedAt(Date.now()); everSaved.current = true; clearDraft(); onSaved(Math.round(r.json.mtime)); }
      else if (r.status === 409) setConflict({ text: toUi(r.json.text), hash: r.json.hash });
      else setMsg('Save failed: ' + (r.json.error || 'HTTP ' + r.status));
    } catch (e) { setMsg('Save failed: ' + String(e)); }
    setSaving(false);
  }, [saving, phase, base.hash, note.id, eol, text, onSaved]);

  const close = () => { if (dirty && !confirm('Discard your unsaved changes?')) return; clearDraft(); onEnd(everSaved.current); };

  const status = saving ? 'Saving...' : conflict ? 'File changed on disk' : dirty ? 'Unsaved changes' : savedAt ? 'Saved ' + new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  if (phase === 'loading') return <div className="ed-msg">Loading the file...</div>;
  if (phase === 'blocked') return <div className="ed-msg"><p>{msg}</p><button className="btn" onClick={() => onEnd(false)}>Back</button></div>;
  return (
    <div className="editor">
      <div className="ed-bar">
        <span className={'ed-status' + (dirty ? ' dirty' : '')}>{status}</span>
        <span className="ed-hint">{eol === 'crlf' ? 'CRLF file, kept as is. ' : ''}&#8984;S save &middot; Esc close &middot; [[ links</span>
        <button className="btn primary" disabled={!dirty || saving || !!conflict} onClick={() => save()}>Save</button>
        <button className="btn" onClick={close}>{everSaved.current && !dirty ? 'Done' : 'Cancel'}</button>
      </div>
      {conflict && (
        <div className="ed-conflict" role="alert">
          <b>This file changed on disk since you opened it</b> (Obsidian, iCloud or another editor). Nothing was overwritten.
          <div className="ed-conflict-actions">
            <button className="btn" onClick={() => setShowTheirs(v => !v)}>{showTheirs ? 'Hide' : 'View'} the version on disk</button>
            <button className="btn" onClick={() => navigator.clipboard.writeText(text)}>Copy mine</button>
            <button className="btn" onClick={() => { setText(conflict.text); setBase({ text: conflict.text, hash: conflict.hash }); setConflict(null); setShowTheirs(false); clearDraft(); }}>Load the disk version (drop mine)</button>
            <button className="btn danger solid" onClick={() => save(true, conflict.hash)}>Overwrite with mine</button>
          </div>
          {showTheirs && <textarea className="ed-theirs" readOnly value={conflict.text} spellCheck={false} />}
        </div>
      )}
      {msg && <div className="ed-err">{msg}</div>}
      <textarea ref={area} className="ed-area" value={text} spellCheck={false} onChange={e => { setText(e.target.value); refresh(e.target); }}
        onSelect={e => refresh(e.currentTarget)} onBlur={() => setAc(null)}
        onKeyDown={e => {
          if (ac && items.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setPick(p => (p + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setPick(p => (p + items.length - 1) % items.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(items[Math.min(pick, items.length - 1)]); return; }
          }
          if (ac && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissed.current = ac.start; setAc(null); return; }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty && !conflict) save(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }} />
      {ac && items.length > 0 && (
        <ul className="ed-ac" role="listbox" aria-label="Link suggestions">
          {items.map((c, i) => (
            <li key={c.vault + c.path} role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''} onMouseDown={e => { e.preventDefault(); accept(c); }} onMouseEnter={() => setPick(i)}>
              <b>{c.base}</b><small>{c.vault} / {c.path}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
