import type { Note } from 'virtual:vault';
import type { Facet } from './facets';
import { shortTitle } from './util';
import { pretty } from './cockpitData';

// Breadcrumb Customer > Project > Component. Customer and project open their hub (filter when there is none or it is the
// open note); component always filters the map. Hubs: type hub with the same customer/project/component and nothing deeper.
export type Crumb = { facet: Facet; value: string; label: string; hub: Note | null };
type Scope = { customer?: string; project?: string; component?: string };

export function crumbsFor(notes: Note[], s: Scope): Crumb[] {
  const hubs = notes.filter(n => n.type === 'hub');
  const out: Crumb[] = [];
  if (s.customer) {
    const hub = hubs.find(n => n.customer === s.customer && !n.project) ?? null;
    out.push({ facet: 'customer', value: s.customer, label: hub ? shortTitle(hub.title) : pretty(s.customer), hub });
  }
  if (s.project) {
    const hub = hubs.find(n => n.project === s.project && !n.component && (!s.customer || !n.customer || n.customer === s.customer)) ?? null;
    out.push({ facet: 'project', value: s.project, label: hub ? shortTitle(hub.title) : pretty(s.project), hub });
  }
  if (s.component) {
    const hub = hubs.find(n => n.project === s.project && n.component === s.component) ?? null;
    // component hubs are titled "Project: Component"; keep the part after the project name
    const t = hub ? shortTitle(hub.title) : '', pre = out[out.length - 1]?.label;
    const label = hub && s.project && pre && t.startsWith(pre + ':') ? t.slice(pre.length + 1).trim() : t || pretty(s.component);
    out.push({ facet: 'component', value: s.component, label, hub });
  }
  return out;
}

// a note's own place: customer from its customer: field, else its folder under projects/
export const scopeOf = (n: Note): Scope => ({ customer: n.customer || n.path.toLowerCase().match(/^projects\/([^/]+)\//)?.[1] || '', project: n.project, component: n.component });

export default function Crumbs({ parts, selfId, onOpen, onFacet, className }: { parts: Crumb[]; selfId?: string; onOpen: (id: string) => void; onFacet: (f: Facet, v: string) => void; className?: string }) {
  if (!parts.length) return null;
  return <nav className={'crumbs' + (className ? ' ' + className : '')} aria-label="Breadcrumb">
    {parts.map((p, i) => {
      const hub = p.facet !== 'component' && p.hub && p.hub.id !== selfId ? p.hub : null;
      return <span key={p.facet}>
        {i > 0 && <span className="crumb-sep" aria-hidden>&rsaquo;</span>}
        <button className="crumb" onClick={() => (hub ? onOpen(hub.id) : onFacet(p.facet, p.value))}
          title={hub ? `Open ${shortTitle(hub.title)}` : `Show only notes with ${p.facet}: ${p.value}`}>{p.label}</button>
      </span>;
    })}
  </nav>;
}
