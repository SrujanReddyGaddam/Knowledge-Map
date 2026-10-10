import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import vault from 'virtual:vault';
import Graph from './Graph';
import Panel from './Panel';
import Browse from './Browse';
import { shortTitle } from './util';
import { play, tick, VARIANTS, setVolume } from './sound';
import { PALETTES, applyColors } from './palettes';
import { buildIndex, runSearch, highlight, type Scope } from './search';

const byId = new Map(vault.notes.map(n => [n.id, n]));
const baseKey = (s: string) => s.trim().split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
const perVault = new Map<string, Map<string, typeof vault.notes[number]>>();
const globalByBase = new Map<string, typeof vault.notes[number]>();
vault.notes.forEach(n => {
  const k = baseKey(n.path);
  if (!perVault.has(n.vault)) perVault.set(n.vault, new Map());
  if (!perVault.get(n.vault)!.has(k)) perVault.get(n.vault)!.set(k, n);
  if (!globalByBase.has(k)) globalByBase.set(k, n);
});
const resolve = (from: typeof vault.notes[number], name: string) => perVault.get(from.vault)?.get(baseKey(name)) ?? globalByBase.get(baseKey(name));
const order = vault.notes.map(n => n.id);
const searchIndex = buildIndex(vault.notes);
const allTags: [string, number][] = (() => { const m = new Map<string, number>(); vault.notes.forEach(n => n.tags.forEach(t => m.set(t, (m.get(t) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); })();
const hashId = () => { const h = decodeURIComponent(location.hash.slice(1)); return byId.has(h) ? h : null; };

export default function App() {
  const [selected, setSelected] = useState<string | null>(hashId);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const saved = useRef<{ q?: string; section?: string | null; tags?: string[]; vaults?: string[]; focus?: { id: string; hops: 1 | 2 } | null }>((() => { try { return JSON.parse(sessionStorage.getItem('filters') || '{}'); } catch { return {}; } })()).current;
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? saved.q ?? '');
  const [vw, setVw] = useState(innerWidth);
  const [section, setSection] = useState<string | null>(saved.section ?? null);
  const [tags, setTags] = useState<string[]>(saved.tags ?? []);
  const [vaultSel, setVaultSel] = useState<string[]>(() => { const p = new URLSearchParams(location.search).get('vault'); return p ? p.split(',').filter(Boolean) : saved.vaults ?? []; });
  const [focus, setFocus] = useState<{ id: string; hops: 1 | 2 } | null>(() => (saved.focus && byId.has(saved.focus.id) ? saved.focus : null));
  const [browse, setBrowse] = useState(() => { try { return localStorage.getItem('browse') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('browse', browse ? '1' : '0'); } catch {} }, [browse]);
  // Survive the live-reload that follows any vault file change (e.g. deleting a note).
  useEffect(() => { try { sessionStorage.setItem('filters', JSON.stringify({ q: query, section, tags, vaults: vaultSel, focus })); } catch {} }, [query, section, tags, vaultSel, focus]);
  const [hide, setHide] = useState(() => { try { const m = new URLSearchParams(location.search).get('mode') || localStorage.getItem('filterMode'); return m !== 'dim'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('filterMode', hide ? 'hide' : 'dim'); } catch {} }, [hide]);
  const [scope, setScope] = useState<Scope>(() => { try { return localStorage.getItem('searchScope') === 'names' ? 'names' : 'all'; } catch { return 'all'; } });
  useEffect(() => { try { localStorage.setItem('searchScope', scope); } catch {} }, [scope]);
  const [cursor, setCursor] = useState(0);
  const [filterOpen, setFilterOpen] = useState(() => new URLSearchParams(location.search).has('filter'));
  const [info, setInfo] = useState(() => new URLSearchParams(location.search).has('info'));
  const [soundId, setSoundId] = useState(() => { try { return localStorage.getItem('soundId') || (localStorage.getItem('sound') === '1' ? 'soft' : 'off'); } catch { return 'off'; } });
  const [volume, setVol] = useState(() => { try { const v = Number(localStorage.getItem('soundVol2')); return v >= 0 && localStorage.getItem('soundVol2') !== null ? v : 75; } catch { return 75; } });
  useEffect(() => { setVolume(volume); try { localStorage.setItem('soundVol2', String(volume)); } catch {} }, [volume]);
  const [soundOpen, setSoundOpen] = useState(() => new URLSearchParams(location.search).has('sound'));
  const [palette, setPalette] = useState(() => { try { const p = new URLSearchParams(location.search).get('palette') || localStorage.getItem('palette'); return p && PALETTES[p] ? p : 'sage'; } catch { return 'sage'; } });
  const [palOpen, setPalOpen] = useState(false);
  const [panelPref, setPanelPref] = useState(() => { try { return Number(localStorage.getItem('panelW')) || 0; } catch { return 0; } });
  const [fs, setFs] = useState(() => { try { return Number(localStorage.getItem('fs')) || 1; } catch { return 1; } });
  useEffect(() => { try { localStorage.setItem('palette', palette); localStorage.setItem('panelW', String(panelPref)); localStorage.setItem('fs', String(fs)); } catch {} }, [palette, panelPref, fs]);
  const maxedRef = useRef(false);
  const soundRef = useRef(soundId); soundRef.current = soundId;
  useEffect(() => { try { localStorage.setItem('soundId', soundId); } catch {} }, [soundId]);
  useEffect(() => { const f = () => setVw(innerWidth); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);

  const select = useCallback((id: string | null) => { if (id && soundRef.current !== 'off') play(soundRef.current); setSelected(id); history.replaceState(null, '', id ? '#' + encodeURIComponent(id) : location.pathname); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {} }, [dark]);

  const q = query.trim();
  const res = useMemo(() => runSearch(searchIndex, query, scope), [query, scope]);
  // local graph: the focused note plus everything within N link hops (either direction)
  const focusSet = useMemo(() => {
    if (!focus) return null;
    const seen = new Set([focus.id]); let ring = [focus.id];
    for (let h = 0; h < focus.hops; h++) {
      const nx: string[] = [];
      for (const id of ring) { const n = byId.get(id); n && [...n.links, ...n.backlinks].forEach(o => { if (!seen.has(o)) { seen.add(o); nx.push(o); } }); }
      ring = nx;
    }
    return seen;
  }, [focus]);
  const matches = useMemo(() => {
    if (!res && !section && !tags.length && !vaultSel.length && !focusSet) return null;
    const textOk = res ? new Set(res.hits.map(h => h.note.id)) : null;
    const set = new Set<string>();
    for (const n of vault.notes) {
      if ((!textOk || textOk.has(n.id)) && (!vaultSel.length || vaultSel.includes(n.vault)) && (!section || n.section === section) && (!focusSet || focusSet.has(n.id)) && tags.every(t => n.tags.includes(t))) set.add(n.id);
    }
    return set;
  }, [res, section, tags, vaultSel, focusSet]);
  const hits = useMemo(() => (res && matches ? res.hits.filter(h => matches.has(h.note.id)) : []), [res, matches]);
  useEffect(() => setCursor(0), [query, scope]);
  const filterCount = (section ? 1 : 0) + vaultSel.length + tags.length + (focus ? 1 : 0);
  const clearFilters = () => { setSection(null); setTags([]); setVaultSel([]); setFocus(null); };
  const toggleTag = (t: string) => setTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);

  // Hide mode keeps the open note visible even if it does not match; prev/next skip hidden notes
  const selExtra = selected && matches && !matches.has(selected) ? selected : null;
  const graphMatches = useMemo(() => (matches && selExtra ? new Set([...matches, selExtra]) : matches), [matches, selExtra]);
  const navOrder = hide && graphMatches ? order.filter(id => graphMatches.has(id)) : order;

  const idx = selected ? navOrder.indexOf(selected) : -1;
  const deleteNote = useCallback(async (id: string) => {
    try {
      const r = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KM': '1' }, body: JSON.stringify({ id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return j.error || 'HTTP ' + r.status;
      setSelected(null); history.replaceState(null, '', location.pathname);
      return null;
    } catch (e) { return String(e); }
  }, []);
  const note = selected ? byId.get(selected)! : null;
  const prev = idx >= 0 ? byId.get(navOrder[(idx - 1 + navOrder.length) % navOrder.length])! : null;
  const next = idx >= 0 ? byId.get(navOrder[(idx + 1) % navOrder.length])! : null;
  const lastNote = useRef(note);
  if (note) lastNote.current = note;
  const colors = PALETTES[palette][dark ? 'dark' : 'light'];
  useEffect(() => { applyColors(colors); }, [colors]);
  const defaultW = Math.min(640, Math.max(420, Math.round(vw * 0.36)));
  const fullW = vw < 800 ? vw : Math.round(Math.min(vw * 0.72, Math.max(340, panelPref || defaultW)));
  const panelW = note ? fullW : 0;
  const [maxed, setMaxed] = useState(false); maxedRef.current = maxed;
  useEffect(() => { if (!note) setMaxed(false); }, [note]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); const el = document.getElementById('search') as HTMLInputElement | null; el?.focus(); el?.select(); return; }
      if (e.key === 'Escape') { if (typing) { setQuery(''); (document.activeElement as HTMLElement).blur(); } else if (maxedRef.current) setMaxed(false); else select(null); }
      else if (typing) return;
      else if (e.key === '/') { e.preventDefault(); document.getElementById('search')?.focus(); }
      else if (e.key === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) setBrowse(v => !v);
      else if (e.key === 'ArrowRight' && next) select(next.id);
      else if (e.key === 'ArrowLeft' && prev) select(prev.id);
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [next, prev, select]);

  const scopeSeg = (
    <div className="seg" role="group" aria-label="Search in">
      <button className={scope === 'names' ? 'on' : ''} onClick={() => setScope('names')} title="Match note names only">Names</button>
      <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} title="Match names, tags, summaries and note text">Everything</button>
    </div>
  );

  return (
    <>
      <Graph notes={vault.notes} edges={vault.edges} selectedId={selected} panelWidth={panelW} colors={colors} matchIds={graphMatches} hide={hide} onSelect={select} onHover={id => { if (id && soundRef.current !== 'off') tick(); }} />
      <div className="search-wrap">
        <div className="search-row">
          <input id="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={"Search notes   /  or  \u2318O"} autoComplete="off" spellCheck={false}
            onKeyDown={e => {
              const shown = Math.min(hits.length, 25);
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(shown - 1, c + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
              else if (e.key === 'Enter' && hits[cursor]) { select(hits[cursor].note.id); setQuery(''); (e.target as HTMLElement).blur(); }
            }} />
          <button className={'icon-btn' + (browse ? ' on' : '')} onClick={() => setBrowse(v => !v)} aria-label="Browse notes" title="Browse: recent, tree, health  (b)">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></svg>
          </button>
          <button className={'icon-btn' + (filterOpen || filterCount ? ' on' : '')} onClick={() => setFilterOpen(v => !v)} aria-label="Filters" title="Filter by section or tag">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3.5h12L9.5 9v4l-3-1.5V9z" /></svg>
            {filterCount > 0 && <span className="count-badge">{filterCount}</span>}
          </button>
        </div>
        {matches && (
          <div className="active-filters">
            {focus && byId.get(focus.id) && <span className="focus-chip"><button className="chip active" onClick={() => setFocus(null)} title="Clear focus">Focus: {shortTitle(byId.get(focus.id)!.title)} &times;</button>
              <span className="seg" role="group" aria-label="Hops"><button className={focus.hops === 1 ? 'on' : ''} onClick={() => setFocus({ ...focus, hops: 1 })}>1 hop</button><button className={focus.hops === 2 ? 'on' : ''} onClick={() => setFocus({ ...focus, hops: 2 })}>2 hops</button></span></span>}
            {vaultSel.map(v => <button key={v} className="chip active" onClick={() => setVaultSel(vaultSel.filter(x => x !== v))}>{v} &times;</button>)}
            {section && <button className="chip active" onClick={() => setSection(null)}>{section.replace(/-/g, ' ')} &times;</button>}
            {tags.map(t => <button key={t} className="chip active" onClick={() => toggleTag(t)}>{t} &times;</button>)}
            <span className="match-count">{matches.size} of {vault.notes.length}</span>
            <div className="seg" role="group" aria-label="Non-matching notes">
              <button className={!hide ? 'on' : ''} onClick={() => setHide(false)} title="Fade non-matching notes">Dim</button>
              <button className={hide ? 'on' : ''} onClick={() => setHide(true)} title="Remove non-matching notes from the map">Hide</button>
            </div>
          </div>
        )}
        {filterOpen && (
          <div className="filter-pop" role="dialog">
            <div className="seg-row"><span className="eyebrow">Non-matching notes</span><div className="seg" role="group" aria-label="Non-matching notes">
                <button className={!hide ? 'on' : ''} onClick={() => setHide(false)} title="Fade non-matching notes">Dim</button>
                <button className={hide ? 'on' : ''} onClick={() => setHide(true)} title="Remove non-matching notes from the map">Hide</button>
            </div></div>
            {vault.vaults.length > 1 && <><div className="eyebrow"><span>Vaults</span></div>
            <div className="sec-list">{vault.vaults.map(vn => (
              <button key={vn} className={'chip' + (vaultSel.includes(vn) ? ' active' : '')} onClick={() => { setVaultSel(vaultSel.includes(vn) ? vaultSel.filter(x => x !== vn) : [...vaultSel, vn]); setSection(null); }}>{vn} <small>{vault.notes.filter(n => n.vault === vn).length}</small></button>
            ))}</div></>}
            <div className="eyebrow"><span>Sections</span>{filterCount > 0 && <button className="link" onClick={clearFilters}>clear all</button>}</div>
            <div className="sec-list">{vault.sections.filter(sx => !vaultSel.length || vault.notes.some(n => n.section === sx && vaultSel.includes(n.vault))).map(sx => (
              <button key={sx} className={'chip' + (section === sx ? ' active' : '')} onClick={() => setSection(section === sx ? null : sx)}>{sx.replace(/-/g, ' ')} <small>{vault.notes.filter(n => n.section === sx).length}</small></button>
            ))}</div>
            <div className="eyebrow"><span>Tags (note must have all selected)</span></div>
            <div className="sec-list tag-list">{allTags.map(([t, c]) => (
              <button key={t} className={'chip tag' + (tags.includes(t) ? ' active' : '')} onClick={() => toggleTag(t)}>{t} <small>{c}</small></button>
            ))}</div>
            <div className="seg-row" style={{ borderBottom: 0, borderTop: '1px solid var(--line)', paddingTop: 12, margin: '10px 0 0' }}><span className="eyebrow">Search in</span>{scopeSeg}</div>
          </div>
        )}
        {q && (
          <div className="results">
            <div className="res-head"><span>{hits.length} {hits.length === 1 ? 'result' : 'results'}</span>{scopeSeg}</div>
            {hits.length > 0 ? hits.slice(0, 25).map((h, i) => (
              <button key={h.note.id} className={i === cursor ? 'cur' : ''} onMouseEnter={() => setCursor(i)} onClick={() => { select(h.note.id); setQuery(''); }}>
                <small>{h.note.section.replace(/-/g, ' ')}</small>
                <span className="res-title">{highlight(shortTitle(h.note.title), res?.terms || []).map((p, k) => p.m ? <mark key={k}>{p.t}</mark> : p.t)}</span>
                {h.snippet && <span className="snip">{highlight(h.snippet, res?.terms || []).map((p, k) => p.m ? <mark key={k}>{p.t}</mark> : p.t)}</span>}
              </button>
            )) : <div className="empty">No notes match.{scope === 'names' && <button className="link" onClick={() => setScope('all')}>Search inside note text too</button>}</div>}
            {hits.length > 25 && <div className="res-more">Showing 25 of {hits.length}. All matches are on the map.</div>}
            <div className="res-tips">Tips: <code>"exact phrase"</code> <code>-skip</code> <code>tag:agents</code> <code>vault:Jarvis</code> <code>path:wiki</code></div>
          </div>
        )}
      </div>
 {browse && <Browse notes={vault.notes} byId={byId} brokenLinks={vault.brokenLinks} selected={selected} onSelect={select} onClose={() => setBrowse(false)} />}
      <div className="top-right" style={{ right: panelW + 20 }}>
        <button className={'icon-btn' + (info ? ' on' : '')} onClick={() => setInfo(v => !v)} aria-label="About this map" title="About">i</button>
        {info && (
          <div className="info-pop" role="dialog">
            <div className="eyebrow">Knowledge map</div>
            <p><b>{vault.vaults.join(' + ')}</b><br />{vault.notes.length} notes, {vault.edges.length} links{vault.broken.length ? `, ${vault.broken.length} broken wikilinks` : ''}</p>
            <div className="eyebrow">Controls</div>
            <p className="keys"><kbd>drag</kbd> pan &nbsp; <kbd>shift</kbd>+<kbd>drag</kbd> rotate &nbsp; <kbd>scroll</kbd> zoom &nbsp; <kbd>click</kbd> open<br /><kbd>/</kbd> search &nbsp; <kbd>b</kbd> browse &nbsp; <kbd>&larr;</kbd><kbd>&rarr;</kbd> prev / next &nbsp; <kbd>esc</kbd> close</p>
          </div>
        )}
      </div>
      <div className="corner" style={{ right: panelW + 20 }}>
        {palOpen && (
          <div className="pal-pop" role="menu">
            {Object.entries(PALETTES).map(([k, p]) => (
              <button key={k} className={'pal' + (k === palette ? ' on' : '')} onClick={() => { setPalette(k); setPalOpen(false); }} title={p.name}>
                <i style={{ background: p.swatch }} /><span>{p.name}</span>
              </button>
            ))}
          </div>
        )}
        <button className="icon-btn" onClick={() => { setPalOpen(v => !v); setSoundOpen(false); }} aria-label="Color palette" title="Color palette"><i className="swatch-dot" style={{ background: 'var(--accent)' }} /></button>
        <button className="icon-btn" onClick={() => setDark(d => !d)} aria-label="Toggle theme" title="Toggle theme">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="6" /><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor" /></svg>
        </button>
        {soundOpen && (
          <div className="pal-pop sound-pop" role="menu" style={{ right: 0 }}>
            <div className="eyebrow">Click sound</div>
            <button className={'pal' + (soundId === 'off' ? ' on' : '')} onClick={() => { setSoundId('off'); setSoundOpen(false); }}><span>Off</span></button>
            {VARIANTS.map(v => (
              <button key={v.id} className={'pal' + (soundId === v.id ? ' on' : '')} onClick={() => { setSoundId(v.id); play(v.id); }}>
                <span>{v.name}<small>{v.hint}</small></span>
              </button>
            ))}
            <div className="vol"><span>Volume</span><input type="range" min="0" max="100" value={volume} onChange={e => setVol(Number(e.target.value))} onPointerUp={() => play(soundId === 'off' ? 'soft' : soundId)} aria-label="Volume" /><b>{volume}</b></div>
            <div className="hint">Click a name to hear it</div>
          </div>
        )}
        <button className="icon-btn" onClick={() => { setSoundOpen(v => !v); setPalOpen(false); }} aria-label="Sound" title="Sound">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6h2.5L8 3v10L4.5 10H2z" />{soundId !== 'off' ? <><path d="M10.5 5.5a3.5 3.5 0 0 1 0 5" /><path d="M12.5 3.5a6.5 6.5 0 0 1 0 9" /></> : <path d="M11 6l3.5 4M14.5 6L11 10" />}</svg>
        </button>
      </div>
      <Panel focusId={focus?.id ?? null} onFocus={id => setFocus(id ? { id, hops: 1 } : null)} onDelete={deleteNote} dark={dark} width={maxed ? vw : fullW} maxed={maxed} onMax={() => setMaxed(m => !m)} fs={fs} onFs={setFs} onResize={w => setPanelPref(w === 0 ? 0 : Math.round(w))} open={!!note} note={note ?? lastNote.current} index={idx >= 0 ? idx : Math.max(0, navOrder.indexOf(lastNote.current?.id ?? ''))} total={navOrder.length} byId={byId} resolve={resolve} prev={prev ?? (lastNote.current ? byId.get(order[(order.indexOf(lastNote.current.id) - 1 + order.length) % order.length])! : null)} next={next ?? (lastNote.current ? byId.get(order[(order.indexOf(lastNote.current.id) + 1) % order.length])! : null)}
        onNav={select} onTag={t => { setTags(ts => (ts.includes(t) ? ts : [...ts, t])); setFilterOpen(true); }} onClose={() => select(null)} />
    </>
  );
}
