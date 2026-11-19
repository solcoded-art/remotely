# Milestone 1 validation evidence

Date: 2026-11-19. Local working tree; not committed/deployed. Prior onboarding, download and release work was preserved. No production data or account credentials were used.

| Check | Result and scope |
| --- | --- |
| `npm run build` | Passed TypeScript and both Vite entry points. Bundles the verified 42.59 kB Satoshi WOFF2. |
| `npm test` | 9 passed against disposable PostgreSQL: account/device ownership, consent gates, stranger signaling, origin checks, revocation/deletion, bounded commands, download safety, startup diagnostics. |
| `npm run test:ui` | 9 passed: Chrome browser and native Electron shell; includes axe checks on login/advanced settings/errors/Mac setup/settings dialog/approval/Apps/Keys/Mouse. No violations in the selected A/AA rule tags at tested states. |
| Two-peer browser test | Real local WebRTC with synthetic canvas capture and mocked native helper. Checks approval, video playback, pause/restart control locking, app switching/editor launch, text, named keys, pointer/scroll buttons, drag release and disconnect focus. |
| Responsive checks | Login and active session at 320×568, 390×844, 844×390 and 1280×900; documentation at phone/landscape sizes; 320-pixel login with 200% root text and WCAG text-spacing overrides. No horizontal page overflow in these checks. |
| `npm run test:image` | Passed clean Docker font download/integrity check, actual browser render of built assets/font/documentation, docs redirect, same-origin API, startup migrations and account/device persistence after container restart. |
| `npm run ios:sync` | Passed build and Capacitor asset/plugin sync. Does not compile, sign or install the iOS app. |
| npm advisory baseline | Full audit: 6 moderate affected-package entries in Electron packaging; no High/Critical entries. Production-only audit: 0 advisory entries. This is not Snyk or a complete assessment of native binaries. |
| Source and repository hygiene | `git diff --check` passed; quality workflow YAML parses; pinned skill revisions/hashes verified; font binary ignored; Ongale-managed deploy workflow unchanged. |

## Review artifacts

Screenshots generated locally in ignored `artifacts/`: `login-320.png`, `login-390.png`, `login-844.png`, `login-1280.png`, `setup-milestone-mac.png`, `session-320.png`, `session-390.png`, `session-844.png`, `session-1280.png`, `production-build.png`, `production-docs.png` and `desktop-companion.png`.

## Unverified or outstanding

- Manual VoiceOver, voice/switch control, real browser zoom, native dynamic text and complete WCAG criterion coverage.
- Semantic screen-reader access to streamed remote applications and detection/recovery for all forms of frozen or degraded video.
- Physical iPhone, actual macOS permission grants/revocation and real native pointer/keyboard effects. The shell test does not grant permissions or control the user's desktop.
- Carrier/NAT/TURN fallback, server/proxy load behavior, operational logging/alerts, restore/rollback and deployment configuration.
- Strix exploit testing, authenticated Snyk SAST/SCA and remediation validation; no such scan was performed.
- Apple signing/notarization/TestFlight and independent security/accessibility review.
- Execution of the new quality workflow on GitHub. Local success is not CI or production proof.

The baseline lists proposed owners and release gates. No claim of full security, WCAG conformance or legal ADA compliance is made.
