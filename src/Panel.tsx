import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import Drawing from './Drawing';
import Editor, { type Draft } from './Editor';
import History from './History';
import Rename from './Rename';
import type { Note } from 'virtual:vault';
import { esc, restTitle, shortTitle } from './util';
import { contextPack } from './contextPack';
import { facetOf, type Facet } from './facets';
import vault, { safeMode } from './data';
const vaultNotes = vault.notes, jiraBase = vault.jiraBase;
import { setTaskInRaw, taskKey } from './taskScan';
import { rawNote, saveNote } from './api';
import { unlinkedMentions, linkFirstMention } from './mentions';
import { weeklyPrompt, ticketFor, ofCustomer, pretty } from './cockpitData';
import Crumbs, { crumbsFor, scopeOf } from './Crumbs';
import PersonProfile from './PersonProfile';
import { isPerson } from './circlesData';

type Props = {
  dark: boolean; width: number; maxed: boolean; onMax: () => void; fs: number; onFs: (v: number) => void; onResize: (w: number) => void;
  open: boolean; note: Note | null; index: number; total: number; byId: Map<string, Note>; resolve: (from: Note, name: string) => Note | undefined;
  prev: Note | null; next: Note | null; onNav: (id: string) => void; onTag: (t: string) => void; onFacet: (f: Facet, v: string) => void; tint?: string; onClose: () => void; onDelete: (id: string) => Promise<string | null>;
  onCockpit: (customer: string) => void;
  onPath: () => void;
  editing: boolean; draft: Draft | null; onEdit: () => void; onEditEnd: (saved: boolean) => void; onSaved: (id: string, mtime: number) => void; onDirty: (d: boolean) => void;
};

type Toc = { id: string; text: string; level: number }[];
const plain = (h: string) => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const slug = (t: string) => t.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
// the line of `from` that mentions `target`, as plain text, so "Linked from" can show why the link exists
const mention = (from: Note, target: Note) => {
  const base = target.path.split('/').pop()!.replace(/\.(md|excalidraw)$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[\\[\\s*(?:[^\\]|]*/)?${base}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]|\\]\\([^)]*${base}\\.md`, 'i');
  const line = from.body.split('\n').find(l => re.test(l));
  if (!line) return '';
  const t = line.replace(/^[\s>#*+-]+/, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
  return t.length > 170 ? t.slice(0, 168) + '..' : t;
};

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24); if (d < 30) return d === 1 ? 'yesterday' : d + ' days ago';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const HEAD_FACETS: Facet[] = ['type', 'customer', 'project', 'component', 'status', 'sensitivity'];

// Prints just the note (see @media print in styles.css). The browser's print dialog has Save as PDF; the title becomes the file name.
function exportPdf(title: string) {
  const old = document.title, done = () => { document.title = old; removeEventListener('afterprint', done); };
  document.title = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || old;
  addEventListener('afterprint', done);
  requestAnimationFrame(() => print());
}

export default function Panel({ dark, width, maxed, onMax, fs, onFs, onResize, open, note, index, total, byId, resolve, prev, next, onNav, onTag, onFacet, tint, onClose, onDelete, onCockpit, onPath, editing, draft, onEdit, onEditEnd, onSaved, onDirty }: Props) {
  const [tocOpen, setTocOpen] = useState(false);
  const [hist, setHist] = useState(false);
  const [ren, setRen] = useState(false);
  useEffect(() => { setHist(false); setRen(false); }, [note?.id]);
  const [card, setCard] = useState<{ id: string; x: number; y: number } | null>(null);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCard = (el: HTMLElement) => {
    const id = el.dataset.id; if (!id) return;
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => { const r = el.getBoundingClientRect(); setCard({ id, x: r.left, y: r.bottom + 8 }); }, 260);
  };
  const hideCard = () => { if (cardTimer.current) clearTimeout(cardTimer.current); setCard(null); };
  const hov = (id: string) => ({ 'data-id': id, onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showCard(e.currentTarget), onMouseLeave: hideCard });
  useEffect(() => { setTocOpen(false); hideCard(); }, [note?.id]);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delErr, setDelErr] = useState('');
  useEffect(() => { setConfirmDel(false); setDelErr(''); }, [note?.id]);
  // Read more / Show less is remembered for every note (localStorage noteFull) until clicked again; notes open in full by default
  const fullPref = () => { try { return localStorage.getItem('noteFull') !== '0'; } catch { return true; } };
  const [expanded, setExpanded] = useState(fullPref);
  const toggleFull = () => { const next = !expanded; try { localStorage.setItem('noteFull', next ? '1' : '0'); } catch {} setExpanded(next); };
  const [tickErr, setTickErr] = useState('');
  useEffect(() => setTickErr(''), [note?.id]);
  // a click on a checkbox in the note: find the same task in the file (by its text) and save the flipped box; the page refreshes after
  const onTick = async (box: HTMLInputElement) => {
    if (!note || box.dataset.busy) return;
    const own = (b: HTMLInputElement) => { const li = b.closest('li')!.cloneNode(true) as HTMLElement; li.querySelectorAll('ul, ol, a, span.wl, input').forEach(x => x.remove()); return taskKey(li.textContent || ''); };
    const key = own(box), boxes = [...(mdRef.current?.querySelectorAll<HTMLInputElement>('input.task-box') || [])];
    const occurrence = boxes.slice(0, boxes.indexOf(box)).filter(b => own(b) === key).length;
    const want = !box.hasAttribute('checked');
    box.dataset.busy = '1'; setTickErr('');
    try {
      const r = await rawNote(note.id);
      if (r.status !== 200) throw new Error(r.json.error || 'could not read the note');
      const text = setTaskInRaw(r.json.text, key, occurrence, want, /^\s*##\s+Summary\s*\n/i.test(note.body) && !!note.body.replace(/^\s*##\s+Summary\s*\n[\s\S]*?(?=\n##\s|(?![\s\S]))/i, '').trim());
      if (text === null) throw new Error('could not find this task in the file (open the editor with e to change it)');
      const sv = await saveNote(note.id, text, r.json.hash);
      if (sv.status !== 200) throw new Error(sv.json.error || 'save failed (HTTP ' + sv.status + ')');
      box.checked = want; want ? box.setAttribute('checked', '') : box.removeAttribute('checked');
      onSaved(note.id, Math.round(sv.json.mtime || Date.now()));
    } catch (e) { box.checked = !want; setTickErr((e as Error).message); }
    finally { delete box.dataset.busy; }
  };
  const [copied, setCopied] = useState('');
  // unlinked mentions are computed only when that section is opened
  const [umOpen, setUmOpen] = useState(false);
  const [umDone, setUmDone] = useState<Set<string>>(() => new Set());
  const [umErr, setUmErr] = useState('');
  useEffect(() => { setUmOpen(false); setUmDone(new Set()); setUmErr(''); }, [note?.id]);
  const crumbs = useMemo(() => (note ? crumbsFor([...byId.values()], scopeOf(note)).filter(c => c.hub?.id !== note.id) : []), [note, byId]);
  const unlinked = useMemo(() => (umOpen && note ? unlinkedMentions(note, [...byId.values()]) : []), [umOpen, note, byId]);
  const linkMention = async (src: Note) => {
    if (!note) return; setUmErr('');
    try {
      const r = await rawNote(src.id);
      if (r.status !== 200) throw new Error(r.json.error || 'could not read the note');
      const text = linkFirstMention(r.json.text, note);
      if (text === null) throw new Error('the mention is no longer in the file');
      const sv = await saveNote(src.id, text, r.json.hash);
      if (sv.status !== 200) throw new Error(sv.json.error || 'save failed (HTTP ' + sv.status + ')');
      setUmDone(d => new Set(d).add(src.id));
    } catch (e) { setUmErr(`${shortTitle(src.title)}: ${(e as Error).message}`); }
  };
  const [resizing, setResizing] = useState(false);
  const [serif, setSerif] = useState(() => { try { return localStorage.getItem('readFont') === 'serif'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('readFont', serif ? 'serif' : 'sans'); } catch {} }, [serif]);
  const progRef = useRef<HTMLDivElement>(null);
  const onBodyScroll = () => { hideCard(); const b = bodyRef.current, p = progRef.current; if (b && p) { const max = b.scrollHeight - b.clientHeight; p.style.transform = `scaleX(${max > 4 ? b.scrollTop / max : 0})`; } };
  const bodyRef = useRef<HTMLDivElement>(null);
  const mdRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setExpanded(fullPref()); setCopied(''); bodyRef.current?.scrollTo(0, 0); if (progRef.current) progRef.current.style.transform = 'scaleX(0)'; }, [note?.id]);

  const { html, toc } = useMemo((): { html: string; toc: Toc } => {
    if (!note) return { html: '', toc: [] };
    const body = note.body.replace(/^\s*##\s+Summary\s*\n[\s\S]*?(?=\n##\s|(?![\s\S]))/i, '').trim() || note.body;
    const link = (seg: string) => seg.replace(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, t: string, alias?: string) => {
      const n = resolve(note, t);
      return n ? `<a class="wl" data-id="${esc(n.id)}">${esc(alias || n.title)}</a>` : `<span class="wl dead">${esc(alias || t)}</span>`;
    });
    // leave fenced blocks and inline code untouched
    const withLinks = body.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((seg, i) => (i % 2 ? seg : link(seg))).join('');
    // web links open in a new tab so they never replace the app window
    let out = marked.parse(withLinks, { async: false }) as string;
    // [text](./other.md) between notes behaves like a wikilink
    out = out.replace(/<a href="(?!https?:|mailto:|#)([^"]+?\.md)(?:#[^"]*)?"[^>]*>/g, (_, href: string) => {
      let name = href; try { name = decodeURIComponent(href); } catch {}
      const n = resolve(note, name);
      return n ? `<a class="wl" data-id="${esc(n.id)}">` : '<a class="wl dead">';
    });
    out = out.replace(/<a href="(https?:)/g, '<a target="_blank" rel="noopener noreferrer" href="$1');
    // Obsidian callouts: > [!note] Title
    out = out.replace(/<blockquote>\s*<p>\[!([\w-]+)\][+-]?[ \t]*([^\n]*?)(?:\n|(?=<\/p>))/g, (_, type: string, title: string) =>
      `<blockquote class="callout c-${type.toLowerCase()}"><p class="callout-title">${title || type[0].toUpperCase() + type.slice(1).toLowerCase()}</p><p>`);
    // Dataview is not executed here; say so instead of showing a bare query
    out = out.replace(/<pre><code class="language-dataview(?:js)?">/g, '<div class="dv-note">Dataview query, not run in this viewer</div>$&');
    // checkboxes can be ticked in writable notes (not in Safe mode, where link text is masked and would not match the file)
    if (note.writable && !safeMode) out = out.replace(/<input (checked="" )?disabled="" type="checkbox">/g, (_, c?: string) => `<input ${c || ''}type="checkbox" class="task-box" title="Click to ${c ? 'untick' : 'tick'} (saves the note)">`);
    // heading ids for the table of contents
    const toc: Toc = [], seen = new Map<string, number>();
    out = out.replace(/<h([2-4])>([\s\S]*?)<\/h\1>/g, (_, lv: string, inner: string) => {
      const text = plain(inner); let id = slug(text); const k = seen.get(id) || 0; seen.set(id, k + 1); if (k) id += '-' + k;
      toc.push({ id, text, level: +lv });
      return `<h${lv} id="${id}">${inner}</h${lv}>`;
    });
    return { html: out, toc };
  }, [note, resolve]);
  const goTo = (id: string) => { setExpanded(true); setTimeout(() => mdRef.current?.querySelector('#' + CSS.escape(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };

  // ![[drawing]] embeds arrive as placeholders; mount the rendered drawing into each one
  useEffect(() => {
    const host = mdRef.current; if (!host) return;
    const roots: Root[] = [];
    host.querySelectorAll<HTMLElement>('.xl-embed').forEach(el => {
      const n = byId.get(el.dataset.id || '');
      if (n?.scene) { const r = createRoot(el); r.render(<Drawing scene={n.scene} dark={dark} />); roots.push(r); }
    });
    return () => { setTimeout(() => roots.forEach(r => r.unmount())); };
  }, [html, dark, byId]);

  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1400); });
  const outs = note ? note.links.map(i => byId.get(i)!).filter(Boolean) : [];
  const ins = useMemo(() => (note ? note.backlinks.map(i => byId.get(i)!).filter(Boolean).map(b => ({ n: b, ctx: mention(b, note) })) : []), [note, byId]);
  const obsidian = note ? `obsidian://open?vault=${encodeURIComponent(note.vault)}&file=${encodeURIComponent(note.path.replace(/\.md$/, ''))}` : '#';
  const sub = note ? restTitle(note.title) : '';

  return (
    <aside className={'panel' + (open ? ' open' : '') + (resizing ? ' resizing' : '') + (maxed ? ' max' : '') + (serif ? ' serif' : '')} aria-hidden={!open} style={{ width, ['--fs' as string]: fs, ['--band' as string]: tint || 'var(--accent)' }}>
      {!maxed && <div className="p-resize" title="Drag to resize" onPointerDown={e => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setResizing(true); }}
        onPointerMove={e => { if (resizing) onResize(innerWidth - e.clientX); }} onPointerUp={() => setResizing(false)} onPointerCancel={() => setResizing(false)} onDoubleClick={() => onResize(0)} />}
      {note && (
        <>
          <header className="p-head">
            <span className="eyebrow">{note.section.replace(/-/g, ' ')}</span>
            <span className="p-head-right">
              <span className="fs-ctl" title="Text size"><button className={'font-btn' + (serif ? ' on' : '')} onClick={() => setSerif(v => !v)} aria-pressed={serif} aria-label="Serif reading font" title={serif ? 'Serif reading font on. Click for sans' : 'Read in a serif font'}>Aa</button><button onClick={() => onFs(Math.max(0.8, +(fs - 0.1).toFixed(2)))} aria-label="Smaller text">A&minus;</button><button onClick={() => onFs(1)} aria-label="Reset text size" className="fs-val">{Math.round(fs * 100)}%</button><button onClick={() => onFs(Math.min(1.7, +(fs + 0.1).toFixed(2)))} aria-label="Larger text">A+</button></span>
              <button className="icon-btn" onClick={onMax} aria-label={maxed ? 'Exit full screen' : 'Full screen'} title={maxed ? 'Exit full screen (Esc)' : 'Full screen'}>{maxed ? '\u2923' : '\u2922'}</button>
              <span className="idx"><b>{index + 1}</b> / {total}</span><button className="icon-btn" onClick={onClose} aria-label="Close">&times;</button></span>
            <div className="p-band" /><div className="p-prog" ref={progRef} />
          </header>
          {ren && note.writable && !editing ? (
            <div className="p-body editing" key={'ren-' + note.id}>
              <div className="ed-title">Rename or move<small>{note.path}</small></div>
              <Rename note={note} onClose={() => setRen(false)} />
            </div>
          ) : hist && note.writable && !editing ? (
            <div className="p-body editing" key={'hist-' + note.id}>
              <div className="ed-title">{shortTitle(note.title)}<small>{note.path}</small></div>
              <History note={note} onClose={() => setHist(false)} onRestored={mt => onSaved(note.id, mt)} />
            </div>
          ) : editing && note.writable ? (
            <div className="p-body editing" key={'edit-' + note.id}>
              <div className="ed-title">{shortTitle(note.title)}<small>{note.path}</small></div>
              <Editor note={note} draft={draft} onEnd={onEditEnd} onSaved={mt => onSaved(note.id, mt)} onDirty={onDirty} />
            </div>
          ) : (
          <div className="p-body" ref={bodyRef} key={note.id} onScroll={onBodyScroll}>
            <Crumbs className="eyebrow p-crumbs" parts={crumbs} selfId={note.id} onOpen={onNav} onFacet={onFacet} />
            <h1 className="p-title">{shortTitle(note.title)}</h1>
            {sub && <div className="p-sub">{sub}</div>}
            <p className="p-lead">{note.summary}</p>
            {HEAD_FACETS.some(f => facetOf(note, f)) && <div className="p-facets">
              {HEAD_FACETS.map(f => { const v = facetOf(note, f); return v && <button key={f} className={'facet f-' + f + ' v-' + v.replace(/[^\w-]/g, '')} onClick={() => onFacet(f, v)} title={`Show only notes with ${f}: ${v}`}><small>{f}</small>{v.replace(/-/g, ' ')}</button>; })}
            </div>}
            <div className="p-meta">{[
              'Edited ' + ago(note.mtime),
              note.kind !== 'drawing' && Math.max(1, Math.round(note.body.split(/\s+/).filter(Boolean).length / 220)) + ' min read',
              `${note.backlinks.length} ${note.backlinks.length === 1 ? 'link' : 'links'} in, ${note.links.length} out`,
              note.fetched && 'fetched ' + note.fetched,
            ].filter(Boolean).join('  \u00b7  ')}</div>
            {isPerson(note) && <PersonProfile note={note} canWrite={note.writable && !safeMode} resolve={resolve} onNav={onNav} />}
            {note.kind === 'drawing' && note.scene && <section className="print-keep"><div className="label">Drawing</div><Drawing scene={note.scene} dark={dark} /></section>}
            {note.kind !== 'drawing' && toc.length >= 3 && <section className="toc">
              <button className="toc-head" onClick={() => setTocOpen(v => !v)} aria-expanded={tocOpen}><span className="label">Contents ({toc.length})</span><span className={'chev' + (tocOpen ? ' flip' : '')}>&#8964;</span></button>
              {tocOpen && <ol>{toc.map(t => <li key={t.id} style={{ paddingLeft: (t.level - 2) * 14 }}><button onClick={() => goTo(t.id)}>{t.text}</button></li>)}</ol>}
            </section>}
            {note.kind !== 'drawing' && <section className="print-keep">
              <div className="label">Full note</div>
              {tickErr && <div className="tick-err">{tickErr}</div>}
              <div ref={mdRef} className={'md' + (expanded || maxed ? ' expanded' : '')} dangerouslySetInnerHTML={{ __html: html }}
                onClick={e => { const t = e.target as HTMLElement; if (t instanceof HTMLInputElement && t.classList.contains('task-box')) { e.preventDefault(); onTick(t); return; } const a = t.closest('a.wl[data-id]') as HTMLElement | null; if (a) { hideCard(); onNav(a.dataset.id!); } }}
                onMouseOver={e => { const a = (e.target as HTMLElement).closest('a.wl[data-id]') as HTMLElement | null; if (a) showCard(a); }}
                onMouseOut={e => { if ((e.target as HTMLElement).closest('a.wl[data-id]')) hideCard(); }} />
              {!maxed && <button className="read-more" onClick={toggleFull} title={expanded ? 'Show the start of notes from now on' : 'Open notes in full from now on'}>{expanded ? 'Show less' : 'Read more'} <span className={expanded ? 'flip' : ''}>&#8964;</span></button>}
            </section>}
            {note.kind === 'drawing' && note.body && <section className="print-keep"><div className="label">Text in this drawing</div><div className="md expanded"><p style={{ whiteSpace: 'pre-wrap' }}>{note.body}</p></div></section>}
            {outs.length > 0 && <section><div className="label">Links to ({outs.length})</div><div className="chips">{outs.map(c => <button key={c.id} className="chip" {...hov(c.id)} onClick={() => { hideCard(); onNav(c.id); }}>{shortTitle(c.title)}</button>)}</div></section>}
            <section><div className="label">Linked from ({ins.length})</div>
              {ins.length ? <ul className="bl">{ins.map(({ n, ctx }) => (
                <li key={n.id}><button {...hov(n.id)} onClick={() => { hideCard(); onNav(n.id); }}><b>{shortTitle(n.title)}</b><small>{n.section.replace(/-/g, ' ')}</small>{ctx && <span>{ctx}</span>}</button></li>
              ))}</ul> : <div className="src muted">Nothing links here yet.</div>}
            </section>
            {note.kind !== 'drawing' && <section className="um">
              <button className="toc-head" onClick={() => setUmOpen(v => !v)} aria-expanded={umOpen}><span className="label">Unlinked mentions{umOpen ? ` (${unlinked.length})` : ''}</span><span className={'chev' + (umOpen ? ' flip' : '')}>&#8964;</span></button>
              {umOpen && <>
                {umErr && <div className="tick-err">{umErr}</div>}
                {unlinked.length ? <ul className="bl">{unlinked.map(({ note: n, ctx }) => (
                  <li key={n.id} className="um-row"><button {...hov(n.id)} onClick={() => { hideCard(); onNav(n.id); }}><b>{shortTitle(n.title)}</b><small>{n.section.replace(/-/g, ' ')}</small>{ctx && <span>{ctx}</span>}</button>
                    {n.writable && !safeMode && (umDone.has(n.id) ? <span className="um-ok">linked</span> : <button className="btn um-link" onClick={() => linkMention(n)} title="Turn the first mention in that note into a [[link]] to this note">Link</button>)}</li>
                ))}</ul> : <div className="src muted">No other note names this one without linking to it.</div>}
              </>}
            </section>}
            {note.tags.length > 0 && <section><div className="label">Tags</div><div className="chips">{note.tags.map(t => <button key={t} className="chip tag" onClick={() => onTag(t)}>{t}</button>)}</div></section>}
            {note.source && <section><div className="label">Source</div><div className="src">{/^https?:/.test(note.source) ? <a href={note.source} target="_blank" rel="noreferrer">{note.source}</a> : note.source}</div></section>}
            <section><div className="label">File</div><div className="src muted" title="Full path">{note.abs}</div></section>
            <div className="actions">
              {note.customer && <button className="btn" onClick={() => onCockpit(note.customer)} title="Everything open and new for this customer  (k)">Open cockpit</button>}
              {note.type === 'hub' && (note.project || note.customer) && <button className="btn" onClick={() => {
                const all = [...byId.values()], list = note.project ? all.filter(n => n.project === note.project) : all.filter(n => ofCustomer(n, note.customer));
                copy('weekly', weeklyPrompt(pretty(note.project || note.customer), ticketFor(note, list), list));
              }} title="Copy a prompt for the /fde-weekly-jira-update skill with the notes changed this week">{copied === 'weekly' ? 'Prompt copied' : 'Weekly update prompt'}</button>}
              {note.writable && <button className="btn" onClick={onEdit} title="Edit this note's markdown (e)">Edit</button>}
              {note.writable && <button className="btn" onClick={() => setRen(true)} title="Rename or move this note and update links to it">Rename</button>}
              {note.writable && <button className="btn" onClick={() => setHist(true)} title="Saved versions of this note, compare and restore">History</button>}
              <button className="btn" onClick={() => copy('claude', contextPack(vaultNotes, note.id, jiraBase))} title="Copy a context pack for Claude Code: this note, its links and backlinks (paths and summaries), open tasks, questions and tickets">{copied === 'claude' ? 'Context copied' : 'Hand to Claude'}</button>
              <button className="btn" onClick={onPath} title="Shortest link path from this note to another one, drawn on the map  (p)">Path to...</button>
              <a className="btn primary" href={obsidian}>Open in Obsidian</a>
              <button className="btn" onClick={() => exportPdf(shortTitle(note.title))} title="Print this note, or choose Save as PDF in the print dialog">Export PDF</button>
              <button className="btn" onClick={() => { if (!note.abs) { location.reload(); return; } copy('path', note.abs); }} title={note.abs}>{copied === 'path' ? 'Path copied' : 'Copy path'}</button>
              <button className="btn" onClick={() => copy('share', location.origin + location.pathname + '#' + encodeURIComponent(note.id))}>{copied === 'share' ? 'Link copied' : 'Share'}</button>
              <button className="btn" onClick={() => copy('md', note.body)}>{copied === 'md' ? 'Copied' : 'Copy markdown'}</button>
              <button className="btn" onClick={() => copy('link', `[[${note.id}]]`)}>{copied === 'link' ? 'Copied' : 'Copy [[link]]'}</button>
              {!confirmDel
                ? <button className="btn danger" onClick={() => setConfirmDel(true)}>Delete</button>
                : <>
                    <button className="btn danger solid" onClick={async () => { const e = await onDelete(note.id); if (e) { setDelErr(e); setConfirmDel(false); } }}>Move to Trash?</button>
                    <button className="btn" onClick={() => setConfirmDel(false)}>Cancel</button>
                  </>}
            </div>
            {delErr && <div className="src muted" style={{ color: '#c0392b', marginTop: 8 }}>Delete failed: {delErr}</div>}
          </div>
          )}
          {!(editing && note.writable) && !(hist && note.writable) && !(ren && note.writable) && <nav className="p-nav">
            <button onClick={() => prev && onNav(prev.id)}><span>&#8592;</span><div><small>Prev</small>{prev ? shortTitle(prev.title) : ''}</div></button>
            <button onClick={() => next && onNav(next.id)} className="right"><div><small>Next</small>{next ? shortTitle(next.title) : ''}</div><span>&#8594;</span></button>
          </nav>}
        </>
      )}
      {card && byId.get(card.id) && createPortal((() => {
        const c = byId.get(card.id)!;
        return (
          <div className="hovercard" style={{ left: Math.max(12, Math.min(card.x, innerWidth - 332)), top: Math.min(card.y, innerHeight - 190) }}>
            <small>{c.section.replace(/-/g, ' ')}{c.status !== 'none' ? ' \u00b7 ' + c.status : ''}</small>
            <b>{shortTitle(c.title)}</b>
            <span>{c.summary || c.body.replace(/[#*`>\[\]]/g, '').slice(0, 220)}</span>
            {c.tags.length > 0 && <em>{c.tags.slice(0, 5).join('  ')}</em>}
          </div>
        );
      })(), document.body)}
    </aside>
  );
}
