# SurveyApps! 1.0.1

Download the installer for macOS or Windows from [GitHub Releases (`v1.0.1`)](https://github.com/zcays/SurveyApps/releases/tag/v1.0.1) (or build from source locally). No Python, Node, browser, or terminal setup is needed. Both tools work completely offline.

- **macOS (Apple silicon):** `SurveyApps-1.0.1-mac-arm64.dmg` · `SurveyApps-1.0.1-mac-arm64.zip`
- **macOS (Intel x64):** `SurveyApps-1.0.1-mac-x64.dmg` · `SurveyApps-1.0.1-mac-x64.zip`
- **Windows (64-bit x64):** `SurveyApps-1.0.1-win-x64.exe` (NSIS installer) · `SurveyApps-1.0.1-win-x64.zip` (portable archive)
- **Source & Checksums:** `SurveyApps-1.0.1-source.zip` · [build/use instructions](README.md) · [install guide](INSTALL.md) · `SHA256SUMS.txt`
- **Artwork:** [2048px PNG](assets/icon-2048.png) · [SVG master](assets/icon.svg) · [macOS ICNS](assets/icon.icns) · [Windows ICO](assets/icon.ico)
- **Evidence:** [validation record](docs/VALIDATION.md) · [source changes](docs/UPSTREAM_CHANGES.md)

Verified across all three platforms in GitHub Actions run [`43512412391`](https://github.com/zcays/SurveyApps/actions/runs/43512412391) (`macos-15` arm64, `macos-15-intel` x64, `windows-2025` x64) as well as local installed-DMG testing on macOS 27.0.1 (ARM64 natively; x64 under Rosetta). Python unit/service tests: 8/8 on all three platforms. Packaged E2E suite (`tests/desktop.cjs --packaged`): 8/8 checks on macOS ARM64 & Intel (`100/100` Grid Studio self-tests on ARM64; `94/94` software-fallback on headless Intel CI) and 7/7 checks on Windows x64 (`100/100` Grid Studio self-tests; Unix `pgrep` check skipped on Windows).

macOS bundles carry valid ad-hoc integrity signatures (`codesign --verify --deep --strict`), and Windows binaries are unsigned (no Developer ID/Apple notarization or Windows Authenticode certificate). Minimum configured macOS is 14.0; older macOS versions and interactive NSIS/SmartScreen GUI flows on physical Windows hardware were not separately exercised outside CI. See [INSTALL.md](INSTALL.md) for unsigned-app first-launch approval steps after verifying `SHA256SUMS.txt`.

**1.0.1 (2026-11-14):** bundles Grid Studio `e6ba1c4` — Auto-fit works through tissue on every chip version, and a crop drawn on a rotated image keeps straight edges. The 1.0.1 installers were built and tested on all three platforms by the GitHub Actions run linked in the [v1.0.1 release notes](https://github.com/zcays/SurveyApps/releases/tag/v1.0.1); the run number in the paragraph above refers to the 1.0.0 build.
