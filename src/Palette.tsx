import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from 'virtual:vault';
import { shortTitle } from './util';

// Command palette (Cmd+K): every action plus note names. Arrows move, Enter runs, Esc closes.
export type Action = { id: string; label: string; hint?: string; keys?: string; run: () => void };
type Props = { actions: Action[]; findNotes: (q: string) => Note[]; onOpen: (id: string) => void; onClose: () => void; placeholder?: string; initial?: string };

const score = (q: string, t: string) => {
  const s = t.toLowerCase();
  if (!q) return 1;
  if (s.startsWith(q)) return 100;
  if (s.split(/\s+/).some(w => w.startsWith(q))) return 80;
  if (s.includes(q)) return 60;
  let i = 0; for (const c of s) if (c === q[i] && ++i === q.length) return 20;
  return 0;
};

export default function Palette({ actions, findNotes, onOpen, onClose, placeholder, initial }: Props) {
  const [q, setQ] = useState(initial ?? '');
  const [cur, setCur] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const acts = actions.map(a => ({ a, s: Math.max(score(ql, a.label), a.hint ? score(ql, a.hint) * 0.5 : 0) })).filter(x => x.s > 0).sort((x, y) => y.s - x.s).slice(0, ql ? 8 : 40)
      .map(x => ({ key: 'a:' + x.a.id, label: x.a.label, sub: x.a.hint || '', keys: x.a.keys, run: x.a.run }));
    const notes = ql ? findNotes(q).slice(0, 10).map(n => ({ key: 'n:' + n.id, label: shortTitle(n.title), sub: n.section.replace(/-/g, ' '), keys: undefined as string | undefined, run: () => onOpen(n.id) })) : [];
    return [...acts, ...notes];
  }, [q, actions, findNotes, onOpen]);
  useEffect(() => setCur(0), [q]);
  useEffect(() => { listRef.current?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }); }, [cur]);
  const go = (i: number) => { const it = items[i]; if (!it) return; onClose(); setTimeout(it.run, 0); };
  const firstNote = items.findIndex(i => i.key.startsWith('n:'));
  return (
    <div className="modal-back pal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder ?? "Type a command or a note name"} spellCheck={false} aria-label="Command"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setCur(c => Math.min(items.length - 1, c + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCur(c => Math.max(0, c - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(cur); }
          }} />
        <div className="pal-list" ref={listRef}>
          {items.map((it, i) => <div key={it.key}>
            {i === 0 && !it.key.startsWith('n:') && <div className="pal-group">Actions</div>}
            {i === firstNote && <div className="pal-group">Notes</div>}
            <button className={i === cur ? 'cur' : ''} onMouseEnter={() => setCur(i)} onClick={() => go(i)}>
              <span>{it.label}{it.sub && <small>{it.sub}</small>}</span>{it.keys && <kbd>{it.keys}</kbd>}
            </button>
          </div>)}
          {!items.length && <div className="pal-empty">{q.trim() || actions.length ? 'Nothing matches.' : 'Type a note name.'}</div>}
        </div>
      </div>
    </div>
  );
}
