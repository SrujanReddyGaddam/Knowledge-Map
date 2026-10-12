import { useState } from 'react';
import { capture, dailyVault } from './journal';

// Quick capture (key c, or the app shortcut ?capture=1): type, Enter, done. The note lands in inbox/ and gets a line in today's journal.
// Enter saves, Shift+Enter starts a new line; the first line becomes the title.
type Props = { vaults: string[]; onClose: () => void; onDone: (vault: string, path: string) => void };

export default function Capture({ vaults, onClose, onDone }: Props) {
  const [text, setText] = useState(() => { try { return sessionStorage.getItem('kmCapture') || ''; } catch { return ''; } });
  const [vault, setVault] = useState(dailyVault());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const keep = (t: string) => { setText(t); try { sessionStorage.setItem('kmCapture', t); } catch {} };
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await capture(text, vault);
      try { sessionStorage.removeItem('kmCapture'); } catch {}
      onDone(r.vault, r.path);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="newnote rename capture" role="dialog" aria-label="Quick capture" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="ed-title">Quick capture<small>inbox/ · linked from today's journal</small></div>
        <textarea className="rn-input cap-text" autoFocus value={text} onChange={e => keep(e.target.value)} rows={4} placeholder={'What is on your mind?\nFirst line = title. Enter saves, Shift+Enter for a new line.'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } }} />
        {err && <div className="ed-err">{err}</div>}
        <div className="rn-actions">
          <button className="btn primary" onClick={save} disabled={!text.trim() || busy}>{busy ? 'Saving...' : 'Capture'}</button>
          <button className="btn" onClick={onClose}>Cancel</button>
          {vaults.length > 1 && <select className="cap-vault" value={vault} onChange={e => setVault(e.target.value)} aria-label="Vault">{vaults.map(v => <option key={v}>{v}</option>)}</select>}
        </div>
      </div>
    </div>
  );
}
