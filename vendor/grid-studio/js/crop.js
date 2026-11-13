'use strict';
/* crop.js — the Crop tool. The selection rect {x, y, w, h} is in canvas px while you draw it.
 * IMPORTANT: cropping affects ONLY THE IMAGE. "Applying" converts the rect to image pixels and stores it in S.img.crop; gl.js
 * then hides everything outside it. The canvas size (S.doc), the grid and the chip scale are never changed by a crop.
 * The crop is non-destructive (Reset crop / Undo bring the picture back) and moves with the image.
 * For a rotated image the stored crop is the bounding box of the selection (crop before rotating for an exact rectangle).
 * Registers TOOLS.crop and the cropNew / cropMove / cropResize drag types at the bottom of this file. */

const rectHasArea = r => r && r.w >= 1 && r.h >= 1;

function clampRect(r) {
  r.w = Math.min(r.w, S.doc.w); r.h = Math.min(r.h, S.doc.h);
  r.x = clamp(r.x, 0, S.doc.w - r.w); r.y = clamp(r.y, 0, S.doc.h - r.h);
  return r;
}
/** Active aspect ratio (w/h) or 0 for free. */
function ratioValue() { return S.ratio === -1 ? (S.img.el ? S.doc.w / S.doc.h : 0) : S.ratio; }

/** Rect dragged out from corner `a` to point `b`, optionally locked to an aspect ratio. */
function rectFromPoints(a, b, ratio) {
  b = {x: clamp(b.x, 0, S.doc.w), y: clamp(b.y, 0, S.doc.h)};
  let w = b.x - a.x, h = b.y - a.y;
  if (ratio) {
    const aw = Math.abs(w), ah = Math.abs(h), sx = Math.sign(w) || 1, sy = Math.sign(h) || 1;
    if (aw / Math.max(ah, 1e-6) > ratio) h = sy * aw / ratio; else w = sx * ah * ratio;
    const maxW = sx > 0 ? S.doc.w - a.x : a.x, maxH = sy > 0 ? S.doc.h - a.y : a.y;
    const shrink = Math.min(1, maxW / Math.abs(w), maxH / Math.abs(h)); w *= shrink; h *= shrink;
  }
  return {x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h)};
}

/** Resize `r0` by dragging handle `handle` ('n','se',…) by delta `d`. */
function resizeRect(r0, handle, d, ratio) {
  const has = c => handle.includes(c);
  let l = r0.x, t = r0.y, r = r0.x + r0.w, b = r0.y + r0.h;
  if (has('w')) l += d.x; if (has('e')) r += d.x;
  if (has('n')) t += d.y; if (has('s')) b += d.y;
  l = clamp(l, 0, S.doc.w); r = clamp(r, 0, S.doc.w); t = clamp(t, 0, S.doc.h); b = clamp(b, 0, S.doc.h);
  if (ratio) {
    const fixWidth = () => { const nw = (b - t) * ratio; if (has('w')) l = r - nw; else r = l + nw; };
    if (has('e') || has('w')) {                       // width drives height
      const nh = Math.abs(r - l) / ratio; if (has('n')) t = b - nh; else b = t + nh;
      if (b > S.doc.h) { b = S.doc.h; fixWidth(); }
      if (t < 0) { t = 0; fixWidth(); }
    } else {                                          // height drives width
      r = l + Math.abs(b - t) * ratio;
      if (r > S.doc.w) { r = S.doc.w; const nh = (r - l) / ratio; if (has('n')) t = b - nh; else b = t + nh; }
    }
  }
  return {x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t)};
}

function fitRatio(ratio) {
  const c = S.crop; if (!c || !ratio) return;
  let w = c.w, h = w / ratio;
  if (h > S.doc.h) { h = S.doc.h; w = h * ratio; }
  if (w > S.doc.w) { w = S.doc.w; h = w / ratio; }
  S.crop = clampRect({x: c.x + c.w / 2 - w / 2, y: c.y + c.h / 2 - h / 2, w, h});
}
function startCrop() {
  if (S.crop) return;
  const {w, h} = S.doc; S.crop = {x: w * .1, y: h * .1, w: w * .8, h: h * .8}; fitRatio(ratioValue());
}
function cancelCrop() { S.crop = null; setTool('move'); }

/** Convert a rect drawn on the canvas into image pixels (undo translate, rotate, scale). Rotated images get the bounding box. */
function canvasRectToImageRect(r) {
  const I = S.img, a = -I.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = I.x + I.w * I.scale / 2, cy = I.y + I.h * I.scale / 2;                  // image centre on the canvas
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [(c * dx - s * dy) / I.scale + I.w / 2, (s * dx + c * dy) / I.scale + I.h / 2];
  });
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
  return {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y};
}

function setImageCrop(crop) {
  undoStack.push({crop: S.img.crop ? {...S.img.crop} : null});
  S.img.crop = crop; S.crop = null; updateUndoButton(); refresh('gl', 'crop');
}
function applyCrop() {
  const c = S.crop; if (!rectHasArea(c) || !S.img.el) return;
  setImageCrop(canvasRectToImageRect(c)); setTool('move');
}
function resetCrop() { if (S.img.crop) setImageCrop(null); }                          // un-crop (undoable)
function undoCrop() {
  const u = undoStack.pop(); if (!u) return;
  S.img.crop = u.crop; S.crop = null; updateUndoButton(); refresh('gl', 'crop');
}
function updateUndoButton() { $('#undo').disabled = !undoStack.length; }

/** Position the on-canvas selection box and refresh the panel readout. */
function updateCrop() {
  const c = S.crop, show = S.tool === 'crop' && c, z = S.zoom;
  dom.cropbox.style.display = show ? 'block' : 'none';
  if (show) Object.assign(dom.cropbox.style, {left: c.x * z + 'px', top: c.y * z + 'px', width: c.w * z + 'px', height: c.h * z + 'px'});
  $('#cropInfo').textContent = c ? `Selection ${Math.round(c.w)} × ${Math.round(c.h)} px at (${Math.round(c.x)}, ${Math.round(c.y)})` : 'No selection';
  $('#cropApply').disabled = !rectHasArea(c);
}

/* ---------------- tool + mouse drags (registered into the registries in state.js) ---------------- */
const insideRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

TOOLS.crop = {
  cursor: 'crosshair',
  enter() { if (S.img.el) startCrop(); },
  pick(e, p) {                                                   // which drag starts on mouse-down
    if (e.target.dataset && e.target.dataset.h) return 'cropResize';   // a handle of #cropbox
    return S.crop && insideRect(p, S.crop) ? 'cropMove' : 'cropNew';
  },
};
Object.assign(dragTypes, {
  cropNew: {
    start: (e, p) => { S.crop = {x: p.x, y: p.y, w: 0, h: 0}; return {p0: p}; },
    move: (d, e, p) => { S.crop = rectFromPoints(d.p0, p, ratioValue()); dirty('crop'); },
    end: () => { if (!(S.crop.w >= 2 && S.crop.h >= 2)) { S.crop = null; startCrop(); dirty('crop'); } },   // a click, not a drag
  },
  cropMove: {
    start: (e, p) => ({p0: p, r0: {...S.crop}}),
    move: (d, e, p) => { S.crop = clampRect({...d.r0, x: d.r0.x + p.x - d.p0.x, y: d.r0.y + p.y - d.p0.y}); dirty('crop'); },
  },
  cropResize: {
    start: (e, p) => ({p0: p, r0: {...S.crop}, handle: e.target.dataset.h}),
    move: (d, e, p) => { S.crop = resizeRect(d.r0, d.handle, {x: p.x - d.p0.x, y: p.y - d.p0.y}, ratioValue()); dirty('crop'); },
  },
});
