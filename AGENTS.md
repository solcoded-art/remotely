# Mac Remote

This repository contains an iOS client, a macOS companion, and an account/signaling service. Keep native desktop control local to the approved desktop peer. The hosted server must never execute input, shell commands, or screen capture.

## Ongale

- Official skills are vendored in `.agents/skills/`; read `ongale-app-ready/SKILL.md` before deployment preparation and `ongale-deploy/SKILL.md` before deployment. Sources and hashes are in `.agents/skills/ongale-sources.json`.
- Deployment configuration and remaining decisions are in `docs/ongale-deployment.md`.
- Deploy the root Dockerfile as one web process. Port: 3000 (or platform `PORT`). Health path: `/health`.
- PostgreSQL is required at runtime. Use `DATABASE_URL` exactly as injected, without adding passwords or SSL options. Startup applies versioned migrations automatically. Builds must work without a database.
- `.mcp.json` declares Ongale's HTTP endpoint for compatible clients. A declaration does not establish an authenticated connection; discover available tools before attempting platform operations.
- Do not invent app/workspace/domain ids or overwrite Ongale-managed deployment workflows.
- Live video and data channels use WebRTC. Do not put them in Ongale Media or Storage. TURN is a separate UDP/TCP relay, not this HTTP web process.

## Validation

- `npm run build` checks TypeScript and builds both clients' shared interface.
- `npm run build:driver` compiles the native Mac helper.
- `npm test` and `npm run test:ui` provision their own disposable PostgreSQL containers. They ignore production `DATABASE_URL`. Docker is required unless `TEST_DATABASE_URL` explicitly points at an isolated test cluster with CREATE DATABASE permission.
- Browser tests use synthetic capture and mocked native input; do not call those tests physical-iPhone or macOS-permission validation.
- Never commit `.env`, signing credentials, database URLs, or account tokens.
