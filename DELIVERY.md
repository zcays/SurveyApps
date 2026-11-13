# SurveyApps! 1.0.0

Use the DMG for your Mac, drag **SurveyApps!** to Applications and open it. No Python, Node, browser or terminal setup is needed. Both tools work offline.

- **Apple silicon:** [DMG installer](dist/SurveyApps-1.0.0-mac-arm64.dmg) · [standalone ZIP](dist/SurveyApps-1.0.0-mac-arm64.zip) · [.app bundle](dist/mac-arm64/SurveyApps!.app)
- **Intel Mac:** [DMG installer](dist/SurveyApps-1.0.0-mac-x64.dmg) · [standalone ZIP](dist/SurveyApps-1.0.0-mac-x64.zip) · [.app bundle](dist/mac/SurveyApps!.app)
- **Source:** [complete source ZIP](dist/SurveyApps-1.0.0-source.zip) · [build/use instructions](README.md) · [SHA-256 checksums](dist/SHA256SUMS.txt)
- **Artwork:** [2048px PNG](assets/icon-2048.png) · [SVG master](assets/icon.svg) · [macOS ICNS](assets/icon.icns) · [Windows ICO](assets/icon.ico)
- **Evidence:** [validation record](docs/VALIDATION.md) · [source changes](docs/UPSTREAM_CHANGES.md)

Tested on macOS 27.0.1: ARM64 natively; x64 through Rosetta. Both installed DMGs passed the full eight-group desktop suite. Python tests: 8/8. Integrated Grid Studio: 100/100. The original source remains unchanged at its documented 98/100 baseline.

Bundles have valid ad-hoc integrity signatures, but no Developer ID signature or Apple notarization. Minimum configured macOS is 14.0; older supported OS versions and physical Intel hardware were not independently tested. If macOS blocks a downloaded app, use its normal Privacy & Security approval flow for a copy you trust.

**Windows EXE and portable ZIP:** Built by `.github/workflows/build-surveyapps.yml` and attached to [GitHub Releases](https://github.com/zcays/SurveyApps/releases) once the workflow completes.
