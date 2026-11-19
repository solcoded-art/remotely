---
name: ongale-deploy
description: Deploy an app to Ongale for the first time, from code written in this chat, a GitHub repository or a container image, with a database and a custom domain. Use when the user asks to deploy to Ongale, put their app live there, or how to do it.
---

# Deploy to Ongale

Run the `ongale-app-ready` checks on the code first. With the Ongale MCP server connected (tools like `apps_list`, see `ongale-mcp`), deploy it yourself. Without it, guide the user through the dashboard (further down).

## With the Ongale MCP server

1. `workspace_get`: check there's a plan and room for another app. No plan: the user picks one (`billing_portal_link`).
2. Create the app from where the code is:
   - **Code written in this chat:** `app_create_from_code` with `name`, `port` (the app reads `PORT`), `health_path` and every file in `files` (up to 500 files, 5 MB). Ongale creates a private repository in the user's GitHub account, commits the code with its deploy workflow, and GitHub Actions builds it. The first time, it answers with a link instead: the user opens it, signs in to GitHub (or signs up) and approves the Ongale app, then you call the tool again.
   - **A GitHub repository:** `github_repos_list` to find it, then `app_create_from_github` with `repository`, `branch`, `port`, `health_path`. A site of only HTML, CSS and JavaScript (a Vite, React or Astro build, plain HTML) takes `kind: "static"` instead of a port: every push runs its `build` script and publishes the folder with `index.html` (`dist/`, `build/`, `out/`), with no server and no RAM from the plan. To add a background worker or a cron job built from the same code, call it again with the same `repository` and branch and `kind: "worker"` or `kind: "cron"` (with `schedule` and `command`): the branch's workflow is shared and every push deploys all of them. Ongale adds its deploy workflow: straight to the branch when the user is the only one working on the repository (the first build starts by itself), otherwise as a pull request. `app_get` shows which; for a pull request, give the user the link to merge it. Either way, tell them to `git pull` before their next push. If the branch already has Ongale's current workflow (an app deleted and created again, or another app on the same branch), nothing is committed and Ongale starts the build itself; this runs the whole branch, so its other apps deploy too. If `app_get` shows `source.build_dispatch` = `push_needed` (GitHub refused, or no build appeared within 10 minutes), the user presses **Start build** on the app page or pushes a commit (`git commit --allow-empty -m "Deploy to Ongale" && git push`).
   - **A ready container image:** `app_create_from_image` with the image by digest (`…@sha256:…`).

   Give the app what it needs to start **in the same call**: `variables` (or `dotenv`) and `databases` (an existing `database_id`, or `create: {engine, name}` for a new one, bound as `DATABASE_URL`, or `REDIS_URL` for Valkey). They're saved before any build or deploy starts, and the first deploy waits until a new database is ready (`app_get` shows `setup`). An app that must never run twice at once (SQLite) gets `deploy_strategy: "replace"` afterwards with `app_readiness_set`.
   - **The user deleted this app before and wants its old address back:** pass `reuse_hostname` (e.g. `shop-acme.ongale.dev`). Only the same workspace can, once the deletion has finished; the new app shares cookies and browser storage with the old one's visitors.
3. Follow it: `run_get` with the returned `run_id`, and `app_get` until the app is live (a GitHub build takes 2 to 5 minutes). Then give the user the address.
4. **A database added later:** `database_create` (`engine` postgresql, or valkey for a cache), `run_get` until it succeeds, then `database_bind` with the app and database ids. The app redeploys with `DATABASE_URL` (or `REDIS_URL`).
5. **Variables added later:** `app_env_set` with `variables` (`"secret": true` for keys and passwords) or a pasted `dotenv`. Secrets set through the chat are test keys: tell the user to create new ones for production and replace them on the app page (**Variables**, marked **Secret**), where they aren't shared with an AI tool. If they'd rather not paste a secret into the chat at all, they add it there from the start.
6. **Domain**, either way; HTTPS is automatic:
   - **DNS hosted by Ongale:** `domains_list`; if the domain isn't there, `domain_add` returns two nameservers for the user to set at their registrar. Once it's active, `domain_attach_to_app` with a host (`www`, `@`).
   - **DNS stays where it is** (one subdomain such as `shop.mybrand.com`): `domain_external_add` with the hostname and app, then the user adds the CNAME and TXT records it returns at their DNS provider.
7. **Email from the domain:** see `ongale-email`.
8. **Images, video and fonts the code ships with:** put them in `media/` and read them through `ongale-media.json`; see `ongale-media`.

If anything fails, use `ongale-fix-deploy`. Later changes to the code: `ongale-continue-app`.

## In the dashboard

You can't click for the user. Give them these steps one at a time, wait for them to confirm, and help with anything that goes wrong.

### First deploy

1. Make sure the code is pushed to GitHub, on the branch they want to deploy.
2. In **https://app.ongale.com**: **Apps → New app → Connect GitHub**. Install the **Ongale** GitHub App on their account and give it access to the repository.
3. Back in Ongale, pick the repository and branch, and set:
   - **Port:** the port the app listens on (it also gets `PORT`).
   - **Health check path:** `/` or the path you added, e.g. `/health`.
   - **Variables** and **Database**, if the app needs them to start: they're saved with the app, and the first deploy waits until a new database is ready (the app shows **Waiting for database**).
   - **Address**, shown only if an app of this workspace was deleted: pick its old address to reuse it, or keep **A new address**.
4. Click **Create app**. If they're the only one working on the repository, Ongale commits the build workflow to the branch and the first build starts by itself. Otherwise it opens a pull request: **Merge workflow PR**, and they merge it. If the branch already has the workflow (an app deleted and created again, or another app on the same branch), Ongale starts the build itself and the app shows **Starting build**, then **Building**. If it shows **Push to deploy** instead, they press **Start build** or push a commit, even an empty one (`git commit --allow-empty -m "Deploy to Ongale" && git push`).
5. The first build takes a few minutes; it shows in the repo's **Actions** tab. When the app turns **Live**, **Open** shows it at `https://<name>.ongale.dev`.

After this, every push to the branch deploys. Pull the workflow file locally (`git pull`) so the next push doesn't conflict, and don't delete or rename it.

### Private repositories

Nothing extra: each deploy lends Ongale the workflow's own short-lived GitHub token to pull the private image, and the deploy step waits until the pull is done. Older workflows don't send the token: Ongale updates them by itself, or opens an **Update Ongale deploy workflow** pull request when others work on the repository; then the user merges it. Fallback: app page → **Private image access → Advanced** → create and save a token with read packages only.

### Database

**Databases → New database**, wait for **Active**, then on the app **Bind database**. The app restarts with `DATABASE_URL`.

### Storage, email and domain

- Every app gets its project's bucket as `S3_*` variables (see `ongale-storage`).
- **Domains → Add domain**, then change the nameservers at the registrar to the two shown, then **Connect app** with a hostname (`www`, or `@`). HTTPS is automatic.
- Sending email from the domain: see `ongale-email`.

### Plan

During testing, the user picks **Starter** on **Billing** and uses the discount code from their invitation, which makes it free.

### Afterwards

- **Roll back:** app page → **Roll back** next to an earlier release (or `app_rollback`).
- **Logs:** app page, **Refresh** for new lines.
- If the deploy fails, use the `ongale-fix-deploy` skill.
