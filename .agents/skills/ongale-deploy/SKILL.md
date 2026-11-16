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
   - **A GitHub repository:** `github_repos_list` to find it, then `app_create_from_github` with `repository`, `branch`, `port`, `health_path`. A site of only HTML, CSS and JavaScript (a Vite, React or Astro build, plain HTML) takes `kind: "static"` instead of a port: every push runs its `build` script and publishes the folder with `index.html` (`dist/`, `build/`, `out/`), with no server and no RAM from the plan. To add a background worker or a cron job built from the same code, call it again with the same `repository` and branch and `kind: "worker"` or `kind: "cron"` (with `schedule` and `command`): the branch's workflow is shared and every push deploys all of them. Ongale adds its deploy workflow: straight to the branch when the user is the only one working on the repository (the first build starts by itself), otherwise as a pull request. `app_get` shows which; for a pull request, give the user the link to merge it. Either way, tell them to `git pull` before their next push.
   - **A ready container image:** `app_create_from_image` with the image by digest (`…@sha256:…`).
3. Follow it: `run_get` with the returned `run_id`, and `app_get` until the app is live (a GitHub build takes 2 to 5 minutes). Then give the user the address.
4. **Database:** `database_create` (`engine` postgresql, or valkey for a cache), `run_get` until it succeeds, then `database_bind` with the app and database ids. The app redeploys with `DATABASE_URL` (or `REDIS_URL`).
5. **Variables:** `app_env_set` with `variables` (`"secret": true` for keys and passwords) or a pasted `dotenv`. Secrets set through the chat are test keys: tell the user to create new ones for production and replace them on the app page (**Variables**, marked **Secret**), where they aren't shared with an AI tool. If they'd rather not paste a secret into the chat at all, they add it there from the start.
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
4. Click **Create app**. If they're the only one working on the repository, Ongale commits the build workflow to the branch and the first build starts by itself. Otherwise it opens a pull request: **Merge workflow PR**, and they merge it.
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
