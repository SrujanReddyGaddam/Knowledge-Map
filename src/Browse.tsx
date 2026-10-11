import { useEffect, useMemo, useState } from 'react';
import type { Note } from 'virtual:vault';
import { shortTitle } from './util';

type Props = {
  top: number; notes: Note[]; byId: Map<string, Note>; brokenLinks: { from: string; target: string }[]; lint: Map<string, string[]>;
  changed: Set<string>; onMarkAllSeen: () => void; hl: boolean; onHl: (v: boolean) => void;
  selected: string | null; onSelect: (id: string) => void; onClose: () => void;
};
type Tab = 'new' | 'recent' | 'tree' | 'health';
type Dir = { name: string; key: string; dirs: Map<string, Dir>; notes: Note[]; count: number };

const ago = (ms: number) => {
  const m = (Date.now() - ms) / 60000;
  if (m < 1) return 'just now'; if (m < 60) return Math.round(m) + 'm ago'; if (m < 1440) return Math.round(m / 60) + 'h ago';
  const d = Math.round(m / 1440); if (d < 30) return d + 'd ago'; if (d < 365) return Math.round(d / 30) + 'mo ago'; return Math.round(d / 365) + 'y ago';
};
const group = (ms: number) => {
  const startToday = new Date().setHours(0, 0, 0, 0), day = 86400000;
  if (ms >= startToday) return 'Today'; if (ms >= startToday - day) return 'Yesterday'; if (ms >= startToday - 6 * day) return 'This week';
  if (ms >= startToday - 30 * day) return 'This month'; return 'Earlier';
};

function buildTree(notes: Note[]) {
  const roots = new Map<string, Dir>();
  const mk = (name: string, key: string): Dir => ({ name, key, dirs: new Map(), notes: [], count: 0 });
  for (const n of notes) {
    if (!roots.has(n.vault)) roots.set(n.vault, mk(n.vault, n.vault));
    let d = roots.get(n.vault)!; d.count++;
    const parts = n.path.split('/').slice(0, -1);
    for (const p of parts) {
      const key = d.key + '/' + p;
      if (!d.dirs.has(p)) d.dirs.set(p, mk(p, key));
      d = d.dirs.get(p)!; d.count++;
    }
    d.notes.push(n);
  }
  return [...roots.values()];
}

export default function Browse({ top, notes, byId, brokenLinks, lint, changed, onMarkAllSeen, hl, onHl, selected, onSelect, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(() => { try { const t = localStorage.getItem('browseTab'); return t === 'new' || t === 'tree' || t === 'health' ? t : 'recent'; } catch { return 'recent'; } });
  useEffect(() => { try { localStorage.setItem('browseTab', tab); } catch {} }, [tab]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTree(notes), [notes]);
  // keep the open note's folders expanded
  useEffect(() => {
    const n = selected ? byId.get(selected) : null; if (!n) return;
    setOpen(o => { const x = new Set(o); let k = n.vault; x.add(k); for (const p of n.path.split('/').slice(0, -1)) { k += '/' + p; x.add(k); } return x; });
  }, [selected, byId]);
  const toggle = (k: string) => setOpen(o => { const x = new Set(o); x.has(k) ? x.delete(k) : x.add(k); return x; });

  const recent = useMemo(() => [...notes].filter(n => n.mtime).sort((a, b) => b.mtime - a.mtime).slice(0, 80), [notes]);
  const fresh = useMemo(() => notes.filter(n => changed.has(n.id)).sort((a, b) => b.mtime - a.mtime), [notes, changed]);
  const orphans = useMemo(() => notes.filter(n => !n.links.length && !n.backlinks.length), [notes]);
  const brokenBySource = useMemo(() => {
    const m = new Map<string, string[]>(); brokenLinks.forEach(b => m.set(b.from, [...(m.get(b.from) || []), b.target])); return [...m];
  }, [brokenLinks]);

  // schema problems grouped by kind, most common first
  const lintGroups = useMemo(() => {
    const m = new Map<string, Note[]>();
    lint.forEach((ps, id) => { const n = byId.get(id); if (n) ps.forEach(p => m.set(p, [...(m.get(p) || []), n])); });
    return [...m].sort((a, b) => b[1].length - a[1].length);
  }, [lint, byId]);
  const [lintOpen, setLintOpen] = useState<string | null>(null);
  const healthCount = brokenLinks.length + orphans.length + lint.size;
  const row = (n: Note, extra?: string) => (
    <button key={n.id} className={'br-row' + (n.id === selected ? ' cur' : '')} onClick={() => onSelect(n.id)} title={n.path}>
      <span className="br-title">{changed.has(n.id) && <i className="new-dot" title="Updated since you last looked" />}{shortTitle(n.title)}</span>{extra && <small>{extra}</small>}
    </button>
  );
  const renderDir = (d: Dir, depth: number): React.ReactNode => {
    const isOpen = open.has(d.key);
    return (
      <div key={d.key}>
        <button className="br-dir" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggle(d.key)}><span className={'chev' + (isOpen ? ' flip' : '')}>&#8250;</span>{d.name}<small>{d.count}</small></button>
        {isOpen && <div>
          {[...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map(c => renderDir(c, depth + 1))}
          {[...d.notes].sort((a, b) => a.title.localeCompare(b.title)).map(n => <div key={n.id} style={{ paddingLeft: 10 + (depth + 1) * 14 }}>{row(n)}</div>)}
        </div>}
      </div>
    );
  };

  let lastGroup = '';
  return (
    <div className="browse" style={{ top }} role="dialog" aria-label="Browse notes">
      <div className="br-head">
        <div className="seg" role="tablist">
          <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>New{changed.size ? ` ${changed.size}` : ''}</button>
          <button className={tab === 'recent' ? 'on' : ''} onClick={() => setTab('recent')}>Recent</button>
          <button className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}>Tree</button>
          <button className={tab === 'health' ? 'on' : ''} onClick={() => setTab('health')}>Health{healthCount > 0 ? ` ${healthCount}` : ''}</button>
        </div>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close browse">&times;</button>
      </div>
      <div className="br-body">
        {tab === 'new' && <>
          <div className="br-tools">
            <label title="Tint updated notes on the map"><input type="checkbox" checked={hl} onChange={e => onHl(e.target.checked)} /> Show on map</label>
            <button className="link" onClick={onMarkAllSeen} disabled={!fresh.length}>Mark all seen</button>
          </div>
          {fresh.length === 0 && <div className="empty">Nothing changed since you last looked. Notes you open are marked seen; edits made after that show up here.</div>}
          {fresh.map(n => row(n, `${n.section.split(' / ').pop()!.replace(/-/g, ' ')} \u00b7 ${ago(n.mtime)}`))}
        </>}
        {tab === 'recent' && recent.map(n => {
          const g = group(n.mtime), head = g !== lastGroup ? <div key={'g' + g} className="br-group">{g}</div> : null; lastGroup = g;
          return <div key={n.id}>{head}{row(n, `${n.section.split(' / ').pop()!.replace(/-/g, ' ')} \u00b7 ${ago(n.mtime)}`)}</div>;
        })}
        {tab === 'recent' && !recent.length && <div className="empty">No modified times available.</div>}
        {tab === 'tree' && tree.map(r => renderDir(r, 0))}
        {tab === 'health' && <>
          {lintGroups.length > 0 && <>
            <div className="br-group">Schema: {lint.size} {lint.size === 1 ? 'note needs' : 'notes need'} attention</div>
            {lintGroups.map(([p, ns]) => <div key={p}>
              <button className="br-dir" onClick={() => setLintOpen(lintOpen === p ? null : p)}><span className={'chev' + (lintOpen === p ? ' flip' : '')}>&#8250;</span>{p}<small>{ns.length}</small></button>
              {lintOpen === p && ns.sort((a, b) => a.title.localeCompare(b.title)).map(n => <div key={n.id} style={{ paddingLeft: 24 }}>{row(n, n.section.replace(/-/g, ' '))}</div>)}
            </div>)}
          </>}
          <div className="br-group">Broken links ({brokenLinks.length})</div>
          {brokenBySource.length === 0 && <div className="empty">None. Every wikilink resolves.</div>}
          {brokenBySource.map(([id, targets]) => { const n = byId.get(id); return n ? (
            <button key={id} className="br-row broken" onClick={() => onSelect(id)} title={n.path}>
              <span className="br-title">{shortTitle(n.title)}</span>
              <small>{targets.map(t => `[[${t}]]`).join('  ')}</small>
            </button>) : null; })}
          <div className="br-group">Orphans, no links in or out ({orphans.length})</div>
          {orphans.length === 0 && <div className="empty">None.</div>}
          {orphans.map(n => row(n, n.section.replace(/-/g, ' ')))}
        </>}
      </div>
    </div>
  );
}
