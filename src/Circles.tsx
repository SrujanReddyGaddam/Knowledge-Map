import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import type { Note } from 'virtual:vault';
import type { Colors } from './palettes';
import { circlesData, RINGS, agoText, bdayText, today, type Person } from './circlesData';
import { appendLine, rawNote, saveNote } from './api';
import { setFrontmatter } from './review';

// Circles (key o): friends and family as a 3D ball of concentric shells around "me". Each shell is a circle of closeness
// (circle: 1 to 4 in the person note), the people of a shell sit on a tilted orbit that links them in a ring, and a faint
// spoke runs from each person to the center, brighter the longer it has been since the last logged contact.
type Props = { notes: Note[]; colors: Colors; dark: boolean; right: number; selected: string | null; safe: boolean; onSelect: (id: string | null) => void; onClose: () => void };

const RADII = [0, 120, 215, 310, 405];
// per shell: orbit tilt, turn and roll (radians). Tilted close to face-on so a ring of names reads like a circle; dragging shows the ball
const TILT = [[0, 0, 0], [1.22, 0.3, 0.2], [-1.25, -0.32, -0.5], [1.3, 0.42, 0.95], [-1.24, -0.28, 1.6]];
const PER_ORBIT = 14, FOV = 42;
const HUE = { family: ['#d9622f', '#e8774a'], friend: ['#2a78d6', '#4a93ea'] };   // light, dark
const KINDS = ['call', 'text', 'video', 'met'];

type Slot = { p: Person; shell: number; orbit: THREE.Object3D; angle: number; pos: THREE.Vector3 };

export default function Circles({ notes, colors, dark, right, selected, safe, onSelect, onClose }: Props) {
  const d = useMemo(() => circlesData(notes), [notes]);
  const host = useRef<HTMLDivElement>(null);
  const dots = useRef(new Map<string, HTMLButtonElement>());
  const ringEls = useRef<(HTMLDivElement | null)[]>([]);
  const meEl = useRef<HTMLDivElement>(null);
  const live = useRef({ selected, onSelect }); live.current = { selected, onSelect };
  const api = useRef<{ fly: (id: string | null) => void } | null>(null);
  const moved = useRef(false);
  const fam = HUE.family[dark ? 1 : 0], fr = HUE.friend[dark ? 1 : 0];
  const key = d.people.map(p => p.note.id + ':' + p.circle + ':' + p.status + ':' + p.since).join('|');

  useEffect(() => {
    const el = host.current; if (!el || !d.people.length) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const cv = renderer.domElement; cv.className = 'ci-canvas'; el.prepend(cv);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 10, 8000);
    const ball = new THREE.Group(); scene.add(ball);
    const ink = new THREE.Color(colors.ink), bg = new THREE.Color(colors.bg), line = new THREE.Color(colors.line), acc = new THREE.Color(colors.accent);
    const mix = (a: THREE.Color, t: number) => bg.clone().lerp(a, t);
    const disposables: { dispose: () => void }[] = [];

    // shells: a faint see-through sphere each, plus a camera-facing outline so the circles read from any angle
    const outlines: THREE.Object3D[] = [];
    for (let s = 1; s <= 4; s++) {
      const g = new THREE.SphereGeometry(RADII[s], 48, 32), m = new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: dark ? 0.025 : 0.022, depthWrite: false });
      ball.add(new THREE.Mesh(g, m)); disposables.push(g, m);
      const og = new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, RADII[s], RADII[s]).getPoints(160).map(p => new THREE.Vector3(p.x, p.y, 0)));
      const om = new THREE.LineBasicMaterial({ color: mix(ink, dark ? 0.22 : 0.18), transparent: true, depthWrite: false });
      const o = new THREE.LineLoop(og, om); scene.add(o); outlines.push(o); disposables.push(og, om);
    }

    // people of a shell on one or more tilted orbits; the orbit line is the ring that links them
    const slots: Slot[] = [];
    for (let s = 1; s <= 4; s++) {
      const ps = d.people.filter(p => p.circle === s); if (!ps.length) continue;
      const nOrb = Math.ceil(ps.length / PER_ORBIT);
      for (let k = 0; k < nOrb; k++) {
        const part = ps.slice(k * PER_ORBIT, (k + 1) * PER_ORBIT);
        const orbit = new THREE.Object3D();
        orbit.rotation.set(TILT[s][0], TILT[s][1] + k * 0.5, TILT[s][2] + k * 1.1, 'ZYX');
        ball.add(orbit);
        const lg = new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, RADII[s], RADII[s]).getPoints(200).map(p => new THREE.Vector3(p.x, 0, p.y)));
        const lm = new THREE.LineBasicMaterial({ color: mix(ink, dark ? 0.5 : 0.42), transparent: true, depthWrite: false });
        orbit.add(new THREE.LineLoop(lg, lm)); disposables.push(lg, lm);
        part.forEach((p, i) => slots.push({ p, shell: s, orbit, angle: (i / part.length) * Math.PI * 2 + s * 0.7, pos: new THREE.Vector3() }));
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
    const relC = { family: new THREE.Color(fam), friend: new THREE.Color(fr) };
    const spokeColor = (sl: Slot, cur: boolean) => {
      if (cur) return mix(acc, 0.9);
      const u = sl.p.status === 'overdue' ? Math.min(1, 0.45 + (sl.p.urgency - 1) * 0.2) : sl.p.status === 'never' ? 0.28 : sl.p.status === 'due' ? 0.24 : 0.1;
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
    const down = (e: PointerEvent) => { if (e.button !== 0 || (e.target as HTMLElement).closest('.ci-ui')) return; drag = { x: e.clientX, y: e.clientY, t0x: e.clientX, t0y: e.clientY }; moved.current = false; vx = vy = 0; };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (Math.hypot(e.clientX - drag.t0x, e.clientY - drag.t0y) > 5) { moved.current = true; el.classList.add('dragging'); }
      vx = dx * 0.006; vy = dy * 0.006; turn(vx, vy);
    };
    const up = () => { if (drag) { drag = null; el.classList.remove('dragging'); saveCam(); } };
    const wheel = (e: WheelEvent) => { if ((e.target as HTMLElement).closest('.ci-side, .ci-card')) return; e.preventDefault(); zoom = Math.min(2.4, Math.max(0.45, zoom * Math.exp(e.deltaY * 0.0012))); saveCam(); };
    el.addEventListener('pointerdown', down); addEventListener('pointermove', move); addEventListener('pointerup', up); el.addEventListener('wheel', wheel, { passive: false });

    // fly: turn the ball so a person faces the camera
    const fly = (id: string | null) => {
      const sl = id ? bySlot.get(id) : null; if (!sl) return;
      ball.updateMatrixWorld(); const w = sl.pos.clone().applyQuaternion(ball.quaternion).normalize();
      const q0 = ball.quaternion.clone(), q1 = new THREE.Quaternion().setFromUnitVectors(w, new THREE.Vector3(0.5, 0.32, 0.8).normalize()).multiply(q0);
      const t = { k: 0 }; flying = true; vx = vy = 0;
      gsap.to(t, { k: 1, duration: 0.9, ease: 'power2.inOut', onUpdate: () => { ball.quaternion.slerpQuaternions(q0, q1, t.k); }, onComplete: () => { flying = false; saveCam(); } });
    };
    api.current = { fly };

    const v = new THREE.Vector3(), wp = new THREE.Vector3();
    let raf = 0, last = performance.now(), drift = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag && !flying && (Math.abs(vx) > 1e-5 || Math.abs(vy) > 1e-5)) { turn(vx, vy); vx *= 0.93; vy *= 0.93; }
      const sel = live.current.selected, hovering = el.querySelector('.ci-dot:hover');
      if (!sel && !hovering && !drag) drift += dt * 0.035;   // a slow orbit, paused while you look at someone
      camera.position.set(0, 0, fit * zoom); camera.lookAt(0, 0, 0);
      outlines.forEach(o => o.quaternion.copy(camera.quaternion));
      ball.updateMatrixWorld(true);
      const scaleAt = (z: number) => camera.position.z / Math.max(1, camera.position.z - z);
      slots.forEach((sl, i) => {
        const a = sl.angle + drift / Math.sqrt(sl.shell);
        sl.pos.set(Math.cos(a) * RADII[sl.shell], 0, Math.sin(a) * RADII[sl.shell]).applyEuler(sl.orbit.rotation);
        sp.set([0, 0, 0, sl.pos.x, sl.pos.y, sl.pos.z], i * 6);
        const c = spokeColor(sl, sl.p.note.id === sel), cc = mix(relC[sl.p.relation], 0.04);
        sc.set([cc.r, cc.g, cc.b, c.r, c.g, c.b], i * 6);
        const b = dots.current.get(sl.p.note.id); if (!b) return;
        wp.copy(sl.pos).applyQuaternion(ball.quaternion); v.copy(wp).project(camera);
        const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H, front = wp.z / RADII[4], s = scaleAt(wp.z);
        b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(0.72 + 0.28 * s).toFixed(3)})`;
        b.style.opacity = String(Math.min(1, 0.32 + 0.68 * (front + 1) / 2 + (sl.p.note.id === sel ? 1 : 0)));
        b.style.zIndex = String(Math.round(1000 + wp.z));
      });
      sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true;
      // ring labels sit on top of each outline, me in the middle
      for (let s = 1; s <= 4; s++) {
        const r = ringEls.current[s]; if (!r) continue;
        v.set(0, RADII[s], 0).applyQuaternion(camera.quaternion).project(camera);
        r.style.transform = `translate(${((v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v.y) / 2 * H).toFixed(1)}px)`;
      }
      if (meEl.current) meEl.current.style.transform = `translate(${W / 2}px, ${H / 2}px)`;
      renderer.setClearColor(bg, 0);
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
  const counts = { family: d.people.filter(p => p.relation === 'family').length, friend: d.people.filter(p => p.relation === 'friend').length };
  const ringOf = (p: Person) => RINGS[p.circle - 1];
  const row = (p: Person, sub: string) => (
    <li key={p.note.id} className={p.note.id === selected ? 'cur' : ''}>
      <button onClick={() => onSelect(p.note.id)}><i className={'ci-sw ' + p.relation} /><b>{p.name}</b><span>{sub}</span></button>
    </li>
  );

  return (
    <div className="tasks-view page-view ci-view" style={{ right, ['--fam' as string]: fam, ['--fr' as string]: fr }} role="dialog" aria-label="Circles">
      <div className="ci-stage" ref={host}>
        {d.people.length > 0 && <>
          <div className="ci-me" ref={meEl}><i /><span>Me</span></div>
          {RINGS.map(r => <div key={r.n} className="ci-ring" ref={e => { ringEls.current[r.n] = e; }}>{r.label} <small>every {r.every}d</small></div>)}
          {d.people.map(p => (
            <button key={p.note.id} ref={e => { if (e) dots.current.set(p.note.id, e); else dots.current.delete(p.note.id); }}
              className={`ci-dot ${p.relation} ${p.status}${p.note.id === selected ? ' cur' : ''}`}
              onClick={() => { if (!moved.current) onSelect(p.note.id === selected ? null : p.note.id); }}
              title={`${p.name}${p.relationship ? ', ' + p.relationship : ''}: ${agoText(p.since)}${p.bdayIn !== null && p.bdayIn <= 14 ? ', ' + bdayText(p) : ''}`}>
              <i className="ci-ball" />{p.bdayIn !== null && p.bdayIn <= 14 && <em className="ci-cake" aria-label="birthday soon">🎂</em>}<span className="ci-name">{p.name}</span>
            </button>
          ))}
        </>}
      </div>

      <header className="tv-head ci-head ci-ui">
        <div><div className="label">Personal / people</div><h1>Circles</h1>
          <p>{d.people.length ? `${counts.family} family, ${counts.friend} friends, ${d.reach.filter(p => p.status === 'overdue').length} overdue` : 'nobody yet'}</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close  (o or Esc)">&times;</button>
      </header>

      {!d.people.length ? (
        <div className="pv-empty ci-empty ci-ui">{safe ? 'Safe mode hides personal notes. Leave Safe mode to see your circles.' : <>No people yet. Add a note with <code>type: person</code> and <code>relation: family</code> or <code>friend</code> (the Personal vault's person template does this).</>}</div>
      ) : !cur && (
        <aside className="ci-side ci-ui">
          <div className="ci-legend">
            <span><i className="ci-sw family" />Family</span><span><i className="ci-sw friend" />Friend</span>
            <span><i className="ci-lg overdue" />Overdue</span><span><i className="ci-lg due" />Due soon</span><span><i className="ci-lg never" />Not logged yet</span>
          </div>
          <h3>Reach out</h3>
          {d.reach.length ? <ul>{d.reach.slice(0, 8).map(p => row(p, p.status === 'never' ? `${ringOf(p).label}, nothing logged` : `${agoText(p.since)}, every ${p.every}d`))}</ul> : <p className="ci-none">Everyone is up to date.</p>}
          {d.reach.length > 8 && <p className="ci-none">and {d.reach.length - 8} more</p>}
          <h3>Birthdays</h3>
          {d.birthdays.length ? <ul>{d.birthdays.map(p => row(p, bdayText(p)))}</ul> : <p className="ci-none">None in the next 60 days.</p>}
          {d.noBirthday > 0 && <p className="ci-none">{d.noBirthday} of {d.people.length} have no <code>birthday:</code> yet.</p>}
        </aside>
      )}

      {cur && <PersonCard key={cur.note.id} p={cur} canWrite={!safe && cur.note.writable} />}
    </div>
  );
}

function PersonCard({ p, canWrite }: { p: Person; canWrite: boolean }) {
  const [kind, setKind] = useState('call');
  const [text, setText] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const n = p.note;

  const log = async () => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || busy) return;
    setBusy('log'); setErr('');
    try {
      const r = await appendLine(n.vault, n.path, 'Log', `- ${date} ${kind}: ${t}`);
      if (r.status !== 200) throw new Error(r.json.error || 'could not save (HTTP ' + r.status + ')');
      setDone('Logged, refreshing'); setText('');   // the page reloads from the server's update a moment later
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const move = async (c: number) => {
    if (c === p.circle || busy) return;
    setBusy('circle'); setErr('');
    try {
      const r = await rawNote(n.id);
      if (r.status !== 200) throw new Error(r.json.error || 'could not read the note');
      const out = setFrontmatter(r.json.text, { circle: String(c) });
      if (out === null) throw new Error('the frontmatter of this note cannot be edited safely');
      const s = await saveNote(n.id, out, r.json.hash);
      if (s.status !== 200) throw new Error(s.json.error || 'save failed (HTTP ' + s.status + ')');
      setDone('Moved to ' + RINGS[c - 1].label + ', refreshing');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };

  return (
    <div className={'ci-card ci-ui ' + p.relation}>
      <div className="ci-card-head"><i className={'ci-sw ' + p.relation} /><b>{p.name}</b><span>{[p.relationship, p.relation === 'family' ? 'family' : 'friend'].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}</span></div>
      <div className="ci-circle" role="group" aria-label="Circle">
        {RINGS.map(r => <button key={r.n} className={r.n === p.circle ? 'on' : ''} disabled={!canWrite || !!busy} onClick={() => move(r.n)} title={`${r.label}: check in every ${r.every} days`}>{r.n} {r.label}</button>)}
      </div>
      <dl>
        <dt>Last contact</dt><dd className={p.status}>{agoText(p.since)}{p.last && <> ({p.last}{p.lastKind ? ', ' + p.lastKind : ''})</>}{p.lastText && <small>{p.lastText}</small>}</dd>
        <dt>Rhythm</dt><dd>every {p.every} days{p.status === 'overdue' ? `, ${p.since! - p.every} days late` : ''}</dd>
        <dt>Birthday</dt><dd>{p.birthday ? <>{p.birthday} <small>{bdayText(p)}</small></> : <span className="ci-none">not set (edit the note)</span>}</dd>
      </dl>
      {canWrite ? (
        <form className="ci-log" onSubmit={e => { e.preventDefault(); log(); }}>
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">{KINDS.map(k => <option key={k}>{k}</option>)}</select>
          <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value || today())} aria-label="Date" />
          <input value={text} onChange={e => setText(e.target.value)} placeholder="What did you talk about?" maxLength={400} aria-label="What did you talk about" />
          <button type="submit" disabled={!text.trim() || !!busy}>{busy === 'log' ? 'Saving' : 'Log'}</button>
        </form>
      ) : <p className="ci-none">Read only here (Safe mode or a read-only vault).</p>}
      {done && <p className="ci-done">{done}</p>}
      {err && <p className="tv-err">{err}</p>}
    </div>
  );
}
