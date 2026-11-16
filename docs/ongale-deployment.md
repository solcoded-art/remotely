# Deploying Mac Remote on Ongale

Status: prepared locally; no Ongale app, database, GitHub repository, domain, or deployment has been created by this session. The Ongale MCP tools are not connected here. `.mcp.json` records the official endpoint for clients that support that file; authentication and tool permissions still need to be connected in the client.

## What runs where

| Component | Runs on | Deployment artifact |
| --- | --- | --- |
| Account API, device discovery, WebRTC signaling, browser interface | Ongale web process | Root `Dockerfile` |
| Accounts, hashed passwords, hashed sessions, paired devices | Ongale PostgreSQL | Bind to get `DATABASE_URL` |
| Full-display capture and approved native input | User's Mac | Electron `.app` / DMG |
| Remote video and controls | iPhone / iPad | Capacitor Xcode project → TestFlight |
| Optional STUN/TURN relay | Dedicated relay service | External to Ongale's HTTP app |

The hosted service never captures screens, executes input, or invokes shell commands. Live video is not recorded or stored. It must not be routed through Ongale Media or Storage. Those features are available in the installed skills for future uploads, release downloads, or other actual files.

## Ready-to-enter app settings

| Setting | Value |
| --- | --- |
| App type | Web process, not a static site |
| Build | Root Dockerfile, multi-stage Node 24 build |
| Start | `node server.js` (Docker CMD) |
| Port | `3000`, or any platform-injected `PORT` |
| Listen address | `0.0.0.0` by default |
| Health path | `/health` |
| Database | PostgreSQL, bound using `DATABASE_URL` |
| Instances | One; signaling presence and pending connections are process-local |

The image builds without `DATABASE_URL`. At startup the service connects to PostgreSQL and applies `signaling/migrations/*.sql` in a transaction protected by an advisory lock. If startup fails, fixed diagnostic messages identify common configuration, connection, authentication, schema-permission, and port errors without printing driver error text. Database URLs and credentials are not logged. Health becomes available after successful startup and answers without authentication or a database query.

Use Ongale's injected `DATABASE_URL` exactly as provided. Do not add a password, `sslmode=require`, or a separate SSL override. The code passes the connection string directly to `pg.Pool` with five connections and bounded timeouts. No local disk or SQLite state is used.

## Environment variables

| Name | Purpose | Required |
| --- | --- | --- |
| `DATABASE_URL` | Injected by binding PostgreSQL | Runtime |
| `PORT` | Injected application port | Default 3000 |
| `HOST` | Listen address | Default `0.0.0.0` |
| `PUBLIC_URL` | Actual HTTPS app origin, including an attached custom domain; permits browser login from that origin | For the hosted browser client |
| `ALLOW_REGISTRATION` | Set to `false` after creating beta accounts if registration should close | Default true |
| `ALLOWED_ORIGINS` | Optional comma-separated replacement for browser/native origin defaults | Optional |
| `STUN_URL` | Your relay provider's STUN URL | Recommended across networks |
| `TURN_URLS` | Comma-separated TURN/TURNS URLs | Recommended across networks |
| `TURN_SECRET` | Coturn REST shared secret; mark **Secret** in Ongale | With TURN |

If replacing `ALLOWED_ORIGINS`, retain `app://macremote` and `capacitor://localhost` for the packaged clients. `PUBLIC_URL` is additionally permitted. The service uses Authorization bearer tokens and authenticates WebSockets with their first message, not query-string tokens. Credentialed responses are `no-store`. `/assets/` contains content-hashed public build files and can be cached.

Never paste production secrets into chat or commit them in `.env`. Set TURN secrets on Ongale's app Variables page. `VITE_ACCOUNT_SERVER` is an optional **public build-time** default for native clients; otherwise the user enters the HTTPS account-server origin in the login form. Both devices must use that same origin. A native build does not need your database URL or relay secret.

## Next deployment session

Read the installed [app-ready skill](../.agents/skills/ongale-app-ready/SKILL.md), [deploy skill](../.agents/skills/ongale-deploy/SKILL.md), and [MCP skill](../.agents/skills/ongale-mcp/SKILL.md).

1. Connect `https://mcp.ongale.com/mcp` using [Ongale's connection guide](https://ongale.com/mcp/). Enable app write and database write permissions for deployment. Do not share API tokens in chat.
2. Read the workspace and existing apps. The Git remote is `git@github.com:solcoded-art/remotely.git`, with `main` as the local branch. Use that repository for push-based deployment after verifying its current remote state.
3. Create the PostgreSQL database and create the web app from this repository. Bind the database before the first successful startup. If the initial attempt fails while it is unbound, follow `ongale-fix-deploy` and retry after configuration is complete.
4. Set the actual `PUBLIC_URL`. Configure STUN/TURN if the beta must work across mobile and home networks. Do not treat successful localhost connectivity as internet connectivity.
5. Follow the deployment job and health check. Verify account creation, same-account device isolation, WebSocket `/ws` upgrade, and reconnect after a release restart. The proxy must pass WebSocket upgrades and long-lived connections; this has not been checked against a live Ongale app.
6. Enter the resulting HTTPS origin on both native apps. Verify a direct route and a forced TURN relay route with two physical devices.

Use the same idempotency key when retrying platform changes. Preserve the Ongale-managed GitHub deploy workflow. If tools are not connected, use the dashboard flow from the installed deploy skill.

## Operating limits

- Deploy one process. Accounts and devices persist in PostgreSQL; presence, rate-limit buckets, and active WebRTC negotiation state are in memory. A redeploy disconnects sessions and requires fresh Mac approval. Horizontal scaling requires shared signaling/pubsub and distributed limits.
- Tokens expire after 24 hours and are held only in client memory for this beta. Closing an app requires signing in again. Add Keychain-backed session persistence before a broader rollout.
- Email/password accounts work, but email verification, password recovery, and MFA are not implemented. The installed `ongale-email` skill defines the platform's `SMTP_*` contract for that follow-up; no outgoing email has been configured or sent.
- Native iPhone video playback, macOS Accessibility/Screen Recording grants, multi-monitor selection, NAT traversal, and mobile carrier networks still require physical-device validation.
- This directory includes all eight official skills with a source/hash manifest. Storage, media, email, and repair skills are available for later use; copying them is not evidence that those services are enabled.
