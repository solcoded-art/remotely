---
name: ongale-fix-deploy
description: Diagnose and fix a failed Ongale deploy, an app stuck building, a failed health check or an app that crashes after deploying. Use when the user says their Ongale deploy failed, is stuck, or the app shows an error.
---

# Fix a failed Ongale deploy

Find which stage failed, then fix the cause in the code. Never ask for secret values.

## With the Ongale MCP server

Look for yourself before asking the user anything (see `ongale-mcp`):

1. `app_get`: status, source, current release and health check. `app_releases_list`: did a new release arrive, and is it the current one?
2. `activity_list` and `run_get` on the latest deploy's run: which step failed, with its error.
3. `app_logs_recent`: the app's own output around the failure (crash, missing variable, migration error). `app_metrics`: restarts, memory near the limit, error rates.
4. Match what you found against the stages below and fix the cause:
   - **In the code:** commit the fix with `code_commit` (see `ongale-continue-app`), or push it from a local checkout.
   - **A missing variable:** `app_env_set`.
   - **A database that isn't bound:** `database_bind`.
   - **A failing health check path:** make the route answer fast, without login (the path set when the app was created; `app_get` shows it).
   - **Nothing to change in the code** (e.g. a variable was added): `app_deploy` redeploys.
   - **A deploy that stopped on an error** blocks deploys, starts, stops and database binds until it's retried: once the cause is fixed, `app_deploy` retries it (the dashboard's **Retry deploy**). Don't delete and recreate the app for this.
5. Users are affected right now and the previous release worked: `app_rollback` first, then fix.
6. The build log lives in GitHub Actions, which the tools can't read. When the build itself fails (no new release, run failed at the build step), ask the user for the failing step's log from the repository's **Actions** tab.

## Without the MCP server

Ask the user to paste what they see.

## 1. Which stage?

Ask what the app page says (or read it with `app_get`), and check the latest run in the repo's **Actions** tab.

| What they see | Stage | Go to |
| --- | --- | --- |
| The Actions run is red | Build | 2 |
| Actions is green, the app page shows an image-access error | Private image | 3 |
| Actions is green, the app page says the health check failed or the app isn't healthy | Start | 4 |
| Live, but pages show errors | Runtime | 5 |
| No Actions run at all after a push | Trigger | 6 |
| The app page says **Asleep**, or visitors see "Starting this app" for a few seconds | Not a failure: during the trial, apps sleep after 30 minutes without visits and the next visit or push wakes them. Paid plans are always on | — |

## 2. Build failed

Read the failing step's log in Actions. Common causes: a lockfile out of sync (`npm ci` fails: run `npm install` and commit the lockfile), a missing build script, a runtime version mismatch (pin it), TypeScript or lint errors that fail the build, code that needs `DATABASE_URL` or another variable at build time (move that to run time). Reproduce locally with a clean install and the same build command, fix, push.

## 3. Image access

The repository is private and Ongale couldn't read its image. Usually the workflow is older and doesn't hand over its token. Ongale updates it after such a deploy: by itself when one person works on the repository, otherwise with an **Update Ongale deploy workflow** pull request to merge. Then push again. Don't edit the workflow's "Deploy to Ongale" step. If it still fails: app page → **Private image access → Advanced** → create and save a token with read packages only, then **Retry deploy**.

## 4. Health check failed

The new version started but didn't answer the health check path with a status below 400 within 5 minutes. Read the app page's **Logs**. Check, in order:

1. It listens on `0.0.0.0` and the `PORT` variable, and the **Port** set in Ongale matches.
2. The health path exists, answers without login, doesn't redirect to a failing page, and is fast.
3. It doesn't crash on start: a missing environment variable (add it on the app page), a database migration error, or the database not bound yet.
4. Start-up isn't slower than 5 minutes (heavy work at boot: move it to a background task).

Fix, push to deploy again. If nothing changed in code (e.g. a variable was added), **Retry deploy** (or `app_deploy`).

## 5. Runtime errors

Read **Logs** around the error. Typical: database queries before migrations ran, SSL forced on `DATABASE_URL` (remove it), files written to local disk and lost on redeploy (use the bucket), a hard-coded `localhost` URL for the site itself (use the app's real address or a variable).

## 6. No deploy started

The workflow pull request wasn't merged (Ongale opens one instead of committing when others work on the repository or the branch is protected), the push went to a different branch, or the workflow file was deleted or edited. Merge the pull request, or restore the file from it.

If it still fails, send Ongale a report with `bug_report_create` (what failed, the app, when, what you tried), or the user emails **support@ongale.com** with the app name and the time of the failed deploy.
