'use strict';
/* view.js — how the canvas is shown: stage size, VIEW zoom, pointer→canvas mapping, status bar, µm scale bar.
 * The canvases (#gl, #grid) are always canvas-sized in pixels; zoom only changes their CSS size.
 * Changing S.zoom never changes the document or the exported PNG. */

const ZOOM_MIN = .05, ZOOM_MAX = 8;

function layout() {
  const {w, h} = S.doc, z = S.zoom;
  dom.stage.style.width = w * z + 'px'; dom.stage.style.height = h * z + 'px';
  for (const c of [dom.gl, dom.grid]) { c.style.width = w * z + 'px'; c.style.height = h * z + 'px'; }
  // The grid canvas is rendered at screen resolution so lines stay crisp when zoomed in.
  const k = Math.max(.05, Math.min(z * (window.devicePixelRatio || 1), MAX_DOC / Math.max(w, h)));
  dom.grid.width = Math.max(1, Math.round(w * k)); dom.grid.height = Math.max(1, Math.round(h * k));
  dirtyFlags.grid = dirtyFlags.crop = dirtyFlags.warp = true;
}

function setZoom(z) {
  const ws = dom.ws, cx = (ws.scrollLeft + ws.clientWidth / 2) / S.zoom, cy = (ws.scrollTop + ws.clientHeight / 2) / S.zoom;
  S.zoom = clamp(z, ZOOM_MIN, ZOOM_MAX); dirty('layout', 'status');
  requestAnimationFrame(() => { ws.scrollLeft = cx * S.zoom - ws.clientWidth / 2; ws.scrollTop = cy * S.zoom - ws.clientHeight / 2; });
}
function fitZoom() {
  const fit = Math.min(4, (dom.ws.clientWidth - 90) / S.doc.w, (dom.ws.clientHeight - 90) / S.doc.h);
  S.zoom = Math.max(ZOOM_MIN, fit);                       // layout may not be measurable yet (fit <= 0)
  dirty('layout', 'status');
}
const zoomIn = () => setZoom(S.zoom * 1.25), zoomOut = () => setZoom(S.zoom / 1.25);

/** Pointer position in document pixels. */
function docPoint(e) {
  const r = dom.stage.getBoundingClientRect();
  return {x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom};
}

/* ---------------- status bar + µm ruler ---------------- */
function updateStatusBar() {
  const k = pxPerUm(), c = S.cursor;
  $('#sInfo').textContent = `${S.doc.w} × ${S.doc.h} px · ${rendererName()}`;
  $('#sZoom').textContent = Math.round(S.zoom * 100) + '%';
  $('#sPos').textContent = !c ? '' : k ? `x ${Math.round(c.x / k)} µm  y ${Math.round(c.y / k)} µm` : `x ${Math.round(c.x)}  y ${Math.round(c.y)}`;
  updateScaleBar(k);
  updateChipInfo();
}

/** Ruler in real µm (only while a chip version is ticked): lets you check well size and spacing against the table. */
function updateScaleBar(k) {
  const bar = $('#scalebar');
  bar.style.display = k ? 'block' : 'none'; if (!k) return;
  const um = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find(u => u * k * S.zoom >= 70) || 10000;
  bar.firstElementChild.style.width = um * k * S.zoom + 'px';
  bar.lastElementChild.textContent = um >= 1000 ? um / 1000 + ' mm' : um + ' µm';
}
