'use strict';
/* gl.js — the image layer, drawn with WebGL into <canvas id="gl"> (canvas-sized, preserveDrawingBuffer so export can read it).
 *
 * PIPELINE (renderGL): source texture → [pass 1: fragment shader: translate/scale/rotate + radial lens correction]
 *   → (only if a distortion is set) offscreen texture → [pass 2: warped mesh, vertices from warp.js] → canvas.
 * Pass 1 is an INVERSE mapping (for each output pixel, where does it come from); pass 2 is a FORWARD mesh.
 * Crop (S.img.crop) is a mask applied in the corrected-image space, so it moves/scales/rotates with the image and never touches the grid.
 * Lens model: sample radius r' = r·(1 − k1·r² − k2·r⁴), r normalised by half the image diagonal. +k1 fixes barrel/fisheye.
 * This is the GPU path. render.js falls back to cpu.js (same maths, software) when WebGL is unavailable — keep them in sync.
 * Premultiplied alpha is used throughout. Add new image effects to FRAGMENT_SRC (and a uniform in UNIFORMS + drawImagePass). */

const VERTEX_SRC = `
attribute vec2 a; varying vec2 v;
void main(){ v = a; gl_Position = vec4(a.x*2.-1., 1.-a.y*2., 0., 1.); }`;

// For every canvas pixel, find which source pixel it shows (inverse mapping).
const FRAGMENT_SRC = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_doc, u_img, u_pos, u_c;
uniform vec4 u_crop;                                      // image crop rect (x, y, w, h) in image px
uniform float u_scale, u_rot, u_k1, u_k2;
varying vec2 v;
void main(){
  vec2 p  = v * u_doc;
  vec2 ic = u_pos + u_img * 0.5 * u_scale;               // image centre on the canvas
  vec2 d  = p - ic;
  float c = cos(-u_rot), s = sin(-u_rot);
  d = vec2(c*d.x - s*d.y, s*d.x + c*d.y);                // undo rotation
  vec2 q  = d / u_scale + u_img * 0.5;                   // pixel in the corrected image
  if (q.x < u_crop.x || q.y < u_crop.y || q.x > u_crop.x + u_crop.z || q.y > u_crop.y + u_crop.w) { gl_FragColor = vec4(0.); return; }   // outside the crop
  vec2 lc = u_c * u_img;                                 // lens centre
  float R = 0.5 * length(u_img);
  vec2 n  = (q - lc) / R;
  float r2 = dot(n, n);
  float f  = 1.0 - u_k1*r2 - u_k2*r2*r2;                 // positive k straightens barrel (fisheye)
  vec2 uv  = (lc + n*f*R) / u_img;
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) { gl_FragColor = vec4(0.); return; }
  gl_FragColor = texture2D(u_tex, uv);
}`;
const UNIFORMS = ['u_tex', 'u_crop', 'u_doc', 'u_img', 'u_pos', 'u_c', 'u_scale', 'u_rot', 'u_k1', 'u_k2'];

const WARP_VERTEX_SRC = `
attribute vec2 a_pos; attribute vec2 a_uv; varying vec2 v;
void main(){ v = a_uv; gl_Position = vec4(a_pos, 0., 1.); }`;
const WARP_FRAGMENT_SRC = `
precision mediump float;
uniform sampler2D u_tex; varying vec2 v;
void main(){ gl_FragColor = texture2D(u_tex, v); }`;

const MESH_N = 32;                                        // warp mesh is MESH_N × MESH_N quads

let gl, program, warpProgram, texture, quadBuf, meshBuf, meshIndexBuf, meshIndexCount;
let fbo, fbTexture, fbSize = {w: 0, h: 0};
const uniform = {};

function compileShader(type, src) {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function linkProgram(vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));      // fixed locations so programs can share attribute slots
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function setupTexture(tex, filter = gl.LINEAR) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter],
                        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
}

/** Set up WebGL. Returns false (and leaves the canvas unusable for GL) if WebGL or the shaders are unavailable → render.js falls back to cpu.js. */
function initGL() {
  try {
    gl = dom.gl.getContext('webgl', {premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true});
    if (!gl) return false;
    setupGL();
    return true;
  } catch (err) { console.warn('WebGL setup failed, using the software renderer:', err); gl = null; return false; }
}
function setupGL() {
  program = linkProgram(VERTEX_SRC, FRAGMENT_SRC, ['a']);
  warpProgram = linkProgram(WARP_VERTEX_SRC, WARP_FRAGMENT_SRC, ['a_pos', 'a_uv']);
  UNIFORMS.forEach(n => uniform[n] = gl.getUniformLocation(program, n));

  quadBuf = gl.createBuffer();                                          // full-screen quad, y down
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

  meshBuf = gl.createBuffer();                                          // warp mesh: positions change, indices don't
  const idx = [], row = MESH_N + 1;
  for (let j = 0; j < MESH_N; j++) for (let i = 0; i < MESH_N; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1; idx.push(a, b, c, b, d, c);
  }
  meshIndexBuf = gl.createBuffer(); meshIndexCount = idx.length;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndexBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

  texture = gl.createTexture(); fbTexture = gl.createTexture(); fbo = gl.createFramebuffer();
}

/** Upload a canvas/image as the image texture. Caller guarantees size <= MAX_TEXTURE_SIZE. */
function uploadTexture(src) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  setupTexture(texture);
}

/** Make the offscreen target (pass 1 output) match the canvas size and bind it. */
function bindOffscreen(w, h) {
  if (fbSize.w !== w || fbSize.h !== h) {
    gl.bindTexture(gl.TEXTURE_2D, fbTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setupTexture(fbTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTexture, 0);
    fbSize = {w, h};
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
}

function drawImagePass(w, h) {
  const I = S.img, L = S.lens;
  gl.useProgram(program);
  gl.disableVertexAttribArray(1);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(uniform.u_tex, 0);
  const cr = I.crop || {x: -1e6, y: -1e6, w: 2e6, h: 2e6};     // no crop = no mask (the lens may show content beyond the original edges)
  gl.uniform4f(uniform.u_crop, cr.x, cr.y, cr.w, cr.h);
  gl.uniform2f(uniform.u_doc, w, h);
  gl.uniform2f(uniform.u_img, I.w, I.h);
  gl.uniform2f(uniform.u_pos, I.x, I.y);
  gl.uniform2f(uniform.u_c, L.cx, L.cy);
  gl.uniform1f(uniform.u_scale, I.scale);
  gl.uniform1f(uniform.u_rot, I.rot * Math.PI / 180);
  gl.uniform1f(uniform.u_k1, L.bypass ? 0 : L.k1);
  gl.uniform1f(uniform.u_k2, L.bypass ? 0 : L.k2);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawWarpPass() {
  gl.useProgram(warpProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf);
  gl.bufferData(gl.ARRAY_BUFFER, warpMesh(MESH_N), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTexture);
  gl.uniform1i(gl.getUniformLocation(warpProgram, 'u_tex'), 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndexBuf);
  gl.drawElements(gl.TRIANGLES, meshIndexCount, gl.UNSIGNED_SHORT, 0);
  gl.disableVertexAttribArray(1);
}

function renderGL() {
  if (!gl) return;
  const {w, h} = S.doc;
  if (dom.gl.width !== w || dom.gl.height !== h) { dom.gl.width = w; dom.gl.height = h; }
  const warped = S.img.el && S.warp.enabled && warpActive();

  if (warped) bindOffscreen(w, h); else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  if (!S.img.el) return;
  drawImagePass(w, h);

  if (warped) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
    drawWarpPass();
  }
}
