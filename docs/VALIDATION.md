# SurveyApps! build and validation record

Date: 2026-11-13. Lead: Codex gpt-6-astra; implementation/testing delegates: Antigravity gemini-4-argon. No push, release publication or original-repository commit was performed.

## Source and platform scope

Original App A revision `212374d713c89a8ecd5a4fd3980c82cd55bd2c0c` plus all five user working-tree edits. Original App B revision `caf7312461360903f340f55e577d16b5f86c5ac2`. Hashes and exclusions in `vendor/provenance.json`. All five original files remained byte-for-byte unchanged. The separate SurveyApps runtime has documented corrections in `UPSTREAM_CHANGES.md`.

Native host: Apple silicon, macOS 27.0.1 (Darwin 27.0.0). Minimum configured macOS: 14.0, not separately tested on macOS 14/15. Electron 45.3.2, Node build tool 24.22.3, Playwright 1.65.0, Dash 4.5.0, Plotly 7.1.0, Pillow 13.0.0, NumPy 2.5.4, PyInstaller 6.22.3. ARM64 CPython 3.13.13; local Intel CPython 3.13.3. Dependency package versions are locked. CI pins Node 24.22.3 and Python 3.13.13.

## Test evidence

- **Original App A:** 98/100. Two pre-existing failures: distortion-only auto-fix accepted gross misalignment; the following mesh assertion then failed. There were zero page errors. The original user's optional real-photo check passed. The original files were preserved, not adjusted to force a green result.
- **Integrated App A:** 100/100, including GPU/software parity, chip geometry/calibration, crop/export and synthetic auto-fit/distortion tests. One optional real-photo test is recorded as skipped/passing because photos are excluded from the package. No user photos are shipped.
- **Python suite:** 8/8. Exact known-pixel outputs for all existing channel formulas; rectangular spacing and placed-origin consistency; well/grid/merged PNGs; row labels; JSON settings round-trip/validation; PNG/JPEG/TIFF and corrupt-image HTTP callbacks; heatmap schema; frozen service authentication and dynamic port; stdin shutdown and parent EOF cleanup.
- **Packaged desktop E2E:** eight test groups. Dashboard and 800×600/1440×960 layouts; both embedded tools; image upload; Grid Studio sample/calibration/rotation/scale/lens/warp/crop and PNG export; integrated tests.html; Lab channels/heatmap and six export types; configuration save/load; persistent navigation; backend crash/retry while Grid Studio stays available; zero leftover backend processes.
- **Startup failure:** missing bundled executable yields an actionable error and cleanup can be called repeatedly without failure (`backend-lifecycle.log`).
- **Native export validation:** test instrumentation replaces only the Save dialog destination, then waits for Electron's download-completed event and decodes/checks actual PNG/CSV/JSON files. Production uses normal native Save dialogs.
- **Distribution install test:** DMG checksum verified with `hdiutil verify`, mounted read-only, app copied to an unrelated `/tmp` installation location, DMG detached, full packaged suite executed against that copied app. The app is launched with PATH limited to system directories and Python/Node environment paths cleared. The test harness itself uses development tools to drive/assert the app; the app does not require them.
- **Signing:** `codesign --verify --deep --strict` passes for ad-hoc-sealed local bundles. No Developer ID identity, Apple notarization or stapling was performed. Gatekeeper approval on a fresh downloaded/quarantined machine remains untested.

Machine-readable results and raw logs are in `test-results/` (local evidence, git-ignored). `desktop-dmg-arm64-final.json` is the native installed-DMG run; `desktop-dmg-x64-rosetta.json` records the installed Intel DMG run under Rosetta (8/8 groups, zero unexpected errors after quit). Both binaries and frozen backend architectures were checked with `file`. Source archive includes the selected final evidence.

## Limits and unbuilt targets

Windows installer EXE and portable ZIP have **not been built or tested**. A macOS Python freeze cannot supply a Windows Python runtime. The manual-only Windows x64 GitHub Actions job builds its own frozen Python backend, produces NSIS EXE and ZIP, then runs tests. It has not been triggered. Intel macOS app, DMG and ZIP were built; full installed-DMG tests passed through Rosetta, not on a physical Intel Mac. Linux and universal macOS binaries are outside this delivery.

The app's upstream scientific limits remain: RGB 8-bit conversion, first TIFF frame, partial edge wells excluded, no spectral unmixing/concentration calibration, capped well dropdown, Grid Studio 8192 px document limit, and auto-fit requiring visible regular arrays. Lab configuration JSON does not embed source images or measurements. Grid Studio has no upstream full-project persistence.

`npm audit` reports six moderate transitive **build-tool-only** minimatch advisories; production npm dependencies are empty and those packages are not shipped as application JS. No forced downgrade/major-version override was applied. Maintain Electron/Python/dependencies with regression tests before future distribution.

## Reproduce

```sh
python -m pip install -r requirements-build.txt
npm ci
python scripts/build_backend.py
python -m unittest discover -s tests -p 'test_*.py' -v
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac
node tests/desktop.cjs --packaged
```

Use `SURVEYAPPS_TEST_EXECUTABLE` to test an installed binary and `SURVEYAPPS_TEST_LABEL` to keep a separate JSON report. For native Windows CI use `npm run build:win`. Packaging always uses `--publish never`. Signing, notarization and public redistribution require a separate explicit release step and rights review.

## Documentation corrections

The testing delegate's narrative summary used wrong environment versions, nonexistent API names and incorrect baseline causes. The lead replaced that prose with facts from the actual test code, JSON outputs and independent reruns. No nonexistent two-point calibration, custom fluorophore weighting UI or HTTP shutdown endpoint is claimed here.

The E2E harness now checks error arrays again after teardown. Connection resets/empty responses caused specifically by intentional quit are classified as expected; other late errors still fail. It also waits for the restarted Dash workspace to render before ending the recovery test. This prevents a premature PASS while asynchronous teardown events are still arriving.

## Final artifacts

- `SurveyApps-1.0.0-mac-arm64.dmg` — Apple silicon installer; 168,767,186 bytes.
- `SurveyApps-1.0.0-mac-arm64.zip` — standalone Apple silicon app archive; 165,667,211 bytes.
- `SurveyApps-1.0.0-mac-x64.dmg` — Intel installer; 178,002,946 bytes.
- `SurveyApps-1.0.0-mac-x64.zip` — standalone Intel app archive; 174,856,272 bytes.
- `SurveyApps-1.0.0-source.zip` — source, assets, locks, workflow and selected validation evidence; no development runtimes, photos or machine folders.

SHA-256 values are in `dist/SHA256SUMS.txt`. The unpacked `.app` bundles are in `dist/mac-arm64/` and `dist/mac/`. Installer copying was tested outside the workspace with no Node/Python on the app PATH. ZIP contents were verified against the same built bundles; a separate ZIP drag-install flow was not exercised.

The Intel JSON report’s top-level `arch` describes the ARM64 test driver; the executed app and its Python backend are x86_64 Mach-O files (see `test-results/architectures.txt`). Subsequent harness runs also record Electron runtime architecture separately. CI accepts a successful upstream self-test title/count when a host lacks WebGL and explicitly records skipped checks rather than requiring the native GPU count.
