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

## Trusted-device milestone / 0.3.0

Date: 2026-11-19. Evidence collected locally before commit, publication and deployment; release status is checked separately. This section supersedes the account-only protocol observations above; it does not close the outstanding manual, platform or independent-review gates.

| Check | Result and scope |
| --- | --- |
| `npm test` | 17 passed against disposable PostgreSQL. Includes immutable key enrollment, nonce reuse/account binding, stolen-token-only socket rejection, signed-message replay, local-pair requirements, endpoint-only revocation/session teardown, stale invitation rejection, modified/cross-session SDP signatures, fresh client-nonce binding, vault corruption/unavailability, and trust/revocation persistence across service restart. |
| `npm run test:ui` | 11 passed. Includes real local WebRTC with synthetic capture/mocked input, QR/link pairing and separate Mac consent, decline/retry, browser key/pin persistence, rejection of wrong invitation secrets, forged phone requests and altered Mac certificates, active-session revocation, legacy-server upgrade guidance, selected axe rules and responsive states. |
| Actual packaged Mac authentication | Passed `MAC_APP_EXECUTABLE` override of `tests/ui/desktop.spec.ts` against a disposable service. The built app signed in, enrolled its OS-protected device key, showed setup, preserved renderer isolation, and rejected unapproved native input. No screen/input permissions were granted. |
| `npm run desktop:package` and strict tamper check | Passed 0.3.0 app/helper resource verification. Modified resources are rejected. Existing runtime flags/entitlements were preserved. This is ad-hoc integrity, not Developer ID trust or notarization. |
| Local ZIP/extraction | Created ignored `release/MacRemote-0.3.0-mac-arm64.zip` and `release/SHA256SUMS`. Extracted a fresh copy, repeated strict signature/helper verification and packaged launch smoke; passed before public publication. |
| `npm run test:image` | Passed final Docker build, built UI/font/documentation rendering, automatic migration, signed device enrollment, and account/device persistence across container restart. No production database was used. |
| `npm run ios:sync` | Passed TypeScript/Vite build and Capacitor sync. No iOS compilation, native secure-key plugin, physical-device install or TestFlight validation. |
| npm advisories | Production-only audit: zero entries. Final clean Docker install reports six moderate build dependency entries; no high/critical entries reported. No Snyk/Strix scan was performed. |
| Source hygiene | `git diff --check` passed. Ongale-managed deploy workflow unchanged. No credentials, runtime key files, QR secrets or generated artifacts are staged for Git. |

Protocol, key-storage boundaries, account MFA/recovery gaps and coordinated release order are documented in [trusted devices](../trusted-devices.md). Native keys use encrypted software storage; the current phone website and iOS wrapper use non-extractable browser CryptoKeys, not Secure Enclave keys. Native capture/input, VoiceOver, carrier/TURN and clean-download Gatekeeper testing remain outside this evidence.

For packaged authentication testing after building, set `MAC_APP_EXECUTABLE` to the app's `Contents/MacOS/Mac Remote` executable and invoke the existing PostgreSQL test runner with Playwright's `tests/ui/desktop.spec.ts`. This uses disposable accounts/databases and never requires production credentials.
