---
name: ongale-fix-deploy
description: Diagnose and fix a failed Ongale deploy, an app stuck building, a failed health check or an app that crashes after deploying. Use when the user says their Ongale deploy failed, is stuck, or the app shows an error.
---

# Fix a failed Ongale deploy

Find which stage failed, then fix the cause in the code. Never ask for secret values.

## With the Ongale MCP server

Look for yourself before asking the user anything (see `ongale-mcp`):

1. `app_get`: status, source, current release and health check. `app_releases_list`: did a new release arrive, and is it the current one?
2. `app_get`'s `last_run`: a deploy that failed has `failure` (`readiness` or `crash` when the app didn't start, `image` when its image couldn't be downloaded), a `reason`, a `hint` (a likely fix) and `log_excerpt` (the app's last log lines). `activity_list` and `run_get` on the run: which step failed, with its error.
3. `app_logs_recent`: the app's own output around the failure (crash, missing variable, migration error). `app_metrics`: restarts, memory near the limit, error rates.
4. Match what you found against the stages below and fix the cause:
   - **In the code:** commit the fix with `code_commit` (see `ongale-continue-app`), or push it from a local checkout.
   - **A missing variable:** `app_env_set`.
   - **A database that isn't bound:** `database_bind`. It deploys the app again, also one whose first deploy failed.
   - **A failing readiness check:** make the health path answer fast, without login, or pick another check or a longer timeout with `app_readiness_set` (`app_get` shows `readiness_mode`, `readiness_timeout_s` and `health_check_path`).
   - **Nothing to change in the code** (e.g. a variable was added): `app_deploy` redeploys.
   - **A deploy that stopped on an error** (Deploy stopped): see 2b. Don't delete and recreate the app for this.
5. Users are affected right now and the previous release worked: `app_rollback` first, then fix.
6. The build log lives in GitHub Actions, which the tools can't read. When the build itself fails (no new release, run failed at the build step), ask the user for the failing step's log from the repository's **Actions** tab.

## Without the MCP server

Ask the user to paste what they see.

## 1. Which stage?

Ask what the app page says (or read it with `app_get`), and check the latest run in the repo's **Actions** tab.

| What they see | Stage | Go to |
| --- | --- | --- |
| The app page says **Failed**, with a reason, a likely fix and the app's last log lines | The app didn't start | 4 |
| The app page says **Deploy stopped** | Stopped on Ongale's side | 2b |
| The app page says a newer push or redeploy **is queued** | Not a failure: it starts when the current deploy ends, and a newer one replaces it | — |
| The Actions run is red at **Deploy to Ongale** with HTTP 409 `older_build`: "a newer build was already accepted" | An older build (e.g. re-running an old workflow) | Push the code again, or use **Roll back** to go back to older code |
| The Actions run is red at **Deploy to Ongale** with HTTP 410: "The Ongale app for … was deleted" | The app was deleted | Create an app for the branch again, then push |
| The app page says **GitHub run failed** | Read the run's log (linked on the app page): a red build step is 2, a red **Deploy to Ongale** step shows Ongale's reason | 2 or 2b |
| The Actions run is red | Build | 2 |
| The app page says **Failed**: its image couldn't be downloaded | Image access | 3 |
| Actions is green, the app page says the health check failed or the app isn't healthy | Start | 4 |
| Live, but pages show errors | Runtime | 5 |
| No Actions run at all after a push | Trigger | 6 |
| The app page says **Asleep**, or visitors see "Starting this app" for a few seconds | Not a failure: during the trial, apps sleep after 30 minutes without visits and the next visit or push wakes them. Paid plans are always on | — |

## 2. Build failed

Read the failing step's log in Actions. Common causes: a lockfile out of sync (`npm ci` fails: run `npm install` and commit the lockfile), a missing build script, a runtime version mismatch (pin it), TypeScript or lint errors that fail the build, code that needs `DATABASE_URL` or another variable at build time (move that to run time). Reproduce locally with a clean install and the same build command, fix, push.

## 2b. Deploy stopped

An earlier deploy stopped on Ongale's side, and the app page shows **Deploy stopped** with the reason and what to do:

- **"Push a fix or press Redeploy"**: a new push, **Redeploy** (`app_deploy`) or a settings change clears the stopped deploy and runs. Fix the cause first if it's yours (e.g. 3), then push or redeploy. **Retry deploy** runs the stopped one again instead, for a cause outside the app that's been fixed.
- **"It needs Ongale's staff to resolve it"**: it can't be cleared from here; new deploys wait until staff resolve it. If it's urgent, send a report (`bug_report_create`) or email support with the app name.

An app that failed to start shows **Failed** instead, not Deploy stopped: see 4.

## 3. Image access

The repository is private and Ongale couldn't read its image. Usually the workflow is older and doesn't hand over its token. Ongale updates it after such a deploy: by itself when one person works on the repository, otherwise with an **Update Ongale deploy workflow** pull request to merge. Then push again. Don't edit the workflow's "Deploy to Ongale" step. If it still fails: app page → **Private image access → Advanced** → create and save a token with read packages only, then **Redeploy** (or push again).

## 4. The app didn't start (Failed)

The new version didn't pass its readiness check in time, or exited 3 times within 30 seconds while starting. The app page shows **Failed** with why, a likely fix and the app's last log lines (`app_get`'s `last_run`); the previous release keeps serving (an app set to **Stop the running one first** starts its previous release again and checks it), and the next push deploys normally. The check is set per app (**Readiness** on the app page, or `app_readiness_set`): **HTTP** (3 answers below 400 in a row from the health path), **TCP** (3 connections in a row to the port, for apps that don't speak HTTP) or **Process** (keeps running 10 seconds; workers), within a timeout of 30 to 1,800 seconds (300 by default). Check, in order:

1. It listens on `0.0.0.0` and the `PORT` variable, and the **Port** set in Ongale matches.
2. The health path exists, answers without login, doesn't redirect to a failing page, and is fast.
3. It doesn't crash on start: a missing environment variable (add it on the app page), a database migration error, or the database not bound yet.
4. Start-up fits the timeout (heavy work at boot: move it to a background task, or raise the timeout).
5. An app that must never run twice at once (SQLite, one writer to a file) uses **Stop the running one first** under Readiness (`deploy_strategy: "replace"`), so the old release stops before the new one starts.
6. The log says **"unsupported startup parameter"**: the app sends a database setting when it connects (e.g. `work_mem` in its pool options). Remove it, and set it with `SET LOCAL` inside a transaction if it's needed. A migration tool that fails or hangs on its lock (Prisma Migrate, Rails migrations) needs a session-mode database binding: ask Ongale support for it.

Fix, then push again or **Redeploy**. For an app that never ran, changing a variable or binding a database deploys it again by itself.

## 5. Runtime errors

Read **Logs** around the error. Typical: database queries before migrations ran, SSL forced on `DATABASE_URL` (remove it), files written to local disk and lost on redeploy (use the bucket), a hard-coded `localhost` URL for the site itself (use the app's real address or a variable).

## 6. No deploy started

The workflow pull request wasn't merged (Ongale opens one instead of committing when others work on the repository or the branch is protected), the push went to a different branch, or the workflow file was deleted or edited. Merge the pull request, or restore the file from it.

An app showing **Push to deploy**: Ongale couldn't start its build (GitHub refused, or no run appeared within 10 minutes). Press **Start build** on the app page, or push a commit, even an empty one: `git commit --allow-empty -m "Deploy to Ongale" && git push`. If Start build answers that a build was just started, one is on its way: wait up to 10 minutes, or push a commit. If Start build keeps failing, the Ongale GitHub App may be missing the Actions permission on that account: the owner accepts the update in GitHub's settings for installed apps.

A push whose run says "The Ongale app for … was deleted" (HTTP 410): create an app for the branch again, then push. "No Ongale app deploys from …" (404): no app was ever created for this branch, or the push came before it was; create it (or wait until it shows on the Apps page), then push again.

If it still fails, send Ongale a report with `bug_report_create` (what failed, the app, when, what you tried), or the user emails **support@ongale.com** with the app name and the time of the failed deploy.
