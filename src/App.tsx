import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import vault, { safeMode, setSafeMode } from './data';
import Graph from './Graph';
import Panel from './Panel';
import Browse from './Browse';
import Tasks from './Tasks';
import { collectTasks } from './taskScan';
import { loadSeen, saveSeen, type Seen } from './seen';
import { trashNote } from './api';
import { readDraft, clearDraft, type Draft } from './Editor';
import { shortTitle } from './util';
import { play, tick, VARIANTS, setVolume } from './sound';
import { PALETTES, applyColors } from './palettes';
import { buildIndex, runSearch, highlight, type Scope } from './search';
import { FACETS, facetCounts, facetMatch, typeTints, lintNote, TYPE_GROUPS, type Facet, type FacetSel } from './facets';
import NewNote from './NewNote';
import Today from './Today';
import Cockpit from './Cockpit';
import Capture from './Capture';
import Palette, { type Action } from './Palette';
import { customersOf } from './cockpitData';
import { dailyNote, dailyPath, dailyVault, ensureDaily } from './journal';

const byId = new Map(vault.notes.map(n => [n.id, n]));
// same rules as the server: exact file name first ([[x.excalidraw]] is the drawing), then the name without .excalidraw, where a note beats a drawing
const baseKey = (s: string) => s.trim().split('/').pop()!.replace(/\.md$/i, '').toLowerCase();
const looseKey = (s: string) => baseKey(s).replace(/\.excalidraw$/i, '');
type N = typeof vault.notes[number];
const perVault = new Map<string, Map<string, N>>(), perVaultLoose = new Map<string, Map<string, N>>();
const globalByBase = new Map<string, N>(), globalLoose = new Map<string, N>();
const addLoose = (m: Map<string, N>, n: N) => { const k = looseKey(n.path), cur = m.get(k); if (!cur || (cur.kind === 'drawing' && n.kind !== 'drawing')) m.set(k, n); };
vault.notes.forEach(n => {
  const k = baseKey(n.path);
  if (!perVault.has(n.vault)) { perVault.set(n.vault, new Map()); perVaultLoose.set(n.vault, new Map()); }
  if (!perVault.get(n.vault)!.has(k)) perVault.get(n.vault)!.set(k, n);
  if (!globalByBase.has(k)) globalByBase.set(k, n);
  addLoose(perVaultLoose.get(n.vault)!, n); addLoose(globalLoose, n);
});
const resolve = (from: N, name: string) => perVault.get(from.vault)?.get(baseKey(name)) ?? perVaultLoose.get(from.vault)?.get(looseKey(name))
  ?? globalByBase.get(baseKey(name)) ?? globalLoose.get(looseKey(name));
const order = vault.notes.map(n => n.id);
const searchIndex = buildIndex(vault.notes);
const allTags: [string, number][] = (() => { const m = new Map<string, number>(); vault.notes.forEach(n => n.tags.forEach(t => m.set(t, (m.get(t) || 0) + 1))); return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); })();
const facetVals = facetCounts(vault.notes);
// schema lint (Health tab) for vaults with "lint": true; hubs are notes with type: hub
const lintIssues = (() => {
  const hubs = new Set(vault.notes.filter(n => n.type === 'hub').map(n => n.id)), m = new Map<string, string[]>();
  vault.notes.forEach(n => { if (vault.lintVaults.includes(n.vault)) { const p = lintNote(n, hubs); if (p.length) m.set(n.id, p); } });
  return m;
})();
// a note just created with New note: open it (in the editor) after the reload
const justCreated = (() => {
  try {
    const j = JSON.parse(sessionStorage.getItem('kmOpen') || 'null'); sessionStorage.removeItem('kmOpen');
    const id = j ? vault.notes.find(n => n.vault === j.vault && n.path === j.path)?.id ?? null : null;
    if (id) history.replaceState(null, '', location.pathname + location.search + '#' + encodeURIComponent(id));
    return id;
  } catch { return null; }
})();
// intro animation: once per tab, never after a live reload (the saved camera wins), not with reduce motion or ?zoom; ?intro=1|0 forces it
const introOn = (() => {
  const p = new URLSearchParams(location.search), f = p.get('intro');
  if (f === '1' || f === '0') return f === '1';
  let first = false;
  try { first = !sessionStorage.getItem('kmIntro') && !sessionStorage.getItem('cam'); sessionStorage.setItem('kmIntro', '1'); } catch {}
  return first && !p.has('zoom') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
})();
const customers = customersOf(vault.notes);
const findNotes = (q: string) => (runSearch(searchIndex, q, 'names')?.hits ?? []).map(h => h.note);
// a message that should survive the reload that follows our own write (e.g. "Captured")
const toastAfterReload = (() => { try { const t = sessionStorage.getItem('kmToast'); sessionStorage.removeItem('kmToast'); return t || ''; } catch { return ''; } })();
type View = 'tasks' | 'today' | 'cockpit' | null;
const hashId = () => { const h = decodeURIComponent(location.hash.slice(1)); return byId.has(h) ? h : null; };

export default function App() {
  // an unsaved draft (kept in sessionStorage) reopens the editor after a reload
  const [draft] = useState<Draft | null>(() => { const d = readDraft(); const n = d && byId.get(d.id); return d && n && n.writable && (hashId() === null || hashId() === d.id) ? d : null; });
  const draftRef = useRef<Draft | null>(draft);                  // handed to the editor once; cleared when editing ends so a later edit starts from disk
  const [selected, setSelected] = useState<string | null>(() => justCreated ?? hashId() ?? draft?.id ?? null);
  const [editId, setEditId] = useState<string | null>(justCreated && byId.get(justCreated)?.writable ? justCreated : draft?.id ?? null);
  const editIdRef = useRef(editId); editIdRef.current = editId;
  const dirtyRef = useRef(false), staleRef = useRef(false);      // dirtyRef: unsaved edits; staleRef: our own save happened, data refreshes when editing ends
  const reloadSoon = () => setTimeout(() => location.reload(), 50);
  const endEdit = useCallback(() => { setEditId(null); draftRef.current = null; dirtyRef.current = false; if (staleRef.current) { staleRef.current = false; reloadSoon(); } }, []);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const saved = useRef<{ q?: string; section?: string | null; tags?: string[]; vaults?: string[]; facets?: FacetSel; focus?: { id: string; hops: 1 | 2 } | null }>((() => { try { return JSON.parse(sessionStorage.getItem('filters') || '{}'); } catch { return {}; } })()).current;
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('q') ?? saved.q ?? '');
  const [vw, setVw] = useState(innerWidth);
  const [section, setSection] = useState<string | null>(saved.section ?? null);
  const [tags, setTags] = useState<string[]>(saved.tags ?? []);
  const [vaultSel, setVaultSel] = useState<string[]>(() => { const p = new URLSearchParams(location.search).get('vault'); return p ? p.split(',').filter(Boolean) : saved.vaults ?? []; });
  const [facets, setFacets] = useState<FacetSel>(() => {
    const out: FacetSel = {}, src = saved.facets ?? {};
    for (const f of FACETS) { const v = (src[f] ?? []).filter(x => facetVals[f].some(([k]) => k === x)); if (v.length) out[f] = v; }
    return out;
  });
  const [colorBy, setColorBy] = useState<'none' | 'type'>(() => { try { return localStorage.getItem('colorBy') === 'type' ? 'type' : 'none'; } catch { return 'none'; } });
  useEffect(() => { try { localStorage.setItem('colorBy', colorBy); } catch {} }, [colorBy]);
  const [newOpen, setNewOpen] = useState(false);
  // the Browse drawer starts below the search row and the active-filter chips (which wrap and grow), never underneath them
  const headRef = useRef<HTMLDivElement>(null);
  const [browseTop, setBrowseTop] = useState(70);
  useEffect(() => {
    const el = headRef.current; if (!el) return;
    const f = () => setBrowseTop(Math.round(el.getBoundingClientRect().bottom + 10));
    const ro = new ResizeObserver(f); ro.observe(el); f(); return () => ro.disconnect();
  }, []);
  const [focus, setFocus] = useState<{ id: string; hops: 1 | 2 } | null>(() => (saved.focus && byId.has(saved.focus.id) ? saved.focus : null));
  const [seenState, setSeenState] = useState<Seen>(loadSeen);
  useEffect(() => saveSeen(seenState), [seenState]);
  const changed = useMemo(() => { const s = new Set<string>(); for (const n of vault.notes) if (n.mtime > (seenState.seen[n.id] ?? seenState.base)) s.add(n.id); return s; }, [seenState]);
  const markAllSeen = useCallback(() => setSeenState({ base: Date.now(), seen: {} }), []);
  const [hl, setHl] = useState(() => { try { return localStorage.getItem('hlChanged') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('hlChanged', hl ? '1' : '0'); } catch {} }, [hl]);
  const [introMsg, setIntroMsg] = useState(introOn);
  useEffect(() => { if (introMsg) { const t = setTimeout(() => setIntroMsg(false), 6200); return () => clearTimeout(t); } }, [introMsg]);
  const [browseKey, setBrowseKey] = useState(0);
  const [browse, setBrowse] = useState(() => { try { return localStorage.getItem('browse') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('browse', browse ? '1' : '0'); } catch {} }, [browse]);
  // Tasks: every open "- [ ]" checkbox across the vaults, in its own full-page view over the map (the note panel opens on top of it)
  const allTasks = useMemo(() => collectTasks(vault.notes), []);
  // full-page views over the map (one at a time): Tasks, Today, customer cockpit. ?view=today|tasks|cockpit&customer=x opens one.
  const [view, setView] = useState<View>(() => {
    const p = new URLSearchParams(location.search).get('view');
    if (p === 'tasks' || p === 'today' || p === 'cockpit') return p;
    try { const v = localStorage.getItem('view'); return v === 'tasks' || v === 'today' || v === 'cockpit' ? v : localStorage.getItem('tasks') === '1' ? 'tasks' : null; } catch { return null; }
  });
  useEffect(() => { try { localStorage.setItem('view', view || ''); localStorage.removeItem('tasks'); } catch {} }, [view]);
  const toggleView = useCallback((v: Exclude<View, null>) => setView(cur => (cur === v ? null : v)), []);
  const tasksOpen = view === 'tasks';
  const tasksRef = useRef(view); tasksRef.current = view;
  const [customer, setCustomer] = useState<string | null>(() => {
    const p = new URLSearchParams(location.search).get('customer');
    let c = p; if (!c) { try { c = localStorage.getItem('cockpitCustomer'); } catch {} }
    return c && customers.includes(c) ? c : null;
  });
  useEffect(() => { try { localStorage.setItem('cockpitCustomer', customer || ''); } catch {} }, [customer]);
  // one-shot URL params (app shortcuts) are dropped after use so a reload does not repeat them
  useEffect(() => { const u = new URL(location.href); if (['capture', 'view', 'customer'].some(k => u.searchParams.has(k))) { ['capture', 'view', 'customer'].forEach(k => u.searchParams.delete(k)); history.replaceState(null, '', u.toString()); } }, []);
  const openCockpit = useCallback((c: string | null) => { setCustomer(c && customers.includes(c) ? c : null); setView('cockpit'); }, []);
  const [captureOpen, setCaptureOpen] = useState(() => new URLSearchParams(location.search).get('capture') === '1');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState(toastAfterReload);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); } }, [toast]);
  // Survive the live-reload that follows any vault file change (e.g. deleting a note).
  useEffect(() => { try { sessionStorage.setItem('filters', JSON.stringify({ q: query, section, tags, vaults: vaultSel, facets, focus })); } catch {} }, [query, section, tags, vaultSel, facets, focus]);
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

  // Focus mode (canvas toggle): every note you pick, from the map, search, Browse or a link, becomes the focus until Esc
  const [focusMode, setFocusMode] = useState(false);
  const focusModeRef = useRef(false); focusModeRef.current = focusMode;
  const hopsRef = useRef<1 | 2>(1); hopsRef.current = focus?.hops ?? hopsRef.current;
  const select = useCallback((id: string | null) => {
    if (editIdRef.current && id !== editIdRef.current) { if (dirtyRef.current && !confirm('You have unsaved changes. Discard them?')) return; clearDraft(); endEdit(); }
    if (id && soundRef.current !== 'off') play(soundRef.current); if (id && focusModeRef.current) setFocus({ id, hops: hopsRef.current }); setSelected(id); history.replaceState(null, '', id ? '#' + encodeURIComponent(id) : location.pathname); }, [endEdit]);
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
    const anyFacet = FACETS.some(f => facets[f]?.length);
    if (!res && !section && !tags.length && !vaultSel.length && !focusSet && !anyFacet) return null;
    const textOk = res ? new Set(res.hits.map(h => h.note.id)) : null;
    const set = new Set<string>();
    for (const n of vault.notes) {
      if ((!textOk || textOk.has(n.id)) && (!vaultSel.length || vaultSel.includes(n.vault)) && (!section || n.section === section) && (!focusSet || focusSet.has(n.id)) && tags.every(t => n.tags.includes(t)) && (!anyFacet || facetMatch(n, facets))) set.add(n.id);
    }
    return set;
  }, [res, section, tags, vaultSel, focusSet, facets]);
  const hits = useMemo(() => (res && matches ? res.hits.filter(h => matches.has(h.note.id)) : []), [res, matches]);
  useEffect(() => setCursor(0), [query, scope]);
  const facetCount = FACETS.reduce((a, f) => a + (facets[f]?.length || 0), 0);
  const filterCount = (section ? 1 : 0) + vaultSel.length + tags.length + (focus ? 1 : 0) + facetCount;
  const clearFilters = () => { setSection(null); setTags([]); setVaultSel([]); setFocus(null); setFacets({}); };
  const toggleFacet = (f: Facet, v: string) => setFacets(fs => { const cur = fs[f] ?? [], nx = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]; const o = { ...fs }; if (nx.length) o[f] = nx; else delete o[f]; return o; });
  const tints = useMemo(() => (colorBy === 'type' ? typeTints(vault.notes, dark) : null), [colorBy, dark]);
  const toggleTag = (t: string) => setTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);

  // Hide mode keeps the open note visible even if it does not match; prev/next skip hidden notes
  const selExtra = selected && matches && !matches.has(selected) ? selected : null;
  const graphMatches = useMemo(() => (matches && selExtra ? new Set([...matches, selExtra]) : matches), [matches, selExtra]);
  const navOrder = hide && graphMatches ? order.filter(id => graphMatches.has(id)) : order;

  const idx = selected ? navOrder.indexOf(selected) : -1;
  const deleteNote = useCallback(async (id: string) => {
    try {
      const r = await trashNote(id);
      if (r.status !== 200) return r.json.error || 'HTTP ' + r.status;
      setSelected(null); history.replaceState(null, '', location.pathname);
      return null;
    } catch (e) { return String(e); }
  }, []);
  const note = selected ? byId.get(selected)! : null;
  const selNote = note;
  // opening a note marks its current version as seen
  useEffect(() => { if (note && changed.has(note.id)) setSeenState(s => ({ ...s, seen: { ...s.seen, [note.id]: note.mtime } })); }, [note, changed]);
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

  // today's journal: open it, or create it from the daily template and open it in the editor after the reload
  const openDaily = () => {
    const n = dailyNote();
    if (n) { select(n.id); return; }
    if (safeMode) { setToast("Today's journal does not exist yet (Safe mode does not create notes)."); return; }
    try { sessionStorage.setItem('kmOpen', JSON.stringify({ vault: dailyVault(), path: dailyPath() + '.md' })); } catch {}
    ensureDaily().then(r => { if (!r.created) { try { sessionStorage.removeItem('kmOpen'); } catch {} setToast("Today's journal exists but is not loaded yet, try again in a moment."); } })
      .catch(e => { try { sessionStorage.removeItem('kmOpen'); } catch {} setToast('Could not create the journal: ' + (e as Error).message); });
  };
  const actions: Action[] = [
    { id: 'today', label: 'Today', hint: 'due tasks, where you left off, captures', keys: 'h', run: () => setView('today') },
    { id: 'tasks', label: 'Tasks', hint: 'every open checkbox', keys: 't', run: () => setView('tasks') },
    { id: 'cockpit', label: 'Customer cockpit', hint: 'pick a customer', keys: 'k', run: () => openCockpit(null) },
    ...customers.map(c => ({ id: 'ck-' + c, label: 'Cockpit: ' + c.replace(/-/g, ' '), hint: 'customer', run: () => openCockpit(c) })),
    ...(dailyVault() && !safeMode ? [{ id: 'capture', label: 'Quick capture', hint: 'into the inbox', keys: 'c', run: () => setCaptureOpen(true) }] : []),
    ...(dailyVault() ? [{ id: 'daily', label: "Today's journal", hint: 'open or create the daily note', keys: 'd', run: openDaily }] : []),
    ...(vault.writableVaults.length ? [{ id: 'new', label: 'New note', hint: 'from a template', keys: 'n', run: () => setNewOpen(true) }] : []),
    { id: 'browse', label: 'Browse', hint: 'new, recent, tree, health', keys: 'b', run: () => setBrowse(v => !v) },
    { id: 'search', label: 'Search notes', keys: '/', run: () => document.getElementById('search')?.focus() },
    ...(selNote ? [
      ...(selNote.writable && selNote.kind !== 'drawing' ? [{ id: 'edit', label: 'Edit this note', hint: shortTitle(selNote.title), keys: 'e', run: () => setEditId(selNote.id) }] : []),
      { id: 'focus', label: 'Focus on this note', hint: 'show its neighbours only', run: () => setFocus({ id: selNote.id, hops: hopsRef.current }) },
      { id: 'close', label: 'Close the note', keys: 'esc', run: () => select(null) },
    ] : []),
    { id: 'focusmode', label: focusMode ? 'Leave focus mode' : 'Focus mode', hint: 'every pick becomes the focus', run: () => { if (focusMode) { setFocusMode(false); setFocus(null); } else setFocusMode(true); } },
    { id: 'clear', label: 'Clear filters', run: clearFilters },
    { id: 'safe', label: safeMode ? 'Leave Safe mode' : 'Safe mode', hint: 'for screen sharing', run: () => setSafeMode(!safeMode) },
    { id: 'theme', label: dark ? 'Light theme' : 'Dark theme', run: () => setDark(d => !d) },
    { id: 'color', label: colorBy === 'type' ? 'Stop coloring by type' : 'Color notes by type', run: () => setColorBy(c => (c === 'type' ? 'none' : 'type')) },
    ...Object.entries(PALETTES).map(([k, p]) => ({ id: 'pal-' + k, label: 'Palette: ' + p.name, run: () => setPalette(k) })),
    { id: 'seen', label: 'Mark all notes seen', run: markAllSeen },
  ];

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || !!(document.activeElement as HTMLElement | null)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); const el = document.getElementById('search') as HTMLInputElement | null; el?.focus(); el?.select(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !editIdRef.current) { e.preventDefault(); setPaletteOpen(v => !v); return; }
      if (e.key === 'Escape') { if (typing) { setQuery(''); (document.activeElement as HTMLElement).blur(); } else if (maxedRef.current) setMaxed(false); else if (tasksRef.current) { if (selNote) select(null); else setView(null); } else if (focusModeRef.current) { setFocusMode(false); setFocus(null); } else select(null); }
      else if (typing) return;
      else if (e.key === '/') { e.preventDefault(); document.getElementById('search')?.focus(); }
      else if (e.key === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) setBrowse(v => !v);
      else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (e.key === 't') toggleView('tasks');
      else if (e.key === 'h') toggleView('today');
      else if (e.key === 'k') { if (tasksRef.current === 'cockpit') setView(null); else openCockpit(selNote?.customer || customer); }
      else if (e.key === 'c' && dailyVault() && !editIdRef.current && !safeMode) { e.preventDefault(); setCaptureOpen(true); }
      else if (e.key === 'd' && dailyVault() && !editIdRef.current) { e.preventDefault(); openDaily(); }
      else if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && vault.writableVaults.length && !editIdRef.current) { e.preventDefault(); setNewOpen(true); }
      else if (e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey && selNote?.writable && selNote.kind !== 'drawing') { e.preventDefault(); setEditId(selNote.id); }
      else if (e.key === 'ArrowRight' && next) select(next.id);
      else if (e.key === 'ArrowLeft' && prev) select(prev.id);
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [next, prev, select, selNote, toggleView, openCockpit, customer]);   // eslint-disable-line react-hooks/exhaustive-deps
  // warn before closing the tab with unsaved edits; our own saves refresh the data once editing ends, external changes reload as before
  useEffect(() => {
    const bu = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', bu);
    const hot = (import.meta as any).hot;
    const own = () => { if (editIdRef.current) staleRef.current = true; else reloadSoon(); };
    hot?.on('km:self-write', own);
    return () => { removeEventListener('beforeunload', bu); hot?.off?.('km:self-write', own); };
  }, []);

  const scopeSeg = (
    <div className="seg" role="group" aria-label="Search in">
      <button className={scope === 'names' ? 'on' : ''} onClick={() => setScope('names')} title="Match note names only">Names</button>
      <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} title="Match names, tags, summaries and note text">Everything</button>
    </div>
  );

  return (
    <>
      <Graph notes={vault.notes} edges={vault.edges} selectedId={selected} panelWidth={panelW} colors={colors} matchIds={graphMatches} markIds={hl && changed.size ? changed : null} tints={tints} hide={hide} intro={introOn} onSelect={select} onHover={id => { if (id && soundRef.current !== 'off') tick(); }} />
      <div className="search-wrap">
        <div ref={headRef}>
        <div className="search-row">
          <input id="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={"Search notes   /  or  \u2318O"} autoComplete="off" spellCheck={false}
            onKeyDown={e => {
              const shown = Math.min(hits.length, 25);
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(shown - 1, c + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
              else if (e.key === 'Enter' && hits[cursor]) { select(hits[cursor].note.id); setQuery(''); (e.target as HTMLElement).blur(); }
            }} />
          <button className={'icon-btn' + (browse ? ' on' : '')} onClick={() => setBrowse(v => !v)} aria-label="Browse notes" title="Browse: new, recent, tree, health  (b)">
            {changed.size > 0 && <span className="count-badge">{changed.size > 99 ? '99+' : changed.size}</span>}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></svg>
          </button>
          <button className={'icon-btn' + (view === 'today' ? ' on' : '')} onClick={() => toggleView('today')} aria-label="Today" title="Today: due tasks, where you left off, captures  (h)">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" /></svg>
          </button>
          {customers.length > 0 && <button className={'icon-btn' + (view === 'cockpit' ? ' on' : '')} onClick={() => (view === 'cockpit' ? setView(null) : openCockpit(selNote?.customer || customer))} aria-label="Customer cockpit" title="Customer cockpit  (k)">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M2.5 14V4.5l5-2.5v12M7.5 14V6.5l6 2.5v5M1.5 14h13M4.5 6.5v.01M4.5 9v.01M4.5 11.5v.01M10 10.5v.01M10 12.5v.01" strokeLinecap="round" /></svg>
          </button>}
          <button className={'icon-btn' + (tasksOpen ? ' on' : '')} onClick={() => toggleView('tasks')} aria-label="Tasks" title={`Tasks: ${allTasks.length} open checkboxes from all notes  (t)`}>
            {allTasks.length > 0 && <span className="count-badge">{allTasks.length > 99 ? '99+' : allTasks.length}</span>}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M5.5 8.2l1.8 1.8 3.4-3.8" /></svg>
          </button>
          {vault.writableVaults.length > 0 && <button className="icon-btn" onClick={() => setNewOpen(true)} aria-label="New note" title="New note from a template  (n)">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
          </button>}
          <button className={'icon-btn' + (filterOpen || filterCount ? ' on' : '')} onClick={() => setFilterOpen(v => !v)} aria-label="Filters" title="Filter by section or tag">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3.5h12L9.5 9v4l-3-1.5V9z" /></svg>
            {filterCount > 0 && <span className="count-badge">{filterCount}</span>}
          </button>
        </div>
        {matches && (
          <div className="active-filters">
            {focus && byId.get(focus.id) && <span className="focus-chip"><button className="chip active" onClick={() => { setFocus(null); setFocusMode(false); }} title="Clear focus">Focus: {shortTitle(byId.get(focus.id)!.title)} &times;</button>
              <span className="seg" role="group" aria-label="Hops"><button className={focus.hops === 1 ? 'on' : ''} onClick={() => setFocus({ ...focus, hops: 1 })}>1 hop</button><button className={focus.hops === 2 ? 'on' : ''} onClick={() => setFocus({ ...focus, hops: 2 })}>2 hops</button></span></span>}
            {vaultSel.map(v => <button key={v} className="chip active" onClick={() => setVaultSel(vaultSel.filter(x => x !== v))}>{v} &times;</button>)}
            {section && <button className="chip active" onClick={() => setSection(null)}>{section.replace(/-/g, ' ')} &times;</button>}
            {tags.map(t => <button key={t} className="chip active" onClick={() => toggleTag(t)}>{t} &times;</button>)}
            {FACETS.flatMap(f => (facets[f] ?? []).map(v => <button key={f + v} className="chip active" onClick={() => toggleFacet(f, v)}>{f}: {v} &times;</button>))}
            <span className="match-count">{matches.size} of {vault.notes.length}</span>
            <div className="seg" role="group" aria-label="Non-matching notes">
              <button className={!hide ? 'on' : ''} onClick={() => setHide(false)} title="Fade non-matching notes">Dim</button>
              <button className={hide ? 'on' : ''} onClick={() => setHide(true)} title="Remove non-matching notes from the map">Hide</button>
            </div>
          </div>
        )}
        </div>
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
            {FACETS.filter(f => facetVals[f].length).map(f => <div key={f}>
              <div className="eyebrow"><span>{f[0].toUpperCase() + f.slice(1)}</span></div>
              <div className="sec-list">{facetVals[f].map(([v, c]) => {
                const g = f === 'type' && colorBy === 'type' ? TYPE_GROUPS.find(x => x.types.includes(v)) : null;
                return <button key={v} className={'chip' + (facets[f]?.includes(v) ? ' active' : '')} onClick={() => toggleFacet(f, v)}>{g && <i className="type-dot" style={{ background: dark ? g.dark : g.light }} />}{v} <small>{c}</small></button>;
              })}</div></div>)}
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
            <div className="res-tips">Tips: <code>"exact phrase"</code> <code>-skip</code> <code>tag:agents</code> <code>vault:work</code> <code>path:wiki</code> <code>type:bug</code> <code>-status:stale</code></div>
          </div>
        )}
      </div>
 {introMsg && <div className="intro-status" style={{ marginLeft: -panelW / 2 }}>
        {vault.notes.length} notes &middot; {vault.vaults.length} {vault.vaults.length === 1 ? 'vault' : 'vaults'}
        {changed.size > 0 && <> &middot; <button onClick={() => { try { localStorage.setItem('browseTab', 'new'); } catch {} setBrowseKey(k => k + 1); setBrowse(true); setIntroMsg(false); }}>{changed.size} updated since you last looked</button></>}
      </div>}
 {tasksOpen && <Tasks right={panelW} tasks={allTasks} vaults={[...new Set(allTasks.map(t => t.note.vault))]} selected={selected} current={selNote} onSelect={select} onClose={() => setView(null)} canTick={!safeMode} />}
 {view === 'today' && <Today right={panelW} notes={vault.notes} tasks={allTasks} current={selNote} customers={customers} canTick={!safeMode} onSelect={select} onClose={() => setView(null)} onCockpit={openCockpit} onCapture={() => setCaptureOpen(true)} onDaily={openDaily} />}
 {view === 'cockpit' && <Cockpit customer={customer} customers={customers} right={panelW} notes={vault.notes} tasks={allTasks} changed={changed} canTick={!safeMode} selected={selected} onCustomer={setCustomer} onSelect={select} onClose={() => setView(null)} />}
 {browse && <Browse key={browseKey} top={browseTop} notes={vault.notes} byId={byId} brokenLinks={vault.brokenLinks} lint={lintIssues} changed={changed} onMarkAllSeen={markAllSeen} hl={hl} onHl={setHl} selected={selected} onSelect={select} onClose={() => setBrowse(false)} />}
      <div className="top-right" style={{ right: panelW + 20 }}>
        <button className={'icon-btn' + (info ? ' on' : '')} onClick={() => setInfo(v => !v)} aria-label="About this map" title="About">i</button>
        {info && (
          <div className="info-pop" role="dialog">
            <div className="eyebrow">Knowledge map</div>
            <p><b>{vault.vaults.join(' + ')}</b><br />{vault.notes.length} notes, {vault.edges.length} links{vault.broken.length ? `, ${vault.broken.length} broken wikilinks` : ''}{safeMode ? `. Safe mode: ${vault.hiddenCount} notes hidden` : ''}</p>
            <div className="eyebrow">Controls</div>
            <p className="keys"><kbd>drag</kbd> rotate &nbsp; <kbd>shift</kbd>+<kbd>drag</kbd> pan &nbsp; <kbd>scroll</kbd> zoom &nbsp; <kbd>click</kbd> open<br /><kbd>&#8984;K</kbd> commands &nbsp; <kbd>/</kbd> search &nbsp; <kbd>h</kbd> today &nbsp; <kbd>k</kbd> cockpit &nbsp; <kbd>t</kbd> tasks &nbsp; <kbd>c</kbd> capture &nbsp; <kbd>d</kbd> journal &nbsp; <kbd>n</kbd> new note &nbsp; <kbd>b</kbd> browse &nbsp; <kbd>&larr;</kbd><kbd>&rarr;</kbd> prev / next &nbsp; <kbd>esc</kbd> close / leave focus mode</p>
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
        <button className={'icon-btn' + (safeMode ? ' on safe' : '')} aria-pressed={safeMode} aria-label="Safe mode" title={safeMode ? `Safe mode on: only notes marked public or internal are shown (${vault.hiddenCount} hidden). Click to show everything` : 'Safe mode for screen sharing: show only notes marked public or internal'}
          onClick={() => setSafeMode(!safeMode)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M8 1.5l5.5 2v4.2c0 3.2-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.6-5.5-6.8V3.5z" />{safeMode && <path d="M5.5 8l1.8 1.8 3.3-3.6" strokeLinecap="round" />}</svg>
        </button>
        <button className={'icon-btn' + (colorBy === 'type' ? ' on' : '')} aria-pressed={colorBy === 'type'} aria-label="Color by type" title={colorBy === 'type' ? 'Coloring notes by type. Click to turn off' : 'Color notes by type'}
          onClick={() => setColorBy(c => (c === 'type' ? 'none' : 'type'))}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="5.5" r="2.6" /><circle cx="11" cy="5.5" r="2.6" /><circle cx="8" cy="11" r="2.6" /></svg>
        </button>
        <button className={'icon-btn' + (focusMode ? ' on' : '')} aria-pressed={focusMode} aria-label="Focus mode" title={focusMode ? 'Focus mode on: every note you pick becomes the focus. Esc to leave' : 'Focus mode: every note you pick becomes the focus until Esc'}
          onClick={() => { if (focusMode) { setFocusMode(false); setFocus(null); } else { setFocusMode(true); if (selNote) setFocus({ id: selNote.id, hops: hopsRef.current }); } }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2.2" fill="currentColor" /><circle cx="8" cy="8" r="5.6" /><path d="M8 0.8v2.2M8 13v2.2M0.8 8H3M13 8h2.2" /></svg>
        </button>
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
      {colorBy === 'type' && <div className="type-legend" style={{ right: panelW + 20 }} aria-label="Color legend">
        {TYPE_GROUPS.map(g => <span key={g.key} title={g.types.join(', ')}><i className="type-dot" style={{ background: dark ? g.dark : g.light }} />{g.label}</span>)}
        <span title="every other type, or no type"><i className="type-dot neutral" />Other</span>
      </div>}
      {safeMode && <button className="safe-badge" onClick={() => setSafeMode(false)} title="Click to leave safe mode">Safe mode: {vault.hiddenCount} notes hidden</button>}
      {newOpen && <NewNote vaults={vault.writableVaults} current={selNote} onClose={() => setNewOpen(false)} />}
      {captureOpen && !safeMode && dailyVault() && <Capture vaults={vault.writableVaults} onClose={() => setCaptureOpen(false)}
        onDone={(v, p) => { const m = `Captured to ${v}: ${p}`; try { sessionStorage.setItem('kmToast', m); } catch {} setCaptureOpen(false); setToast(m); }} />}
      {paletteOpen && <Palette actions={actions} findNotes={findNotes} onOpen={id => select(id)} onClose={() => setPaletteOpen(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      <Panel editing={!!note && editId === note.id} draft={draftRef.current} onEdit={() => note && setEditId(note.id)} onEditEnd={() => endEdit()} onDirty={d => { dirtyRef.current = d; }} onSaved={(id, mtime) => setSeenState(s => ({ ...s, seen: { ...s.seen, [id]: mtime } }))} onDelete={deleteNote} dark={dark} width={maxed ? vw : fullW} maxed={maxed} onMax={() => setMaxed(m => !m)} fs={fs} onFs={setFs} onResize={w => setPanelPref(w === 0 ? 0 : Math.round(w))} open={!!note} note={note ?? lastNote.current} index={idx >= 0 ? idx : Math.max(0, navOrder.indexOf(lastNote.current?.id ?? ''))} total={navOrder.length} byId={byId} resolve={resolve} prev={prev ?? (lastNote.current ? byId.get(order[(order.indexOf(lastNote.current.id) - 1 + order.length) % order.length])! : null)} next={next ?? (lastNote.current ? byId.get(order[(order.indexOf(lastNote.current.id) + 1) % order.length])! : null)}
        onNav={select} onTag={t => { setTags(ts => (ts.includes(t) ? ts : [...ts, t])); setFilterOpen(true); }} onFacet={(f, v) => { if (!facets[f]?.includes(v)) toggleFacet(f, v); setFilterOpen(true); }} onCockpit={c => openCockpit(c)} tint={note ? tints?.get(note.id) : undefined} onClose={() => select(null)} />
    </>
  );
}
