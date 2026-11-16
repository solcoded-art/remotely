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

Ongale calls the health check path over HTTP after each deploy. The new version goes live only when it answers with a status below 400, within 5 minutes of starting, each try within 5 seconds.

- Use `/` if the home page loads without login and without slow work. Otherwise add `GET /health` returning `200 ok`.
- It must not redirect to a login page that then fails, need a cookie, or depend on third-party services.

## 3. Database: `DATABASE_URL`

When the user binds a PostgreSQL database in the dashboard, the app restarts with `DATABASE_URL`.

- Use it exactly as given. It has no password and SSL is off on purpose; don't add `sslmode=require` or SSL options, and don't ask the user for a password.
- PostgreSQL only for now. If the app uses SQLite, MySQL or MongoDB, say so and offer to switch it to PostgreSQL.
- Run migrations when the app starts (e.g. `prisma migrate deploy`, `drizzle-kit migrate`, `alembic upgrade head`) or as part of the start command, not by hand.
- Don't fail at build time if `DATABASE_URL` is missing; it exists at run time only.

## 3b. Redis: `REDIS_URL`

- If the app needs Redis (caches, sessions, queues like BullMQ, Sidekiq or Celery), read the connection from `REDIS_URL` (`redis://127.0.0.1:6379`, no password). The user adds a Valkey instance on **Databases** and binds it to the app.
- Don't call `CONFIG SET` or other admin commands at startup (some libraries do, e.g. to set an eviction policy); they're refused. On Starter the data isn't kept across restarts, so don't store anything you can't rebuild.

## 4. Files and state

- Don't keep user uploads or other important files on the local disk. Use the bucket: see the `ongale-storage` skill.
- Keep sessions and caches in the database or signed cookies, not in memory, if losing them on a redeploy matters.

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
