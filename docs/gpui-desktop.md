# Mac Remote on GPUI — plan

Status: **milestones 1–4 built** in `desktop-gpui/`: sign-in, device key,
signaling, pairing, approval, screen sharing over WebRTC, remote input,
remembered approval, Electron data import, update prompt and release packaging.
Decision: the GPUI app **replaces the Electron app** (same name, bundle ID and
download channel) from version 0.4.0. The Electron app
(`desktop/`), the web app (`src/`), and the signaling service (`signaling/`) are
unchanged. Nothing here changes the wire protocol.

## Goal

A native macOS companion built with [GPUI](https://gpui.rs/) that behaves like the
Electron app: same sign-in, same per-device key and signed transcripts
(`shared/trust.mjs`), same pairing/approval flow and data-channel command set
(`shared/commands.cjs`), so already-deployed phones and `https://enftify.com` keep
working with it.

## What the Electron app does today (what must be reproduced)

| Electron piece | Responsibility | GPUI equivalent |
| --- | --- | --- |
| `desktop/auth-session.cjs` | Login `{token, expires}` per server, OS-encrypted | Keychain generic password (`security-framework`) |
| `desktop/identity.cjs` | P-256 device key + trusted-phone pins, OS-encrypted, never exposed | Keychain item; `p256` crate for ECDSA (IEEE P1363 / raw r‖s, base64url) |
| `desktop/main.cjs` + `display-capture.cjs` | Capture only the selected display, only while a session is approved | ScreenCaptureKit stream started only after Allow connection |
| `desktop/main.cjs` + `shared/commands.cjs` | Validate every data-channel command, write JSON lines to the Swift driver | Rust port of `validateCommand`, same driver subprocess |
| `driver/mac_driver.swift` | CGEvent input, app list, icons, display bounds | **Reused unchanged** as a subprocess (`bin/mac_driver`) |
| `src/lib/connection.ts` | `/api/health`, device enrollment, `/ws` hello + signed envelopes, pairing, approvals, WebRTC offer, data channel limits (32768 chars, 250/s) | Rust `Connection` state machine on GPUI's executor |
| `src/lib/remember.ts` (Mac half) | Verify phone passkey (WebAuthn ES256) for remembered approval ≤ 3 days | Rust port: `p256` + `sha2`, same checks |
| `src/components/*` | Sign-in, pairing QR, approval card, setup checklist, display picker | GPUI views |

The server already accepts native clients that send no `Origin` header
(`allowsOrigin` returns true for a missing origin), for both HTTP and `/ws`.

## Crate choices

| Concern | Choice | Notes |
| --- | --- | --- |
| UI | `gpui` (crates.io, `runtime_shaders` feature) | `runtime_shaders` avoids needing full Xcode's `metal` compiler; Command Line Tools are enough. Text input is hand-written on `EntityInputHandler` (no component library) to keep the dependency surface small. |
| HTTP | `ureq` 3 (rustls) on GPUI's background executor | Blocking client, no Tokio runtime needed for the account API. |
| WebSocket signaling | `tungstenite` (rustls, `ring` provider) on a dedicated thread, `async-channel` back to the UI | Same `/ws` messages: `challenge` → `hello` → signed `{data, seq, signature}` envelopes. |
| Keychain | `security-framework` generic passwords | Login: service `app.enftify.macremote.gpui.session`, account = storage service origin. Device key + pins: service `app.enftify.macremote.gpui.device-key`, account = SHA-256 hex of the JS scope `JSON.stringify([storageService, userId])`. |
| Device key / signatures | `p256` (ECDSA, SHA-256), `sha2`, `hmac`, `base64` (URL_SAFE_NO_PAD) | Key id = `d_` + base64url(SHA-256 of canonical JWK JSON `{"crv","kty","x","y"}` in that order). Transcripts are `JSON.stringify([...])` — must match JS serialisation byte-for-byte (tests against `shared/trust.mjs` vectors). |
| WebRTC | `webrtc` 0.21 (webrtc-rs) | Pure Rust, on its own Tokio runtime. mDNS `QueryOnly` so Safari/Chrome `.local` host candidates resolve. Offerer with one video track + ordered data channel `mac-remote`. Alternative if interop/encoding is poor: `libwebrtc` bindings (LiveKit's `libwebrtc` crate) — heavier, but the same stack Safari peers are tested against. |
| Screen capture | GPUI's own ScreenCaptureKit wrapper (`cx.screen_capture_sources()`, as Zed uses for screen sharing) | One display, paced to ≤30 fps, scaled to ≤1920×1080, no audio, started only after Allow connection; dropping the stream stops capture. |
| Video encoding | VideoToolbox (hand-written FFI in `encoder.rs`) → `webrtc` `TrackLocalStaticSample` | Hardware H.264 Baseline, no B-frames, real-time, keyframe at least every 2 s and on connect. A VideoToolbox pixel-transfer session scales BGRA→YUV on the GPU. Apple's encoder avoids bundling a software H.264 encoder and its patent questions. |
| Input | Existing `driver/mac_driver.swift` as a child process | Same JSON-lines protocol and `releaseAll` on end/exit. Commands pass through a Rust port of `validateCommand` first. |
| QR code | `qrcode` crate → GPUI image | Pairing link format unchanged: `<service>/#pair=<base64url JSON>`. |

### Storage keys

`shared/account-service.mjs`: production (`https://enftify.com`) and the legacy Ongale
origin share the storage key `https://remotely-marisol-workspace-k1zb.ongale.dev`.
The GPUI app uses the same `storageService()` mapping for Keychain accounts, and
the same `canonicalService()` for requests.

The GPUI app **imports Electron's data once** (`electron.rs`): device key, paired
phones and sign-in, decrypted from Electron's `safeStorage` files (Chromium "v10":
PBKDF2-SHA1 of the "Mac Remote Safe Storage" Keychain password, AES-128-CBC). It
uses the same file names (SHA-256 of the same scopes), so phones keep their pairing.
An Electron key that exists but cannot be read stops with an error instead of
creating a new key.

## Milestones

1. **Skeleton (done)** — `desktop-gpui/` builds with `cargo build` on Apple
   Silicon; GPUI window; email magic-link + paste-link sign-in against
   `https://enftify.com` (advanced: custom HTTPS server); session saved in and
   restored from the Keychain; signed-in view lists account devices from
   `GET /api/devices`; sign-out calls `POST /api/auth/logout` and removes the item.
2. **Identity and signaling (done)** — Keychain device key; `/api/device-challenge` +
   `POST /api/devices` enrollment as `kind: "desktop"`; `/ws` hello and signed
   envelopes; live `devices` updates; pairing (invite, QR, approve/decline, revoke)
   with pins in the Keychain. Byte-exact transcript tests against `shared/trust.mjs`.
3. **Approval + capture + WebRTC (done)** — approval card, display picker, permission
   checklist (Screen Recording, Accessibility, driver), ScreenCaptureKit →
   VideoToolbox H.264 → webrtc-rs; signed SDP/ICE; `/api/ice` TURN credentials;
   data channel limits; driver bridge with `validateCommand` port.
4. **Remembered approval, updates, packaging (done)** — Mac half of `remember.ts` (passkey verify, single-use
   unlocks, ≤ 3 days, forget/forget-all on sign-out), update prompt, packaging
   (`.app` bundle, ad-hoc seal, entitlements, driver in `Contents/Resources`).

Optional: Electron device-key import so existing pairings carry over.

## Risks

- **WebRTC interop with Safari on iPhone.** webrtc-rs is less exercised against
  Safari than libwebrtc: H.264 profile-level-id/packetization-mode negotiation,
  DTLS role, data-channel SCTP parameters, and trickle ICE ordering all need
  testing on a real iPhone, across NAT and via TURN. Fallback is LiveKit's
  `libwebrtc` bindings.
- **Video encoding.** webrtc-rs only packetizes; we own capture → encode →
  pacing, keyframe on PLI/FIR, bitrate adaptation from RTCP. Electron/Chromium
  gives all of this for free today. This is the largest piece of new work.
- **GPUI maturity on macOS.** The crates.io `gpui` is pre-1.0 with breaking
  changes between releases and little documentation; there is no built-in text
  field, select, or dialog. Accessibility (VoiceOver) support is limited compared
  to the Electron/React UI, which is a regression for the approval prompt.
- **Toolchain.** Without full Xcode, GPUI must use `runtime_shaders`. Release
  builds should be checked with full Xcode too.
- **Permissions identity.** Screen Recording/Accessibility grants are per code
  signature; an unsigned/ad-hoc GPUI binary is a different app from Electron's
  Mac Remote and needs its own grants. The driver subprocess inherits the
  responsible app's grants only when launched from the bundle.
- **Byte-exact transcripts.** Any difference from `JSON.stringify` (escaping,
  number formatting, key order) breaks signatures. Must be covered by tests.
- **Security boundary.** As in Electron: capture starts only after Allow
  connection and stops on end; the hosted server never executes input or
  capture; the driver receives only validated commands from an approved session.

## Out of scope for milestone 1

Device enrollment, WebSocket signaling, pairing, approvals, capture, WebRTC,
input, update prompts, packaging/signing.

## Running the skeleton

```bash
cd desktop-gpui && cargo run
```

Builds with Command Line Tools only (no full Xcode) thanks to `runtime_shaders`.
`cargo test` covers server-URL validation, the production/legacy storage-key
mapping, and sign-in-link parsing. The login is stored as Keychain generic password
`app.enftify.macremote.gpui.session` (account = storage service origin); the
chosen server origin, which is not a credential, is in
`~/Library/Application Support/Mac Remote GPUI/server`. Because dev builds are
unsigned, macOS may ask to allow Keychain access again after each rebuild.

## Milestone 2 status

Built in `desktop-gpui/src/`: `trust.rs` (port of `shared/trust.mjs`),
`identity.rs` (Keychain device key and pins, fails closed on corruption),
`signaling.rs` (`/ws` transport thread), `connection.rs` (enrollment as
`kind: "desktop"`, challenge/hello, signed sequenced envelopes, live device list,
reconnect after 2 s except on close codes 4000/4001, pairing invite/approve/decline,
revoke, and incoming `revoked`), `qr.rs` (pairing QR), and the pairing UI in `app.rs`.

Connection requests from paired phones are verified (pin, grant, request
signature) and then **declined** with `failure: "setup"`, so the phone shows
“Mac setup failed” immediately instead of waiting for the 60 s timeout. The Mac
app explains why. Screen sharing comes in milestone 3.

The GPUI app has its own device key, so it appears as a second Mac next to the
Electron app if both are installed, and phones must pair with it separately.

### Tests

- `cargo test` (in `desktop-gpui/`): URL/link rules, plus byte-for-byte transcript,
  key-id, signature and HMAC-proof checks against
  `tests/fixtures/trust-vectors.json`. Regenerate it from the JS reference with
  `node desktop-gpui/tests/trust-vectors.mjs`. One Rust signature in the tests was
  also checked with WebCrypto `verify()`.
- End-to-end (opens the app window; needs Docker):

  ```bash
  (cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)
  ```

  ```bash
  node scripts/test-with-postgres.cjs node desktop-gpui/tests/e2e-pairing.mjs
  ```

  It runs the real signaling service against disposable PostgreSQL, a simulated
  iPhone that uses `shared/trust.mjs` like `src/lib/connection.ts`, and the real
  GPUI app driven through the test-only `e2e` feature (stdin commands instead of
  button clicks). It covers enrollment, the socket handshake, online status,
  invite → proof → approval → grant verification, a forged proof being declined,
  a connection request being declined, key/pin persistence across restart, and
  revocation. The `e2e` feature is off by default and only accepts a loopback server.
  It is not a physical-iPhone test.

## Milestone 3 status

Built in `desktop-gpui/src/`:

- `commands.rs`: port of `validateCommand`, checked against
  `tests/fixtures/command-vectors.json` (from `tests/command-vectors.mjs`, run on
  `shared/commands.cjs`). It counts string lengths in UTF-16 units, as JavaScript does.
- `driver.rs`: `bin/mac_driver` as a child process (JSON lines), with a bounded write
  queue, `releaseAll` whenever a session ends, and stdin closed on exit. Found via
  `MAC_REMOTE_DRIVER`, `Contents/Resources/mac_driver`, or the repository's `bin/`.
- `platform.rs`: Accessibility (`AXIsProcessTrustedWithOptions`) and Screen
  Recording (`CGPreflightScreenCaptureAccess`/`CGRequestScreenCaptureAccess`).
- `encoder.rs`: VideoToolbox H.264 (see the crate table).
- `peer.rs`: webrtc-rs offerer with one H.264 track and the ordered `mac-remote`
  channel. It trickles ICE with the bundled m-line's real `mid`, drops outgoing
  messages when more than 64 KiB is buffered, and fetches `/api/ice` per connection.
- `connection/session.rs`: setup checklist, approval prompt (Allow connection /
  Decline), `session-approval` signing, capture start only after Allow, signed and
  sequenced SDP/ICE in both directions, the 25 s negotiation timeout, data-channel
  limits (32768 chars, 250/s), commands → `validate_command` → driver, driver
  replies → phone, End session, and keeping a live peer across a signaling reconnect.

Not built yet: remembered approval (phones are asked every time; `remember-key`
messages are ignored), the Mac-side preview of the shared screen, display
thumbnails, route/latency stats, keyframes on RTCP PLI/FIR (the encoder sends one
on connect, after dropped frames, and at least every 2 s), the update prompt, and
`.app` packaging.

### Permissions when running from a terminal

macOS attributes Screen Recording and Accessibility to the app that launched the
process. Under `cargo run` that is your terminal app, so grant both to the terminal,
or wait for the packaged `.app` (milestone 4).

### Session end-to-end test

```bash
npm run build && npm run build:driver
```

```bash
(cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)
```

```bash
node scripts/test-with-postgres.cjs node desktop-gpui/tests/e2e-session.mjs
```

This runs the real phone web app (`dist/`, served by the signaling service) in
headless Chrome against the GPUI app. It covers sign-in, pairing through the phone
UI, declining, allowing, a WebRTC session whose VideoToolbox H.264 the browser
decodes at 1280×800 with the frame count rising, the app list returning through
data channel → validator → real driver → phone, and End session. The e2e build
streams a synthetic test pattern and skips the permission checks, because automated
runs cannot grant Screen Recording. It is **not** a Safari, physical-iPhone or real
screen-capture test.

## Testing on a real iPhone (first result)

Build a signed development bundle (it puts `bin/mac_driver` in Resources):

```bash
desktop-gpui/scripts/bundle-dev.sh
```

```bash
open "desktop-gpui/target/Mac Remote GPUI.app"
```

- Logs: `~/Library/Logs/Mac Remote GPUI/session.log` (session steps, ICE states,
  candidate kinds, never tokens, keys or addresses). The e2e tests append there too.
- Signing: the script signs with a local self-signed "Mac Remote GPUI Dev"
  certificate when it is in the login keychain, so Screen Recording and
  Accessibility grants survive rebuilds. Without a Team ID the login keychain
  still ties item access to the exact build, so each rebuild asks once to allow
  the single Keychain item (`app.enftify.macremote.gpui`, see `vault.rs`). An
  Apple Development or Developer ID certificate removes that prompt.
- Pairing and connection requests show a toast over the window and bounce the
  Dock icon.

First real-device result (Safari on iPhone, same Wi-Fi): the connection succeeded,
going from request to an open data channel in about 7 s. A 2940×1912 display was
encoded at 1660×1080 H.264 Baseline at about 5.4 Mbit/s, and the iPhone's mDNS
host candidate resolved.

**Production returned no ICE servers (`/api/ice` → `[]`)**, so only direct
connections work. Phones on mobile data or other networks need `STUN_URL` and,
for most NATs, `TURN_URLS`/`TURN_SECRET` set on the account service and a TURN
relay deployed. This affects the Electron app equally.

## Milestone 4 status

- `remember.rs` + `connection/session.rs`: Mac half of `src/lib/remember.ts`. After
  Allow with "Skip approval for", the Mac offers remembering over the data channel,
  verifies the phone's passkey (WebAuthn ES256, `create` or `get`), and records
  `{grantId, credentialId, publicKey, origin, until ≤ 3 days}` in the Keychain
  vault. A later request whose unlock proof verifies, for that grant, with a
  single-use controller nonce and the setup checklist complete, is approved without a
  prompt. Records are forgotten on Forget, Revoke, re-pairing, a `revoked` message
  and sign-out. `tests/fixtures/remember-vectors.json` comes from running the
  JavaScript `verifyUnlock`/`verifyUnlockKey` on valid and tampered responses.
- `electron.rs`: the import above, tested against real Electron output
  (`tests/fixtures/electron-vectors.json`).
- `update.rs`: checks `/api/downloads/mac` at launch and every 6 hours. It shows an
  Update available card (Later is remembered per version) or a blocking dialog when
  `minimumSupportedVersion` is newer, and opens only `<service>/download/mac`. There
  is no native notification or focus re-check.
- `scripts/package-mac.sh`: `target/dist/Mac Remote.app` and
  `MacRemote-<version>-mac-arm64.zip` (+ `.sha256`). It uses
  `com.macremote.companion`, the Electron usage strings and icon, the driver in
  Resources, and ad-hoc signing with the hardened runtime, arm64 only.
  `MAC_REMOTE_CHANNEL=release` drops the "· GPUI" device-name suffix.

### Tests

`cargo test` (19), plus four e2e scripts run through
`node scripts/test-with-postgres.cjs node desktop-gpui/tests/<name>.mjs` after
`(cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)`:

- `e2e-pairing.mjs`: pairing, forged proof/request, decline, persistence, revoke.
- `e2e-session.mjs`: phone web app in headless Chrome; WebRTC + H.264 + driver.
- `e2e-remember.mjs`: Chrome's WebAuthn virtual authenticator stands in for Face ID.
  It covers turning remembering on, a reconnect approved with no prompt, and Forget.
- `e2e-electron-import.mjs`: real Electron runs `desktop/identity.cjs` under a
  throwaway name and Keychain item; the GPUI app must start with Electron's
  device ID and pinned phone.

### Releasing 0.4.0 (manual, not done)

1. `desktop-gpui/scripts/package-mac.sh` on Apple Silicon.
2. Smoke-test `target/dist/Mac Remote.app` on a Mac that has the Electron app and
   paired phones; confirm the phones still connect without re-pairing.
3. Upload `MacRemote-0.4.0-mac-arm64.zip` to a `mac-v0.4.0` GitHub release.
4. Then bump `release.config.json` (version `0.4.0`, the new URL) and deploy. Doing
   this before the upload makes `/download/mac` unavailable. Electron 0.3.2+ users
   then see the update prompt.

Not built: keyframes on RTCP PLI/FIR, a preview of the shared screen on the Mac,
display thumbnails, route/latency stats, Developer ID signing and notarization.
