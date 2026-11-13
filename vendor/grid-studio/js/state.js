'use strict';
/* state.js — the single source of truth, DOM handles and the redraw scheduler.
 *
 * READ THIS FIRST. Everything the app "knows" lives in the object `S` below. Other files read S and
 * change it through small functions (actions.js, presets.js, crop.js, warp.js ...), then call
 * dirty(...) / refresh(...) so the next animation frame redraws what changed.
 *
 * RULES
 *  - S.img / S.lens / S.warp / S.grid / S.chip are mutated IN PLACE, never replaced
 *    (use Object.assign). Other modules keep references to them; replacing one silently breaks
 *    the settings panels (this was a real bug once).
 *  - Units: `S.doc` and S.img.x/y are CANVAS PIXELS. Chip data (presets.js) is in µm.
 *    pxPerUm() converts µm → canvas px. Warp points are canvas-NORMALISED (0..1).
 *  - Registries (TOOLS, dragTypes) let each feature plug itself in without editing tools.js.
 */

const MAX_DOC = 8192;                       // largest canvas / texture edge, in px (GPU safe)

const $ = sel => document.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---- default values (factories, so "reset" can re-apply them) ---- */
const defaultLens = () => ({k1: 0, k2: 0, cx: .5, cy: .5, bypass: false});
const defaultImageTransform = () => ({x: 0, y: 0, scale: 1, rot: 0});
const defaultWarp = () => ({
  enabled: true,                                                                  // "Apply distortion" switch (before / after)
  c: {nw: {x: 0, y: 0}, ne: {x: 1, y: 0}, se: {x: 1, y: 1}, sw: {x: 0, y: 1}},   // corners, canvas-normalised
  dev: {n: {x: 0, y: 0}, e: {x: 0, y: 0}, s: {x: 0, y: 0}, w: {x: 0, y: 0}},     // edge-bow offsets from each edge's midpoint
  mesh: null,                                                                     // fine correction on top of the handles: {n, d: [dx0, dy0, dx1, dy1, …]} = n×n nodes
                                                                                  // over the canvas, canvas-normalised offsets. Filled by Auto-fit / Auto-fix distortion.
});

const S = {
  doc: {w: 1200, h: 800},                   // canvas ("plane") size in px. The grid and export use this.
  img: {el: null, w: 0, h: 0, crop: null, ...defaultImageTransform()},   // image layer; x,y = top-left in canvas px, scale = canvas px per image px;
                                            // crop = {x,y,w,h} in IMAGE px (null = uncropped). Crop only masks the image; canvas + grid are untouched.
  lens: defaultLens(),                      // fisheye correction (gl.js shader): k1 strength, k2 falloff, cx/cy lens centre 0..1
  warp: defaultWarp(),                      // free distortion (warp.js)
  grid: {                                   // MANUAL grid settings (chip mode overrides size/spacing, see presets.js)
    visible: true, mode: 'outline', color: '#ffffff', opacity: .75, shape: 'square',
    size: 12, gapX: 12, gapY: 12,           // px
    mL: 40, mR: 40, mT: 40, mB: 40, center: true,    // dead space around the array
    offX: 0, offY: 0, cols: 0, rows: 0,     // offsets shift the grid; cols/rows 0 = as many as fit
    radius: 0, stroke: 2,                   // stroke = outline thickness in px for a 1200 px wide canvas (scaled up on bigger canvases)
  },
  chip: {id: null, fit: true, margin: 8, savedDoc: null},   // ticked chip version; null id = manual grid
  zoom: 1,                                  // VIEW zoom (screen px per canvas px). Does not change the document.
  tool: 'move', crop: null, ratio: 0, cursor: null,
};
const undoStack = [];                       // crop history entries: {crop} = the image crop to restore

const dom = {
  stage: $('#stage'), ws: $('#ws'), gl: $('#gl'), grid: $('#grid'), cropbox: $('#cropbox'),
  emptyHint: $('#hint'), toast: $('#toast'),
};

/* ---- plug-in registries, filled by crop.js / warp.js / tools.js at load time ---- */
const TOOLS = {};       // name → {cursor, enter?(), pick(e, p) → dragTypes key | null}   (the toolbar buttons use data-tool="name")
const dragTypes = {};   // name → {start(e, p) → drag state, move(drag, e, p), end?(drag)}   (p = pointer in canvas px)

/* ---- redraw scheduler: mark what is stale, flush once per animation frame (main.js → frame()) ----
 * flags: gl (image layer), grid (overlay), layout (stage size/zoom), crop (crop box), warp (distort handles), status (status bar + chip info) */
const dirtyFlags = {gl: true, grid: true, layout: true, crop: true, status: true, warp: true};
let rafId = 0;
function dirty(...keys) {
  keys.forEach(k => dirtyFlags[k] = true);
  if (!rafId) rafId = requestAnimationFrame(frame);
}

/* ---- settings-panel sync: every control registers a function that re-reads S into its widgets ---- */
const syncs = [];
const syncAll = () => syncs.forEach(fn => fn());
/** The normal "I changed S" call: update the panel widgets, then redraw the given layers. */
function refresh(...keys) { syncAll(); dirty(...keys); }

function toast(text) {
  dom.toast.textContent = text; dom.toast.style.display = 'block';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => dom.toast.style.display = 'none', 2200);
}
