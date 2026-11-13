/**
 * SurveyApps! — Rigorous Desktop & Packaged E2E Test Suite (surveyapps/tests/desktop.cjs)
 *
 * Supports:
 *   node tests/desktop.cjs             (dev / source Electron launch)
 *   node tests/desktop.cjs --packaged  (packaged .app / .exe launch)
 *
 * Verifies:
 *   1. Dashboard bridge contract, friendly product copy (no raw URLs or heavy jargon),
 *      responsive 800x600 minimum & 1440x960 wide layouts, and clean screenshots.
 *   2. Persistent iframe navigation across Home, Grid Studio, Fluorescence Lab, and Help.
 *   3. Grid Studio: sample load, file upload (#file), chip preset calibration (V12 / V3.1),
 *      image rotation, scale, crop + undo, lens fisheye k1/k2, warp control points,
 *      pixel/state verification, and native PNG export download via session will-download.
 *   4. Packaged / custom-protocol Grid Studio self-test suite (surveyapps://app/vendor/grid-studio/tests.html) -> 100/100 PASS.
 *   5. Fluorescence Lab: upload synthetic fixed RGB fixtures (PNG, TIFF, JPEG), unlinked X/Y spacing
 *      and placed center origin, channel intensities (mean, R, G, B, FITC, TRITC, Cy5, YFP, brightfield),
 *      Plotly heatmap rendered with zero JS/500 errors, native downloads for Image PNG, Grid PNG,
 *      Merged PNG, Cropped Well PNG, Matrix CSV, and JSON grid settings save/reload round trip.
 *   6. Expected negative / validation checks (corrupt image upload graceful error, invalid settings JSON rejection).
 *   7. Backend fault isolation & recovery: kill backend child process -> assert error UI + Grid Studio unaffected ->
 *      click Retry -> assert backend restarts and Fluorescence Lab recovers to ready state.
 *   8. Clean process shutdown with zero orphan surveyapps-backend processes.
 */

'use strict';

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SURVEYAPPS_DIR = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(SURVEYAPPS_DIR, 'test-results');
const PYTHON_BIN = fs.existsSync(path.join(SURVEYAPPS_DIR, '.venv/bin/python'))
  ? path.join(SURVEYAPPS_DIR, '.venv/bin/python')
  : (fs.existsSync(path.join(SURVEYAPPS_DIR, '.venv/Scripts/python.exe'))
      ? path.join(SURVEYAPPS_DIR, '.venv/Scripts/python.exe')
      : (process.platform === 'win32' ? 'python' : 'python3'));

const isPackaged = process.argv.includes('--packaged');

function resolvePackagedExecutable() {
  if (process.env.SURVEYAPPS_TEST_EXECUTABLE) return process.env.SURVEYAPPS_TEST_EXECUTABLE;
  const candidates = [
    path.join(SURVEYAPPS_DIR, 'dist/mac-arm64/SurveyApps!.app/Contents/MacOS/SurveyApps!'),
    path.join(SURVEYAPPS_DIR, 'dist/mac/SurveyApps!.app/Contents/MacOS/SurveyApps!'),
    path.join(SURVEYAPPS_DIR, 'dist/mac-x64/SurveyApps!.app/Contents/MacOS/SurveyApps!'),
    path.join(SURVEYAPPS_DIR, 'dist/win-unpacked/SurveyApps!.exe'),
    path.join(SURVEYAPPS_DIR, 'dist/linux-unpacked/surveyapps'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Packaged executable not found. Checked:\n${candidates.map(c => '  - ' + c).join('\n')}`
  );
}

function generateTestFixtures(fixtureDir) {
  fs.mkdirSync(fixtureDir, { recursive: true });
  const pyScript = `
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

out = Path(sys.argv[1])
# 241x181 image so 80x90 grid lines [0, 80, 160, 240] and [0, 90, 180] form 2 rows x 3 cols
arr = np.zeros((181, 241, 3), dtype=np.uint8)
# Row A (y: 0..90): A1=(200,20,40), A2=(30,180,60), A3=(10,50,210)
arr[0:90, 0:80] = [200, 20, 40]
arr[0:90, 80:160] = [30, 180, 60]
arr[0:90, 160:241] = [10, 50, 210]
# Row B (y: 90..181): B1=(240,240,0), B2=(0,160,200), B3=(128,128,128)
arr[90:181, 0:80] = [240, 240, 0]
arr[90:181, 80:160] = [0, 160, 200]
arr[90:181, 160:241] = [128, 128, 128]

img = Image.fromarray(arr, mode='RGB')
img.save(out / 'fixture_rgb.png', format='PNG')
img.save(out / 'fixture_rgb.tiff', format='TIFF')
img.save(out / 'fixture_rgb.jpg', format='JPEG', quality=100, subsampling=0)

# Shifted fixture with offset (15, 25) and spacing (70, 50) for origin + X/Y spacing test (200x160)
arr2 = np.zeros((160, 200, 3), dtype=np.uint8)
arr2[25:75, 15:85] = [180, 40, 20]    # A1
arr2[25:75, 85:155] = [20, 190, 50]   # A2
arr2[75:125, 15:85] = [30, 60, 210]   # B1
arr2[75:125, 85:155] = [220, 200, 10] # B2
Image.fromarray(arr2, mode='RGB').save(out / 'fixture_shifted.png', format='PNG')

# Invalid image file
(out / 'corrupt.png').write_bytes(b'not-a-valid-image-payload')
`;
  execFileSync(PYTHON_BIN, ['-c', pyScript, fixtureDir], { stdio: 'inherit' });
}

function inspectPngFile(filePath) {
  const pyScript = `
import json, sys
from PIL import Image
import numpy as np
im = Image.open(sys.argv[1])
arr = np.array(im)
print(json.dumps({
  'width': im.size[0],
  'height': im.size[1],
  'mode': im.mode,
  'mean': float(arr.mean()),
  'std': float(arr.std()),
  'min': int(arr.min()),
  'max': int(arr.max())
}))
`;
  const stdout = execFileSync(PYTHON_BIN, ['-c', pyScript, filePath], { encoding: 'utf8' });
  return JSON.parse(stdout.trim());
}

async function triggerAndAwaitDownload(electronApp, downloadDir, actionFn, customSaveName = null) {
  // Set up one-shot download path queue in Electron main process
  const targetPath = customSaveName && path.isAbsolute(customSaveName) ? customSaveName : path.join(
    downloadDir,
    customSaveName || `dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );

  await electronApp.evaluate(({ session }, saveTarget) => {
    globalThis.__testDownloadQueue = globalThis.__testDownloadQueue || [];
    globalThis.__testDownloadQueue.push(saveTarget);
    if (!globalThis.__testDownloadHookInstalled) {
      globalThis.__testDownloadHookInstalled = true;
      globalThis.__testDownloadResults = [];
      session.defaultSession.on('will-download', (_event, item) => {
        const nextTarget = (globalThis.__testDownloadQueue || []).shift();
        const finalPath = nextTarget || item.getSavePath();
        const origName = item.getFilename();
        if (nextTarget) {
          item.setSavePath(nextTarget);
        }
        item.once('done', (_e, state) => {
          globalThis.__testDownloadResults.push({
            filename: origName,
            savePath: finalPath,
            state,
            totalBytes: item.getReceivedBytes(),
          });
        });
      });
    }
  }, targetPath);

  const prevCount = await electronApp.evaluate(() => (globalThis.__testDownloadResults || []).length);
  await actionFn();

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const results = await electronApp.evaluate(() => globalThis.__testDownloadResults || []);
    if (results.length > prevCount) {
      const latest = results[results.length - 1];
      assert.equal(latest.state, 'completed', `Download failed for ${latest.filename}: state=${latest.state}`);
      assert.ok(fs.existsSync(latest.savePath), `Downloaded file missing on disk: ${latest.savePath}`);
      const stat = fs.statSync(latest.savePath);
      assert.ok(stat.size > 0, `Downloaded file is empty: ${latest.savePath}`);
      return { ...latest, size: stat.size };
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Timed out waiting for Electron native download to complete');
}

(async () => {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surveyapps-e2e-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const downloadDir = path.join(tempRoot, 'downloads');
  const fixtureDir = path.join(tempRoot, 'fixtures');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  generateTestFixtures(fixtureDir);

  const modeLabel = process.env.SURVEYAPPS_TEST_LABEL || (isPackaged ? 'packaged' : 'dev');
  fs.rmSync(path.join(RESULTS_DIR,`desktop-${modeLabel}.json`),{force:true});
  const launchOpts = isPackaged
    ? {
        executablePath: resolvePackagedExecutable(),
        args: [`--user-data-dir=${userDataDir}`],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', PYTHONHOME: '', PYTHONPATH: '', NODE_PATH: '', ...(process.platform === 'darwin' ? {PATH:'/usr/bin:/bin:/usr/sbin:/sbin'} : {}) },
      }
    : {
        args: [SURVEYAPPS_DIR, `--user-data-dir=${userDataDir}`],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
      };

  console.log(`[SurveyApps E2E] Launching in ${modeLabel.toUpperCase()} mode...`);
  if (isPackaged) {
    console.log(`[SurveyApps E2E] Packaged executable: ${launchOpts.executablePath}`);
  }

  const report = {
    mode: modeLabel,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    timestamp: new Date().toISOString(),
    executable: isPackaged ? launchOpts.executablePath : 'electron . (source)',
    checks: [],
    unexpectedPageErrors: [],
    unexpectedConsoleErrors: [],
    unexpectedHttp500s: [],
    expectedHandledErrors: [],
  };

  function recordCheck(name, details = {}) {
    console.log(`  ✓ ${name}`);
    report.checks.push({ name, status: 'PASS', ...details });
  }

  const electronApp = await electron.launch(launchOpts);
  let allowExpectedErrorWindow = false;
  let tearingDown = false;
  report.runtime = await electronApp.evaluate(() => ({arch:process.arch,versions:process.versions}));

  try {
    const page = await electronApp.firstWindow();

    page.on('pageerror', err => {
      const msg = err && err.stack ? err.stack : String(err);
      report.unexpectedPageErrors.push(msg);
      console.error('[UNEXPECTED PAGE ERROR]', msg);
    });

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (allowExpectedErrorWindow || (tearingDown && /ERR_(CONNECTION_RESET|CONNECTION_REFUSED|EMPTY_RESPONSE|ABORTED)/.test(text))) {
          report.expectedHandledErrors.push(text);
        } else {
          report.unexpectedConsoleErrors.push(text);
          console.error('[UNEXPECTED CONSOLE ERROR]', text);
        }
      }
    });

    page.on('response', response => {
      if (response.status() >= 500) {
        const info = `${response.status()} ${response.url()}`;
        report.unexpectedHttp500s.push(info);
        console.error('[UNEXPECTED HTTP 500]', info);
      }
    });

    // -------------------------------------------------------------------------
    // 1. Wait for preload bridge & true backend ready state (via DOM & bridge poll)
    // -------------------------------------------------------------------------
    await page.waitForFunction(() => Boolean(window.surveyapps), null, { timeout: 15000 });

    const readyStart = Date.now();
    let bridgeStatus = null;
    while (Date.now() - readyStart < 75000) {
      bridgeStatus = await page.evaluate(() => window.surveyapps.getStatus());
      const pillText = await page.locator('#pill-text').innerText();
      if (bridgeStatus && bridgeStatus.state === 'ready' && pillText === 'All Tools Ready') {
        break;
      }
      if (bridgeStatus && bridgeStatus.state === 'error') {
        throw new Error(`Backend entered error state on startup: ${bridgeStatus.message}`);
      }
      await page.waitForTimeout(250);
    }
    assert.equal(bridgeStatus?.state, 'ready', `Backend did not reach ready state: ${JSON.stringify(bridgeStatus)}`);
    assert.ok(bridgeStatus.microscopyUrl.startsWith('http://127.0.0.1:'), 'microscopyUrl must be loopback');
    assert.equal(bridgeStatus.gridUrl, 'surveyapps://app/vendor/grid-studio/index.html');
    recordCheck('Dashboard preload bridge and local Python backend ready', {
      version: bridgeStatus.version,
      startupMs: Date.now() - readyStart,
    });

    // -------------------------------------------------------------------------
    // 2. Verify refined dashboard product copy & responsive screenshots
    // -------------------------------------------------------------------------
    const homeText = await page.locator('#view-home').innerText();
    assert.ok(!homeText.includes('surveyapps://'), 'Home copy must not expose internal surveyapps:// URLs');
    assert.ok(!homeText.includes('127.0.0.1'), 'Home copy must not expose loopback IP URLs');
    assert.ok(!homeText.includes('biquadratic'), 'Home copy must keep heavy math jargon in Help');
    assert.ok(!homeText.includes('demodulation'), 'Home copy must keep FFT demodulation jargon in Help');
    assert.ok(homeText.includes('8-bit'), 'Home copy must preserve 8-bit calibration caveat');

    // Wide layout (1440x960)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1440, 960);
    });
    await page.waitForTimeout(300);

    // Check SVG text is inside the SVG right border and not clipped
    const svgFit = await page.evaluate(() => {
      const svg = document.querySelector('.scientific-illustration');
      const text = svg.querySelector('text');
      const rect = svg.querySelector('g rect');
      const textBox = text.getBBox();
      const rectBox = rect.getBBox();
      return {
        textRight: textBox.x + textBox.width,
        boxWidth: rectBox.width,
      };
    });
    assert.ok(
      svgFit.textRight < svgFit.boxWidth - 6,
      `SVG scale bar text should fit cleanly inside box: textRight=${svgFit.textRight}, boxWidth=${svgFit.boxWidth}`
    );

    await page.screenshot({ path: path.join(RESULTS_DIR, `home-wide-${modeLabel}.png`) });
    if (isPackaged) {
      await page.screenshot({ path: path.join(RESULTS_DIR, 'home.png') });
    }

    // Help view check & screenshot
    await page.locator('[data-nav="help"]').click();
    await page.locator('#view-help').waitFor({ state: 'visible' });
    const helpText = await page.locator('#view-help').innerText();
    assert.ok(helpText.includes('biquadratic') && helpText.includes('FFT'), 'Help view retains detailed scientific documentation');
    await page.screenshot({ path: path.join(RESULTS_DIR, `help-${modeLabel}.png`) });

    // Responsive minimum 800x600 layout
    await page.locator('[data-nav="home"]').click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(800, 600);
    });
    await page.waitForTimeout(300);
    const minLayoutOk = await page.evaluate(() => {
      const shell = document.getElementById('app-shell');
      const home = document.getElementById('view-home');
      return shell.clientWidth >= 780 && home.offsetParent !== null;
    });
    assert.ok(minLayoutOk, '800x600 minimum window layout failed');
    await page.screenshot({ path: path.join(RESULTS_DIR, `home-800px-${modeLabel}.png`) });

    // Restore 1440x960 for tool tests
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1440, 960);
    });
    await page.waitForTimeout(250);
    recordCheck('Refined dashboard copy, unclipped SVG art, Help reference, and 800px/1440px responsive layouts', {
      svgFit,
    });

    // -------------------------------------------------------------------------
    // 3. Grid Studio: sample, upload, calibration, rotation, scale, crop, lens, warp, export
    // -------------------------------------------------------------------------
    await page.locator('[data-nav="grid"]').click();
    const gridFrame = page.frameLocator('#frame-grid');
    await gridFrame.locator('#sample').waitFor({ state: 'visible', timeout: 15000 });

    const gsPageFrame = () => {
      const f = page.frames().find(fr => fr.url().includes('vendor/grid-studio/index.html'));
      assert.ok(f, 'Grid Studio frame not found');
      return f;
    };

    // 3a. Load built-in sample
    await gridFrame.locator('#sample').click();
    const sampleState = await gsPageFrame().evaluate(() => {
      const st = eval('S');
      return { w: st.img.w, h: st.img.h, docW: st.doc.w, docH: st.doc.h, hasEl: Boolean(st.img.el) };
    });
    assert.equal(sampleState.w, 1200);
    assert.equal(sampleState.h, 800);
    assert.equal(sampleState.hasEl, true);

    // 3b. Upload custom image file via #file input
    await gridFrame.locator('#file').setInputFiles(path.join(fixtureDir, 'fixture_rgb.png'));
    await page.waitForFunction(
      () => {
        const f = Array.from(window.frames).find(w => {
          try { return w.location.href.includes('vendor/grid-studio/index.html'); } catch { return false; }
        });
        return f && f.eval('S.img.w') === 241 && f.eval('S.img.h') === 181;
      },
      null,
      { timeout: 10000 }
    );

    // Reload sample for rich visual calibration/lens/warp transformations
    await gridFrame.locator('#sample').click();

    // 3c. Chip preset calibration (select V12: 200 µm pitch, 170 µm well, 49x49 array)
    const calState = await gsPageFrame().evaluate(() => {
      selectChip('V12');
      const st = eval('S');
      const k = pxPerUm();
      const u = umPerPx();
      const chipInfo = document.getElementById('chipInfo').innerText;
      return { chipId: st.chip.id, docW: st.doc.w, docH: st.doc.h, k, u, chipInfo };
    });
    assert.equal(calState.chipId, 'V12');
    assert.ok(calState.k > 0.15 && calState.k < 0.25, `Unexpected pxPerUm for V12: ${calState.k}`);
    assert.ok(calState.u > 0, `Expected positive umPerPx calibration: ${calState.u}`);
    assert.ok(calState.chipInfo.includes('V12') && calState.chipInfo.includes('µm per pixel'));

    // 3d. Rotation, scale, lens fisheye (k1, k2), warp control points, and crop + undo
    const transformMetrics = await gsPageFrame().evaluate(() => {
      const st = eval('S');
      const sampleExportStats = () => {
        const c = buildExportCanvas({ image: true, grid: false });
        const ctx = c.getContext('2d');
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 16) sum += data[i] + data[i + 1] + data[i + 2];
        return { w: c.width, h: c.height, checksum: sum };
      };

      const baseStats = sampleExportStats();

      // Rotate & scale
      st.img.rot = 6.5;
      st.img.scale = 1.25;
      refresh('gl', 'status');
      const rotScaleStats = sampleExportStats();

      // Lens correction k1 / k2
      st.lens.k1 = -0.32;
      st.lens.k2 = 0.08;
      refresh('gl', 'status');
      const lensStats = sampleExportStats();

      // Warp / distort corner control point
      setTool('warp');
      st.warp.c.nw = { x: 0.06, y: 0.05 };
      st.warp.c.se = { x: 0.94, y: 0.92 };
      refresh('gl', 'warp', 'status');
      const warpStats = sampleExportStats();

      // Crop & undo crop
      setTool('crop');
      startCrop();
      st.crop = { x: 200, y: 200, w: 600, h: 500 };
      applyCrop();
      const croppedRect = st.img.crop ? { ...st.img.crop } : null;
      const cropStats = sampleExportStats();
      undoCrop();
      const afterUndoCrop = st.img.crop;

      return {
        baseStats,
        rotScaleStats,
        lensStats,
        warpStats,
        croppedRect,
        cropStats,
        afterUndoCrop,
      };
    });

    assert.notEqual(transformMetrics.baseStats.checksum, transformMetrics.rotScaleStats.checksum, 'Rotation/scale should alter rendered pixels');
    assert.notEqual(transformMetrics.rotScaleStats.checksum, transformMetrics.lensStats.checksum, 'Lens k1/k2 should alter rendered pixels');
    assert.notEqual(transformMetrics.lensStats.checksum, transformMetrics.warpStats.checksum, 'Warp mesh should alter rendered pixels');
    assert.ok(transformMetrics.croppedRect && transformMetrics.croppedRect.w > 100, 'Crop rect should be applied in image coordinates');
    assert.notEqual(transformMetrics.warpStats.checksum, transformMetrics.cropStats.checksum, 'Crop should mask outside pixels');
    assert.equal(transformMetrics.afterUndoCrop, null, 'undoCrop() should restore uncropped state');

    await page.screenshot({ path: path.join(RESULTS_DIR, `grid-studio-${modeLabel}.png`) });

    // 3e. Native PNG export download from Grid Studio
    const gridExportDl = await triggerAndAwaitDownload(
      electronApp,
      downloadDir,
      async () => {
        await gridFrame.locator('#export').click();
      },
      path.join(downloadDir, 'grid-overlay-export.png')
    );
    const gridExportInfo = inspectPngFile(gridExportDl.savePath);
    assert.equal(gridExportInfo.width, calState.docW);
    assert.equal(gridExportInfo.height, calState.docH);
    assert.ok(gridExportInfo.std > 10, 'Exported Grid Studio PNG must contain non-trivial image + grid content');
    recordCheck('Grid Studio sample, upload, V12 calibration, rotation/scale/lens/warp/crop, and native PNG export', {
      exportedPng: gridExportInfo,
    });

    // -------------------------------------------------------------------------
    // 4. Packaged / Custom Protocol Grid Studio Self-Test Suite (tests.html -> 100/100 PASS)
    // -------------------------------------------------------------------------
    allowExpectedErrorWindow = true; // tests.html probes optional samples/photo1.jpg (404 expected & skipped)
    const gridSelfTestResult = await page.evaluate(async () => {
      return await new Promise((resolve, reject) => {
        const qaFrame = document.createElement('iframe');
        qaFrame.id = 'qa-grid-tests-frame';
        qaFrame.style.cssText = 'position:fixed;width:640px;height:480px;left:-9999px;top:0;border:0;';
        qaFrame.src = 'surveyapps://app/vendor/grid-studio/tests.html';
        document.body.appendChild(qaFrame);

        const timeout = setTimeout(() => {
          qaFrame.remove();
          reject(new Error('Timed out waiting for surveyapps://app/vendor/grid-studio/tests.html'));
        }, 180000);

        const poll = setInterval(() => {
          try {
            const doc = qaFrame.contentDocument;
            if (!doc) return;
            if (doc.title === 'PASS' || doc.title.startsWith('FAIL')) {
              clearInterval(poll);
              clearTimeout(timeout);
              const outText = doc.getElementById('out') ? doc.getElementById('out').innerText : '';
              const title = doc.title;
              qaFrame.remove();
              resolve({ title, summary: outText.split('\n')[0] || '', fullText: outText });
            }
          } catch (err) {
            clearInterval(poll);
            clearTimeout(timeout);
            qaFrame.remove();
            reject(err);
          }
        }, 250);
      });
    });
    allowExpectedErrorWindow = false;
    assert.equal(
      gridSelfTestResult.title,
      'PASS',
      `Grid Studio embedded tests.html did not PASS: ${gridSelfTestResult.summary}`
    );
    assert.ok(
      /^(\d+) \/ \1 passed/.test(gridSelfTestResult.summary),
      `Expected all available Grid Studio checks to pass, got: ${gridSelfTestResult.summary}`
    );
    recordCheck('Grid Studio self-test suite via surveyapps://app/vendor/grid-studio/tests.html', {
      summary: gridSelfTestResult.summary,
      skips: gridSelfTestResult.fullText.split("\n").filter(line => /skipped|unavailable/i.test(line)),
    });

    // -------------------------------------------------------------------------
    // 5. Fluorescence Lab: uploads, X/Y spacing & center, channels, heatmap, exports, settings
    // -------------------------------------------------------------------------
    await page.locator('[data-nav="microscopy"]').click();
    const labFrame = page.frameLocator('#frame-microscopy');
    await labFrame.locator('#btn-compute-fluor').waitFor({ state: 'visible', timeout: 25000 });

    const labPageFrame = () => {
      const f = page.frames().find(fr => fr.url().startsWith('http://127.0.0.1:'));
      assert.ok(f, 'Fluorescence Lab frame not found');
      return f;
    };

    // Wait for Dash clientside & initial synthetic image plot before uploading fixtures
    await labPageFrame().waitForFunction(
      () => {
        if (!window.dash_clientside || typeof window.dash_clientside.set_props !== 'function') return false;
        const gd = document.querySelector('#image-graph .js-plotly-plot');
        return Boolean(gd && gd.layout && gd.layout.xaxis && Array.isArray(gd.layout.xaxis.range));
      },
      null,
      { timeout: 30000 }
    );

    // 5a. Upload JPEG, TIFF, and PNG fixtures via actual file input inside #upload-image
    for (const fileName of ['fixture_rgb.jpg', 'fixture_rgb.tiff', 'fixture_rgb.png']) {
      const uploadResponsePromise = page.waitForResponse(
        res => res.url().includes('/_dash-update-component') && res.status() === 200,
        { timeout: 25000 }
      );
      await labFrame.locator('#upload-image input[type="file"]').setInputFiles(path.join(fixtureDir, fileName));
      await uploadResponsePromise;
      await labPageFrame().waitForFunction(
        () => {
          const gd = document.querySelector('#image-graph .js-plotly-plot');
          return gd && gd.layout && gd.layout.xaxis && Math.round(gd.layout.xaxis.range[1]) === 241;
        },
        null,
        { timeout: 25000 }
      );
    }

    // 5b. Configure unlinked X/Y spacing (X=80, Y=90) and center point (0, 0) on fixture_rgb.png (241x181 -> 2 rows x 3 cols)
    await labPageFrame().evaluate(() => {
      window.dash_clientside.set_props('link-spacing-check', { value: [] });
      window.dash_clientside.set_props('grid-spacing-slider', { value: 80 });
      window.dash_clientside.set_props('grid-y-spacing-slider', { value: 90 });
      window.dash_clientside.set_props('grid-x-offset-slider', { value: 0 });
      window.dash_clientside.set_props('grid-y-offset-slider', { value: 0 });
      window.dash_clientside.set_props('center-point-store', { data: { x: 0, y: 0 } });
      window.dash_clientside.set_props('rotation-slider', { value: 0 });
    });
    await page.waitForTimeout(500);

    // Test channels: mean, r, g, b, dapi, fitc, tritc, cy5, yfp, brightfield
    const expectedA1ByChannel = {
      mean: (200 + 20 + 40) / 3.0,
      r: 200.0,
      g: 20.0,
      b: 40.0,
      dapi: 40.0,
      fitc: 20.0,
      tritc: 200.0,
      cy5: 200.0 * 0.8 + 40.0 * 0.2,
      yfp: 200.0 * 0.3 + 20.0 * 0.7,
      brightfield: 0.2126 * 200.0 + 0.7152 * 20.0 + 0.0722 * 40.0,
    };

    for (const [channelName, expectedA1] of Object.entries(expectedA1ByChannel)) {
      await labPageFrame().evaluate(ch => {
        window.dash_clientside.set_props('fluor-channel', { value: ch });
      }, channelName);
      // Wait for invalidate_fluorescence server callback to complete so it cannot race with Compute Fluorescence
      await page.waitForTimeout(350);
      await labFrame.locator('#btn-compute-fluor').click();

      // Poll inside labPageFrame() until matrix-graph heatmap renders updated text/z values for this channel
      const matrixSummary = await labPageFrame().waitForFunction(
        expected => {
          const plot = document.querySelector('#matrix-graph .js-plotly-plot');
          if (!plot || !plot.data || !plot.data[0]) return null;
          const trace = plot.data[0];
          // Plotly 7 may serialize numpy 2D array into trace.text (2D string array) or trace.z
          const text2d = trace.text;
          if (!Array.isArray(text2d) || text2d.length !== 2 || !Array.isArray(text2d[0]) || text2d[0].length !== 3) {
            return null;
          }
          const a1FromText = parseFloat(text2d[0][0]);
          let a1Val = a1FromText;
          if (Array.isArray(trace.z) && Array.isArray(trace.z[0]) && typeof trace.z[0][0] === 'number') {
            a1Val = trace.z[0][0];
          }
          if (Math.abs(a1Val - expected) < 0.15) {
            return { rows: text2d.length, cols: text2d[0].length, a1: a1Val, text: text2d };
          }
          return null;
        },
        expectedA1,
        { timeout: 10000 }
      ).then(h => h.jsonValue());

      assert.ok(
        Math.abs(matrixSummary.a1 - expectedA1) < 0.15,
        `Channel ${channelName} A1 mismatch: ${matrixSummary.a1} vs ${expectedA1}`
      );
    }

    // Set channel back to 'mean' and compute so screenshot and CSV have canonical mean values
    await labPageFrame().evaluate(() => {
      window.dash_clientside.set_props('fluor-channel', { value: 'mean' });
    });
    await page.waitForTimeout(200);
    await labFrame.locator('#btn-compute-fluor').click();
    await page.waitForTimeout(600);

    await page.screenshot({ path: path.join(RESULTS_DIR, `fluorescence-lab-${modeLabel}.png`) });
    if (isPackaged) {
      await page.screenshot({ path: path.join(RESULTS_DIR, 'lab.png') });
    }

    // 5c. Export Matrix CSV and verify numeric contents
    const csvDl = await triggerAndAwaitDownload(
      electronApp,
      downloadDir,
      async () => {
        await labFrame.locator('#btn-save-csv').click();
      },
      path.join(downloadDir, 'fluorescence_matrix_mean.csv')
    );
    const csvLines = fs.readFileSync(csvDl.savePath, 'utf8').trim().split(/\r?\n/);
    assert.equal(csvLines[0], 'Row/Col,1,2,3');
    const rowA = csvLines[1].split(',');
    const rowB = csvLines[2].split(',');
    assert.equal(rowA[0], 'A');
    assert.ok(Math.abs(parseFloat(rowA[1]) - 86.667) < 0.01, `Unexpected A1 CSV value: ${rowA[1]}`);
    assert.ok(Math.abs(parseFloat(rowA[2]) - 90.0) < 0.01, `Unexpected A2 CSV value: ${rowA[2]}`);
    assert.equal(rowB[0], 'B');
    assert.ok(Math.abs(parseFloat(rowB[3]) - 128.0) < 0.01, `Unexpected B3 CSV value: ${rowB[3]}`);

    // 5d. Export Image Only, Grid Only, Merged Image, and Cropped Well PNGs
    const imgOnlyDl = await triggerAndAwaitDownload(
      electronApp,
      downloadDir,
      async () => { await labFrame.locator('#btn-save-image').click(); },
      path.join(downloadDir, 'microscopy_image.png')
    );
    const imgOnlyMeta = inspectPngFile(imgOnlyDl.savePath);
    assert.equal(imgOnlyMeta.width, 241);
    assert.equal(imgOnlyMeta.height, 181);

    const gridOnlyDl = await triggerAndAwaitDownload(
      electronApp,
      downloadDir,
      async () => { await labFrame.locator('#btn-save-grid').click(); },
      path.join(downloadDir, 'microscopy_grid.png')
    );
    const gridOnlyMeta = inspectPngFile(gridOnlyDl.savePath);
    assert.equal(gridOnlyMeta.width, 241);
    assert.equal(gridOnlyMeta.height, 181);
    assert.equal(gridOnlyMeta.mode, 'RGBA');

    const mergedDl = await triggerAndAwaitDownload(
      electronApp,
      downloadDir,
      async () => { await labFrame.locator('#btn-save-merged').click(); },
      path.join(downloadDir, 'microscopy_merged.png')
    );
    const mergedMeta = inspectPngFile(mergedDl.savePath);
    assert.equal(mergedMeta.width, 241);
    assert.equal(mergedMeta.height, 181);

    // Select well B2 ('1,1') and download cropped well PNG
    await labPageFrame().evaluate(() => {
      window.dash_clientside.set_props('crop-well-dropdown', { value: '1,1' });
    });
    await page.waitForTimeout(250);
    const wellDl = await triggerAndAwaitDownload(
      electronApp,
      downloadDir,
      async () => { await labFrame.locator('#btn-crop-well').click(); },
      path.join(downloadDir, 'well_B2.png')
    );
    const wellMeta = inspectPngFile(wellDl.savePath);
    assert.equal(wellMeta.width, 80);
    assert.equal(wellMeta.height, 90);

    // 5e. Test Place Center Point button interaction + JSON Grid Settings Save & Reload round trip
    await labFrame.locator('#btn-place-center').click();
    await page.waitForTimeout(200);
    const placementPrompt = await labFrame.locator('#placement-status').innerText();
    assert.ok(placementPrompt.includes('Select a point'), 'Place Center Point button should enter placement mode');
    // Toggle off placement mode and set explicit center point + offsets for JSON save/reload
    await labFrame.locator('#btn-place-center').click();
    await labPageFrame().evaluate(() => {
      window.dash_clientside.set_props('center-point-store', { data: { x: 15, y: 25 } });
      window.dash_clientside.set_props('grid-spacing-slider', { value: 70 });
      window.dash_clientside.set_props('grid-y-spacing-slider', { value: 50 });
      window.dash_clientside.set_props('grid-x-offset-slider', { value: 5 });
      window.dash_clientside.set_props('grid-y-offset-slider', { value: -5 });
      window.dash_clientside.set_props('save-settings-filename', { value: 'lab_roundtrip.json' });
    });
    await page.waitForTimeout(300);

    const settingsDl = await triggerAndAwaitDownload(
      electronApp,
      downloadDir,
      async () => { await labFrame.locator('#btn-save-settings').click(); },
      path.join(downloadDir, 'lab_roundtrip.json')
    );
    const savedConfig = JSON.parse(fs.readFileSync(settingsDl.savePath, 'utf8'));
    assert.equal(savedConfig.grid_spacing, 70);
    assert.equal(savedConfig.grid_y_spacing, 50);
    assert.deepEqual(savedConfig.center_point, { x: 15, y: 25 });

    // Perturb sliders, then reload the saved JSON config via #upload-settings input[type="file"]
    await labPageFrame().evaluate(() => {
      window.dash_clientside.set_props('grid-spacing-slider', { value: 200 });
      window.dash_clientside.set_props('grid-y-spacing-slider', { value: 200 });
    });
    await page.waitForTimeout(200);
    await labFrame.locator('#upload-settings input[type="file"]').setInputFiles(settingsDl.savePath);
    await labPageFrame().waitForFunction(
      () => {
        const st = document.getElementById('status-text');
        return st && st.innerText.includes('Settings loaded successfully');
      },
      null,
      { timeout: 10000 }
    );
    const centerDisplayAfterLoad = await labFrame.locator('#center-point-display').innerText();
    assert.equal(centerDisplayAfterLoad.trim(), 'Center Point: (15, 25)');

    // 5f. Verify graceful handling of corrupt image upload in UI
    await labFrame.locator('#upload-image input[type="file"]').setInputFiles(path.join(fixtureDir, 'corrupt.png'));
    await labPageFrame().waitForFunction(
      () => {
        const st = document.getElementById('status-text');
        return st && st.innerText.includes('Could not read this image');
      },
      null,
      { timeout: 10000 }
    );

    recordCheck('Fluorescence Lab PNG/TIFF/JPEG uploads, X/Y spacing & center, channels, heatmap, 6 native exports, and settings round trip', {
      exports: {
        csv: csvDl.filename,
        imageOnly: imgOnlyMeta,
        gridOnly: gridOnlyMeta,
        merged: mergedMeta,
        croppedWell: wellMeta,
        settingsJson: savedConfig,
      },
    });

    // -------------------------------------------------------------------------
    // 6. Persistent Iframe State Verification Across View Navigation
    // -------------------------------------------------------------------------
    await page.locator('[data-nav="home"]').click();
    await page.locator('[data-nav="help"]').click();
    await page.locator('[data-nav="grid"]').click();
    const persistedGridChip = await gsPageFrame().evaluate(() => eval('S.chip.id'));
    assert.equal(persistedGridChip, 'V12', 'Grid Studio iframe state was lost across navigation');

    await page.locator('[data-nav="microscopy"]').click();
    const persistedCenterText = await labFrame.locator('#center-point-display').innerText();
    assert.equal(persistedCenterText.trim(), 'Center Point: (15, 25)', 'Fluorescence Lab iframe state was lost across navigation');
    recordCheck('Both tool iframes persist state across Dashboard / Grid Studio / Fluorescence Lab / Help navigation');

    // -------------------------------------------------------------------------
    // 7. Backend Failure Isolation & Retry Recovery via Test Instrumentation
    // -------------------------------------------------------------------------
    allowExpectedErrorWindow = true;
    const electronPid = electronApp.process().pid;
    let killedPid = null;
    try {
      if (process.platform === 'win32') {
        const out = execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${electronPid} AND Name='surveyapps-backend.exe'" | Select-Object -ExpandProperty ProcessId`],
          { encoding: 'utf8' }
        );
        const pids = out.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(Boolean);
        if (pids.length > 0) {
          killedPid = pids[0];
          process.kill(killedPid, 'SIGKILL');
        }
      } else {
        const out = execFileSync('pgrep', ['-P', String(electronPid)], { encoding: 'utf8' });
        const pids = out.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(Boolean);
        for (const pid of pids) {
          try {
            const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
            if (cmd.includes('surveyapps-backend') || cmd.includes('Python') || cmd.includes('python')) {
              process.kill(pid, 'SIGKILL');
              killedPid = pid;
              break;
            }
          } catch {}
        }
      }
    } catch {}

    assert.ok(killedPid, 'Backend process must be identified for the recovery test');
    if (killedPid) {
      await page.waitForFunction(
        () => document.getElementById('pill-text')?.innerText === 'Fluorescence Lab Error',
        null,
        { timeout: 15000 }
      );
      const errStatus = await page.evaluate(() => window.surveyapps.getStatus());
      assert.equal(errStatus.state, 'error');

      // Verify Grid Studio still works while backend is in error state
      await page.locator('[data-nav="grid"]').click();
      const gridStillWorks = await gsPageFrame().evaluate(() => Boolean(eval('S.img.el')));
      assert.equal(gridStillWorks, true, 'Grid Studio must remain operational when Python backend stops');

      // Retry backend via topbar retry button
      await page.locator('#topbar-retry-btn').click();
      await page.waitForFunction(
        () => document.getElementById('pill-text')?.innerText === 'All Tools Ready',
        null,
        { timeout: 60000 }
      );
      const recoveredStatus = await page.evaluate(() => window.surveyapps.getStatus());
      assert.equal(recoveredStatus.state, 'ready');
      // A healthy server can announce ready before the restarted Dash frame is loaded.
      await page.locator('[data-nav=microscopy]').click();
      await page.frameLocator('#frame-microscopy').locator('#btn-compute-fluor').waitFor({state:'visible',timeout:30000});
      await page.frameLocator('#frame-microscopy').locator('#image-graph .js-plotly-plot').waitFor({state:'visible',timeout:30000});
      recordCheck('Backend failure isolation (Grid Studio unaffected) and one-click Retry recovery', {
        killedBackendPid: killedPid,
      });
    }
    allowExpectedErrorWindow = false;

    // Assert zero unexpected errors or HTTP 500s across the entire run
    assert.equal(
      report.unexpectedPageErrors.length,
      0,
      `Unexpected page errors: ${JSON.stringify(report.unexpectedPageErrors)}`
    );
    assert.equal(
      report.unexpectedConsoleErrors.length,
      0,
      `Unexpected console errors: ${JSON.stringify(report.unexpectedConsoleErrors)}`
    );
    assert.equal(
      report.unexpectedHttp500s.length,
      0,
      `Unexpected HTTP 500 responses: ${JSON.stringify(report.unexpectedHttp500s)}`
    );
  } finally {
    tearingDown = true;
    await electronApp.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------
  // 8. Verify clean process shutdown (no orphan surveyapps-backend processes)
  // -------------------------------------------------------------------------
  await new Promise(r => setTimeout(r, 800));
  if (process.platform !== 'win32') {
    let remaining = '';
    try {
      remaining = execFileSync('pgrep', ['-fl', 'surveyapps-backend'], { encoding: 'utf8' }).trim();
    } catch {
      remaining = '';
    }
    assert.equal(remaining, '', `Orphan surveyapps-backend process still running after quit:\n${remaining}`);
    recordCheck('Clean backend process termination on application quit (zero orphan processes)');
  }

  // Re-check after teardown: late page/console failures must never produce a false PASS.
  assert.equal(report.unexpectedPageErrors.length,0,JSON.stringify(report.unexpectedPageErrors));
  assert.equal(report.unexpectedConsoleErrors.length,0,JSON.stringify(report.unexpectedConsoleErrors));
  assert.equal(report.unexpectedHttp500s.length,0,JSON.stringify(report.unexpectedHttp500s));
  const outFile = path.join(RESULTS_DIR, `desktop-${modeLabel}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`[SurveyApps E2E] ${modeLabel.toUpperCase()} SUITE PASSED (${report.checks.length} checks). Saved ${outFile}`);
})().catch(err => {
  console.error('[SurveyApps E2E] FAILED:', err);
  process.exitCode = 1;
});
