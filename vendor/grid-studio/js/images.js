'use strict';
/* images.js — getting an image into the app: file picker / drag-drop / paste (loadFile) and the built-in test picture (loadSample).
 * setImage() is the one entry point: it uploads the texture (gl.js), resets image/lens/crop state, sizes the canvas to the image,
 * and — if a chip is ticked — re-fits the canvas to the chip array (presets.js). Images larger than the GPU limit are downscaled. */

function downscaleToFit(src, max) {
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  if (Math.max(w, h) <= max) return src;
  const k = max / Math.max(w, h), c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  toast(`Image was downscaled to ${c.width}×${c.height} for the GPU`);
  return c;
}

/** Make `src` (Image or canvas) the working image and reset everything that depended on the old one. */
function setImage(src) {
  src = downscaleToFit(src, maxTextureSize());
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
  setRendererImage(src);
  Object.assign(S.img, {el: src, w, h, crop: null}, defaultImageTransform());
  Object.assign(S.lens, defaultLens());
  S.doc = {w, h}; S.crop = null; undoStack.length = 0;
  dom.emptyHint.style.display = 'none';
  S.chip.savedDoc = null; applyChipCanvas(); if (S.chip.id) centerImage();     // a ticked chip re-fits the canvas to the new image
  fitZoom(); updateUndoButton(); refresh('gl', 'grid', 'layout', 'crop', 'status');
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return toast('That is not an image file');
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => { setImage(im); URL.revokeObjectURL(url); };
  im.onerror = () => toast('Could not read that image');
  im.src = url;
}

/* ---- sample: a straight test scene pushed through a barrel distortion ---- */
function drawTestScene(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#6f8fb0'); sky.addColorStop(1, '#2d3a47');
  x.fillStyle = sky; x.fillRect(0, 0, w, h);
  for (const [color, ...r] of [['#b5603a', 300, 300, 400, 560], ['#e3d6a7', 760, 380, 560, 340], ['#3d7a52', 1380, 250, 300, 600]]) { x.fillStyle = color; x.fillRect(...r); }
  x.strokeStyle = '#fff'; x.lineWidth = 3;
  for (let i = 0; i <= w; i += 100) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
  for (let j = 0; j <= h; j += 100) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
  return c;
}

function barrelDistort(scene, w, h, strength) {
  const sw = scene.width, sh = scene.height, src = scene.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const octx = out.getContext('2d'), img = octx.createImageData(w, h), R = Math.hypot(w, h) / 2;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const nx = (px - w / 2) / R, ny = (py - h / 2) / R, f = 1 + strength * (nx * nx + ny * ny);
    const sx = Math.round(sw / 2 + nx * f * R), sy = Math.round(sh / 2 + ny * f * R);
    if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
    const s = (sy * sw + sx) * 4, o = (py * w + px) * 4;
    img.data[o] = src[s]; img.data[o + 1] = src[s + 1]; img.data[o + 2] = src[s + 2]; img.data[o + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function loadSample() { setImage(barrelDistort(drawTestScene(1900, 1300), 1200, 800, 0.45)); }
