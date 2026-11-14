'use strict';
/* panels.js — builds the right-hand settings panels (containers #p-chip, #p-grid, … live in index.html).
 * Each build*Panel() only wires widgets (ui.js) to state; the real work is in the feature files.
 * To add a setting: add the field to S (state.js), use it where it is drawn, then add one slider()/checkbox() line here.
 * Panel order on screen is the order of the <details> blocks in index.html, not the order of the calls below. */

function buildGridPanel() {
  const p = $('#p-grid'), G = S.grid, set = fn => setter(['grid'], fn);
  let lastSpacing = G.gapX, lastMargin = G.mL;
  const allEqual = (...v) => v.every(x => x === v[0]);

  checkbox(p, 'Show grid', () => G.visible, set(v => G.visible = v));
  line(p, 'Style', '<select id="gMode"><option value="outline">Outlined squares</option><option value="filled">Filled squares</option></select>');
  $('#gMode').onchange = e => { G.mode = e.target.value; dirty('grid'); };

  // Manual sizing: switched off (greyed + inert) while a chip version is ticked, because the chip dictates shape, size and spacing.
  const m = document.createElement('div'); m.id = 'gridManual'; p.append(m);
  line(m, 'Shape', '<select id="gShape"><option value="square">Squares</option><option value="circle">Circles</option></select>');
  $('#gShape').onchange = e => { G.shape = e.target.value; dirty('grid'); };
  slider(m, 'Square size', () => G.size, set(v => G.size = Math.max(1, v)), 2, 200, 1);
  slider(m, 'Spacing (both)', () => allEqual(G.gapX, G.gapY) ? G.gapX : lastSpacing, set(v => G.gapX = G.gapY = lastSpacing = Math.max(0, v)), 0, 200, 1);
  slider(m, 'Spacing ↔ horiz.', () => G.gapX, set(v => G.gapX = Math.max(0, v)), 0, 200, 1);
  slider(m, 'Spacing ↕ vert.', () => G.gapY, set(v => G.gapY = Math.max(0, v)), 0, 200, 1);
  slider(m, 'Dead space (all)', () => allEqual(G.mL, G.mR, G.mT, G.mB) ? G.mL : lastMargin, set(v => G.mL = G.mR = G.mT = G.mB = lastMargin = Math.max(0, v)), 0, 400, 1);
  for (const [label, key] of [['Space left', 'mL'], ['Space right', 'mR'], ['Space top', 'mT'], ['Space bottom', 'mB']])
    slider(m, label, () => G[key], set(v => G[key] = Math.max(0, v)), 0, 400, 1);
  checkbox(m, 'Centre array', () => G.center, set(v => G.center = v), 'spread leftover room evenly on both ends');
  slider(m, 'Columns (0=auto)', () => G.cols, set(v => G.cols = Math.max(0, Math.round(v))), 0, 100, 1);
  slider(m, 'Rows (0=auto)', () => G.rows, set(v => G.rows = Math.max(0, Math.round(v))), 0, 100, 1);
  syncs.push(() => $('#gShape').value = G.shape);

  // Common to manual and chip grids:
  slider(p, 'Offset X', () => G.offX, set(v => G.offX = v), -2000, 2000, 1);
  slider(p, 'Offset Y', () => G.offY, set(v => G.offY = v), -2000, 2000, 1);
  slider(p, 'Corner radius', () => G.radius, set(v => G.radius = Math.max(0, v)), 0, 50, 1);
  slider(p, 'Line width', () => G.stroke, set(v => G.stroke = Math.max(.25, v)), .5, 12, .25);
  slider(p, 'Opacity %', () => G.opacity * 100, set(v => G.opacity = clamp(v, 0, 100) / 100), 0, 100, 1);

  const swatches = ['#ffffff', '#000000', '#ff3b30', '#34c759', '#00e5ff', '#ffd60a', '#ff2dff'];
  const colour = line(p, 'Colour', '<input type="color" id="gCol">' + swatches.map(c => `<button class="sw" data-c="${c}" style="background:${c}"></button>`).join(''));
  $('#gCol').oninput = e => { G.color = e.target.value; dirty('grid'); };
  syncs.push(() => $('#gCol').value = G.color);
  colour.querySelectorAll('.sw').forEach(b => b.onclick = () => { G.color = b.dataset.c; refresh('grid'); });
  note(p, 'The grid is fixed to the canvas — it stays put while you move, rotate or correct the image underneath.');
}

/** Chip versions (presets.js). Ticking one switches the grid to true-to-scale chip geometry. */
function buildChipPanel() {
  const p = $('#p-chip');
  const list = document.createElement('div'); list.className = 'chips';
  list.innerHTML = CHIPS.map(c => `<label class="chip"><input type="checkbox" data-id="${c.id}"><span><b>${c.id}</b><small>${c.shape} · pitch ${c.pitch} / well ${c.well} µm</small></span></label>`).join('');
  p.append(list);
  list.querySelectorAll('input').forEach(cb => cb.onchange = () => selectChip(cb.checked ? cb.dataset.id : null));   // ticking one unticks the others

  const tools = document.createElement('div'); p.append(tools);       // greyed out until a chip is ticked
  checkbox(tools, 'Fit canvas to array', () => S.chip.fit, setChipFit, 'canvas = the N × M wells + border');
  slider(tools, 'Dead room %', () => S.chip.margin, setChipMargin, 0, 40, 1);
  buttons(tools, [['afButton', 'Auto-fit image to grid', 'primary', autoFit], ['afUndo', 'Undo auto-fit', '', undoAutoFit]]);
  note(tools, 'Finds the wells in the photo and sets tilt, size, position, fisheye and distortion (handles + fine mesh) for you. Uses visible patches around tissue; covered areas are inferred. Check any hidden-corner or uncertain-edge warnings and fine-tune afterwards.', 'autoFitInfo');
  const info = document.createElement('div'); info.id = 'chipInfo'; info.className = 'info'; p.append(info);   // filled by updateChipInfo()
  note(p, 'Tick a version: the grid takes its shape, well size and pitch from the table, true to scale, and the canvas is sized to the real array plus a border. Then move / scale / rotate the image until it lines up with the wells — the µm/px readout is your image\'s calibration. Untick for the manual grid.');

  syncs.push(() => {
    list.querySelectorAll('.chip').forEach(l => { const cb = l.querySelector('input'), on = cb.dataset.id === S.chip.id; cb.checked = on; l.classList.toggle('on', on); });
    tools.classList.toggle('off', !S.chip.id); tools.inert = !S.chip.id;
    const manual = $('#gridManual'); manual.classList.toggle('off', !!S.chip.id); manual.inert = !!S.chip.id;
    updateChipInfo();
    $('#afButton').disabled = !S.chip.id || !S.img.el; $('#afUndo').disabled = !afUndoState;
  });
}

function buildLensPanel() {
  const p = $('#p-lens'), L = S.lens, set = fn => setter(['gl'], fn);
  slider(p, 'Strength', () => L.k1, set(v => L.k1 = v), -1, 1.5, .005);
  slider(p, 'Edge falloff', () => L.k2, set(v => L.k2 = v), -1, 1, .005);
  slider(p, 'Centre X %', () => L.cx * 100, set(v => L.cx = v / 100), 0, 100, .5);
  slider(p, 'Centre Y %', () => L.cy * 100, set(v => L.cy = v / 100), 0, 100, .5);
  checkbox(p, 'Before / after', () => L.bypass, set(v => L.bypass = v), 'show original');
  buttons(p, [['lReset', 'Reset lens', '', resetLens]]);
  note(p, 'Positive Strength straightens barrel (fisheye) bowing; negative fixes pincushion. Use the grid as a straight-line reference. Edge falloff fine-tunes the outer corners.');
}

function buildWarpPanel() {
  const p = $('#p-warp');
  buttons(p, [['wTool', 'Distort tool', '', () => setTool('warp')], ['wReset', 'Reset distortion', '', resetWarp]]);
  checkbox(p, 'Apply distortion', () => S.warp.enabled, setter(['gl'], v => S.warp.enabled = v), 'untick to compare');
  buttons(p, [['wAuto', 'Auto-fix distortion', 'primary', autoFixDistortion], ['wUndo', 'Undo', '', undoAutoFit]]);
  note(p, 'Auto-fix distortion bends the image onto the ticked chip grid: it sets the 8 handles and a fine correction mesh underneath them, without changing tilt, size or position. Use it after Auto-fit or after lining the image up roughly by hand.', 'warpFixInfo');
  syncs.push(() => { $('#wAuto').disabled = !S.chip.id || !S.img.el; $('#wUndo').disabled = !afUndoState; $('#wReset').textContent = S.warp.mesh ? 'Reset distortion (incl. fine mesh)' : 'Reset distortion'; });
  note(p, 'In the Distort tool (D) drag a corner to move it, drag a side handle to move the whole edge, and hold Alt/Option while dragging a side to bend it. The grid stays fixed; the image bends to meet it.');
}

function buildImagePanel() {
  const p = $('#p-img'), I = S.img, set = fn => setter(['gl', 'status'], fn);   // 'status' refreshes the chip µm/px readout
  slider(p, 'Position X', () => I.x, set(v => I.x = v), -2000, 4000, 1);
  slider(p, 'Position Y', () => I.y, set(v => I.y = v), -2000, 4000, 1);
  slider(p, 'Scale %', () => I.scale * 100, set(v => I.scale = Math.max(1, v) / 100), 10, 400, .1);
  slider(p, 'Rotate °', () => I.rot, set(v => I.rot = v), -180, 180, .1);
  buttons(p, [['iCenter', 'Centre', '', centerImage], ['iFit', 'Fit to canvas', '', fitImageToCanvas], ['iReset', 'Reset', '', resetImageTransform]]);
  note(p, 'Arrow keys nudge the image 1 px (Shift = 10 px). Or drag with the Move tool.');
}

const ASPECTS = [['Free', 0], ['Same as canvas', -1], ['1 : 1', 1], ['4 : 3', 4 / 3], ['3 : 2', 1.5], ['16 : 9', 16 / 9], ['3 : 4', .75], ['2 : 3', 2 / 3], ['9 : 16', 9 / 16]];
function buildCropPanel() {
  const p = $('#p-crop');
  line(p, 'Aspect', `<select id="cRatio">${ASPECTS.map(([t, v]) => `<option value="${v}">${t}</option>`).join('')}</select>`);
  $('#cRatio').onchange = e => { S.ratio = +e.target.value; const r = ratioValue(); if (S.crop && r) { fitRatio(r); dirty('crop'); } };
  buttons(p, [['cStart', 'Crop tool', '', () => setTool('crop')], ['cropApply', 'Apply crop', 'primary', applyCrop], ['cCancel', 'Cancel', '', cancelCrop], ['cReset', 'Reset crop', '', resetCrop]]);
  note(p, '', 'cropInfo');                                            // text set by updateCrop()
  note(p, 'Crop only trims the image — the canvas and the grid never change, and the edges stay straight as drawn even if the image is rotated. Drag to draw, drag handles to resize, Enter to apply, Esc to cancel, ⌘/Ctrl+Z to undo, Reset crop to bring the whole image back.');
}

function buildDocPanel() {
  const p = $('#p-doc'), set = fn => setter(['layout', 'gl', 'status'], fn);
  slider(p, 'Width px', () => S.doc.w, set(v => S.doc.w = clamp(Math.round(v), 16, MAX_DOC)), 100, 4000, 1);
  slider(p, 'Height px', () => S.doc.h, set(v => S.doc.h = clamp(Math.round(v), 16, MAX_DOC)), 100, 4000, 1);
}

/** Called once at start-up. buildGridPanel must run before buildChipPanel (the chip panel greys out #gridManual). */
function buildPanels() {
  buildGridPanel(); buildChipPanel(); buildLensPanel(); buildWarpPanel(); buildImagePanel(); buildCropPanel(); buildDocPanel();
  syncAll();
}
