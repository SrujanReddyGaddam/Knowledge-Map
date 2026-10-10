import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorSelection, EditorState, Prec, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { autocompletion, completionStatus, type CompletionContext } from '@codemirror/autocomplete';
import { suggest } from './linkSuggest';

// Live-preview markdown editor (like Obsidian): the document is the exact markdown text, we only style it and hide the syntax marks
// on lines the cursor is not on. Nothing is converted, so saving can never reformat a note.

class Bullet extends WidgetType { toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = '•'; return s; } eq() { return true; } }
const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new Bullet() });
const WIKI = /(!?)\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;

function build(view: EditorView): { all: DecorationSet; atomic: DecorationSet } {
  const { state } = view, doc = state.doc;
  const active = new Set<number>();
  for (const r of state.selection.ranges) for (let i = doc.lineAt(r.from).number, e = doc.lineAt(r.to).number; i <= e; i++) active.add(i);
  const isActive = (from: number, to: number) => { for (let i = doc.lineAt(from).number, e = doc.lineAt(to).number; i <= e; i++) if (active.has(i)) return true; return false; };
  const out: Range<Decoration>[] = [], hides: Range<Decoration>[] = [], code: [number, number][] = [];
  const lineDeco = (pos: number, cls: string) => out.push(Decoration.line({ class: cls }).range(doc.lineAt(pos).from));
  const mark = (from: number, to: number, cls: string) => { if (to > from) out.push(Decoration.mark({ class: cls }).range(from, to)); };
  const hideR = (from: number, to: number) => { if (to > from) { const r = hide.range(from, to); out.push(r); hides.push(r); } };

  // frontmatter block at the very top
  if (doc.lines > 1 && doc.line(1).text === '---') {
    for (let i = 2; i <= doc.lines; i++) if (doc.line(i).text === '---') { for (let k = 1; k <= i; k++) lineDeco(doc.line(k).from, 'cm-fm'); code.push([0, doc.line(i).to]); break; }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({ from, to, enter(n) {
      const name = n.name, h = /^ATXHeading(\d)$/.exec(name);
      if (h) { lineDeco(n.from, 'cm-h cm-h' + h[1]); return; }
      switch (name) {
        case 'HeaderMark': {
          if (isActive(n.from, n.to)) { mark(n.from, n.to, 'cm-syn'); break; }
          let end = n.to; if (n.from === doc.lineAt(n.from).from && doc.sliceString(n.to, n.to + 1) === ' ') end++;
          hideR(n.from, end); break;
        }
        case 'StrongEmphasis': mark(n.from, n.to, 'cm-strong'); break;
        case 'Emphasis': mark(n.from, n.to, 'cm-em'); break;
        case 'Strikethrough': mark(n.from, n.to, 'cm-del'); break;
        case 'InlineCode': mark(n.from, n.to, 'cm-icode'); code.push([n.from, n.to]); break;
        case 'EmphasisMark': case 'StrikethroughMark': isActive(n.from, n.to) ? mark(n.from, n.to, 'cm-syn') : hideR(n.from, n.to); break;
        case 'CodeMark': if (n.node.parent?.name === 'InlineCode') isActive(n.from, n.to) ? mark(n.from, n.to, 'cm-syn') : hideR(n.from, n.to); break;
        case 'FencedCode': case 'CodeBlock':
          code.push([n.from, n.to]);
          for (let i = doc.lineAt(n.from).number, e = doc.lineAt(n.to).number; i <= e; i++) lineDeco(doc.line(i).from, 'cm-fence' + (name === 'FencedCode' && (i === doc.lineAt(n.from).number || i === e) ? ' cm-fence-edge' : ''));
          break;
        case 'Blockquote': for (let i = doc.lineAt(n.from).number, e = doc.lineAt(n.to).number; i <= e; i++) lineDeco(doc.line(i).from, 'cm-quote'); break;
        case 'QuoteMark': mark(n.from, n.to, 'cm-syn'); break;
        case 'HorizontalRule': lineDeco(n.from, 'cm-hr'); break;
        case 'ListMark': {
          const t = doc.sliceString(n.from, n.to);
          if (/^[-*+]$/.test(t) && !isActive(n.from, n.to) && doc.sliceString(n.to, n.to + 1) === ' ') { const r = bullet.range(n.from, n.to); out.push(r); hides.push(r); }
          else mark(n.from, n.to, 'cm-listmark');
          break;
        }
        case 'Link': {
          const ms = n.node.getChildren('LinkMark');
          if (ms.length >= 2 && !isActive(n.from, n.to)) { hideR(ms[0].from, ms[0].to); mark(ms[0].to, ms[1].from, 'cm-link'); hideR(ms[1].from, n.to); }
          else mark(n.from, n.to, 'cm-linksrc');
          break;
        }
        case 'Image': mark(n.from, n.to, 'cm-syn'); break;
        case 'URL': break;
      }
    } });
    // [[wikilinks]] and ![[embeds]], outside code
    const text = doc.sliceString(from, to);
    for (const m of text.matchAll(WIKI)) {
      const s = from + m.index!, e = s + m[0].length;
      if (code.some(([a, b]) => s >= a && e <= b)) continue;
      const embed = m[1] === '!', tStart = s + (embed ? 3 : 2), target = m[2], head = m[3] || '', alias = m[4];
      if (isActive(s, e)) { mark(s, e, 'cm-wlsrc'); continue; }
      if (embed) hideR(s, s + 1);
      hideR(s + (embed ? 1 : 0), tStart);                                      // [[
      if (alias != null) { const aStart = tStart + target.length + head.length + 1; hideR(tStart, aStart); mark(aStart, e - 2, 'cm-wl' + (embed ? ' cm-embed' : '')); }
      else mark(tStart, e - 2, 'cm-wl' + (embed ? ' cm-embed' : ''));
      hideR(e - 2, e);                                                          // ]]
    }
  }
  return { all: Decoration.set(out, true), atomic: Decoration.set(hides, true) };
}

const livePreview = ViewPlugin.fromClass(class {
  deco: DecorationSet; atomic: DecorationSet;
  constructor(v: EditorView) { const b = build(v); this.deco = b.all; this.atomic = b.atomic; }
  update(u: ViewUpdate) { if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) { const b = build(u.view); this.deco = b.all; this.atomic = b.atomic; } }
}, { decorations: v => v.deco, provide: p => EditorView.atomicRanges.of(v => v.plugin(p)?.atomic ?? Decoration.none) });

// ---- formatting commands (toolbar and shortcuts) ------------------------------------------------------------------------------
export type Fmt = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'h' | 'bullet' | 'number' | 'task' | 'quote' | 'wikilink';
function wrap(view: EditorView, open: string, close = open) {
  view.dispatch(view.state.changeByRange(r => {
    const d = view.state.doc, sel = d.sliceString(r.from, r.to);
    if (sel && d.sliceString(r.from - open.length, r.from) === open && d.sliceString(r.to, r.to + close.length) === close)   // already wrapped: unwrap
      return { changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + close.length }], range: EditorSelection.range(r.from - open.length, r.to - open.length) };
    return { changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }], range: EditorSelection.range(r.from + open.length, r.to + open.length) };
  }));
  view.focus();
}
function prefix(view: EditorView, kind: 'h' | 'bullet' | 'number' | 'task' | 'quote') {
  const { state } = view, ch: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) for (let i = state.doc.lineAt(r.from).number, e = state.doc.lineAt(r.to).number; i <= e; i++) {
    if (seen.has(i)) continue; seen.add(i);
    const l = state.doc.line(i);
    const has = { h: /^#{1,6} /, bullet: /^\s*[-*+] (?!\[[ xX]\] )/, number: /^\s*\d+\. /, task: /^\s*[-*+] \[[ xX]\] /, quote: /^> ?/ }[kind].exec(l.text);
    if (kind === 'h') { const m = /^(#{1,6}) /.exec(l.text), lvl = m ? m[1].length : 0; ch.push({ from: l.from, to: l.from + (m ? m[0].length : 0), insert: lvl >= 3 ? '' : '#'.repeat(lvl + 1) + ' ' }); continue; }
    if (has) ch.push({ from: l.from + (has[0].length - has[0].trimStart().length), to: l.from + has[0].length, insert: '' });
    else {
      const strip = /^\s*(?:[-*+] \[[ xX]\] |[-*+] |\d+\. )/.exec(l.text);   // switching list type replaces the old marker
      const add = { bullet: '- ', number: '1. ', task: '- [ ] ', quote: '> ' }[kind];
      ch.push({ from: l.from + (strip ? strip[0].length - strip[0].trimStart().length : 0), to: l.from + (strip ? strip[0].length : 0), insert: add });
    }
  }
  view.dispatch({ changes: ch }); view.focus();
}
export function format(view: EditorView, f: Fmt) {
  if (f === 'bold') wrap(view, '**'); else if (f === 'italic') wrap(view, '*'); else if (f === 'strike') wrap(view, '~~'); else if (f === 'code') wrap(view, '`');
  else if (f === 'wikilink') { wrap(view, '[[', ']]'); }
  else if (f === 'link') {
    const r = view.state.selection.main, sel = view.state.doc.sliceString(r.from, r.to);
    view.dispatch({ changes: { from: r.from, to: r.to, insert: `[${sel}](url)` }, selection: { anchor: r.from + sel.length + 3, head: r.from + sel.length + 6 } }); view.focus();
  } else prefix(view, f);
}

// ---- component -----------------------------------------------------------------------------------------------------------------
export type RichHandle = { focus: () => void; format: (f: Fmt) => void };
type Props = { value: string; vault: string; onChange: (t: string) => void; onSave: () => void; onEsc: () => void };

const RichText = forwardRef<RichHandle, Props>(function RichText({ value, vault, onChange, onSave, onEsc }, ref) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onSave, onEsc, vault }); cb.current = { onChange, onSave, onEsc, vault };

  useEffect(() => {
    const wikiSource = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\[\]\n|#]*/);
      if (!m || (m.from === m.to && !ctx.explicit)) return null;
      const q = m.text.slice(2), from = m.from + 2;
      return {
        from, filter: false,
        options: suggest(q, cb.current.vault).map(c => ({
          label: c.base, detail: c.vault + ' / ' + c.path,
          apply: (v: EditorView, _c: unknown, f: number, t: number) => {
            const close = v.state.doc.sliceString(t, t + 2) === ']]' ? '' : ']]';
            v.dispatch({ changes: { from: f, to: t, insert: c.base + close }, selection: { anchor: f + c.base.length + 2 } });
          },
        })),
      };
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(), markdown({ base: markdownLanguage }), livePreview, EditorView.lineWrapping,
          autocompletion({ override: [wikiSource], icons: false, closeOnBlur: true, defaultKeymap: true, maxRenderedOptions: 8 }),
          Prec.highest(EditorView.domEventHandlers({
            keydown(e, view) {
              if (e.key !== 'Escape') return false;
              e.stopPropagation();                                   // the page's own Esc handling must not see it
              if (completionStatus(view.state)) return false;        // first Esc only closes the suggestion list
              e.preventDefault(); cb.current.onEsc(); return true;
            },
          })),
          keymap.of([
            { key: 'Mod-s', run: () => { cb.current.onSave(); return true; } },
            { key: 'Mod-b', run: v => { format(v, 'bold'); return true; } },
            { key: 'Mod-i', run: v => { format(v, 'italic'); return true; } },
            { key: 'Mod-k', run: v => { format(v, 'link'); return true; } },
            indentWithTab, ...historyKeymap, ...defaultKeymap,
          ]),
          EditorView.updateListener.of(u => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': 'Note editor' }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // the parent replaced the text (load the disk version): mirror it without losing the editor
  useEffect(() => {
    const v = view.current; if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  useImperativeHandle(ref, () => ({ focus: () => view.current?.focus(), format: f => view.current && format(view.current, f) }), []);
  return <div className="rt" ref={host} />;
});
export default RichText;
