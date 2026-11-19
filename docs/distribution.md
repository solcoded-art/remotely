# Native distribution

## Mac companion

Normal use requires opening the installed Mac Remote app and signing in; the account backend runs on Ongale. Users do not start Node, Docker, or a local account server. The packaged interface defaults to the production account server; developers can override it with `VITE_ACCOUNT_SERVER` or the advanced login setting. The Mac app must remain open to share its screen and receive approved input.

`npm run desktop:package` produces an Apple Silicon `.app` in `release/mac-arm64/`. `npm run desktop:dmg` produces a DMG. The Swift helper is compiled for the build machine's architecture; cross-architecture or universal builds are not configured.

Development builds are unsigned. For external distribution, configure a Developer ID Application identity for electron-builder and notarization through its supported environment variables or Keychain configuration. Keep all signing material outside this repository. Sign the embedded helper consistently with the app, then test both Accessibility and Screen Recording permissions on a clean Mac. The app closes remote access when its window closes; background tray hosting is not implemented.

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
