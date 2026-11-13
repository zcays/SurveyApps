'use strict';
/* cv.js — a small computer-vision toolbox with no dependencies. Used only by autofit.js. No app state in here.
 * Images are Float32Array(w*h), row-major. Contents:
 *   cvGrayFromImage   draw an <img>/<canvas> at a working size and return its grey levels
 *   cvBlur            Gaussian blur (exact for small sigma, three box blurs for large sigma)
 *   cvGradients       central-difference gradients
 *   cvFFT2            in-place 2-D FFT (power-of-two size)
 *   cvLatticePeaks    find the two frequency vectors of a square lattice from the power spectrum
 *   cvDemodulate      complex demodulation: local amplitude + phase of one line family
 *   cvUnwrap          quality-guided 2-D phase unwrapping on a coarse grid
 *   cvSolve / cvLeastSquares   small dense solver and a robust Levenberg-Marquardt fitter */

function cvGrayFromImage(el, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', {willReadFrequently: true}); x.imageSmoothingQuality = 'high'; x.drawImage(el, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = .299 * d[j] + .587 * d[j + 1] + .114 * d[j + 2];
  return out;
}

/* ---------------- blurring ---------------- */
function cvConvSeparable(src, w, h, kernel) {
  const r = (kernel.length - 1) >> 1, tmp = new Float32Array(w * h), dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let k = -r; k <= r; k++) { const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k; s += src[y * w + xx] * kernel[k + r]; }
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let k = -r; k <= r; k++) { const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k; s += tmp[yy * w + x] * kernel[k + r]; }
    dst[y * w + x] = s;
  }
  return dst;
}
/** One box blur pass (window 2r+1, shrinking at the borders) along rows then columns, using prefix sums. */
function cvBox(src, w, h, r) {
  const tmp = new Float32Array(w * h), dst = new Float32Array(w * h), pre = new Float64Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; pre[0] = 0; for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + src[o + x];
    for (let x = 0; x < w; x++) { const a = x - r < 0 ? 0 : x - r, b = x + r + 1 > w ? w : x + r + 1; tmp[o + x] = (pre[b] - pre[a]) / (b - a); }
  }
  for (let x = 0; x < w; x++) {
    pre[0] = 0; for (let y = 0; y < h; y++) pre[y + 1] = pre[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) { const a = y - r < 0 ? 0 : y - r, b = y + r + 1 > h ? h : y + r + 1; dst[y * w + x] = (pre[b] - pre[a]) / (b - a); }
  }
  return dst;
}
function cvBlur(src, w, h, sigma) {
  if (sigma < 2.5) {
    const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1); let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    return cvConvSeparable(src, w, h, k);
  }
  const n = 3, ideal = Math.sqrt(12 * sigma * sigma / n + 1); let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;        // three boxes ≈ a Gaussian
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)); let a = src;
  for (let i = 0; i < n; i++) a = cvBox(a, w, h, ((i < m ? wl : wl + 2) - 1) >> 1);
  return a;
}
function cvGradients(g, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, xl = x > 0 ? i - 1 : i, xr = x < w - 1 ? i + 1 : i, yu = y > 0 ? i - w : i, yd = y < h - 1 ? i + w : i;
    gx[i] = (g[xr] - g[xl]) / (xr - xl || 1); gy[i] = (g[yd] - g[yu]) / ((yd - yu) / w || 1);
  }
  return {gx, gy};
}

/* ---------------- FFT ---------------- */
function cvFFT(re, im, n, off, stride) {            // in-place radix-2 FFT of n values starting at `off` with spacing `stride`
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { const a = off + i * stride, b = off + j * stride; let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = off + (i + k) * stride, b = off + (i + k + half) * stride;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function cvFFT2(re, im, n) { for (let y = 0; y < n; y++) cvFFT(re, im, n, y * n, 1); for (let x = 0; x < n; x++) cvFFT(re, im, n, x, n); }

/** Find the two frequency vectors (cycles per pixel of the w×h image) of a square lattice.
 *  features: one or more feature images; their power spectra are ADDED (e.g. |gx| and |gy| separately, which keeps the lattice
 *  axes stronger than the lattice diagonal). fLo/fHi bound the search (cycles/px).
 *  Returns {f1, f2, strength} or null. f1 is the more x-aligned one (f1.x > 0), f2.y > 0. */
function cvLatticePeaks(features, w, h, fLo, fHi) {
  const dec = Math.max(1, Math.ceil(Math.max(w, h) / 1024)), dw = Math.floor(w / dec), dh = Math.floor(h / dec);
  let n = 256; while (n < Math.max(dw, dh)) n <<= 1;
  const P = new Float64Array(n * n), re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (const E of features) {
    re.fill(0); im.fill(0);
    for (let y = 0; y < dh; y++) {
      const wy = .5 - .5 * Math.cos(2 * Math.PI * (y + .5) / dh);
      for (let x = 0; x < dw; x++) {
        let s = 0; for (let j = 0; j < dec; j++) for (let i = 0; i < dec; i++) s += E[(y * dec + j) * w + x * dec + i];     // block average = decimate
        re[y * n + x] = s / (dec * dec) * wy * (.5 - .5 * Math.cos(2 * Math.PI * (x + .5) / dw));                              // Hann window
      }
    }
    cvFFT2(re, im, n);
    for (let i = 0; i < P.length; i++) P[i] += re[i] * re[i] + im[i] * im[i];
  }
  const at = (kx, ky) => P[((ky + n) % n) * n + ((kx + n) % n)];
  const smooth = (kx, ky) => { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(kx + i, ky + j); return s / 9; };
  const freq = k => (k < n / 2 ? k : k - n) / n / dec;                                                                        // bin → cycles per image px
  const peaks = [], bandVals = [];
  for (let ky = 0; ky < n; ky++) for (let kx = 0; kx <= n / 2; kx++) {
    const fx = freq(kx), fy = freq(ky), r = Math.hypot(fx, fy);
    if (r < fLo || r > fHi || (kx === 0 && fy < 0)) continue;
    const v = smooth(kx, ky); if (((kx * 7 + ky * 13) % 11) === 0) bandVals.push(v);
    let isMax = true; for (let j = -1; j <= 1 && isMax; j++) for (let i = -1; i <= 1; i++) if ((i || j) && smooth(kx + i, ky + j) > v) { isMax = false; break; }
    if (!isMax) continue;
    let sw = 0, sx = 0, sy = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const p = at(kx + i, ky + j); sw += p; sx += p * i; sy += p * j; }   // sub-bin centroid
    const ky2 = ky < n / 2 ? ky : ky - n;
    peaks.push({x: (kx + sx / sw) / n / dec, y: (ky2 + sy / sw) / n / dec, p: v});
  }
  if (!peaks.length) return null;
  peaks.sort((a, b) => b.p - a.p);
  const kept = [];                                                    // non-maximum suppression: drop shoulders / side lobes of a stronger peak
  for (const p of peaks) { const lp = Math.hypot(p.x, p.y); if (!kept.some(q => Math.hypot(p.x - q.x, p.y - q.y) < .12 * lp)) kept.push(p); if (kept.length >= 30) break; }
  bandVals.sort((a, b) => a - b); const median = bandVals[bandVals.length >> 1] || 1e-12;
  const pairs = [];
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    const a = kept[i], b = kept[j], la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
    if (Math.abs(a.x * b.x + a.y * b.y) / (la * lb) > .26 || la / lb < .8 || la / lb > 1.25) continue;                         // must be ~perpendicular with ~equal period
    pairs.push({a, b, score: Math.sqrt(a.p * b.p)});
  }
  if (!pairs.length) return null;
  const best = pairs.reduce((m, p) => p.score > m.score ? p : m);
  // The strongest pair may be a harmonic (2f) or the lattice diagonal (f1±f2). The true basis is the LOWEST-frequency strong pair
  // that generates the strongest pair with whole-number combinations.
  const generates = q => {
    const det = q.a.x * q.b.y - q.a.y * q.b.x; if (Math.abs(det) < 1e-12) return false;
    return [best.a, best.b].every(v => { const m = (v.x * q.b.y - v.y * q.b.x) / det, n = (q.a.x * v.y - q.a.y * v.x) / det; return Math.abs(m - Math.round(m)) < .15 && Math.abs(n - Math.round(n)) < .15 && (Math.round(m) || Math.round(n)); });
  };
  const len = q => Math.hypot(q.a.x, q.a.y) + Math.hypot(q.b.x, q.b.y);
  const pick = pairs.filter(q => q.score >= .2 * best.score && generates(q)).sort((p, q) => len(p) - len(q))[0] || best;
  let f1 = pick.a, f2 = pick.b; if (Math.abs(f2.x) > Math.abs(f1.x)) [f1, f2] = [f2, f1];
  f1 = f1.x < 0 ? {x: -f1.x, y: -f1.y} : {x: f1.x, y: f1.y}; f2 = f2.y < 0 ? {x: -f2.x, y: -f2.y} : {x: f2.x, y: f2.y};
  return {f1, f2, strength: pick.score / median};
}

/** Complex demodulation of the line family with frequency vector f (cycles/px).
 *  Returns re/im of the local phasor (blurred over ~1.2 periods), sampled on a coarse grid, plus the line-strength image `lines`.
 *  Walls are where  f·r + atan2(im, re)/2π  is an integer. Uses |gradient along f| so dark and bright walls behave the same. */
function cvDemodulate(gx, gy, w, h, f, step) {
  const len = Math.hypot(f.x, f.y), ux = f.x / len, uy = f.y / len, period = 1 / len, E = new Float32Array(w * h);
  for (let i = 0; i < E.length; i++) E[i] = Math.abs(gx[i] * ux + gy[i] * uy);
  const bg = cvBlur(E, w, h, period), re = new Float32Array(w * h), im = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = E[i] - bg[i], a = -2 * Math.PI * (f.x * x + f.y * y); E[i] = v; re[i] = v * Math.cos(a); im[i] = v * Math.sin(a);
  }
  const br = cvBlur(re, w, h, 1.2 * period), bi = cvBlur(im, w, h, 1.2 * period);
  const cw = Math.floor((w - (step >> 1) - 1) / step) + 1, ch = Math.floor((h - (step >> 1) - 1) / step) + 1;
  const cre = new Float32Array(cw * ch), cim = new Float32Array(cw * ch), amp = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const s = (j * step + (step >> 1)) * w + i * step + (step >> 1), o = j * cw + i; cre[o] = br[s]; cim[o] = bi[s]; amp[o] = Math.hypot(br[s], bi[s]);
  }
  for (let i = 0; i < E.length; i++) E[i] = Math.abs(E[i]);
  return {re: cre, im: cim, amp, cw, ch, lines: cvBlur(E, w, h, 1)};
}

/** Quality-guided flood-fill phase unwrapping. phase in cycles; only cells with mask[i] are visited, strongest first. Returns Float32Array (NaN = not reached). */
function cvUnwrap(phase, amp, mask, cw, ch) {
  const out = new Float32Array(cw * ch).fill(NaN); let seed = -1, best = -1;
  for (let i = 0; i < amp.length; i++) if (mask[i] && amp[i] > best) { best = amp[i]; seed = i; }
  if (seed < 0) return out;
  const heap = [];                                                       // binary max-heap of cell indices keyed by amplitude
  const push = i => { heap.push(i); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (amp[heap[p]] >= amp[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let p = 0; for (;;) { let l = 2 * p + 1, r = l + 1, m = p; if (l < heap.length && amp[heap[l]] > amp[heap[m]]) m = l; if (r < heap.length && amp[heap[r]] > amp[heap[m]]) m = r; if (m === p) break; [heap[p], heap[m]] = [heap[m], heap[p]]; p = m; } } return top; };
  out[seed] = phase[seed]; push(seed);
  while (heap.length) {
    const i = pop(), x = i % cw, y = (i / cw) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
      const j = ny * cw + nx; if (!mask[j] || !isNaN(out[j])) continue;
      out[j] = phase[j] - Math.round(phase[j] - out[i]); push(j);
    }
  }
  return out;
}

/* ---------------- small dense maths ---------------- */
/** Solve A x = b (A is n×n as array of rows) by Gaussian elimination with partial pivoting. Returns null if singular. */
function cvSolve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
/** Robust Levenberg-Marquardt. fn(x) → Float64Array of residuals. Loss = soft-L1 with scale fScale (outliers count ~linearly).
 *  steps[j] = finite-difference step of parameter j. Returns {x, cost, residuals}. */
function cvLeastSquares(fn, x0, steps, fScale, maxIter = 40) {
  const rho = r => { let s = 0; for (let i = 0; i < r.length; i++) { const z = r[i] / fScale; s += 2 * (Math.sqrt(1 + z * z) - 1); } return s * fScale * fScale; };
  let x = x0.slice(), r = fn(x), cost = rho(r), lambda = 1e-3; const n = x.length, m = r.length;
  for (let iter = 0; iter < maxIter; iter++) {
    const J = []; for (let j = 0; j < n; j++) { const xj = x.slice(); xj[j] += steps[j]; const rj = fn(xj), col = new Float64Array(m); for (let i = 0; i < m; i++) col[i] = (rj[i] - r[i]) / steps[j]; J.push(col); }
    const wgt = new Float64Array(m); for (let i = 0; i < m; i++) { const z = r[i] / fScale; wgt[i] = 1 / Math.sqrt(1 + z * z); }
    const A = Array.from({length: n}, () => new Array(n).fill(0)), g = new Array(n).fill(0);
    for (let a = 0; a < n; a++) { for (let i = 0; i < m; i++) g[a] += J[a][i] * wgt[i] * r[i]; for (let b = a; b < n; b++) { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * wgt[i] * J[b][i]; A[a][b] = A[b][a] = s; } }
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const dx = cvSolve(A.map((row, a) => row.map((v, b) => a === b ? v * (1 + lambda) + 1e-12 : v)), g.map(v => -v));
      if (dx) { const xn = x.map((v, j) => v + dx[j]), rn = fn(xn), cn = rho(rn); if (cn < cost) { const gain = (cost - cn) / cost; x = xn; r = rn; cost = cn; lambda *= .3; improved = gain > 1e-7; break; } }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return {x, cost, residuals: r};
}
