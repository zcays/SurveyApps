'use strict';
/* presets.js — chip versions (the well-geometry table) and the physical scale they imply.
 *
 * DATA: CHIPS below mirrors the lab's table. All lengths are µm. pitch = well + wall; wide × pitch ≈ widthUm.
 *       To add a chip, add one object here (the settings panel and tests pick it up automatically).
 *       Only shape / well / pitch / wide / long affect drawing; the other fields are shown in the info box.
 * SCALE: pxPerUm() = canvas px per µm for the ticked chip (null when none). Everything true-to-scale derives from it
 *        (well px = well µm × k, pitch px = pitch µm × k), so well : wall : pitch proportions are always exact.
 *        Two modes: S.chip.fit (canvas = array + dead-room border, the default) or tile across a fixed canvas.
 * IMAGE: umPerPx() = the image's µm per pixel. keepingImageScale() keeps it constant when the grid scale/chip changes
 *        (the microscope doesn't change), so changing chips rescales the image along with the grid.
 * Draft angle, bottom shape and depth are NOT drawn (2-D top view only). */

const CHIPS = [
  {id: 'V1-Square', shape: 'square', bottom: '12% draft angle', draft: 12,   pitch: 500, well: 470, wall: 30, depth: 400, widthUm: 19500, lengthUm: 9500,  wide: 39,  long: 19},
  {id: 'V3.1',      shape: 'square', bottom: 'square',          draft: 0,    pitch: 200, well: 170, wall: 30, depth: 400, widthUm: 8000,  lengthUm: 8000,  wide: 40,  long: 40},
  {id: 'V3.2',      shape: 'square', bottom: 'radius 20 µm',    draft: null, pitch: 200, well: 170, wall: 30, depth: 50,  widthUm: 8000,  lengthUm: 8000,  wide: 40,  long: 40},
  {id: 'V7.0',      shape: 'square', bottom: 'square',          draft: 0,    pitch: 100, well: 50,  wall: 50, depth: 50,  widthUm: 8000,  lengthUm: 8000,  wide: 80,  long: 80},
  {id: 'V9.0',      shape: 'circle', bottom: 'square',          draft: 0,    pitch: 60,  well: 50,  wall: 10, depth: 50,  widthUm: 20000, lengthUm: 18000, wide: 333, long: 300},
  {id: 'V9.1',      shape: 'circle', bottom: 'square',          draft: 0,    pitch: 60,  well: 50,  wall: 10, depth: 50,  widthUm: 7500,  lengthUm: 7500,  wide: 125, long: 125},
  {id: 'V9.2',      shape: 'circle', bottom: 'square',          draft: 0,    pitch: 60,  well: 50,  wall: 10, depth: 50,  widthUm: 10000, lengthUm: 9000,  wide: 166, long: 150},
  {id: 'V10.2',     shape: 'square', bottom: 'radius 20 µm',    draft: 0,    pitch: 120, well: 80,  wall: 40, depth: 200, widthUm: 8000,  lengthUm: 8000,  wide: 66,  long: 66},
  {id: 'V11',       shape: 'square', bottom: 'draft angle 5%',  draft: 5,    pitch: 120, well: 80,  wall: 40, depth: 200, widthUm: 10000, lengthUm: 10000, wide: 83,  long: 83},
  {id: 'V12',       shape: 'square', bottom: 'draft angle 5%',  draft: 5,    pitch: 200, well: 170, wall: 30, depth: 200, widthUm: 10000, lengthUm: 10000, wide: 49,  long: 49},
  {id: 'V15.1',     shape: 'square', bottom: 'draft angle 5%',  draft: 5,    pitch: 75,  well: 50,  wall: 25, depth: 100, widthUm: 10000, lengthUm: 10000, wide: 133, long: 133},
  {id: 'V15.2',     shape: 'square', bottom: 'draft angle 5%',  draft: 5,    pitch: 100, well: 50,  wall: 50, depth: 100, widthUm: 10000, lengthUm: 10000, wide: 100, long: 100},
];

const AUTO_PITCH_PX = 48;                   // tiled (not fit) mode: one well pitch is drawn this many canvas px wide
const FIT_TARGET_PX = 2000;                 // fit-canvas mode: the array's longer side is about this many canvas px

/** Real extent of the N × M array in µm (first well edge to last well edge) and the dead-room border around it. */
function chipGeometry(P) {
  const extX = P.wide * P.pitch - (P.pitch - P.well), extY = P.long * P.pitch - (P.pitch - P.well);
  return {extX, extY, longest: Math.max(extX, extY), borderUm: Math.max(extX, extY) * S.chip.margin / 100};
}

const activePreset = () => S.chip.id ? CHIPS.find(c => c.id === S.chip.id) : null;
/** Canvas pixels per µm for the active chip (null when no chip is ticked). */
function pxPerUm() {
  const P = activePreset(); if (!P) return null;
  const base = S.chip.fit ? FIT_TARGET_PX / (chipGeometry(P).longest * 1.16) : AUTO_PITCH_PX / P.pitch;
  return base;
}
/** Current image calibration in µm per image pixel (null without chip or image). */
const umPerPx = () => { const k = pxPerUm(); return k && S.img.el ? S.img.scale / k : null; };

/** Resize the canvas to the array plus dead room (or restore the old size). Returns true if the canvas size changed. */
function applyChipCanvas() {
  const P = activePreset(), C = S.chip, before = `${S.doc.w}x${S.doc.h}`;
  if (P && C.fit) {
    if (!C.savedDoc) C.savedDoc = {...S.doc};
    const g = chipGeometry(P), k = pxPerUm();
    S.doc = {w: clamp(Math.round((g.extX + 2 * g.borderUm) * k), 16, MAX_DOC), h: clamp(Math.round((g.extY + 2 * g.borderUm) * k), 16, MAX_DOC)};
  } else if (C.savedDoc) { S.doc = C.savedDoc; C.savedDoc = null; }
  return before !== `${S.doc.w}x${S.doc.h}`;
}

/** Run `change`, keep the image's µm-per-pixel (the microscope doesn't change), then refit the canvas. */
function keepingImageScale(change) {
  const u = umPerPx();
  change();
  const k = pxPerUm();
  if (u && k) S.img.scale = u * k;
  if (applyChipCanvas()) fitZoom();
  if (!u && S.img.el && activePreset()) fitImageToCanvas();   // first tick: start with the image fitted, then adjust it to the wells
  refresh('gl', 'grid', 'layout', 'crop', 'status');
}
function selectChip(id) { keepingImageScale(() => S.chip.id = id); }
function setChipFit(on) { keepingImageScale(() => S.chip.fit = on); }
function setChipMargin(pct) { keepingImageScale(() => S.chip.margin = clamp(pct, 0, 40)); }

function updateChipInfo() {
  const el = $('#chipInfo'), P = activePreset();
  if (!el) return;
  if (!P) { el.textContent = 'No chip ticked: the grid uses the manual settings below.'; return; }
  const k = pxPerUm(), u = umPerPx();
  el.innerHTML = [
    `<b>${P.id}</b> · ${P.shape} wells · bottom: ${P.bottom}${P.draft ? ` · draft ${P.draft}` : ''}`,
    `pitch ${P.pitch} µm · well ${P.well} µm · wall ${P.wall} µm · depth ${P.depth} µm`,
    `array ${P.widthUm} × ${P.lengthUm} µm (${P.wide} × ${P.long} wells)${S.chip.fit ? ' · canvas fitted to array' : ''}`,
    `<b>Scale:</b> ${k.toFixed(3)} px/µm → pitch ${(P.pitch * k).toFixed(1)} px, well ${(P.well * k).toFixed(1)} px`,
    `Canvas shows ${Math.round(S.doc.w / k)} × ${Math.round(S.doc.h / k)} µm`,
    u ? `<b>Image: ${u.toFixed(3)} µm per pixel</b>` : '',
  ].filter(Boolean).join('<br>');
}
