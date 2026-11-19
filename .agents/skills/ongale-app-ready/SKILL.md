---
name: ongale-app-ready
description: Prepare a web app to run on Ongale. Use when the user wants to deploy to Ongale, asks whether their app will work there, or an app needs a PORT, health check, database or file storage setup for Ongale.
---

# Make an app ready for Ongale

Ongale runs one web process per app from the user's GitHub repo. Check and fix these, in order. Change as little as possible and explain each change in one line.

## 1. Listen on `$PORT`

Ongale sets the `PORT` environment variable. The app must listen on it, on `0.0.0.0`.

- Node/Express: `app.listen(process.env.PORT || 3000, "0.0.0.0")`
- Next.js: `next start -H 0.0.0.0 -p ${PORT:-3000}`
- Vite/SPA preview servers aren't for production: serve the built files with a small server, or let the build produce a static site served by one.
- Python: `gunicorn app:app --bind 0.0.0.0:${PORT:-8000}` or `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}`
- Go: `http.ListenAndServe(":"+os.Getenv("PORT"), h)`

Tell the user which port to enter in the dashboard. If the app reads `PORT`, any value works; 3000 is the default.

## 2. A health check path

Before a new version serves, Ongale checks it's ready: by default it requests the health check path and needs **3 answers below 400 in a row** (1 second apart), within **5 minutes** (the timeout can be set from 30 seconds to 30 minutes). A version that isn't ready in time, or exits 3 times within 30 seconds while starting, fails: the previous version keeps serving (with **Stop the running one first**, it's started again and checked) and the app page shows why, with the app's last log lines.

- Use `/` if the home page loads without login and without slow work. Otherwise add `GET /health` returning `200 ok`.
- It must not redirect to a login page that then fails, need a cookie, or depend on third-party services.
- An app that doesn't speak HTTP (a TCP server) uses the **TCP** check instead, and a background worker the **Process** check (it keeps running 10 seconds): **Readiness** on the app page, or `readiness_mode` when creating it.

## 3. Database: `DATABASE_URL`

When the user binds a PostgreSQL database in the dashboard, the app restarts with `DATABASE_URL`. An app whose first deploy failed (for example because `DATABASE_URL` was missing) is deployed again by the binding, with no push needed.

- Use it exactly as given. It has no password and SSL is off on purpose; don't add `sslmode=require` or SSL options, and don't ask the user for a password.
- Don't put settings in the connection. Pool or URL options like `statement_timeout`, `lock_timeout` or `idle_in_transaction_session_timeout` are ignored: the plan's query time limit applies, and the others keep their defaults. To set your own, use `SET LOCAL` inside a transaction. Settings in `options` (`options=-c ...`, `PGOPTIONS`) are ignored too. Other settings sent when connecting (for example `work_mem`) are refused with "unsupported startup parameter". Only `application_name`, `TimeZone`, `DateStyle`, `IntervalStyle`, `search_path`, `standard_conforming_strings` and the client encoding are kept.
- PostgreSQL only for now. If the app uses MySQL or MongoDB, say so and offer to switch it to PostgreSQL.
- **SQLite** works if its file is in `/data` (the app's persistent disk, 1 GB, kept across deploys). Then set the app to **stop the running version first** (**Readiness → When a new release deploys**, or `deploy_strategy: "replace"`), so two versions never write the file at once; each deploy then has a short downtime. For more than one writer, PostgreSQL is better.
- Run migrations when the app starts (e.g. `prisma migrate deploy`, `drizzle-kit migrate`, `alembic upgrade head`) or as part of the start command, not by hand. They run on every start, so they must be safe to run again. A new database is empty: the app creates its tables.
- `DATABASE_URL` goes through a connection pooler that hands out a connection per transaction. A lock that keeps two starts from migrating at once must be `pg_advisory_xact_lock`, taken inside the migration's own transaction; a session lock (`pg_advisory_lock`) doesn't hold. Tools that take a session lock (Prisma Migrate, Rails migrations) can fail or hang this way: the user asks Ongale support to switch the database binding to session mode.
- Don't fail at build time if `DATABASE_URL` is missing; it exists at run time only.
- If the app can't start without it, create the app with its database: the **Database** section of the new app form, or `databases` on the create tools. The first deploy then waits until the database is ready.

## 3b. Redis: `REDIS_URL`

- If the app needs Redis (caches, sessions, queues like BullMQ, Sidekiq or Celery), read the connection from `REDIS_URL` (`redis://127.0.0.1:6379`, no password). The user adds a Valkey instance on **Databases** and binds it to the app.
- Don't call `CONFIG SET` or other admin commands at startup (some libraries do, e.g. to set an eviction policy); they're refused. On Starter the data isn't kept across restarts, so don't store anything you can't rebuild.

## 4. Files and state

- Don't keep user uploads or other important files on the local disk. Use the bucket: see the `ongale-storage` skill.
- Keep sessions and caches in the database or signed cookies, not in memory, if losing them on a redeploy matters.

## 4b. WebSockets

WebSockets work on the app's own port and paths, with nothing to set up. Clients connect with `wss://<the app's address>/<path>`.

- A connection with no traffic for 10 minutes is closed. Send a ping about every 30 seconds (Socket.IO and most libraries do this by default; with `ws`, call `ws.ping()` on a timer).
- Every redeploy or restart closes all connections, so clients must reconnect by themselves, waiting a little longer after each failed try.
- One app runs one process, so keeping connected clients in memory works. Keep anything that must survive a restart (rooms, pairings, messages) in the database.

## 5. Configuration

- Read settings and secrets from environment variables. The user adds them on the app page (**Add variable** or **Paste .env**); values marked **Secret** can't be read back.
- Never commit `.env` files with real values. Make sure `.env` is in `.gitignore`.
- Never print environment variable values in logs, output or chat.

## 6. Build

A `Dockerfile` in the repo is used if present; otherwise the stack is detected automatically. Without a Dockerfile, make sure `package.json` (or the language's equivalent) has working `build` and `start` scripts and pins the runtime version (`engines.node`, `.python-version`, `go.mod`).

If there is a Dockerfile: it must build on a clean machine, `EXPOSE` isn't required, and the container must start the web server in the foreground.

## 7. Errors don't stop the server

One unhandled error ends the process: Ongale restarts it within seconds, but every request in progress fails meanwhile.

- Catch errors in request handlers and answer with a 500 instead. In Express 4, wrap `async` handlers (or use Express 5), since a rejected promise there isn't caught.
- Check for missing input, a missing environment variable or a failed database call where it happens, not later.
- Keep memory use well under the plan's limit (stream large files and query results instead of loading them whole).

## 8. Caching (optional)

Files like `.css`, `.js` and images are cached and cleared on every deploy. To have a page or API response served from the cache, send `CDN-Cache-Control: max-age=<seconds>`, only on responses that are the same for every visitor and set no cookie.

## With the Ongale MCP server

If the Ongale tools are connected (see `ongale-mcp`), check against the real workspace instead of assuming:

- `workspace_get` shows the plan's limits (memory, databases, storage), so you can size the app to them.
- An existing app: `app_get` (port, health path, bound databases) and `app_env_list` (variable names; secret values never come back).
- The database: `database_schema` shows its tables, and `database_query` runs read-only SQL to check migrations ran.
- Missing pieces you can add yourself: `database_create` and `database_bind` for `DATABASE_URL`, and `app_env_set` for variables (`"secret": true` for secrets).

## Done when

The app listens on `$PORT`, the health path answers quickly without login, the database comes from `DATABASE_URL`, and it builds from a clean checkout. Then continue with the `ongale-deploy` skill (or `ongale-continue-app` for an app already on Ongale).
