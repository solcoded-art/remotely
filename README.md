# Mac Remote

A downloadable iOS client and Mac desktop companion, paired through email accounts, one-use QR links and approved device keys. The shared React interface uses official shadcn/ui components and adapts to phones, landscape, tablets, and desktop windows.

The Mac shares a selected display over WebRTC. Video and input use the peer connection; the hosted service handles accounts, device discovery, and signaling. The Mac user approves each session. Direct connections are preferred, with optional TURN relay credentials for difficult networks.

## Run locally

Requires Node 24+, Docker for the local PostgreSQL container, and macOS Command Line Tools for the Swift helper.

```sh
npm ci
cp .env.example .env
npm run db:dev
npm start
```

`db:dev` waits for PostgreSQL to accept TCP connections before returning. Start the server with `npm start` so the project's `.env` is loaded. If startup fails, it reports a specific configuration, database, migration, or port error without printing connection strings or passwords.

In another terminal, start the browser interface:

```sh
npm run dev
```

For the actual Mac companion:

```sh
npm run desktop
```

Create an account, then sign in on both devices using the same HTTPS account-server origin. Local desktop development permits `http://127.0.0.1:3000`; a native iPhone needs the deployed HTTPS server. In the Mac companion, create a pairing link. Scan its QR code with your phone’s Camera (or paste the full link on the phone), then approve pairing on the Mac. Select a display, grant macOS permissions, connect from the paired phone, and approve each session on the Mac. See [the trusted-device protocol and limitations](docs/trusted-devices.md).

## Work with your apps

- Full-display video replaces the old repeating JPEG screenshots. Capture requests target up to 30 fps; this is not a measured latency guarantee.
- **Apps** lists running Mac applications. Tap one to bring it forward. Open VS Code, Cursor, Zed, or Terminal with the workspace launchers; unavailable apps return an error.
- **Mouse** supports movement, clicks, two-finger scrolling, drag hold, and speed adjustment. Switching away releases a held drag.
- **Keys** sends Unicode text and Mac shortcuts into the focused application.
- Tap the visible video to click its matching screen position. Letterboxed areas do not produce clicks.

Only the selected display is shared. A window on another display requires selecting that display on the Mac. A hidden browser tab can be brought forward through the browser's controls or keyboard shortcuts; the app does not inspect private browser-tab metadata.

## Build and verify

```sh
npm run build
npm run build:driver
npm test
npm run test:ui
npm run test:image
npm run desktop:package
npm run ios:sync
npm run ios:open
```

Tests provision and remove isolated PostgreSQL containers; they never use production `DATABASE_URL`. Chrome is required by the browser test configuration. The native iOS project requires full Xcode 26+ for compilation and signing. TestFlight distribution still requires an Apple Developer team, App Store Connect setup, and device validation.

## Deploy on Ongale

All eight official Ongale skills are installed in `.agents/skills/`. The root Dockerfile builds the shared interface and runs one Node web process on `0.0.0.0:$PORT`. Bind PostgreSQL to provide `DATABASE_URL`; startup applies versioned migrations. Configure `/health` as the health-check path.

Read [Ongale deployment](docs/ongale-deployment.md), [native distribution](docs/distribution.md), and [validation limits](docs/validation.md). `.mcp.json` declares the Ongale MCP endpoint for compatible clients; it does not establish a signed-in connection. No live resources have been created.

## UI foundations and hardening

The setup and connection journey uses shared shadcn/ui components, locally bundled Satoshi, explicit permission/approval/playback states, and pointer/scroll alternatives to gestures. Both development and production builds fetch the pinned font when needed; see [font provenance and licensing](docs/hardening/fonts.md). Font binaries are excluded from this repository.

See the [hardening milestone](docs/hardening/README.md), [security/accessibility backlog](docs/hardening/baseline.md), [threat model](docs/hardening/threat-model.md), and [validation evidence](docs/hardening/validation.md). Automated accessibility checks are included in the browser suite; they do not establish complete ADA/WCAG compliance. Remote desktop screen-reader semantics remain outstanding.

## Current beta limits

Login supports passwords of at least 12 characters and optional Better Auth magic links when SMTP is configured. New clients stay signed in for up to 30 days, using HttpOnly browser cookies or OS-protected native storage. First email verification replaces an existing unverified password and signs out other devices; compatible updated native apps are required for email sign-in. See [authentication setup and migration](docs/authentication.md). Password recovery by reset, MFA, unattended access, audio forwarding, background phone sessions, and file transfer are not implemented. One active controller per Mac is supported. Accounts and devices persist in PostgreSQL; live sessions end on server restart.

The old unauthenticated shell/action server has been removed. Remote commands are allowlisted and run only inside the approved desktop peer. See `docs/distribution.md` for trust and signing limits.
