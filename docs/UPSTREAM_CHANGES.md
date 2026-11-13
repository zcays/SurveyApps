# Source preservation and integration changes

`vendor/provenance.json` records both pinned commits and SHA-256 of all five original dirty App A files. `vendor/grid-studio/` is the tracked working-tree snapshot, including these edits. `vendor/microscopy/` preserves the original scientific Python sources. No user photos, unrelated essay, machine configuration or git metadata are included.

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

Grid Studio runtime snapshot correction: distortion-only fitting now rejects an absolute phase residual 90th–10th percentile spread over 1.5 lattice periods before fitting flexible corners. The original dirty implementation could absorb a gross rotation error into the warp and report success; its refusal test and following mesh test failed. This small guard, stored with the other `AF` thresholds, restores 100/100 vendored tests without changing rendering math or the original five dirty files. The optional user-photo test is excluded from the package.

Plotly compatibility: change deprecated heatmap axis `titlefont` to `title.font`. Plotly 7 otherwise raised a callback error after fluorescence computation.

Reconstruction patches are included in `vendor/app-a-user-changes.patch`,
`vendor/app-a-surveyapps.patch` and `vendor/app-b-surveyapps.patch`.
Apply the user patch to pinned App A, then the small SurveyApps patch; App B's
original file is retained alongside its complete runtime diff. No original repo
working-tree file is edited by SurveyApps build or test commands.
