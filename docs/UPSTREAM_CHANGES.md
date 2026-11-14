# Source preservation and integration changes

`vendor/provenance.json` records both pinned commits. `vendor/grid-studio/` is an exact, unpatched copy of Grid Studio at commit `e6ba1c4` (updated 2026-11-13: Auto-fit that works through tissue on every chip version, and a crop that keeps straight edges on a rotated image). `vendor/microscopy/` preserves the original scientific Python sources. No user photos, unrelated essay, machine configuration or git metadata are included.

The runtime copy `backend/microscopy_app.py` retains upstream algorithms and callbacks. Targeted changes:

- Replace startup network download with the upstream deterministic synthetic fallback, always offline.
- Local Dash assets, title and blue/cyan desktop CSS; explicit 8-bit RGB intensity interpretation.
- Bound Pillow input to 100 million pixels and HTTP uploads to 256 MiB; unreadable images produce a visible error.
- Clear image rotation cache on upload/crop/reset to avoid stale previews from Python object identity reuse.
- Make separate Y spacing and placed center consistent between the existing preview, fluorescence, well options/cropping, grid export and merged export. Previously these server callbacks used X spacing for both axes and some ignored the placed center.
- Clear stale fluorescence when source image, alignment or channel changes. Recompute to export current results.
- Reject non-finite/invalid settings and invalid well indices instead of running invalid geometry.

`backend/server.py` owns authentication, atomically allocated loopback port, local health check, parent pipe lifetime, payload limits and headers. The original debug Flask entry point is never used in the desktop package.

Scientific limits retained: images convert to RGB 8-bit; multi-page TIFF uses the first frame. Fluorophore labels map to RGB weights, not spectral unmixing or concentration. Edge partial wells are excluded. Well selector lists at most 1,000 wells. Grid Studio has its upstream 8192 px document and GPU/CPU limits; auto-fit depends on visible regular arrays and should be checked visually. Grid Studio has no full project save/load feature upstream; Lab grid settings JSON does not embed the image or measured matrix.

Neither repository snapshot contains a LICENSE. Confirm public redistribution rights before distributing outside the authorized local project. Dependencies retain their own licenses in the bundled runtimes and source lockfiles.

Grid Studio: SurveyApps used to carry one small patch to `autofit.js` (a start-spread guard for distortion-only fitting). Upstream now has its own safeguards for that case and its self-tests pass unmodified, so the patch was dropped and the vendored copy equals upstream.

Plotly compatibility: change deprecated heatmap axis `titlefont` to `title.font`. Plotly 7 otherwise raised a callback error after fluorescence computation.

The App B runtime diff is included as `vendor/app-b-surveyapps.patch`, with the original file retained alongside. App A needs no patch (see above). No original repo working-tree file is edited by SurveyApps build or test commands.
