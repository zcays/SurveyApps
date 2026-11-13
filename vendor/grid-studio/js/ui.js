'use strict';
/* ui.js — tiny widget helpers used to build the settings panels (panels.js). No app logic here.
 *
 * Every widget takes `get` (read from S) and `set` (write to S). A widget registers a function in `syncs`
 * so refresh() / syncAll() can re-read S into it whenever something else changed the state.
 * To add a new slider, call slider(panelElement, 'Label', get, set, min, max, step) from a build*Panel() in panels.js. */

/* Arrow-key increment per setting while that slider / number box is focused (plain press).
 * Shift = ×10, Alt/Option = ×0.1; never finer than the slider's own step. The key is the slider's LABEL.
 * Not listed → one hundredth of the slider range. Chosen so one press is a visible but small change. */
const KEY_STEP = {
  'Square size': 1, 'Spacing (both)': 1, 'Spacing ↔ horiz.': 1, 'Spacing ↕ vert.': 1,
  'Dead space (all)': 5, 'Space left': 5, 'Space right': 5, 'Space top': 5, 'Space bottom': 5,
  'Offset X': 1, 'Offset Y': 1, 'Columns (0=auto)': 1, 'Rows (0=auto)': 1, 'Corner radius': 1, 'Line width': .5, 'Opacity %': 5,
  'Dead room %': 1,
  'Strength': .01, 'Edge falloff': .01, 'Centre X %': 1, 'Centre Y %': 1,
  'Position X': 1, 'Position Y': 1, 'Scale %': .1, 'Rotate °': .5, 'Width px': 10, 'Height px': 10,
};
const ARROW_DIR = {ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1};
const decimalsOf = n => n < 1 ? Math.ceil(-Math.log10(n)) : 0;

/** Build a setter for a widget: run `fn(value)` to change S, then mark the given layers dirty. */
const setter = (keys, fn) => v => { fn(v); dirty(...keys); };

/** Label + range slider + number box. Handles typing, dragging and the custom arrow-key stepping. */
function slider(parent, label, get, set, min, max, step) {
  const keyStep = KEY_STEP[label] || Math.max(step, (max - min) / 100), decimals = Math.max(decimalsOf(step), decimalsOf(keyStep));
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><input type="number" step="${keyStep}">`;
  const range = row.children[1], num = row.children[2];

  const show = () => {                                  // don't overwrite the control the user is typing in
    const v = get();
    if (document.activeElement !== range) range.value = v;
    if (document.activeElement !== num) num.value = (+v).toFixed(decimals);
  };
  const commit = v => { set(v); syncAll(); };
  range.oninput = () => commit(+range.value);
  num.oninput = () => { if (num.value !== '' && !isNaN(+num.value)) commit(+num.value); };

  const bump = (dir, e) => {                            // arrow key on a focused control
    const k = Math.max(step, keyStep * (e.shiftKey ? 10 : 1) * (e.altKey ? .1 : 1));
    commit(+(get() + dir * k).toFixed(4)); range.value = get(); num.value = (+get()).toFixed(decimals);
  };
  const onArrow = allowed => e => {
    const dir = ARROW_DIR[e.key];
    if (!dir || !allowed.includes(e.key) || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation(); bump(dir, e);     // stopPropagation: keyboard.js must not also nudge the image
  };
  range.addEventListener('keydown', onArrow(Object.keys(ARROW_DIR)));
  num.addEventListener('keydown', onArrow(['ArrowUp', 'ArrowDown']));      // left/right still move the text caret

  parent.append(row); syncs.push(show); show();
}

/** A labelled row of arbitrary HTML controls (the caller wires them up). */
function line(parent, label, html) {
  const d = document.createElement('div'); d.className = 'line'; d.innerHTML = `<label>${label}</label>${html}`;
  parent.append(d); return d;
}
function note(parent, text, id) { const n = document.createElement('div'); n.className = 'note'; n.textContent = text; if (id) n.id = id; parent.append(n); }
function checkbox(parent, label, get, set, hint = '') {
  const cb = line(parent, label, `<input type="checkbox">${hint ? `<span class="note">${hint}</span>` : ''}`).querySelector('input');
  cb.onchange = () => set(cb.checked); syncs.push(() => cb.checked = get()); cb.checked = get();
}
/** Row of buttons. spec = [[elementId, text, cssClass, onClick], ...] */
function buttons(parent, spec) {
  const d = line(parent, '', spec.map(([id, text, cls]) => `<button id="${id}" ${cls ? `class="${cls}"` : ''}>${text}</button>`).join(''));
  spec.forEach(([id,,, fn]) => d.querySelector('#' + id).onclick = fn); return d;
}
