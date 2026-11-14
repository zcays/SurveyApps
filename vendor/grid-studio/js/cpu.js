'use strict';
/* cpu.js — SOFTWARE image renderer: the fallback used when WebGL is unavailable (e.g. the browser's "hardware acceleration" is off).
 * It must give the same picture as gl.js: translate/scale/rotate → radial lens correction → crop mask → distortion (warp).
 *  - No lens correction: one drawImage() with a transform (fast).
 *  - Lens correction: per-pixel inverse mapping in JavaScript (same maths as FRAGMENT_SRC in gl.js, bilinear sampling).
 *  - Distortion: the pass-1 result is drawn as small texture-mapped triangles (affine per triangle, 2-D canvas has no mesh API).
 * It is slower, so interactive frames of heavy renders are drawn at reduced resolution and a full-quality render follows ~250 ms
 * after the last change. Export always renders full quality. renderCPU() is called through renderImage() in render.js.
 * If you change the maths in gl.js, change it here too — tests.html compares the two renderers. */

const CPU_PREVIEW_PIXELS = 1.0e6;          // heavy interactive frames are drawn with about this many pixels
const CPU_MESH_N = 16;                     // warp mesh resolution (the GPU path uses 32)
let cpuScratch = null, cpuSrcData = null, cpuFullTimer = 0;

function cpuSetSource() { cpuSrcData = null; }          // the image changed: drop the cached pixels

/** Pixels of the source image (cached). */
function cpuSourcePixels() {
  const I = S.img;
  if (!cpuSrcData || cpuSrcData.el !== I.el) {
    const c = document.createElement('canvas'); c.width = I.w; c.height = I.h;
    const x = c.getContext('2d'); x.drawImage(I.el, 0, 0);
    cpuSrcData = {el: I.el, data: x.getImageData(0, 0, I.w, I.h).data};
  }
  return cpuSrcData.data;
}

const lensIsActive = () => !S.lens.bypass && (S.lens.k1 !== 0 || S.lens.k2 !== 0);

/** Pass 1 with a lens: per-pixel inverse mapping, the JS twin of the fragment shader. k = output px per canvas px. */
function cpuLensPass(ctx, cw, ch, k) {
  const I = S.img, L = S.lens, src = cpuSourcePixels(), sw = I.w, sh = I.h;
  const out = ctx.createImageData(cw, ch), o = out.data;
  const cr = cropFrame(I.crop);
  const a = -I.rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const icx = I.x + sw * I.scale / 2, icy = I.y + sh * I.scale / 2, inv = 1 / k, invScale = 1 / I.scale;
  const lcx = L.cx * sw, lcy = L.cy * sh, R = 0.5 * Math.hypot(sw, sh), k1 = L.k1, k2 = L.k2;

  for (let y = 0; y < ch; y++) {
    const py = (y + .5) * inv - icy;
    for (let x = 0; x < cw; x++) {
      const px = (x + .5) * inv - icx;
      const qx = (cs * px - sn * py) * invScale + sw / 2, qy = (sn * px + cs * py) * invScale + sh / 2;   // corrected-image px
      const ex = qx - cr.cx, ey = qy - cr.cy;                                                              // in the crop rectangle's own (turned) frame
      if (Math.abs(cr.cos * ex + cr.sin * ey) > cr.hw || Math.abs(cr.cos * ey - cr.sin * ex) > cr.hh) continue;   // outside the crop
      const nx = (qx - lcx) / R, ny = (qy - lcy) / R, r2 = nx * nx + ny * ny, f = 1 - k1 * r2 - k2 * r2 * r2;
      const ux = lcx + nx * f * R, uy = lcy + ny * f * R;                                                  // source px
      if (ux < 0 || uy < 0 || ux > sw || uy > sh) continue;
      const fx = ux - .5, fy = uy - .5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const xa = x0 < 0 ? 0 : x0 > sw - 1 ? sw - 1 : x0, xb = x0 + 1 > sw - 1 ? sw - 1 : x0 + 1 < 0 ? 0 : x0 + 1;
      const ya = y0 < 0 ? 0 : y0 > sh - 1 ? sh - 1 : y0, yb = y0 + 1 > sh - 1 ? sh - 1 : y0 + 1 < 0 ? 0 : y0 + 1;
      const i00 = (ya * sw + xa) * 4, i10 = (ya * sw + xb) * 4, i01 = (yb * sw + xa) * 4, i11 = (yb * sw + xb) * 4, oi = (y * cw + x) * 4;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      for (let c = 0; c < 4; c++) o[oi + c] = src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** Pass 1 without a lens: a single transformed drawImage (plus a clip for the crop). */
function cpuPlainPass(ctx, k) {
  const I = S.img;
  ctx.save();
  ctx.scale(k, k); ctx.translate(I.x + I.w * I.scale / 2, I.y + I.h * I.scale / 2); ctx.rotate(I.rot * Math.PI / 180);
  ctx.scale(I.scale, I.scale); ctx.translate(-I.w / 2, -I.h / 2);
  if (I.crop) {                                                    // clip to the (possibly turned) crop rectangle
    const cr = cropFrame(I.crop); ctx.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b], n) => { const x = cr.cx + cr.cos * a * cr.hw - cr.sin * b * cr.hh, y = cr.cy + cr.sin * a * cr.hw + cr.cos * b * cr.hh; n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.clip();
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(I.el, 0, 0);
  ctx.restore();
}

/** Draw triangle (s0,s1,s2) of `img` onto ctx at (d0,d1,d2) using the affine map between them. Points are {x, y}. */
function cpuDrawTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
  const s1x = s1.x - s0.x, s1y = s1.y - s0.y, s2x = s2.x - s0.x, s2y = s2.y - s0.y, det = s1x * s2y - s2x * s1y;
  if (Math.abs(det) < 1e-9) return;
  const e1x = d1.x - d0.x, e1y = d1.y - d0.y, e2x = d2.x - d0.x, e2y = d2.y - d0.y;
  const a = (e1x * s2y - e2x * s1y) / det, c = (-e1x * s2x + e2x * s1x) / det;
  const b = (e1y * s2y - e2y * s1y) / det, d = (-e1y * s2x + e2y * s1x) / det;
  const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
  const gx = (d0.x + d1.x + d2.x) / 3, gy = (d0.y + d1.y + d2.y) / 3;       // grow the clip triangle ~0.6 px so neighbours overlap (no seams)
  const grow = p => { const vx = p.x - gx, vy = p.y - gy, len = Math.hypot(vx, vy) || 1; return {x: p.x + vx / len * .6, y: p.y + vy / len * .6}; };
  const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
  const bx0 = Math.max(0, Math.floor(Math.min(s0.x, s1.x, s2.x)) - 1), by0 = Math.max(0, Math.floor(Math.min(s0.y, s1.y, s2.y)) - 1);
  const bx1 = Math.min(img.width, Math.ceil(Math.max(s0.x, s1.x, s2.x)) + 1), by1 = Math.min(img.height, Math.ceil(Math.max(s0.y, s1.y, s2.y)) + 1);
  if (bx1 <= bx0 || by1 <= by0) return;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath(); ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, bx0, by0, bx1 - bx0, by1 - by0, bx0, by0, bx1 - bx0, by1 - by0);
  ctx.restore();
}

/** Pass 2: draw the pass-1 canvas through the warp mesh (same control points as the GPU path, warp.js). */
function cpuWarpPass(ctx, img, cw, ch) {
  const P = warpControlPoints(), N = CPU_MESH_N, pts = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const u = i / N, v = j / N, p = warpPoint(u, v, P);
    pts.push({src: {x: u * cw, y: v * ch}, dst: {x: p.x * cw, y: p.y * ch}});
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = pts[j * (N + 1) + i], b = pts[j * (N + 1) + i + 1], c = pts[(j + 1) * (N + 1) + i], d = pts[(j + 1) * (N + 1) + i + 1];
    cpuDrawTriangle(ctx, img, a.src, b.src, c.src, a.dst, b.dst, c.dst);
    cpuDrawTriangle(ctx, img, b.src, d.src, c.src, b.dst, d.dst, c.dst);
  }
}

/** Render the image layer into the (2-D) #gl canvas. full = always full resolution (export, and the follow-up after a preview). */
function renderCPU(full = false) {
  clearTimeout(cpuFullTimer);
  const {w, h} = S.doc, I = S.img, warped = I.el && S.warp.enabled && warpActive(), lens = lensIsActive();
  const heavy = lens || warped;
  const k = full || !heavy ? 1 : Math.min(1, Math.sqrt(CPU_PREVIEW_PIXELS / (w * h)));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  if (dom.gl.width !== cw || dom.gl.height !== ch) { dom.gl.width = cw; dom.gl.height = ch; }
  const ctx = dom.gl.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
  if (!I.el) return;

  let target = ctx;
  if (warped) {
    if (!cpuScratch) cpuScratch = document.createElement('canvas');
    if (cpuScratch.width !== cw || cpuScratch.height !== ch) { cpuScratch.width = cw; cpuScratch.height = ch; }
    target = cpuScratch.getContext('2d'); target.setTransform(1, 0, 0, 1, 0, 0); target.clearRect(0, 0, cw, ch);
  }
  if (lens) cpuLensPass(target, cw, ch, k); else cpuPlainPass(target, k);
  if (warped) cpuWarpPass(ctx, cpuScratch, cw, ch);

  if (k < 1) cpuFullTimer = setTimeout(() => renderCPU(true), 250);      // sharpen once the user pauses
}
