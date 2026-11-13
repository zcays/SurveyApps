'use strict';
/* actions.js — small named commands that change S. Shared by buttons, keyboard shortcuts and sliders
 * so the same behaviour is never written twice. Add new one-liner commands here. */

function toggleGrid() { S.grid.visible = !S.grid.visible; refresh('grid'); }
function toggleBypass() { S.lens.bypass = !S.lens.bypass; refresh('gl'); }       // before / after for the fisheye correction
function resetLens() { Object.assign(S.lens, defaultLens()); refresh('gl'); }
function resetImageTransform() { Object.assign(S.img, defaultImageTransform()); refresh('gl'); }

function centerImage() {
  const I = S.img; if (!I.el) return;
  I.x = (S.doc.w - I.w * I.scale) / 2; I.y = (S.doc.h - I.h * I.scale) / 2; refresh('gl', 'status');
}
function fitImageToCanvas() {
  const I = S.img; if (!I.el) return;
  I.scale = Math.min(S.doc.w / I.w, S.doc.h / I.h); centerImage();
}
function nudgeImage(dx, dy) { if (!S.img.el) return; S.img.x += dx; S.img.y += dy; refresh('gl'); }

/* [ ] and { } shortcuts. With a chip ticked the grid size comes from the chip, so both do nothing then. */
function nudgeGridSize(d) {
  if (S.chip.id) return;
  S.grid.size = Math.max(1, S.grid.size + d); refresh('grid');
}
function nudgeGridSpacing(d) { if (S.chip.id) return; const g = S.grid; g.gapX = g.gapY = Math.max(0, g.gapX + d); refresh('grid'); }
