# SurveyApps! desktop architecture

Electron hosts an isolated local dashboard and both scientific tools. Grid Studio is a working-tree snapshot at the pinned revision, including all five pre-existing user edits. Microscopy retains Dash/Plotly/Pillow/NumPy scientific algorithms. A PyInstaller standalone backend serves Dash on an OS-assigned loopback port, authenticated per launch. Electron owns startup, health, errors, resource paths and cleanup. No development runtimes required by downloads.

## Alternatives evaluated
| Option | Compatibility/offline/runtime | Reliability/security/maintenance | Size |
|---|---|---|---|
| Electron + frozen Python (selected) | Bundled Chromium supports existing WebGL/canvas and Dash consistently; bundled Python; fully offline | Single managed backend; isolated renderers, no renderer Node, restricted navigation; upstream dependency updates required | Largest, includes Chromium and Python |
| Tauri + frozen Python | Same Python bundle needed; system WebKit/WebView2 differences must be qualified | Rust + Python + JS maintenance; Windows WebView2 offline provisioning adds a prerequisite/bundle | Smaller shell; Python dominates remaining size |
| Python + Qt WebEngine | Bundles browser and Python but adds Qt packaging/licensing surface | More native wheel and GUI integration complexity; similar isolation needed | Often comparable to Electron |
| pywebview / browser launcher | OS-specific browser behavior; browser launcher is not a unified desktop app | Extra runtime provisioning and inconsistent WebGL behavior | Smallest shell, weaker reproducibility |

## Ownership
Lead Astra: desktop/, backend/, package.json, build configuration, assets/, scripts/, docs/, integration and final packaging.
Argon frontend delegate: renderer/ only, consumes the bridge contract below. Do not edit vendors or original repository.

## Renderer bridge contract
window.surveyapps.getStatus() -> Promise<{state: 'starting'|'ready'|'error', message: string, microscopyUrl?: string, gridUrl: string, version: string}>
window.surveyapps.onStatus(callback) -> unsubscribe function
window.surveyapps.retryBackend() -> Promise<void>
Dashboard files are loaded from renderer/index.html. Logo path ../assets/icon.svg. Grid Studio URL supplied by bridge; load lazily in persistent iframe. Microscopy URL supplied only after authenticated local backend is ready; retain iframe when navigating. No external URLs, fonts or CDN. Renderer has no Node access.

## Implemented lifecycle and security
The `surveyapps://app` protocol serves only packaged renderer/assets/Grid Studio files. The dashboard preload exposes status/retry/subscription only, verifies main-frame IPC senders, and never grants renderer Node access. Electron allows network requests only to its current authenticated backend origin. Python receives a random credential over stdin, binds loopback port zero atomically, prints readiness only after binding, verifies the Host, header and Origin, and stops when stdin closes. User-facing startup errors leave Grid Studio available.

One window and one backend preserve the original Python module's session-global image/cache semantics. Server callbacks are serialized. Both tools use persistent iframe elements, so changing navigation does not unload their state. All required Dash/Plotly assets are bundled locally.

Official references checked during implementation: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [PyInstaller packaging](https://pyinstaller.org/en/stable/usage.html), [GitHub native runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Distribution bundles are ad-hoc sealed, not Developer ID signed/notarized. Native Windows and Intel CI freeze Python on their corresponding OS/architecture.
