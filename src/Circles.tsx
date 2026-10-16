import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import type { Note } from 'virtual:vault';
import type { Colors } from './palettes';
import { circlesData, RINGS, RELATIONS, agoText, bdayText, type Person, type Relation } from './circlesData';

// Circles (key o): people as a 3D ball of concentric shells around "me". The shell is how close someone is (circle: 1 to 4),
// color and shape say who they are (relation). Each shell's people are grouped by relation: on a tilted orbit (a ring that
// links them, with a tinted arc per group) while a shell holds up to ORBIT_MAX people, spread over the shell's surface in
// wedges per group beyond that. A faint spoke runs from each person to the center, brighter the longer since the last contact.
type Props = { notes: Note[]; colors: Colors; dark: boolean; right: number; selected: string | null; safe: boolean; onSelect: (id: string | null) => void; onClose: () => void; onAdd?: () => void };

const RADII = [0, 120, 215, 310, 405];
// per shell: orbit tilt, turn and roll (radians). Tilted close to face-on so a ring of names reads like a circle; dragging shows the ball
const TILT = [[0, 0, 0], [1.22, 0.3, 0.2], [-1.25, -0.32, -0.5], [1.3, 0.42, 0.95], [-1.24, -0.28, 1.6]];
const ORBIT_MAX = 16, FOV = 42;
const DOT = [0, 1.15, 1, 0.86, 0.74];   // dot size per shell: closer people are drawn larger
const HUE: Record<Relation, [string, string]> = {   // light, dark
  family: ['#d9622f', '#e8774a'], friend: ['#2a78d6', '#4a93ea'], colleague: ['#13976a', '#22b07c'], 'ex-colleague': ['#13976a', '#22b07c'], acquaintance: ['#8a8a82', '#8f8f88'],
};
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} } };

type Slot = { p: Person; shell: number; holder: THREE.Object3D; spin: THREE.Object3D; local: THREE.Vector3; pos: THREE.Vector3; lw: number; lab: boolean; left: boolean; css: [string, string, string, string] };   // css: last written transform, opacity, z-index, pointer-events
type Scr = { sl: Slot; x: number; y: number; s: number; front: number; off: boolean };

export default function Circles({ notes, colors, dark, right, selected, safe, onSelect, onClose, onAdd }: Props) {
  const d = useMemo(() => circlesData(notes), [notes]);
  const host = useRef<HTMLDivElement>(null);
  const dots = useRef(new Map<string, HTMLButtonElement>());
  const ringEls = useRef<(HTMLDivElement | null)[]>([]);
  const meEl = useRef<HTMLDivElement>(null);
  const hover = useRef<string | null>(null);
  const [hidden, setHidden] = useState<Set<Relation>>(() => new Set((store.get('ciHide') || '').split(',').filter(Boolean) as Relation[]));
  useEffect(() => store.set('ciHide', [...hidden].join(',')), [hidden]);
  const live = useRef({ selected, hidden }); live.current = { selected, hidden };
  const api = useRef<{ fly: (id: string | null) => void } | null>(null);
  const moved = useRef(false);
  const hue = (r: Relation) => HUE[r][dark ? 1 : 0];
  const key = d.people.map(p => p.note.id + ':' + p.circle + ':' + p.relation + ':' + p.status + ':' + p.since).join('|');

  useEffect(() => {
    const el = host.current; if (!el || !d.people.length) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const cv = renderer.domElement; cv.className = 'ci-canvas'; el.prepend(cv);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 10, 8000);
    const ball = new THREE.Group(); scene.add(ball);
    const ink = new THREE.Color(colors.ink), bg = new THREE.Color(colors.bg), acc = new THREE.Color(colors.accent);
    const mix = (a: THREE.Color, t: number) => bg.clone().lerp(a, t);
    const relC = Object.fromEntries(RELATIONS.map(r => [r.key, new THREE.Color(HUE[r.key][dark ? 1 : 0])])) as Record<Relation, THREE.Color>;
    const disposables: { dispose: () => void }[] = [];
    const arcMats: { rel: Relation; m: THREE.LineBasicMaterial }[] = [];
    const ringLine = (R: number, a0: number, a1: number, color: THREE.Color, opacity: number, closed = false) => {
      const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (Math.PI * 2) * 200)), pts: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); }
      const g = new THREE.BufferGeometry().setFromPoints(pts), m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      disposables.push(g, m); return { line: closed ? new THREE.LineLoop(g, m) : new THREE.Line(g, m), m };
    };

    // shells: a faint see-through sphere each, plus a camera-facing outline so the circles read from any angle
    const outlines: THREE.Object3D[] = [];
    for (let s = 1; s <= 4; s++) {
      const g = new THREE.SphereGeometry(RADII[s], 48, 32), m = new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: dark ? 0.025 : 0.022, depthWrite: false });
      ball.add(new THREE.Mesh(g, m)); disposables.push(g, m);
      const o = ringLine(RADII[s], 0, Math.PI * 2, mix(ink, dark ? 0.22 : 0.18), 1, true).line; o.rotation.x = Math.PI / 2;
      const wrap = new THREE.Object3D(); wrap.add(o); scene.add(wrap); outlines.push(wrap);
    }

    // people per shell, grouped by relation (circlesData sorts by circle, relation, name)
    const slots: Slot[] = [];
    for (let s = 1; s <= 4; s++) {
      const ps = d.people.filter(p => p.circle === s); if (!ps.length) continue;
      const holder = new THREE.Object3D(), spin = new THREE.Object3D();
      holder.rotation.set(TILT[s][0], TILT[s][1], TILT[s][2], 'ZYX'); holder.add(spin); ball.add(holder);
      const R = RADII[s], groups: Person[][] = [];
      ps.forEach(p => { const g = groups[groups.length - 1]; if (g && g[0].relation === p.relation) g.push(p); else groups.push([p]); });
      const arc = (rel: Relation, a0: number, a1: number) => { const { line, m } = ringLine(R * 1.002, a0, a1, relC[rel], 0.85); spin.add(line); arcMats.push({ rel, m }); };
      const add = (p: Person, local: THREE.Vector3) => slots.push({ p, shell: s, holder, spin, local, pos: new THREE.Vector3(), lw: 0, lab: true, left: false, css: ['', '', '', ''] });
      if (ps.length <= ORBIT_MAX) {
        // one orbit: an empty slot between groups, a tinted arc under each group
        const gap = groups.length > 1 ? 1 : 0, step = (Math.PI * 2) / (ps.length + gap * groups.length);
        spin.add(ringLine(R, 0, Math.PI * 2, mix(ink, dark ? 0.42 : 0.36), 1, true).line);
        let k = 0;
        for (const g of groups) {
          const a0 = k * step;
          g.forEach(p => { const a = k++ * step; add(p, new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); });
          arc(g[0].relation, a0 - step * 0.4, (k - 1) * step + step * 0.4);
          k += gap;
        }
      } else {
        // many people: spread over the shell (fibonacci points), sorted by longitude so each group gets a wedge; arcs on the equator
        const lon = (v: THREE.Vector3) => (Math.atan2(v.z, v.x) + Math.PI * 2) % (Math.PI * 2);
        const pts = ps.map((_, i) => { const y = 1 - 2 * (i + 0.5) / ps.length, r = Math.sqrt(1 - y * y), th = Math.PI * (3 - Math.sqrt(5)) * i; return new THREE.Vector3(Math.cos(th) * r * R, y * R * 0.92, Math.sin(th) * r * R); })
          .sort((a, b) => lon(a) - lon(b));
        spin.add(ringLine(R, 0, Math.PI * 2, mix(ink, dark ? 0.3 : 0.26), 1, true).line);
        let k = 0;
        for (const g of groups) {
          const mine = pts.slice(k, k + g.length);
          g.forEach((p, i) => add(p, mine[i]));
          arc(g[0].relation, lon(mine[0]) - 0.03, lon(mine[mine.length - 1]) + 0.03);
          k += g.length;
        }
      }
    }
    const bySlot = new Map(slots.map(sl => [sl.p.note.id, sl]));

    // spokes from the center to each person
    const sp = new Float32Array(slots.length * 6), sc = new Float32Array(slots.length * 6);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3).setUsage(THREE.DynamicDrawUsage));
    const sm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    ball.add(new THREE.LineSegments(sg, sm)); disposables.push(sg, sm);
    const many = slots.length > 60;   // with a crowd only the ones that need attention keep a visible spoke
    const spokeColor = (sl: Slot, cur: boolean, off: boolean) => {
      if (cur) return mix(acc, 0.9);
      if (off) return bg;
      const u = sl.p.status === 'overdue' ? Math.min(1, 0.45 + (sl.p.urgency - 1) * 0.2) : sl.p.status === 'never' ? (many ? 0.07 : 0.28) : sl.p.status === 'due' ? 0.24 : many ? 0.04 : 0.1;
      return mix(relC[sl.p.relation], u);
    };

    // camera: rotation and zoom survive reloads (a logged call reloads the page)
    let zoom = 1;
    try { const c = JSON.parse(sessionStorage.getItem('ciCam') || 'null'); if (c?.q?.length === 4) ball.quaternion.fromArray(c.q); if (c?.z) zoom = c.z; else ball.rotation.x = 0.22; } catch { ball.rotation.x = 0.22; }
    const saveCam = () => { try { sessionStorage.setItem('ciCam', JSON.stringify({ q: ball.quaternion.toArray(), z: zoom })); } catch {} };
    let W = 1, H = 1, fit = 1200;
    const resize = () => {
      W = el.clientWidth || 1; H = el.clientHeight || 1;
      renderer.setSize(W, H, false); cv.style.width = W + 'px'; cv.style.height = H + 'px';
      camera.aspect = W / H; camera.updateProjectionMatrix();
      fit = (RADII[4] * 1.18) / Math.tan((FOV / 2) * Math.PI / 180) / Math.min(1, camera.aspect);
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // drag rotates the ball (with inertia), wheel zooms
    let drag: { x: number; y: number; t0x: number; t0y: number } | null = null, vx = 0, vy = 0, flying = false;
    const qa = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0);
    const turn = (dx: number, dy: number) => { qa.setFromAxisAngle(ay, dx); ball.quaternion.premultiply(qa); qa.setFromAxisAngle(ax, dy); ball.quaternion.premultiply(qa); };
    const down = (e: PointerEvent) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, t0x: e.clientX, t0y: e.clientY }; moved.current = false; vx = vy = 0; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (Math.hypot(e.clientX - drag.t0x, e.clientY - drag.t0y) > 5) { moved.current = true; el.classList.add('dragging'); }
      vx = dx * 0.006; vy = dy * 0.006; turn(vx, vy);
    };
    const up = () => { if (drag) { drag = null; el.classList.remove('dragging'); saveCam(); } };
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoom = Math.min(2.4, Math.max(0.35, zoom * Math.exp(e.deltaY * 0.0012))); saveCam(); };
    el.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); el.addEventListener('wheel', wheel, { passive: false });

    // fly: turn the ball so a person faces the camera, a little off the center so they do not cover "me"
    const fly = (id: string | null) => {
      const sl = id ? bySlot.get(id) : null; if (!sl) return;
      const w = sl.pos.clone().applyQuaternion(ball.quaternion).normalize();
      const q0 = ball.quaternion.clone(), q1 = new THREE.Quaternion().setFromUnitVectors(w, new THREE.Vector3(0.5, 0.32, 0.8).normalize()).multiply(q0);
      const t = { k: 0 }; flying = true; vx = vy = 0;
      gsap.to(t, { k: 1, duration: 0.9, ease: 'power2.inOut', onUpdate: () => { ball.quaternion.slerpQuaternions(q0, q1, t.k); }, onComplete: () => { flying = false; saveCam(); } });
    };
    api.current = { fly };

    // labels: greedy placement by priority (open, hovered, inner circles, needs attention, facing you); a name that would overlap is hidden
    const placed: number[][] = [];
    const labels = (scr: Scr[]) => {
      const sel = live.current.selected;
      const pr = (o: Scr) => o.sl.p.note.id === sel ? 1e6 : o.sl.p.note.id === hover.current ? 1e5 : (5 - o.sl.shell) * 100 + (o.sl.p.status === 'overdue' ? 60 : o.sl.p.status === 'due' ? 30 : 0) + o.front * 40;
      scr.sort((a, b) => pr(b) - pr(a)); placed.length = 0;
      const kOf = (o: Scr) => (0.72 + 0.28 * o.s) * DOT[o.sl.shell];
      // every visible dot is an obstacle too, so a name never covers someone else
      const dotBox = scr.filter(o => !o.off && o.front > -0.6).map(o => { const k = kOf(o); return [o.x - 9 * k, o.y - 9 * k, o.x + 9 * k, o.y + 9 * k, o.sl.shell, o.sl.p.note.id] as const; });
      const hit = (box: number[], q: readonly (number | string)[]) => box[0] < (q[2] as number) && box[2] > (q[0] as number) && box[1] < (q[3] as number) && box[3] > (q[1] as number);
      for (const o of scr) {
        const id = o.sl.p.note.id, b = dots.current.get(id)!;
        if (!o.sl.lw) o.sl.lw = (b.querySelector('.ci-name') as HTMLElement | null)?.offsetWidth || 60;
        const k = kOf(o), must = id === sel || id === hover.current;
        // the name goes right of the dot, or left when the right side is taken; hidden only when both are
        const free = (box: number[]) => !placed.some(q => hit(box, q)) && !dotBox.some(q => q[5] !== id && hit(box, q));
        const R = [o.x + 10 * k, o.y - 9 * k, o.x + (16 + o.sl.lw) * k, o.y + 8 * k], L = [o.x - (16 + o.sl.lw) * k, o.y - 9 * k, o.x - 10 * k, o.y + 8 * k];
        let ok = !o.off && (must || o.front > -0.35), left = false;
        if (ok && !must && !free(R)) { if (free(L)) left = true; else ok = false; }
        if (ok) placed.push(left ? L : R);
        if (left !== o.sl.left) { o.sl.left = left; b.classList.toggle('lf', left); }
        if (ok !== o.sl.lab) { o.sl.lab = ok; b.classList.toggle('nl', !ok); }
      }
    };

    const v = new THREE.Vector3(), wp = new THREE.Vector3();
    let raf = 0, last = performance.now(), drift = 0, fr = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag && !flying && (Math.abs(vx) > 1e-5 || Math.abs(vy) > 1e-5)) { turn(vx, vy); vx *= 0.93; vy *= 0.93; }
      const { selected: sel, hidden: hid } = live.current;
      if (!sel && !hover.current && !drag) drift += dt * 0.035;   // a slow orbit, paused while you look at someone
      camera.position.set(0, 0, fit * zoom); camera.lookAt(0, 0, 0);
      outlines.forEach(o => o.quaternion.copy(camera.quaternion));
      for (const sl of slots) sl.spin.rotation.y = -drift / Math.sqrt(sl.shell);
      ball.updateMatrixWorld(true);
      const scaleAt = (z: number) => camera.position.z / Math.max(1, camera.position.z - z);
      const scr: Scr[] = [];
      slots.forEach((sl, i) => {
        sl.pos.copy(sl.local).applyMatrix4(sl.spin.matrix).applyMatrix4(sl.holder.matrix);
        const id = sl.p.note.id, off = hid.has(sl.p.relation) && id !== sel;
        if (off) sp.fill(0, i * 6, i * 6 + 6); else sp.set([0, 0, 0, sl.pos.x, sl.pos.y, sl.pos.z], i * 6);   // a faded group has no spoke
        const c = spokeColor(sl, id === sel, off), cc = off ? bg : mix(relC[sl.p.relation], 0.04);
        sc.set([cc.r, cc.g, cc.b, c.r, c.g, c.b], i * 6);
        const b = dots.current.get(id); if (!b) return;
        wp.copy(sl.pos).applyQuaternion(ball.quaternion); v.copy(wp).project(camera);
        const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H, front = wp.z / RADII[4], s = scaleAt(wp.z);
        // only changed values are written: with hundreds of people, z-index and opacity churn is what costs
        const css: Slot['css'] = [`translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(Math.round((0.72 + 0.28 * s) * DOT[sl.shell] * 25) / 25).toFixed(2)})`,
          off ? '0.07' : Math.min(1, 0.3 + 0.7 * (front + 1) / 2 + (id === sel || id === hover.current ? 1 : 0)).toFixed(2),
          String(Math.round((1000 + wp.z + (id === hover.current ? 600 : 0)) / 4)), off ? 'none' : ''];
        if (css[0] !== sl.css[0]) b.style.transform = css[0];
        if (css[1] !== sl.css[1]) b.style.opacity = css[1];
        if (css[2] !== sl.css[2]) b.style.zIndex = css[2];
        if (css[3] !== sl.css[3]) b.style.pointerEvents = css[3];
        sl.css = css;
        scr.push({ sl, x, y, s, front, off });
      });
      if (fr++ % 2 === 0 || drag || flying) labels(scr);
      for (const a of arcMats) a.m.opacity = hid.has(a.rel) ? 0.08 : 0.85;
      sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true;
      // ring labels sit on top of each outline, me in the middle
      for (let s = 1; s <= 4; s++) {
        const r = ringEls.current[s]; if (!r) continue;
        v.set(0, RADII[s], 0).applyQuaternion(camera.quaternion).project(camera);
        r.style.transform = `translate(${((v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v.y) / 2 * H).toFixed(1)}px)`;
      }
      if (meEl.current) meEl.current.style.transform = `translate(${W / 2}px, ${H / 2}px)`;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    if (live.current.selected && bySlot.has(live.current.selected)) setTimeout(() => fly(live.current.selected), 60);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); saveCam();
      el.removeEventListener('pointerdown', down); removeEventListener('pointermove', move); removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel);
      disposables.forEach(x => x.dispose()); renderer.dispose(); cv.remove(); api.current = null;
    };
  }, [key, colors, dark]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (selected) api.current?.fly(selected); }, [selected]);

  const cur = d.people.find(p => p.note.id === selected) || null;
  const count = (r: Relation) => d.people.filter(p => p.relation === r).length;
  const present = RELATIONS.filter(r => count(r.key) > 0);
  const toggle = (r: Relation) => setHidden(h => { const x = new Set(h); if (x.has(r)) x.delete(r); else x.add(r); return x; });
  const perRing = (n: number) => d.people.filter(p => p.circle === n && !hidden.has(p.relation)).length;

  return (
    <div className={'tasks-view page-view ci-view' + (cur ? ' has-card' : '')} style={{ right, ...Object.fromEntries(RELATIONS.map(r => ['--' + r.key, hue(r.key)])) }} role="dialog" aria-label="Circles">
      <div className="ci-stage" ref={host}>
        {d.people.length > 0 && <>
          <div className="ci-me" ref={meEl}><i /><span>Me</span></div>
          {RINGS.map(r => <div key={r.n} className="ci-ring" ref={e => { ringEls.current[r.n] = e; }}>{r.label} <small>{perRing(r.n)} · every {r.every}d</small></div>)}
          {d.people.map(p => (
            <button key={p.note.id} ref={e => { if (e) dots.current.set(p.note.id, e); else dots.current.delete(p.note.id); }}
              className={`ci-dot rel-${p.relation} ${p.status}${p.note.id === selected ? ' cur' : ''}`}
              onPointerEnter={() => { hover.current = p.note.id; }} onPointerLeave={() => { if (hover.current === p.note.id) hover.current = null; }}
              onClick={() => { if (!moved.current) onSelect(p.note.id === selected ? null : p.note.id); }}
              title={`${p.name} (${relLabel(p)}): ${agoText(p.since)}${p.bdayIn !== null && p.bdayIn <= 14 ? ', ' + bdayText(p) : ''}`}>
              <i className="ci-ball" />{p.bdayIn !== null && p.bdayIn <= 14 && <em className="ci-cake" aria-label="birthday soon">🎂</em>}<span className="ci-name">{p.name}</span>
            </button>
          ))}
        </>}
      </div>

      <header className="tv-head ci-head">
        <div><div className="label">Personal / people</div><h1>Circles</h1>
          <p>{d.people.length ? `${d.people.length} people, ${d.reach.filter(p => p.status === 'overdue').length} overdue` : 'nobody yet'}</p>
          {present.length > 0 && <div className="ci-chips">{present.map(r => (
            <button key={r.key} className={hidden.has(r.key) ? 'off' : ''} onClick={() => toggle(r.key)} title={hidden.has(r.key) ? 'Show ' + r.label.toLowerCase() : 'Fade ' + r.label.toLowerCase()}>
              <i className={'ci-sw rel-' + r.key} />{r.label}<small>{count(r.key)}</small></button>))}</div>}
        </div>
        <div className="ci-head-btns">{onAdd && <button className="btn primary" onClick={onAdd} title="Add a person  (a)">+ Add person</button>}
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close  (o or Esc)">&times;</button></div>
      </header>

      {!d.people.length
        ? <div className="pv-empty ci-empty">{safe ? 'Safe mode hides personal notes. Leave Safe mode to see your circles.' : <>No people yet. Add a note with <code>type: person</code> and a <code>relation:</code> (family, friend, colleague, ex-colleague or acquaintance); the Personal vault's person template does this.</>}</div>
        : <Side d={d} hidden={hidden} selected={selected} onSelect={onSelect} />}

    </div>
  );
}

const relLabel = (p: Person) => [p.relationship, p.relation.replace('-', ' ')].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');

// side list: Reach out, Birthdays, Everyone (grouped by circle), with a search over names, relationships and locations
function Side({ d, hidden, selected, onSelect }: { d: ReturnType<typeof circlesData>; hidden: Set<Relation>; selected: string | null; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'reach' | 'bday' | 'all'>(() => { const t = store.get('ciTab'); return t === 'bday' || t === 'all' ? t : 'reach'; });
  useEffect(() => store.set('ciTab', tab), [tab]);
  const [q, setQ] = useState('');
  const qq = q.trim().toLowerCase();
  const keep = (p: Person) => !hidden.has(p.relation) && (!qq || (p.name + ' ' + p.relationship + ' ' + p.relation + ' ' + (p.note.meta.location || '')).toLowerCase().includes(qq));
  const row = (p: Person, sub: string) => (
    <li key={p.note.id} className={p.note.id === selected ? 'cur' : ''}>
      <button onClick={() => onSelect(p.note.id)}><i className={'ci-sw rel-' + p.relation} /><b>{p.name}</b><span>{sub}</span></button>
    </li>
  );
  const reach = d.reach.filter(keep), bdays = d.birthdays.filter(keep), all = d.people.filter(keep);
  const tabs: [typeof tab, string, number][] = [['reach', 'Reach out', reach.length], ['bday', 'Birthdays', bdays.length], ['all', 'Everyone', all.length]];
  return (
    <aside className="ci-side">
      <div className="ci-tabs" role="tablist">
        {tabs.map(([k, l, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} <small>{n}</small></button>)}
      </div>
      <input className="ci-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" />
      <div className="ci-list">
        {tab === 'reach' && (reach.length ? <ul>{reach.map(p => row(p, p.status === 'never' ? `${RINGS[p.circle - 1].label}, nothing logged` : `${agoText(p.since)}, every ${p.every}d`))}</ul> : <p className="ci-none">{qq ? 'Nobody matches.' : 'Everyone is up to date.'}</p>)}
        {tab === 'bday' && <>{bdays.length ? <ul>{bdays.map(p => row(p, bdayText(p)))}</ul> : <p className="ci-none">None in the next 60 days.</p>}
          {d.noBirthday > 0 && <p className="ci-none">{d.noBirthday} of {d.people.length} have no <code>birthday:</code> yet.</p>}</>}
        {tab === 'all' && (all.length ? RINGS.map(r => { const ps = all.filter(p => p.circle === r.n); return ps.length ? <div key={r.n}><h3>{r.label} <small>{ps.length}</small></h3><ul>{ps.map(p => row(p, `${relLabel(p)}, ${agoText(p.since)}`))}</ul></div> : null; }) : <p className="ci-none">Nobody matches.</p>)}
      </div>
      <div className="ci-legend"><span><i className="ci-lg overdue" />Overdue</span><span><i className="ci-lg due" />Due soon</span><span><i className="ci-lg never" />Not logged</span></div>
    </aside>
  );
}
