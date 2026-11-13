'use strict';
/* render.js — chooses how the image layer is drawn: the GPU (gl.js, WebGL) or the software fallback (cpu.js, Canvas 2-D).
 *
 * WHY: with the browser's "hardware acceleration" switched off (or on some locked-down / remote machines) WebGL is often unavailable.
 * The app then switches itself to the software renderer: same picture, slower on big images. Nothing else in the app knows which
 * renderer is active — everything calls renderImage() / maxTextureSize() / setRendererImage() from here.
 * Force the software renderer for testing with  index.html?renderer=cpu
 */

let useGL = false;

function initRenderer() {
  const forced = /[?&]renderer=cpu/.test(location.search);
  if (!forced && initGL()) {
    useGL = true;
    dom.gl.addEventListener('webglcontextlost', e => { e.preventDefault(); enterCpuMode('The graphics context was lost'); });
  } else enterCpuMode(forced ? 'Software rendering was requested' : 'WebGL is not available (hardware acceleration may be off)');
}

/** Switch to the software renderer. A canvas that has had a WebGL context cannot give a 2-D context, so swap in a fresh <canvas>. */
function enterCpuMode(reason) {
  useGL = false;
  const fresh = document.createElement('canvas'); fresh.id = 'gl';
  dom.gl.replaceWith(fresh); dom.gl = fresh;
  cpuSetSource();
  toast(`${reason}: using the slower software renderer.`);
  dirty('layout', 'gl', 'status');
}

/** Draw the image layer. full = full quality (only matters for the software renderer's reduced-resolution previews). */
function renderImage({full = false} = {}) { if (useGL) renderGL(); else renderCPU(full); }
const maxTextureSize = () => useGL ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), MAX_DOC) : MAX_DOC;
function setRendererImage(src) { if (useGL) uploadTexture(src); else cpuSetSource(); }
const rendererName = () => useGL ? 'GPU' : 'software';
