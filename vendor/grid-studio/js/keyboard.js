'use strict';
/* keyboard.js — keyboard shortcuts, the shortcut help overlay and the status-bar hint.
 *
 * ARROW KEYS have two owners:
 *   - a focused slider / number box handles its own arrows (ui.js, with stopPropagation), and
 *   - otherwise they nudge the image here (Shift ×10, Alt ×0.1).
 *  Esc blurs a focused control; clicking the canvas also blurs it, so arrows return to the image.
 * To add a shortcut: add an entry to KEY_ACTIONS (single keys) or MOD_ACTIONS (Cmd/Ctrl + key), and list it in the #help overlay in index.html.
 */

const helpEl = $('#help');
const helpOpen = () => helpEl.style.display === 'flex';
function toggleHelp(show = !helpOpen()) { helpEl.style.display = show ? 'flex' : 'none'; }
helpEl.onclick = e => { if (e.target === helpEl) toggleHelp(false); };

// Single-key shortcuts (letters matched case-insensitively). Ignored while typing in a text / number field.
const KEY_ACTIONS = {
  v: () => setTool('move'), c: () => setTool('crop'), d: () => setTool('warp'),
  a: autoFit, g: toggleGrid, h: toggleHelp, '?': toggleHelp,
  r: resetImageTransform, m: centerImage, f: fitZoom, 0: fitZoom, 1: () => setZoom(1),
  '+': zoomIn, '=': zoomIn, '-': zoomOut, _: zoomOut,
  '[': () => nudgeGridSize(-1), ']': () => nudgeGridSize(1), '{': () => nudgeGridSpacing(-1), '}': () => nudgeGridSpacing(1),
  '\\': toggleBypass,                                   // before / after of the fisheye correction
};
const MOD_ACTIONS = {z: undoCrop, o: () => $('#file').click(), e: () => $('#export').click()};
const ARROW_NUDGE = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};

addEventListener('keydown', e => {
  const t = e.target, tag = t.tagName, inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && ['number', 'text'].includes(t.type));
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (key === 'Escape') {
    if (helpOpen()) return toggleHelp(false);
    if (inField) return t.blur();
    if (S.tool === 'crop') return cancelCrop();
    if (S.tool === 'warp') return setTool('move');
    return;
  }
  if (ARROW_NUDGE[key]) {
    if (inField) return;                                // a focused setting handles its own arrows
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (e.altKey ? .1 : 1), [dx, dy] = ARROW_NUDGE[key];
    return nudgeImage(dx * step, dy * step);
  }
  if (e.metaKey || e.ctrlKey) { const act = MOD_ACTIONS[key]; if (act) { e.preventDefault(); act(); } return; }
  if (typing || e.altKey) return;

  if (key === 'Enter') { if (S.tool === 'crop' && !inField && tag !== 'BUTTON') applyCrop(); return; }
  if (key === ' ') { if (!inField && tag !== 'BUTTON') { setPanMode(true); e.preventDefault(); } return; }   // Space + drag = pan
  const act = KEY_ACTIONS[key]; if (act) act();
});
addEventListener('keyup', e => { if (e.key === ' ') setPanMode(false); });

/* Status-bar hint that tells the user what the arrow keys will do right now. */
function updateKeyHint() {
  const a = document.activeElement, onSetting = a && a.tagName === 'INPUT' && ['range', 'number'].includes(a.type);
  $('#sHint').textContent = onSetting
    ? 'Setting selected: ←/→ or ↑/↓ adjust · Shift ×10 · Alt ×0.1 · Esc = back to image'
    : 'Arrows nudge image (Shift ×10, Alt ×0.1) · ? = all shortcuts';
}
addEventListener('focusin', updateKeyHint);
addEventListener('focusout', () => setTimeout(updateKeyHint, 0));
