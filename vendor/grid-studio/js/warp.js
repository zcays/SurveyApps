'use strict';
/* warp.js — the Distort tool: free distortion of the image layer, drawn by gl.js (pass 2).
 * Registers TOOLS.warp and the warpCorner / warpEdge / warpBow drag types at the bottom of this file.
 * Eight handles: 4 corners and 4 sides.
 *   corner drag      → moves that corner (skew / perspective-like)
 *   side drag        → moves the whole edge (both of its corners)
 *   Alt + side drag  → bows the edge into a curve (stored as an offset from the edge's midpoint)
 * On top of the handles there can be a FINE MESH (S.warp.mesh, 17 × 17 nodes of small offsets) that follows local deviations the
 * 8 handles cannot. It has no handles of its own: Auto-fit / Auto-fix distortion (autofit.js) compute it, Reset distortion clears it.
 * Points are in canvas-normalised coordinates (0..1, y down). The warp is a biquadratic patch over
 * a 3 × 3 control grid, so with untouched handles it is exactly the identity. */

const SIDE_ENDS = {n: ['nw', 'ne'], e: ['ne', 'se'], s: ['se', 'sw'], w: ['sw', 'nw']};
const CORNERS = ['nw', 'ne', 'se', 'sw'], SIDES = ['n', 'e', 's', 'w'];

const midpoint = (a, b) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});
const sidePoint = k => { const m = midpoint(S.warp.c[SIDE_ENDS[k][0]], S.warp.c[SIDE_ENDS[k][1]]), d = S.warp.dev[k]; return {x: m.x + d.x, y: m.y + d.y}; };

/** 3 × 3 control points, [row (top→bottom)][col (left→right)]. */
function warpControlPoints() {
  const {c, dev} = S.warp;
  const avg = {x: (c.nw.x + c.ne.x + c.se.x + c.sw.x) / 4, y: (c.nw.y + c.ne.y + c.se.y + c.sw.y) / 4};
  const centre = {                                         // follows the average of the edge bows
    x: avg.x + (dev.n.x + dev.e.x + dev.s.x + dev.w.x) / 2,
    y: avg.y + (dev.n.y + dev.e.y + dev.s.y + dev.w.y) / 2,
  };
  return [[c.nw, sidePoint('n'), c.ne], [sidePoint('w'), centre, sidePoint('e')], [c.sw, sidePoint('s'), c.se]];
}

const lagrange = t => [2 * (t - .5) * (t - 1), -4 * t * (t - 1), 2 * t * (t - .5)];   // quadratic basis at t = 0, .5, 1
/** Fine-mesh offset at canvas-normalised (u, v): bilinear between the n×n nodes of mesh = {n, d}. Pure (no app state). */
function warpMeshOffset(mesh, u, v) {
  const n = mesh.n, d = mesh.d, fu = (u < 0 ? 0 : u > 1 ? 1 : u) * (n - 1), fv = (v < 0 ? 0 : v > 1 ? 1 : v) * (n - 1);
  const i = Math.min(n - 2, Math.floor(fu)), j = Math.min(n - 2, Math.floor(fv)), a = fu - i, b = fv - j, k = (j * n + i) * 2, k2 = k + 2 * n;
  return {x: (d[k] * (1 - a) + d[k + 2] * a) * (1 - b) + (d[k2] * (1 - a) + d[k2 + 2] * a) * b,
          y: (d[k + 1] * (1 - a) + d[k + 3] * a) * (1 - b) + (d[k2 + 1] * (1 - a) + d[k2 + 3] * a) * b};
}
/** Where the pass-1 picture point (u, v) is drawn: the 8-handle patch plus the fine mesh (if any). Both renderers and the overlay use this. */
function warpPoint(u, v, P = warpControlPoints()) {
  const lu = lagrange(u), lv = lagrange(v); let x = 0, y = 0;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const w = lv[j] * lu[i]; x += w * P[j][i].x; y += w * P[j][i].y; }
  if (S.warp.mesh) { const o = warpMeshOffset(S.warp.mesh, u, v); x += o.x; y += o.y; }
  return {x, y};
}

function warpActive() {
  const d = defaultWarp(), near = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  return !!S.warp.mesh || CORNERS.some(k => !near(S.warp.c[k], d.c[k])) || SIDES.some(k => !near(S.warp.dev[k], d.dev[k]));
}
function resetWarp() { const keep = S.warp.enabled; Object.assign(S.warp, defaultWarp(), {enabled: keep}); refresh('gl', 'warp'); }

/** Vertex data for the GL mesh: clip x, clip y, texture u, texture v (flipped to match the offscreen texture). */
function warpMesh(n) {
  const P = warpControlPoints(), out = new Float32Array((n + 1) * (n + 1) * 4); let o = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n, p = warpPoint(u, v, P);
    out[o++] = p.x * 2 - 1; out[o++] = 1 - p.y * 2; out[o++] = u; out[o++] = 1 - v;
  }
  return out;
}

/* ---------------- on-canvas overlay (outline, inner guide lines, 8 handles) ---------------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
let warpSvg, warpPath, warpHandles = {};

function buildWarpOverlay() {
  warpSvg = document.createElementNS(SVG_NS, 'svg'); warpSvg.id = 'warpsvg';
  warpPath = document.createElementNS(SVG_NS, 'path'); warpSvg.append(warpPath);
  dom.stage.append(warpSvg);
  for (const k of [...CORNERS, ...SIDES]) {
    const h = document.createElement('i'); h.className = 'wh ' + (SIDES.includes(k) ? 'side' : 'corner'); h.dataset.w = k;
    h.title = SIDES.includes(k) ? 'Drag: move edge · Alt+drag: bend edge' : 'Drag: move corner';
    dom.stage.append(h); warpHandles[k] = h;
  }
}

function updateWarpUI() {
  const show = S.tool === 'warp' && S.img.el;
  warpSvg.style.display = show ? 'block' : 'none';
  for (const h of Object.values(warpHandles)) h.style.display = show ? 'block' : 'none';
  if (!show) return;
  const W = S.doc.w * S.zoom, H = S.doc.h * S.zoom, P = warpControlPoints(), px = p => `${(p.x * W).toFixed(1)} ${(p.y * H).toFixed(1)}`;
  const curve = (fixed, isU) => { let d = ''; for (let t = 0; t <= 24; t++) d += (t ? 'L' : 'M') + px(isU ? warpPoint(fixed, t / 24, P) : warpPoint(t / 24, fixed, P)); return d; };
  warpPath.setAttribute('d', [0, .25, .5, .75, 1].map(t => curve(t, true) + curve(t, false)).join(''));
  for (const k of CORNERS) place(warpHandles[k], S.warp.c[k], W, H);
  for (const k of SIDES) place(warpHandles[k], sidePoint(k), W, H);
}
function place(el, p, W, H) { el.style.left = p.x * W + 'px'; el.style.top = p.y * H + 'px'; }

/* ---------------- tool + mouse drags (registered into the registries in state.js) ---------------- */
// Pointer positions arrive in canvas px; warp points are canvas-normalised, so convert and work with deltas.
const normPoint = p => ({x: p.x / S.doc.w, y: p.y / S.doc.h});
const warpDelta = (d, p) => { const n = normPoint(p); return {x: n.x - d.p0.x, y: n.y - d.p0.y}; };
const handleKey = e => e.target.dataset && e.target.dataset.w;       // 'nw' … 'w' from the .wh handle element

TOOLS.warp = {
  cursor: 'default',
  pick(e) {
    const k = handleKey(e); if (!k) return null;
    return CORNERS.includes(k) ? 'warpCorner' : e.altKey ? 'warpBow' : 'warpEdge';
  },
};
Object.assign(dragTypes, {
  warpCorner: {
    start: (e, p) => { const key = handleKey(e); return {key, p0: normPoint(p), c0: {...S.warp.c[key]}}; },
    move: (d, e, p) => { const m = warpDelta(d, p); S.warp.c[d.key] = {x: d.c0.x + m.x, y: d.c0.y + m.y}; dirty('gl', 'warp'); },
  },
  warpEdge: {                                                        // moves both corners of the edge
    start: (e, p) => { const ends = SIDE_ENDS[handleKey(e)]; return {ends, p0: normPoint(p), c0: ends.map(k => ({...S.warp.c[k]}))}; },
    move: (d, e, p) => { const m = warpDelta(d, p); d.ends.forEach((k, i) => S.warp.c[k] = {x: d.c0[i].x + m.x, y: d.c0[i].y + m.y}); dirty('gl', 'warp'); },
  },
  warpBow: {                                                         // Alt + side handle: curve the edge
    start: (e, p) => { const key = handleKey(e); return {key, p0: normPoint(p), v0: {...S.warp.dev[key]}}; },
    move: (d, e, p) => { const m = warpDelta(d, p); S.warp.dev[d.key] = {x: d.v0.x + m.x, y: d.v0.y + m.y}; dirty('gl', 'warp'); },
  },
});
