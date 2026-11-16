# Validation record

Browser integration uses two separate browser contexts, real HTTP email/password login, PostgreSQL, WebSocket signaling, and real RTCPeerConnection video/data transport. Only screen capture and native Mac commands are replaced with synthetic test doubles. Synthetic video is explicitly labeled in test screenshots and is not shipped as a demo workspace.

The service tests cover account/device ownership, login failure, logout revocation, rejection of the removed shell route, mandatory Mac approval, cross-account signaling rejection, hostile origins, and account deletion. Command tests check native input ranges and reject arbitrary shell execution, display selection from a peer, and unapproved launch targets.

Layout checks use 320×568, 390×844, 844×390, and 1280×900 viewports. Screenshots are written to `artifacts/`. See test output for the latest run; this document is not a substitute for a passing run.

The native Electron smoke test boots the actual Mac shell, verifies renderer isolation, logs into the real local account service from its `app://` origin, and confirms input is rejected without an approved session. It does not request real screen capture. The deployment-image smoke checks `/health`, built assets, account/device persistence across a container restart, and startup migrations against disposable PostgreSQL.

The compiled Swift helper was also queried directly with read-only `status`, `listApps`, and `getBounds` commands outside the filesystem sandbox. It returned nine running apps and detected a code editor. Its Accessibility and Screen Recording permissions were not granted. No input, app activation, or capture was attempted.

Physical iPhone/WKWebView playback, real macOS permissions and capture, input latency, signed native distribution, live Ongale routing, and TURN traversal have not been verified by these tests.

`npm audit` currently reports six moderate findings in the development-only electron-builder/minimatch dependency chain. No forced dependency downgrade or unsupported major override has been applied. Check `npm audit --omit=dev` separately for the deployed server dependency graph. Revisit the packaging dependency when upstream provides a compatible fix.
