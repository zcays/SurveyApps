'use strict';
/* tools.js — the active tool and mouse/touch interaction on the canvas.
 *
 * HOW IT WORKS
 *  - Each tool is an entry in TOOLS (state.js registry): {cursor, enter?, pick(e, p)}. `pick` decides which drag
 *    starts on mouse-down by returning a key of `dragTypes`. Crop and Distort register themselves in crop.js / warp.js;
 *    the Move tool and panning are defined here.
 *  - A drag type is {start(e, p) → state, move(state, e, p), end?(state)}; p is the pointer in canvas px.
 *  - To add a tool: add a toolbar <button data-tool="name"> in index.html, register TOOLS.name + its dragTypes in a new
 *    file, add that file to index.html, and (optionally) a shortcut in keyboard.js.
 */

let drag = null;            // the drag in progress: {type, ...state returned by start()}
let panMode = false;        // Space held (or middle mouse): dragging scrolls the workspace instead of using the tool

function updateCursor() { dom.stage.style.cursor = panMode ? 'grab' : (TOOLS[S.tool] || {}).cursor || 'default'; }
function setPanMode(on) { panMode = on; updateCursor(); }

function setTool(name) {
  if (!TOOLS[name]) return;
  S.tool = name;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === name));
  dom.stage.dataset.tool = name;                    // CSS uses this (distort handles may hang over the canvas edge)
  if (TOOLS[name].enter) TOOLS[name].enter();
  updateCursor(); dirty('crop', 'warp');
}

/* ---- built-in drag types: panning and moving the image ---- */
Object.assign(dragTypes, {
  pan: {
    start: e => ({sx: e.clientX, sy: e.clientY, left: dom.ws.scrollLeft, top: dom.ws.scrollTop}),
    move: (d, e) => { dom.ws.scrollLeft = d.left - (e.clientX - d.sx); dom.ws.scrollTop = d.top - (e.clientY - d.sy); },
  },
  image: {
    start: e => ({sx: e.clientX, sy: e.clientY, ix: S.img.x, iy: S.img.y}),
    move: (d, e) => { S.img.x = d.ix + (e.clientX - d.sx) / S.zoom; S.img.y = d.iy + (e.clientY - d.sy) / S.zoom; refresh('gl'); },
  },
});
TOOLS.move = {cursor: 'grab', pick: () => 'image'};

/* ---- pointer events on the stage ---- */
function pickDragType(e, p) {
  if (e.button === 1 || panMode) return 'pan';
  if (e.button !== 0 || !S.img.el) return null;     // tools need an image
  return TOOLS[S.tool].pick(e, p);
}

dom.stage.addEventListener('pointerdown', e => {
  const p = docPoint(e), type = pickDragType(e, p);
  if (!type) return;
  e.preventDefault();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();   // arrow keys go back to the image
  drag = {type, ...dragTypes[type].start(e, p)};
  dom.stage.setPointerCapture(e.pointerId);
  if (type === 'image') dom.stage.style.cursor = 'grabbing';
});
dom.stage.addEventListener('pointermove', e => {
  const p = docPoint(e); S.cursor = p; dirty('status');
  if (drag) dragTypes[drag.type].move(drag, e, p);
});
function endDrag() {
  const d = drag; drag = null;
  if (d && dragTypes[d.type].end) dragTypes[d.type].end(d);
  updateCursor();
}
dom.stage.addEventListener('pointerup', endDrag);
dom.stage.addEventListener('pointercancel', endDrag);
dom.ws.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(S.zoom * Math.exp(-e.deltaY * .0025)); } }, {passive: false});
