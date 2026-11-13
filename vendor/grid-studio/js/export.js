'use strict';
/* export.js — "Export PNG". buildExportCanvas() composites, at full canvas resolution:
 *   1. the image layer (re-rendered at full quality by render.js so lens correction, distortion and crop are included), then
 *   2. the grid drawn on top (grid.js, k = 1).
 * The checkboxes #exImg / #exGrid choose the layers. The result is exactly S.doc.w × S.doc.h px.
 * History: drawGrid() used to clear its canvas first, which erased the image and exported only the grid — it no longer clears. */

function buildExportCanvas({image = $('#exImg').checked, grid = $('#exGrid').checked} = {}) {
  const c = document.createElement('canvas'); c.width = S.doc.w; c.height = S.doc.h;
  const ctx = c.getContext('2d');
  if (image && S.img.el) { renderImage({full: true}); ctx.drawImage(dom.gl, 0, 0, S.doc.w, S.doc.h); }
  if (grid) drawGrid(ctx, S.doc.w, S.doc.h, 1);
  return c;
}

function exportPng() {
  buildExportCanvas().toBlob(blob => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'grid-overlay.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}
