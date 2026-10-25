import { useEffect, useMemo, useState } from 'react';
import { listTemplates, createNote } from './api';
import type { Note } from 'virtual:vault';

type Tpl = { name: string; text: string };
type Props = { vaults: string[]; current: Note | null; onClose: () => void; onPerson?: (title: string) => void };

// Template hints live in the template's frontmatter and are removed from the new note:
//   km_folder: knowledge/uipath   (default folder)     km_dated: true   (file name starts with the date)
// Placeholders: {{title}} {{date}}
// "Person" (when people can be added) hands the title over to the Add person form, which writes a full profile
const PERSON = 'Person (profile form)';
const BLANK: Tpl = { name: 'Blank', text: '---\ntitle: {{title}}\ntype: \nsummary: \nsensitivity: \ntags: []\n---\n\n' };
const hint = (t: string, k: string) => t.match(new RegExp(`^km_${k}:\\s*(.*)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// inside frontmatter the title is quoted when YAML needs it ("DeepRAG: output shape"); in the body it stays as typed
const yamlStr = (s: string) => (/^[\w(][^:#\[\]{}"'`|>&*!%@,]*$/.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s));
export const fill = (t: string, title: string) => {
  const one = title.replace(/\s*\n\s*/g, ' ');
  const end = t.startsWith('---\n') ? t.indexOf('\n---', 4) : -1;
  const sub = (x: string, ttl: string) => x.replace(/\{\{title\}\}/g, ttl).replace(/\{\{date\}\}/g, today());
  return end > 0 ? sub(t.slice(0, end).replace(/^km_\w+:.*\n?/gm, '').replace(/\n+$/, ''), yamlStr(one)) + sub(t.slice(end), one) : sub(t, one);
};

export default function NewNote({ vaults, current, onClose, onPerson }: Props) {
  const [vault, setVault] = useState(current && vaults.includes(current.vault) ? current.vault : vaults[0]);
  const [tpls, setTpls] = useState<Tpl[]>([BLANK]);
  const [tpl, setTpl] = useState('Blank');
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [folderTouched, setFolderTouched] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    listTemplates(vault).then(r => { if (live) { setTpls([BLANK, ...(r.status === 200 ? r.json.templates : [])]); if (r.status !== 200) setErr(r.json.error || 'HTTP ' + r.status); } }).catch(e => live && setErr(String(e)));
    return () => { live = false; };
  }, [vault]);
  const t = tpls.find(x => x.name === tpl) ?? BLANK;
  // folder: the template's hint, else the folder of the open note (same vault)
  useEffect(() => {
    if (folderTouched) return;
    const h = hint(t.text, 'folder');
    setFolder(h || (current && current.vault === vault ? current.path.split('/').slice(0, -1).join('/') : ''));
  }, [t, vault, current, folderTouched]);
  const name = useMemo(() => { const s = slug(title); return s ? (hint(t.text, 'dated') === 'true' ? today() + '-' : '') + s : ''; }, [title, t]);
  const rel = [folder.trim().replace(/^\/+|\/+$/g, ''), name].filter(Boolean).join('/');

  const create = async () => {
    if (!name || busy) return;
    setBusy(true); setErr('');
    // the server reloads the page as soon as it sees the new file, possibly before this request returns,
    // so record what to open first; App opens it in the editor after the reload
    sessionStorage.setItem('kmOpen', JSON.stringify({ vault, path: rel + '.md' }));
    try {
      const r = await createNote(vault, rel, fill(t.text, title.trim()));
      if (r.status === 200) { setTimeout(() => location.reload(), 2500); return; }
      setErr(r.json.error || 'HTTP ' + r.status);
    } catch (e) { setErr(String(e)); }
    sessionStorage.removeItem('kmOpen');
    setBusy(false);
  };

  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="newnote rename" role="dialog" aria-label="New note" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ed-title">New note</div>
        {vaults.length > 1 && <label className="rn-label">Vault
          <select className="rn-input" value={vault} onChange={e => { setVault(e.target.value); setTpl('Blank'); }}>{vaults.map(v => <option key={v}>{v}</option>)}</select></label>}
        <label className="rn-label">Template
          <select className="rn-input" value={tpl} onChange={e => { if (e.target.value === PERSON && onPerson) onPerson(title.trim()); else setTpl(e.target.value); }}>{tpls.map(x => <option key={x.name}>{x.name}</option>)}{onPerson && <option>{PERSON}</option>}</select></label>
        <label className="rn-label">Title
          <input className="rn-input" autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} placeholder="What is this note about?" /></label>
        <label className="rn-label">Folder
          <input className="rn-input" value={folder} onChange={e => { setFolder(e.target.value); setFolderTouched(true); }} placeholder="(vault root)" spellCheck={false} /></label>
        <div className="rn-note">File: <code>{rel ? rel + '.md' : '...'}</code></div>
        {err && <div className="ed-err">{err}</div>}
        <div className="rn-actions">
          <button className="btn primary" onClick={create} disabled={!name || busy}>{busy ? 'Creating...' : 'Create and edit'}</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
