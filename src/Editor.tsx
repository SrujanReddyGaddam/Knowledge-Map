import { useCallback, useEffect, useRef, useState } from 'react';
import { rawNote, saveNote } from './api';
import RichText, { type Fmt, type RichHandle } from './RichText';
import type { Note } from 'virtual:vault';

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

const TOOLS: [Fmt, string, string][] = [['bold', 'B', 'Bold (\u2318B)'], ['italic', 'I', 'Italic (\u2318I)'], ['strike', 'S', 'Strikethrough'], ['code', '</>', 'Inline code'], ['h', 'H', 'Heading (click again for the next level)'], ['bullet', '\u2022', 'Bullet list'], ['number', '1.', 'Numbered list'], ['task', '\u2610', 'Task list'], ['quote', '\u201C', 'Quote'], ['link', '\u{1F517}', 'Link (\u2318K)'], ['wikilink', '[[ ]]', 'Link to a note']];

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
  const [rich, setRich] = useState(() => { try { return localStorage.getItem('editorMode') !== 'source'; } catch { return true; } });
  const rt = useRef<RichHandle>(null);
  const setMode = (r: boolean) => { setRich(r); try { localStorage.setItem('editorMode', r ? 'rich' : 'source'); } catch {} setTimeout(() => (r ? rt.current?.focus() : area.current?.focus()), 30); };

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
      setPhase('ready'); setTimeout(() => (rt.current ?? area.current)?.focus(), 60);
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
        <span className="ed-hint">{eol === 'crlf' ? 'CRLF file, kept as is. ' : ''}&#8984;S save &middot; Esc close</span>
        <button className="btn primary" disabled={!dirty || saving || !!conflict} onClick={() => save()}>Save</button>
        <button className="btn" onClick={close}>{everSaved.current && !dirty ? 'Done' : 'Cancel'}</button>
      </div>
      {rich && (
        <div className="ed-tools" role="toolbar" aria-label="Formatting">
          {TOOLS.map(([f, label, title]) => <button key={f} type="button" title={title} aria-label={title} onMouseDown={e => e.preventDefault()} onClick={() => rt.current?.format(f)}>{label}</button>)}
          <span className="ed-mode"><button type="button" className="on" onClick={() => setMode(false)} title="Edit the raw markdown text instead">Source mode</button></span>
        </div>
      )}
      {!rich && <div className="ed-tools"><span className="ed-mode"><button type="button" onClick={() => setMode(true)} title="Back to the rich editor">Rich editor</button></span></div>}
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
      {rich ? <RichText ref={rt} value={text} vault={note.vault} onChange={setText} onEsc={close} onSave={() => { if (dirty && !conflict) save(); }} />
        : <textarea ref={area} className="ed-area" value={text} spellCheck={false} onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty && !conflict) save(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          }} />}
    </div>
  );
}
