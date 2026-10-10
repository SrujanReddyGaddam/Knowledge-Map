import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { forceSimulation, forceManyBody, forceLink, forceRadial, forceCollide } from 'd3-force-3d';
import type { Note } from 'virtual:vault';
import { shortTitle } from './util';
import type { Colors } from './palettes';

type GNode = { id: string; note: Note; tx?: number; ty?: number; tz?: number; R0: number; show: number; showT: number; x: number; y: number; z: number; fx?: number | null; fy?: number | null; fz?: number | null; r: number; t: number; R: number; hov: number; dim: number; lab: number; sx: number; sy: number; sr: number; wz: number; front: number; p: [number, number, number] };
type Props = { notes: Note[]; edges: [string, string][]; selectedId: string | null; panelWidth: number; colors: Colors; matchIds: Set<string> | null; markIds?: Set<string> | null; hide: boolean; onSelect: (id: string) => void; onHover?: (id: string | null) => void };

const SPHERE = 330, DEFAULT_DIST = 1080, FOV = 46;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

export default function Graph(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const api = useRef<{ focus: (id: string | null) => void; panel: (w: number) => void; filter: () => void } | null>(null);

  useEffect(() => {
    const host = wrap.current!;
    const { notes, edges } = live.current;
    const deg = new Map(notes.map(n => [n.id, 0]));
    edges.forEach(([a, b]) => { deg.set(a, deg.get(a)! + 1); deg.set(b, deg.get(b)! + 1); });
    const maxDeg = Math.max(1, ...deg.values());

    // nodes seeded on a fibonacci sphere; hubs sit nearer the middle
    const nodes: GNode[] = notes.map((n, i) => {
      const t = deg.get(n.id)! / maxDeg, k = (i + 0.5) / notes.length;
      const phi = Math.acos(1 - 2 * k), th = Math.PI * (1 + Math.sqrt(5)) * i, R = SPHERE * (1 - 0.3 * Math.pow(t, 0.8));
      return { id: n.id, note: n, R0: R, show: 1, showT: 1, x: R * Math.sin(phi) * Math.cos(th), y: R * Math.cos(phi), z: R * Math.sin(phi) * Math.sin(th), r: 6 + Math.pow(t, 0.55) * 13, t, R, hov: 0, dim: 0, lab: 0, sx: 0, sy: 0, sr: 0, wz: 0, front: 0, p: [0, 0, 0] };
    });
    const byId = new Map(nodes.map(n => [n.id, n]));
    (window as unknown as { __km?: unknown }).__km = { nodes };
    const links = edges.map(([s, t]) => ({ source: byId.get(s)!, target: byId.get(t)! }));
    const nb = new Map(notes.map(n => [n.id, new Set([...n.links, ...n.backlinks])]));
    const pin = { node: null as GNode | null, group: new Set<GNode>(), slots: new Map<GNode, [number, number, number]>() };   // a dragged node left in place together with its linked notes
    const unpin = () => { if (pin.node) { pin.node.fx = pin.node.fy = pin.node.fz = null; pin.node = null; pin.group = new Set(); pin.slots = new Map(); refreshShell(); sim.alpha(Math.max(sim.alpha(), 0.3)); } };
    const refreshShell = () => (sim.force('shell') as any).strength((d: GNode) => pin.group.has(d) ? 0 : 0.55);   // d3 only re-reads a strength callback when it is set again
    const sim = forceSimulation(nodes, 3)
      .force('charge', forceManyBody().strength(-45).distanceMax(450))
      .force('link', forceLink(links).id((d: GNode) => d.id).distance(120).strength(0.012))
      .force('shell', forceRadial((d: GNode) => d.R, 0, 0, 0).strength((d: GNode) => pin.group.has(d) ? 0 : 0.55))
      .force('collide', forceCollide((d: GNode) => d.r + 8).strength(0.8))
      .velocityDecay(0.55).alphaDecay(0.02).stop();
    // keep the cloud a ball: pull each node back toward its shell radius (hubs sit nearer the middle)
    const dragRef = { node: null as GNode | null };
    let active: GNode[] = nodes;                 // nodes currently in the simulation (everything, or only the filter matches in Hide mode)
    const shell = { cur: 1, tgt: 1 }, settle = { t: 0 };             // sphere radius scale: a smaller set regroups into a smaller ball
    const constrain = (k: number) => {
      for (const n of active) { if ((n === dragRef.node && n.fx != null) || pin.group.has(n)) continue; const len = Math.hypot(n.x, n.y, n.z) || 1, f = 1 + (n.R / len - 1) * k; n.x *= f; n.y *= f; n.z *= f; }
    };
    for (let i = 0; i < 260; i++) { sim.tick(); constrain(0.5); }
    constrain(1);
    sim.on('tick', () => {
      constrain(0.18);
      // while a node is held, its neighbours are gently tugged along so the whole cluster responds
      const d = pin.node;
      if (d && d.fx != null) for (const [m, o] of pin.slots) { m.x += (d.x + o[0] - m.x) * 0.06; m.y += (d.y + o[1] - m.y) * 0.06; m.z += (d.z + o[2] - m.z) * 0.06; }
    });
    sim.alpha(0.1).alphaTarget(0.02).restart();

    // three.js scene
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const cv = renderer.domElement; cv.className = 'graph'; host.appendChild(cv);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 50, 6000);
    const bg = new THREE.Color(), nearTone = new THREE.Color(), farTone = new THREE.Color(), ink = new THREE.Color(), accent = new THREE.Color(), tmp = new THREE.Color();

    const discs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }), nodes.length);
    discs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); discs.frustumCulled = false; discs.renderOrder = 1;
    discs.setColorAt(0, tmp.set('#fff'));
    const E = links.length, SEG = 10, lp = new Float32Array(E * SEG * 6), lc = new Float32Array(E * SEG * 6), tmpP = [0, 0, 0];
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
    lines.frustumCulled = false; lines.renderOrder = 0;
    // flow: small dots streaming along every link (faster and brighter on the focused node's links)
    const PER = 3, PN = E * PER, pp = new Float32Array(PN * 3), pc = new Float32Array(PN * 3);
    const phase = Float32Array.from({ length: PN }, () => Math.random()), speed = Float32Array.from({ length: PN }, () => 0.07 + Math.random() * 0.09);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(pc, 3).setUsage(THREE.DynamicDrawUsage));
    const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 15, 0, 7); g.fill(); return new THREE.CanvasTexture(c); })();
    const dots = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.4 * Math.min(devicePixelRatio || 1, 2), map: dotTex, vertexColors: true, sizeAttenuation: false, transparent: false, alphaTest: 0.35, depthTest: false, depthWrite: false }));
    dots.frustumCulled = false; dots.renderOrder = 0.5;
    const mkRing = () => {
      const m = new THREE.Mesh(new THREE.RingGeometry(1.28, 1.4, 64), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }));
      m.renderOrder = 2; m.visible = false; m.frustumCulled = false; return m;
    };
    const hoverRing = mkRing(), selRing = mkRing();
    scene.add(lines, dots, discs, hoverRing, selRing);

    // labels (DOM overlay, positioned from projected node centres)
    const layer = document.createElement('div'); layer.className = 'labels'; host.appendChild(layer);
    const els = nodes.map(n => {
      const d = document.createElement('div'); d.className = 'node-label';
      const t = shortTitle(n.note.title).toUpperCase(); d.textContent = t.length > 30 ? t.slice(0, 28) + '..' : t;
      layer.appendChild(d); return d;
    });

    // state
    let W = 1, H = 1;
    const rot = { x: 0.28, y: 0 }, vel = { x: 0, y: 0 };
    const z0 = Number(new URLSearchParams(location.search).get('zoom')) || DEFAULT_DIST;
    const cam = { dist: z0, target: z0, off: live.current.panelWidth / 2, px: 0, py: 0, tx: 0, ty: 0 };   // px/py: camera pan (zoom-to-cursor), t* are its targets
    // a live reload (vault file saved) rebuilds the graph: restore the view so the camera does not jump
    let restored = false;
    try { const c = JSON.parse(sessionStorage.getItem('cam') || 'null'); if (c && !new URLSearchParams(location.search).has('zoom')) { rot.x = c.rx; rot.y = c.ry; cam.dist = cam.target = c.d; cam.px = cam.tx = c.px; cam.py = cam.ty = c.py; restored = true; } } catch {}
    let lastSave = 0;
    const pend = { x: 0, y: 0 }, tgt = [0, 0, 0];
    let hover: string | null = null, drag = false, rotMode = false, moved = 0, last = [0, 0], idleSince = performance.now();
    let tween: gsap.core.Tween | null = null;

    const resize = () => {
      const r = host.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
      renderer.setSize(W, H, false); camera.aspect = W / H;
    };
    resize(); const ro = new ResizeObserver(resize); ro.observe(host);

    let lastPanel = live.current.panelWidth, lastSig = '';
    const defaultDist = () => Math.max(700, DEFAULT_DIST * (0.55 + 0.45 * shell.tgt));
    api.current = {
      // Hide mode: non-matching nodes leave the simulation and fade out; the rest regroup into a smaller sphere
      filter: () => {
        const { matchIds, hide, selectedId } = live.current, on = !!(hide && matchIds);
        const sig = on ? [...matchIds!].sort().join('|') : '';
        if (sig === lastSig) return;
        lastSig = sig;
        nodes.forEach(n => { n.showT = !on || matchIds!.has(n.id) ? 1 : 0; });
        active = nodes.filter(n => n.showT === 1);
        sim.nodes(active); sim.force('link').links(links.filter(l => l.source.showT === 1 && l.target.showT === 1));
        shell.tgt = active.length ? clamp(Math.sqrt(active.length / nodes.length), 0.4, 1) : 1;
        // spread the remaining nodes evenly over the (smaller) sphere: relax directions by mutual repulsion, then glide there
        const u = active.map(n => { const l = Math.hypot(n.x, n.y, n.z) || 1; return [n.x / l, n.y / l, n.z / l]; });
        for (let it = 0; it < 160; it++) {
          const F = u.map(() => [0, 0, 0]);
          for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) {
            const dx = u[i][0] - u[j][0], dy = u[i][1] - u[j][1], dz = u[i][2] - u[j][2], d2 = dx * dx + dy * dy + dz * dz + 0.01, f = 1 / (d2 * Math.sqrt(d2));
            F[i][0] += dx * f; F[i][1] += dy * f; F[i][2] += dz * f; F[j][0] -= dx * f; F[j][1] -= dy * f; F[j][2] -= dz * f;
          }
          for (let i = 0; i < u.length; i++) {
            const m = Math.hypot(F[i][0], F[i][1], F[i][2]) || 1, step = Math.min(m * 0.002, 0.04) / m;
            u[i][0] += F[i][0] * step; u[i][1] += F[i][1] * step; u[i][2] += F[i][2] * step;
            const l = Math.hypot(u[i][0], u[i][1], u[i][2]) || 1; u[i][0] /= l; u[i][1] /= l; u[i][2] /= l;
          }
        }
        active.forEach((n, i) => { const R = n.R0 * shell.tgt; n.tx = u[i][0] * R; n.ty = u[i][1] * R; n.tz = u[i][2] * R; });
        unpin();
        settle.t = 1.8;
        sim.alpha(0.7).restart();
        if (!selectedId) { tween?.kill(); tween = gsap.to(cam, { target: defaultDist(), tx: 0, ty: 0, duration: 1.1, ease: 'power2.inOut' }); }
      },
      panel: w => { const big = Math.abs(w - lastPanel) > 160; lastPanel = w; gsap.killTweensOf(cam, 'off'); gsap.to(cam, { off: w / 2, duration: big ? 0.9 : 0.18, ease: big ? 'power3.out' : 'none' }); },
      focus: id => {
        tween?.kill();
        if (!id) { if (restored) { restored = false; return; } tween = gsap.to(cam, { target: defaultDist(), tx: 0, ty: 0, duration: 1.2, ease: 'power2.inOut' }); idleSince = performance.now(); return; }
        restored = false;
        const n = byId.get(id)!, rho = Math.hypot(n.x, n.z), ty = Math.atan2(-n.x, n.z), tx = Math.atan2(n.y, rho);
        let dy = ty - rot.y; dy = (((dy + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        vel.x = vel.y = 0;
        tween = gsap.to(rot, { x: tx, y: rot.y + dy, duration: 1.4, ease: 'power3.inOut' });
        gsap.to(cam, { target: Math.max(520, Math.hypot(n.x, n.y, n.z) + 340), tx: 0, ty: 0, duration: 1.4, ease: 'power3.inOut' });
      },
    };

    // pointer
    const pos = (e: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pick = (mx: number, my: number) => {
      let best: GNode | null = null, bz = -1e9;
      for (const n of nodes) if (n.show > 0.5 && Math.hypot(n.sx - mx, n.sy - my) < Math.max(n.sr, 7) + 4 && n.wz > bz) { best = n; bz = n.wz; }
      return best;
    };
    // pointer ray -> point on the plane the node sits in (view space), then back into simulation space
    const planePoint = (mx: number, my: number, n: GNode) => {
      v3.set((mx / W) * 2 - 1, -(my / H) * 2 + 1, 0.5).unproject(camera);
      const o = camera.position, dx = v3.x - o.x, dy = v3.y - o.y, dz = v3.z - o.z, t = (n.p[2] - o.z) / dz;
      const x1 = o.x + dx * t, y2 = o.y + dy * t, z2 = n.p[2];
      const cx = Math.cos(rot.x), sx = Math.sin(rot.x), cy = Math.cos(rot.y), sy = Math.sin(rot.y);
      const y = y2 * cx + z2 * sx, z1 = -y2 * sx + z2 * cx;
      tgt[0] = x1 * cy - z1 * sy; tgt[1] = y; tgt[2] = x1 * sy + z1 * cy;
    };
    const down = (e: PointerEvent) => {
      rotMode = e.shiftKey || e.button === 2; drag = true; moved = 0; last = pos(e); cv.setPointerCapture(e.pointerId); tween?.kill(); vel.x = vel.y = 0; pend.x = pend.y = 0;
      dragRef.node = pick(last[0], last[1]); if (dragRef.node) sim.alphaTarget(0.2).restart();
      if (dragRef.node && pin.node && !pin.group.has(dragRef.node)) unpin();
      cv.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      const [mx, my] = pos(e);
      if (drag) {
        const dx = mx - last[0], dy = my - last[1]; moved += Math.abs(dx) + Math.abs(dy); idleSince = performance.now();
        if (dragRef.node) { if (moved >= 6) { planePoint(mx, my, dragRef.node); if (dragRef.node.fx == null) { dragRef.node.fx = dragRef.node.x; dragRef.node.fy = dragRef.node.y; dragRef.node.fz = dragRef.node.z; } } }
        else if (rotMode) { pend.y += dx * 0.0052; pend.x += dy * 0.0052; }  // shift/right-drag rotates; applied smoothly in the frame loop
        else {
          // plain drag pans the view so the content follows the pointer (1:1 at the middle depth)
          tween?.kill(); gsap.killTweensOf(cam, 'tx,ty');
          const upp = cam.dist / (H / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))), lim = SPHERE * 1.6;
          cam.tx = cam.px = clamp(cam.px - dx * upp, -lim, lim); cam.ty = cam.py = clamp(cam.py + dy * upp, -lim, lim);
        }
      } else { const p = pick(mx, my), id = p ? p.id : null; if (id !== hover) live.current.onHover?.(id); hover = id; cv.style.cursor = p ? 'pointer' : 'grab'; }
      last = [mx, my];
    };
    const up = (e: PointerEvent) => {
      if (!drag) return; drag = false; cv.style.cursor = hover ? 'pointer' : 'grab';
      const held = dragRef.node;
      if (held) {
        dragRef.node = null; sim.alphaTarget(0.02);
        if (moved >= 6) { if (pin.node && pin.node !== held) unpin(); pin.node = held;
          const ns = [...(nb.get(held.id) ?? [])].map(id => byId.get(id)!).filter(m => m && active.includes(m));
          pin.group = new Set([held, ...ns]);
          // each linked note gets its own spot on a sphere around the held one, so they stay apart instead of piling up on it
          const ring = held.r + 70 + 22 * Math.sqrt(ns.length);
          pin.slots = new Map(ns.map((m, i) => { const y = ns.length > 1 ? 1 - 2 * (i + 0.5) / ns.length : 0, rr = Math.sqrt(1 - y * y), th = i * 2.399963; return [m, [Math.cos(th) * rr * ring, y * ring, Math.sin(th) * rr * ring]] as [GNode, [number, number, number]]; }));
          refreshShell(); }   // leave it where it was dropped
        else if (held !== pin.node) held.fx = held.fy = held.fz = null;
      }
      if (moved < 6) { const [mx, my] = pos(e); const p = pick(mx, my); if (p && pin.node && !pin.group.has(p)) unpin(); if (p) live.current.onSelect(p.id); }
      idleSince = performance.now();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); tween?.kill(); gsap.killTweensOf(cam, 'tx,ty,target');
      // zoom toward whatever is under the cursor: keep that point fixed on screen by sliding the camera sideways as it dollies
      const [mx, my] = pos(e);
      let zp = 0, best = 48;                                   // depth of the nearest visible note (within 48px), else the middle plane
      for (const n of active) { const d = Math.hypot(n.sx - mx, n.sy - my) - n.sr; if (n.show > 0.5 && d < best) { best = d; zp = n.p[2]; } }
      v3.set((mx / W) * 2 - 1, -(my / H) * 2 + 1, 0.5).unproject(camera);
      const o = camera.position, t = (zp - o.z) / (v3.z - o.z), Px = o.x + (v3.x - o.x) * t, Py = o.y + (v3.y - o.y) * t;
      const d0 = cam.target, d1 = clamp(d0 * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), 450, 2100), k = (d1 - zp) / (d0 - zp), lim = SPHERE * 1.3;
      cam.tx = clamp(Px - (Px - cam.tx) * k, -lim, lim); cam.ty = clamp(Py - (Py - cam.ty) * k, -lim, lim);
      cam.target = d1; idleSince = performance.now();
    };
    const leave = () => { hover = null; };
    cv.style.cursor = 'grab';
    cv.addEventListener('contextmenu', ev => ev.preventDefault()); cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', leave); cv.addEventListener('wheel', wheel, { passive: false });

    // frame loop
    let raf = 0, prev = performance.now();
    const v3 = new THREE.Vector3(), m4 = new THREE.Matrix4(), qI = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      const { selectedId, colors: c, matchIds, markIds } = live.current;
      const ease = 1 - Math.exp(-dt * 10), fast = 1 - Math.exp(-dt * 14);

      // rotation: inertia after a drag, then a slow idle spin
      if (drag && !dragRef.node) {
        // ease the pending drag distance in over a few frames instead of snapping to the pointer
        const k = 1 - Math.exp(-dt * 22), ay = pend.y * k, ax = pend.x * k;
        pend.y -= ay; pend.x -= ax; rot.y += ay; rot.x = clamp(rot.x + ax, -1.45, 1.45);
        const f = 0.6 / Math.max(dt, 0.001) / 60; vel.y = ay * f; vel.x = ax * f;
      } else if (drag && dragRef.node && dragRef.node.fx != null) {
        // held node glides toward the pointer
        const d = dragRef.node, k = 1 - Math.exp(-dt * 14);
        d.fx = d.fx! + (tgt[0] - d.fx!) * k; d.fy = d.fy! + (tgt[1] - d.fy!) * k; d.fz = d.fz! + (tgt[2] - d.fz!) * k;
        d.x = d.fx; d.y = d.fy; d.z = d.fz;
      }
      if (!drag) {
        rot.y += vel.y * dt * 60; rot.x = clamp(rot.x + vel.x * dt * 60, -1.45, 1.45);
        vel.y *= Math.exp(-dt * 2.4); vel.x *= Math.exp(-dt * 2.4);
        if (!selectedId && !hover && !dragRef.node && now - idleSince > 1500 && !tween?.isActive()) rot.y += dt * 0.07;
      }
      if (now - lastSave > 600) { lastSave = now; try { sessionStorage.setItem('cam', JSON.stringify({ rx: rot.x, ry: rot.y, d: cam.target, px: cam.tx, py: cam.ty })); } catch {} }
      cam.dist += (cam.target - cam.dist) * ease;
      cam.px += (cam.tx - cam.px) * ease; cam.py += (cam.ty - cam.py) * ease;
      camera.position.set(cam.px, cam.py, cam.dist);
      camera.setViewOffset(W, H, cam.off, 0, W, H); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);

      bg.set(c.bg); nearTone.set(c.near); farTone.set(c.far); ink.set(c.ink); accent.set(c.accent);
      renderer.setClearColor(bg, 1);

      const cx = Math.cos(rot.x), sx = Math.sin(rot.x), cy = Math.cos(rot.y), sy = Math.sin(rot.y);
      const focus = hover ?? selectedId, fnb = focus ? nb.get(focus)! : null;
      const pxPerUnit = H / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
      shell.cur += (shell.tgt - shell.cur) * (1 - Math.exp(-dt * 2.5));
      if (settle.t > 0) { settle.t -= dt; const k = 1 - Math.exp(-dt * 4); for (const n of active) if (n.tx != null && n !== dragRef.node) { n.x += (n.tx - n.x) * k; n.y += ((n.ty as number) - n.y) * k; n.z += ((n.tz as number) - n.z) * k; } }
      const showK = 1 - Math.exp(-dt * 7);
      for (const n of nodes) {
        n.R = n.R0 * shell.cur; n.show += (n.showT - n.show) * showK;
        const x1 = n.x * cy + n.z * sy, z1 = -n.x * sy + n.z * cy, y2 = n.y * cx - z1 * sx, z2 = n.y * sx + z1 * cx;
        n.p = [x1, y2, z2]; n.wz = z2; n.front = clamp((z2 + SPHERE) / (2 * SPHERE), 0, 1);
        v3.set(x1, y2, z2).project(camera);
        n.sx = (v3.x * 0.5 + 0.5) * W; n.sy = (-v3.y * 0.5 + 0.5) * H;
        n.sr = n.r * (1 + 0.5 * Math.pow(1 - n.front, 3)) * pxPerUnit / (cam.dist - z2);
        const matchQ = !matchIds || matchIds.has(n.id) || n.showT === 0;
        n.dim += (((!matchQ) || (focus && n.id !== focus && !fnb!.has(n.id)) ? 1 : 0) - n.dim) * fast;
        n.hov += ((n.id === hover || n.id === selectedId ? 1 : 0) - n.hov) * fast;
      }

      // discs, painted back to front; far ones grow and fade like out-of-focus bokeh
      [...nodes].sort((a, b) => a.wz - b.wz).forEach((n, i) => {
        const marked = !!markIds && markIds.has(n.id);
        const s = n.r * (1 + 0.5 * Math.pow(1 - n.front, 3)) * (1 + n.hov * 0.12 + (marked ? 0.18 : 0)) * smooth(n.show);
        m4.compose(v3.set(n.p[0], n.p[1], n.p[2]), qI, sc.set(s, s, 1)); discs.setMatrixAt(i, m4);
        const f = smooth(n.front);
        tmp.copy(farTone).lerp(nearTone, f * (0.35 + 0.65 * Math.pow(n.t, 0.6))).lerp(bg, clamp(n.dim * 0.5 + (1 - f) * 0.35, 0, 1));
        tmp.lerp(accent, Math.max(n.hov * 0.7, marked ? 0.85 : 0)).lerp(bg, 1 - n.show); discs.setColorAt(i, tmp);
      });
      discs.instanceMatrix.needsUpdate = true; discs.instanceColor!.needsUpdate = true;

      // edges: bowed curves. Only the focused node's links are drawn; everything else recedes to near-nothing
      const zoomK = clamp(1150 / cam.dist, 0.25, 1.1);
      links.forEach((l, i) => {
        const ls = l.source, lt = l.target, hot = !!focus && (ls.id === focus || lt.id === focus);
        const A = ls.p, B = lt.p, dx = B[0] - A[0], dy = B[1] - A[1], flat = Math.hypot(dx, dy) || 1, bow = 0.13 * Math.hypot(dx, dy, B[2] - A[2]);
        const mx = (A[0] + B[0]) / 2 - (dy / flat) * bow, my = (A[1] + B[1]) / 2 + (dx / flat) * bow, mz = (A[2] + B[2]) / 2;
        const curve = (t: number) => { const u = 1 - t; tmpP[0] = u * u * A[0] + 2 * u * t * mx + t * t * B[0]; tmpP[1] = u * u * A[1] + 2 * u * t * my + t * t * B[1]; tmpP[2] = u * u * A[2] + 2 * u * t * mz + t * t * B[2]; };
        const fade = 1 - Math.max(ls.dim, lt.dim) * 0.9, avg = (ls.front + lt.front) / 2;
        const vs = smooth(Math.min(ls.show, lt.show));
        const lineAmt = (hot ? 0.8 * Math.max(zoomK, 0.6) : (0.04 + 0.2 * avg * avg) * (focus ? 0.06 : 1) * zoomK * zoomK * fade) * vs;
        for (let k = 0; k < SEG; k++) for (let e = 0; e < 2; e++) {
          curve((k + e) / SEG); const vi = (i * SEG + k) * 6 + e * 3;
          lp[vi] = tmpP[0]; lp[vi + 1] = tmpP[1]; lp[vi + 2] = tmpP[2];
          tmp.copy(bg).lerp(hot ? accent : ink, lineAmt * (hot ? 1 : 0.35 + 0.65 * (ls.front + (lt.front - ls.front) * ((k + e) / SEG))));
          lc[vi] = tmp.r; lc[vi + 1] = tmp.g; lc[vi + 2] = tmp.b;
        }
        const dotAmt = (hot ? 0.95 : focus ? 0 : (0.2 + 0.45 * avg) * fade * zoomK) * vs, boost = hot ? 3.2 : 1;
        tmp.copy(bg).lerp(hot ? accent : ink, dotAmt);
        for (let j = 0; j < PER; j++) {
          const idx = i * PER + j; phase[idx] = (phase[idx] + speed[idx] * boost * dt) % 1;
          curve(phase[idx]);
          if (dotAmt < 0.01) { pp[idx * 3] = pp[idx * 3 + 1] = pp[idx * 3 + 2] = 1e7; } else { pp[idx * 3] = tmpP[0]; pp[idx * 3 + 1] = tmpP[1]; pp[idx * 3 + 2] = tmpP[2]; }
          pc[idx * 3] = tmp.r; pc[idx * 3 + 1] = tmp.g; pc[idx * 3 + 2] = tmp.b;
        }
      });
      lg.attributes.position.needsUpdate = true; lg.attributes.color.needsUpdate = true;
      (dots.material as THREE.PointsMaterial).size = 3.4 * Math.min(devicePixelRatio || 1, 2) * clamp(zoomK * 1.1, 0.45, 1.1);
      pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true;

      const ringFor = (ring: THREE.Mesh, id: string | null) => {
        const n = id ? byId.get(id) : null; ring.visible = !!n && n.show > 0.3; if (!n) return;
        const s = n.r * (1 + 0.5 * Math.pow(1 - n.front, 3));
        ring.position.set(n.p[0], n.p[1], n.p[2]); ring.scale.set(s, s, 1);
        const m = ring.material as THREE.MeshBasicMaterial; m.color.copy(id === selectedId ? accent : ink); m.opacity = id === selectedId ? 0.9 : 0.45;
      };
      ringFor(selRing, selectedId); ringFor(hoverRing, hover && hover !== selectedId ? hover : null);

      renderer.render(scene, camera);

      // labels scale with the node's on-screen size; biggest first, anything that would overlap is hidden
      const boxes: number[][] = [];
      const prio = [...nodes].sort((a, b) => (b.hov - a.hov) || (b.sr - a.sr));
      for (const n of prio) {
        const el = els[nodes.indexOf(n)], forced = (n.hov > 0.3 || (focus && fnb!.has(n.id)) || n.id === selectedId) && n.show > 0.5;
        const size = Math.min(26, 7 + n.sr * 0.2) * (1 + n.hov * 0.1), cw = size * 0.62, tiny = n.sr < 7 && !(n.hov > 0.3 || n.id === selectedId);
        const w = el.textContent!.length * cw + 6, h = size + 4, bx = n.sx - w / 2, by = n.sy - n.sr - 3 - h;
        let ok = !tiny && n.show > 0.5 && (!!forced || n.sr > 5);
        if (ok && !forced && boxes.some(b => bx < b[0] + b[2] && bx + w > b[0] && by < b[1] + b[3] && by + h > b[1])) ok = false;
        if (ok) boxes.push([bx, by, w, h]);
        n.lab += ((ok ? 1 : 0) - n.lab) * fast;
        if (n.lab < 0.02) { el.style.opacity = '0'; continue; }
        el.style.opacity = String((0.12 + 0.88 * Math.pow(n.front, 1.4)) * (1 - n.dim * 0.7) * n.lab * n.show);
        el.style.color = c.ink; el.style.fontSize = Math.max(size, 7).toFixed(1) + 'px';
        el.style.transform = `translate(${n.sx.toFixed(1)}px, ${(n.sy - n.sr - 3).toFixed(1)}px) translate(-50%, -100%)`;
        el.style.fontWeight = n.hov > 0.5 ? '600' : '400';
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); sim.stop(); ro.disconnect(); tween?.kill(); gsap.killTweensOf(cam); gsap.killTweensOf(rot);
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up); cv.removeEventListener('pointerleave', leave); cv.removeEventListener('wheel', wheel);
      renderer.dispose(); dotTex.dispose(); cv.remove(); layer.remove();
    };
  }, [props.notes, props.edges]);

  useEffect(() => { api.current?.filter(); }, [props.matchIds, props.hide]);
  useEffect(() => { api.current?.focus(props.selectedId); }, [props.selectedId]);
  useEffect(() => { api.current?.panel(props.panelWidth); }, [props.panelWidth]);

  return <div ref={wrap} className="graph-host" />;
}
