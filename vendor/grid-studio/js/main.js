'use strict';
/* main.js — the frame loop and start-up. Loaded LAST: it runs init() as soon as it is parsed.
 *
 * frame() is called by the scheduler in state.js (dirty()). It redraws only what is flagged stale, in this order:
 *   layout (stage size) → gl (image) → grid (overlay) → crop box → distort handles → status bar. */

function frame() {
  rafId = 0;
  const f = dirtyFlags;
  if (f.layout) { layout(); f.layout = false; f.gl = true; }
  if (f.gl) { renderImage(); f.gl = false; }
  if (f.grid) { renderGrid(); f.grid = false; }
  if (f.crop) { updateCrop(); f.crop = false; }
  if (f.warp) { updateWarpUI(); f.warp = false; }
  if (f.status) { updateStatusBar(); f.status = false; }
}

function wireTopBar() {
  $('#file').onchange = e => { loadFile(e.target.files[0]); e.target.value = ''; };
  $('#sample').onclick = loadSample;
  $('#undo').onclick = undoCrop;
  $('#export').onclick = exportPng;
  $('#helpBtn').onclick = () => toggleHelp();
  document.querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#zIn').onclick = zoomIn; $('#zOut').onclick = zoomOut; $('#zFit').onclick = fitZoom; $('#z100').onclick = () => setZoom(1);

  dom.ws.addEventListener('dragover', e => e.preventDefault());                       // drop an image file onto the workspace
  dom.ws.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
  addEventListener('paste', e => { const f = e.clipboardData && e.clipboardData.files[0]; if (f) loadFile(f); });
  addEventListener('resize', () => { if (!S.img.el) fitZoom(); });
  addEventListener('load', () => { if (!S.img.el) fitZoom(); });                     // layout is not measurable before load
}

function init() {
  initRenderer();
  buildWarpOverlay();
  buildPanels();
  wireTopBar();
  updateCursor(); updateKeyHint(); fitZoom();
  dirty('gl', 'grid', 'crop', 'status', 'warp');
}
init();
