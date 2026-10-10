import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import Drawing from './Drawing';
import Editor, { type Draft } from './Editor';
import History from './History';
import type { Note } from 'virtual:vault';
import { esc, restTitle, shortTitle } from './util';

type Props = {
  dark: boolean; width: number; maxed: boolean; onMax: () => void; fs: number; onFs: (v: number) => void; onResize: (w: number) => void;
  open: boolean; note: Note | null; index: number; total: number; byId: Map<string, Note>; resolve: (from: Note, name: string) => Note | undefined;
  prev: Note | null; next: Note | null; onNav: (id: string) => void; onTag: (t: string) => void; onClose: () => void; onDelete: (id: string) => Promise<string | null>;
  focusId: string | null; onFocus: (id: string | null) => void;
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

export default function Panel({ dark, width, maxed, onMax, fs, onFs, onResize, open, note, index, total, byId, resolve, prev, next, onNav, onTag, onClose, onDelete, focusId, onFocus, editing, draft, onEdit, onEditEnd, onSaved, onDirty }: Props) {
  const [tocOpen, setTocOpen] = useState(false);
  const [hist, setHist] = useState(false);
  useEffect(() => { setHist(false); }, [note?.id]);
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
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState('');
  const [resizing, setResizing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mdRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setExpanded(false); setCopied(''); bodyRef.current?.scrollTo(0, 0); }, [note?.id]);

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
    <aside className={'panel' + (open ? ' open' : '') + (resizing ? ' resizing' : '') + (maxed ? ' max' : '')} aria-hidden={!open} style={{ width, ['--fs' as string]: fs }}>
      {!maxed && <div className="p-resize" title="Drag to resize" onPointerDown={e => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setResizing(true); }}
        onPointerMove={e => { if (resizing) onResize(innerWidth - e.clientX); }} onPointerUp={() => setResizing(false)} onPointerCancel={() => setResizing(false)} onDoubleClick={() => onResize(0)} />}
      {note && (
        <>
          <header className="p-head">
            <span className="eyebrow">{note.section.replace(/-/g, ' ')}</span>
            <span className="p-head-right">
              <span className="fs-ctl" title="Text size"><button onClick={() => onFs(Math.max(0.8, +(fs - 0.1).toFixed(2)))} aria-label="Smaller text">A&minus;</button><button onClick={() => onFs(1)} aria-label="Reset text size" className="fs-val">{Math.round(fs * 100)}%</button><button onClick={() => onFs(Math.min(1.7, +(fs + 0.1).toFixed(2)))} aria-label="Larger text">A+</button></span>
              <button className="icon-btn" onClick={onMax} aria-label={maxed ? 'Exit full screen' : 'Full screen'} title={maxed ? 'Exit full screen (Esc)' : 'Full screen'}>{maxed ? '\u2923' : '\u2922'}</button>
              <span className="idx"><b>{index + 1}</b> / {total}</span><button className="icon-btn" onClick={onClose} aria-label="Close">&times;</button></span>
          </header>
          {hist && note.writable && !editing ? (
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
          <div className="p-body" ref={bodyRef} key={note.id} onScroll={hideCard}>
            <h1 className="p-title">{shortTitle(note.title)}</h1>
            {sub && <div className="p-sub">{sub}</div>}
            <p className="p-lead">{note.summary}</p>
            <div className="p-meta">
              {note.status !== 'none' && <span className={'badge ' + note.status}>{note.status}</span>}
              {note.fetched && <span className="muted">fetched {note.fetched}</span>}
            </div>
            {note.kind === 'drawing' && note.scene && <section><div className="label">Drawing</div><Drawing scene={note.scene} dark={dark} /></section>}
            {note.kind !== 'drawing' && toc.length >= 3 && <section className="toc">
              <button className="toc-head" onClick={() => setTocOpen(v => !v)} aria-expanded={tocOpen}><span className="label">Contents ({toc.length})</span><span className={'chev' + (tocOpen ? ' flip' : '')}>&#8964;</span></button>
              {tocOpen && <ol>{toc.map(t => <li key={t.id} style={{ paddingLeft: (t.level - 2) * 14 }}><button onClick={() => goTo(t.id)}>{t.text}</button></li>)}</ol>}
            </section>}
            {note.kind !== 'drawing' && <section>
              <div className="label">Full note</div>
              <div ref={mdRef} className={'md' + (expanded ? ' expanded' : '')} dangerouslySetInnerHTML={{ __html: html }}
                onClick={e => { const a = (e.target as HTMLElement).closest('a.wl[data-id]') as HTMLElement | null; if (a) { hideCard(); onNav(a.dataset.id!); } }}
                onMouseOver={e => { const a = (e.target as HTMLElement).closest('a.wl[data-id]') as HTMLElement | null; if (a) showCard(a); }}
                onMouseOut={e => { if ((e.target as HTMLElement).closest('a.wl[data-id]')) hideCard(); }} />
              <button className="read-more" onClick={() => setExpanded(v => !v)}>{expanded ? 'Show less' : 'Read more'} <span className={expanded ? 'flip' : ''}>&#8964;</span></button>
            </section>}
            {note.kind === 'drawing' && note.body && <section><div className="label">Text in this drawing</div><div className="md expanded"><p style={{ whiteSpace: 'pre-wrap' }}>{note.body}</p></div></section>}
            {outs.length > 0 && <section><div className="label">Links to ({outs.length})</div><div className="chips">{outs.map(c => <button key={c.id} className="chip" {...hov(c.id)} onClick={() => { hideCard(); onNav(c.id); }}>{shortTitle(c.title)}</button>)}</div></section>}
            <section><div className="label">Linked from ({ins.length})</div>
              {ins.length ? <ul className="bl">{ins.map(({ n, ctx }) => (
                <li key={n.id}><button {...hov(n.id)} onClick={() => { hideCard(); onNav(n.id); }}><b>{shortTitle(n.title)}</b><small>{n.section.replace(/-/g, ' ')}</small>{ctx && <span>{ctx}</span>}</button></li>
              ))}</ul> : <div className="src muted">Nothing links here yet.</div>}
            </section>
            {note.tags.length > 0 && <section><div className="label">Tags</div><div className="chips">{note.tags.map(t => <button key={t} className="chip tag" onClick={() => onTag(t)}>{t}</button>)}</div></section>}
            {note.source && <section><div className="label">Source</div><div className="src">{/^https?:/.test(note.source) ? <a href={note.source} target="_blank" rel="noreferrer">{note.source}</a> : note.source}</div></section>}
            <section><div className="label">File</div><div className="src muted" title="Full path">{note.abs}</div></section>
            <div className="actions">
              {note.writable && <button className="btn" onClick={onEdit} title="Edit this note's markdown (e)">Edit</button>}
              {note.writable && <button className="btn" onClick={() => setHist(true)} title="Saved versions of this note, compare and restore">History</button>}
              <a className="btn primary" href={obsidian}>Open in Obsidian</a>
              <button className="btn" onClick={() => onFocus(focusId === note.id ? null : note.id)} title="Show only this note and its neighbours on the map">{focusId === note.id ? 'Clear focus' : 'Focus on map'}</button>
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
          {!(editing && note.writable) && !(hist && note.writable) && <nav className="p-nav">
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
