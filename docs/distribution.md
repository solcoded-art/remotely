# Native distribution

## Mac companion

Normal use requires opening the installed Mac Remote app and signing in; the account backend runs on Ongale. Users do not start Node, Docker, or a local account server. The packaged interface defaults to the production account server; developers can override it with `VITE_ACCOUNT_SERVER` or the advanced login setting. The Mac app must remain open to share its screen and receive approved input.

`npm run desktop:package` produces an Apple Silicon `.app` in `release/mac-arm64/`. `npm run desktop:dmg` produces a DMG. The Swift helper is compiled for the build machine's architecture; cross-architecture or universal builds are not configured.

Developer ZIP builds use ad-hoc resource integrity signatures, without a trusted Apple Developer ID or notarization. For external distribution, configure a Developer ID Application identity for electron-builder and notarization through its supported environment variables or Keychain configuration. Keep all signing material outside this repository. Sign the embedded helper consistently with the app, then test both Accessibility and Screen Recording permissions on a clean Mac. The app closes remote access when its window closes; background tray hosting is not implemented.

The input driver is bundled under Resources, runs without a shell, and receives only allowlisted commands. Capture permissions are requested when selecting a display. The local user approves each iPhone session. End a session before changing the display. A full display includes the currently visible frontmost apps; obscured windows and hidden browser tabs become visible when brought forward. The app list and editor launcher do that without storing code remotely.

## iPhone and iPad → TestFlight

The real native project is `ios/App/App.xcodeproj`, generated with Capacitor 8 and Swift Package Manager. It bundles the React interface in WKWebView. It is not a Safari installation shortcut. Portrait and landscape orientations are enabled; the local-network usage description explains the peer connection.

1. Install Xcode 26 or newer and select it as the developer directory. This machine currently has Command Line Tools only, so an iOS archive and simulator build have not been produced here.
2. Run `npm run ios:sync`, then `npm run ios:open`.
3. Choose your Apple Developer team and replace `com.macremote.ios` with an identifier owned by that team (also update `capacitor.config.ts`). Set the actual account server in the app's login form, or build with a public `VITE_ACCOUNT_SERVER` default.
4. Test on a physical iPhone, including a cellular connection, landscape, text entry, video playback, app activation, cancellation, and backgrounding. The first version deliberately ends a phone session when the app goes into the background; it does not claim background remote control.
5. Archive for a generic iOS device, upload through Xcode Organizer to App Store Connect, complete the beta metadata/privacy/export-compliance questions from the app's actual behavior, and invite TestFlight testers. External testing may require Apple's beta review.

No signing team, signing certificate, App Store Connect app, privacy policy URL, or TestFlight invitation has been configured. Do not call the app App Store ready until those steps and device tests are completed. Passwords are scrypt-hashed, session tokens are stored as hashes on the server, and WebRTC encrypts video/data transport; the signaling service still handles login credentials over HTTPS and connection metadata. Do not claim protection against a compromised signaling server without an independently verified peer-identity layer.

References: [Capacitor iOS requirements](https://capacitorjs.com/docs/ios), [Apple TestFlight](https://developer.apple.com/testflight/), [Electron screen capture](https://www.electronjs.org/docs/latest/api/desktop-capturer/).


## Public website onboarding and Mac downloads

The public login page and no-device state keep a short Mac-app requirement notice linking to `/docs/getting-started/`. The dedicated documentation page contains the installer download, requirements, setup steps, permissions, and troubleshooting without requiring an account. On phones, it offers a setup-page link to open on the Mac. Header Documentation links open the guide in a new tab so an existing account view is preserved. The guide is a separate Vite HTML entry with correctly resolved assets and a canonical trailing-slash URL, served by the production Node process.

`release.config.json` pins the exact public GitHub Release asset. `/api/downloads/mac` checks that the asset exists and is a binary download; `/download/mac` redirects only when it is available. Until then the UI displays an unavailable state and Retry rather than a broken download link. Release checks are coalesced and cached for up to one minute. This does not use Ongale Media, which does not sync installer ZIP files.

The independent `.github/workflows/mac-release.yml` runs only for a pushed `mac-v*` tag. It checks the package/manifest version, uses an ARM64 macOS runner, builds the Mac app and Swift helper for macOS 13+, packages the ZIP with SHA256SUMS, and publishes a clearly labeled developer prerelease without Apple Developer ID trust. It does not modify Ongale's managed deployment workflow. Publishing a new installer requires updating the package version and manifest together, committing, and explicitly pushing the matching tag; a normal main-branch push alone does not publish an installer.

`mac-v0.2.2` contained an invalid linker-only bundle signature and must be replaced. The corrected download is `mac-v0.2.3`; the site switches its versioned URL to that release and enables the download only after the asset is published. A signed consumer installer remains dependent on Apple signing/notarization setup.

Runner architecture reference: https://docs.github.com/en/actions/reference/runners/github-hosted-runners

## In-app update prompts (Mac companion)

The Mac app checks `/api/downloads/mac` on launch, every six hours, and when its window regains focus after 30 minutes. When the published `version` is newer than the running build and the download is `available`, it shows an **Update available** banner and one native macOS notification per version. **Download update** asks the main process to open `<account server>/download/mac`; the renderer cannot open any other URL (`desktop/updates.cjs`). **Later** hides that version until a newer one is published.

To ship an update, bump `version` and `url` in `release.config.json` and deploy the service; installed apps pick it up on their next check. Optionally set `"minimumSupportedVersion": "x.y.z"` to show older apps a blocking **Update required** dialog instead, for example after a protocol or security change. Leave it unset for ordinary releases.

This prompts users to download; it does not install updates. Silent download-and-relaunch updates (for example `electron-updater` with GitHub Releases) require a Developer ID–signed, notarized app, because macOS rejects updates for ad-hoc signed builds.

## Bundle signature regression and v0.2.3

Skipping electron-builder signing left linker-only ad-hoc signatures with no resource seals on Electron bundles. The published v0.2.2 failed `codesign --verify --deep --strict` with `code has no resources but signature indicates they must be present`. A successful local launch did not exercise the downloaded-app security boundary.

`desktop:package` now runs `scripts/seal-mac.cjs` after packaging. It seals existing ad-hoc code inside-out, following [Apple's nested signing guidance](https://developer.apple.com/library/archive/technotes/tn2206/_index.html). It refuses to replace Developer ID signatures and asserts that existing entitlements and runtime flags are unchanged, except for the linker-only signature marker. No new signing entitlements or runtime exemptions are introduced. The base Developer ID entitlement file is unchanged. This beta does not claim Hardened Runtime or Apple trust merely because a build configuration requests them.

The release verifies bundle/helper signatures, architecture and version, rejects a deliberately modified resource, and launches the packaged app without requesting permissions or performing native input. After ZIP creation, it extracts into a fresh temporary directory and repeats signature and launch checks. Developer ID signing, notarization and clean-Mac browser-download testing remain separate requirements. The legacy `signed: false` metadata indicates no Developer ID signature; `signature: "ad-hoc"` describes the integrity seal.

Replace the old 0.2.2 app with 0.2.3. Do not remove quarantine attributes or disable Gatekeeper for a damaged-app alert. macOS can still refuse the replacement because its publisher is unverified; [Apple documents an app-specific opening flow](https://support.apple.com/en-us/102445) when the source has been verified. Persistent damaged-app warnings require investigation, not a global security bypass.

## Trusted-device protocol release (0.3.0)

The 0.3.0 client/server protocol requires device keys and explicit QR/link pairing. Publish the new Mac ZIP before deploying the matching service; old clients are rejected with an upgrade message. The release target is configured but is not evidence that a public artifact has been published. See [trusted devices](trusted-devices.md) for coordination, key storage, Keychain prompts and recovery limits. Developer ID signing/notarization remain unavailable.
