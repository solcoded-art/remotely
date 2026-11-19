---
name: ongale-media
description: Serve an app's images, video, audio and fonts from Ongale's CDN with build sync (a media/ folder, ongale-media.json, MEDIA_URL). Use when an app deployed to Ongale from GitHub ships large or many media files (hero images, product photos, background video, podcasts, fonts), when its image or static site is getting big, or when the user asks how to serve media fast on Ongale.
---

# Serve an app's media from Ongale's CDN

Apps deployed to Ongale from GitHub (web apps, workers, cron jobs and static sites) have **build sync**: on every push, the deploy workflow uploads the files in the repository's `media/` folder to Ongale's CDN. Each file is uploaded once, keyed by its content: a push uploads only new or changed files.

**Plain tags just work:** `<img src="/media/hero.jpg">`, CSS `url(/media/bg.webp)` and `<video src="/media/intro.mp4">` on the app's own address are redirected to the CDN copy of that file. No code change is needed. Files are **shown only on the workspace's own sites** (its `ongale.dev` addresses and connected domains) and in the Ongale dashboard: other websites can't embed them, and opening a file's CDN link directly is refused.

Use it for the media the code ships with (design images, product photos, video, audio, fonts). Files that users upload at run time go to the app's bucket instead (see `ongale-storage`).

## Set up

1. Put the files under `media/` at the repository root, in any subfolders (`media/products/mug.jpg`). To sync other folders, list them in `ongale.json` at the root: `{"media": ["public/images", "assets/video"]}`. The list replaces `media/`; add `"media"` to it to keep it too.
2. Reference the files by their path from the repository root, starting with `/`: `/media/products/mug.jpg`. A relative `media/mug.jpg` only works on pages at the site's root. Spaces and other characters in file names work; keep the exact spelling and case.
3. Optionally, use the CDN address directly, which saves the redirect: read it from the build's manifest, `ongale-media.json`, with a small helper (below). Add `ongale-media.json` to `.gitignore`, since the workflow writes it before each build, and don't exclude it in a `.dockerignore`.
4. Push. The repository's **Actions** run shows "Synced N media files (M images as WebP)" in the **Sync media to Ongale** step, and a warning for each file it left out. If it shows `Media wasn't synced: HTTP Error 403: Forbidden`, the repository has an older Ongale workflow: merge the **Update Ongale deploy workflow** pull request (or `git pull`, if Ongale committed it) and push again.

Synced types, up to these sizes per file: PNG, JPEG, WebP, GIF and AVIF images (50 MB); MP4 and WebM video (1 GB); MP3, OGG and WAV audio (50 MB); WOFF2 fonts (5 MB). Images are stored as WebP (below); GIFs, video, audio and fonts as they are, except that an MP4 whose index sits at its end is made to start fast in the Actions run (no re-encoding). If the step warns `ffmpeg isn't available` for an MP4, export it with *fast start* (or *web optimized*) on and commit that file. Videos are served as files (no streaming), and seeking works. Other files (SVG, PDF, CSS) aren't synced and stay in the app as before. Hidden files are skipped.

## What the app gets

- **Redirects** on the app's own address for every synced path, from the release being served: a rollback brings back that release's files. A push whose sync failed serves the files in its own build.
- **`ongale-media.json`** at the repository root during the build, e.g. `{"media/hero.jpg": "https://cdn.ongale.dev/t_…/app/3f2a….jpg"}`.
- **`MEDIA_URL`** at run time: the CDN folder for these files (`https://cdn.ongale.dev/t_<workspace>/app`). An app that already sets its own `MEDIA_URL` (Django projects often do) keeps it.
- **Images as WebP, at the widths the code asks for:** `/media/hero.jpg` is the full-size WebP, and `/media/hero.jpg?w=640` the 640-pixel one, if the code mentions that width (see *Image versions*).

## Responsive images

Give the browser a few widths and let it choose. Put **`?w=` on every `srcset` entry**, written literally in the markup or template (not computed at run time), so Ongale can see them:

```html
<img
  src="/media/hero.jpg?w=1280"
  srcset="/media/hero.jpg?w=640 640w, /media/hero.jpg?w=1280 1280w, /media/hero.jpg?w=1920 1920w"
  sizes="(max-width: 800px) 100vw, 800px"
  width="1600" height="900" alt="…" loading="lazy" decoding="async">
```

- `sizes` says how wide the image is shown on the page; the browser picks the smallest width that covers it on that screen.
- `width` and `height` are the image's own size (its proportions), so the page doesn't jump while it loads.
- A `srcset` entry without `?w=` (`/media/hero-640.jpg 640w`) is a separate file, not a width of `hero.jpg`: the `640w` alone makes nothing.

## Shown only on the workspace's sites

The CDN checks the page a file is shown on (the browser's `Referer`):
- **Works:** the app's pages on its `ongale.dev` address and connected domains, the Ongale dashboard, and `localhost` while developing.
- **Refused (`403 AccessDenied`, the same answer as for a file that doesn't exist):** other websites, and requests without a `Referer`. That covers a direct visit to the CDN link, "open image in new tab", and tools like `curl`.
- **Don't set `Referrer-Policy: no-referrer`** on the site (or `referrerpolicy="no-referrer"` on a tag): browsers then send no `Referer` and the site's own images are refused. The default policy (`strict-origin-when-cross-origin`) works, and so does `same-origin` for pages that only use the redirect paths.
- **Not for emails:** mail apps send no `Referer`. For images in emails, upload them in **Storage → Media** (they stay public).
- **This stops embedding and hotlinking, not copying.** Anyone who sees an image on the site can still save it. For files only signed-in users may see, use the app's bucket (`ongale-storage`) with short-lived links.
- The owner can change a file's visibility in **Storage → Media → View**: **Private**, **Your sites** or **Public**.

## Helpers (optional: the direct CDN address)

### Node (Express, Fastify, any server)

```js
// media.js
import fs from "node:fs";

let manifest = {};
try {
  manifest = JSON.parse(fs.readFileSync(new URL("./ongale-media.json", import.meta.url), "utf8"));
} catch {} // no manifest: serve the local files
export const media = (path) => manifest[path] ?? `/${path}`;
```

```js
app.use("/media", express.static("media")); // the fallback, in development
res.render("home", { hero: media("media/hero.jpg") });
```

### Next.js

Keep the files in `public/media/`, so Next.js serves them in development, and sync that folder: `ongale.json` is `{"media": ["public/media"]}`. Read the manifest when building, so client components get the addresses too:

```js
// next.config.mjs
import fs from "node:fs";

const manifest = fs.existsSync("ongale-media.json") ? fs.readFileSync("ongale-media.json", "utf8") : "{}";
export default { env: { NEXT_PUBLIC_MEDIA_MANIFEST: manifest } };
```

```ts
// lib/media.ts
const manifest: Record<string, string> = JSON.parse(process.env.NEXT_PUBLIC_MEDIA_MANIFEST || "{}");
// media("public/media/hero.jpg") → the CDN address, or /media/hero.jpg locally
export const media = (path: string) => manifest[path] ?? "/" + path.replace(/^public\//, "");
```

For `next/image` with CDN addresses, allow the host in `next.config.mjs`: `images: { remotePatterns: [{ hostname: "cdn.ongale.dev" }] }`.

### Vite (React, Vue, Svelte) and other static sites

```js
// vite.config.js
import fs from "node:fs";
import { defineConfig } from "vite";

const manifest = fs.existsSync("ongale-media.json") ? JSON.parse(fs.readFileSync("ongale-media.json", "utf8")) : {};
export default defineConfig({ define: { __MEDIA__: JSON.stringify(manifest) } });
```

```js
export const media = (path) => __MEDIA__[path] ?? `/${path}`;
```

A static site packed from the repository root leaves the files that synced out of its upload, since the redirects serve them; files that didn't sync (other types, a failed sync) stay in it. A site built into `dist/` doesn't contain `media/` unless the build copies it.

### Python (Django, Flask, FastAPI)

```python
# media.py
import json, pathlib

try:
  MANIFEST = json.loads((pathlib.Path(__file__).parent / "ongale-media.json").read_text())
except (OSError, ValueError):
  MANIFEST = {}


def media(path: str) -> str:
  return MANIFEST.get(path, "/" + path)
```

Put `media.py` at the repository root, or adjust the path to the manifest. In Django, register `media` as a template global or context processor. Don't confuse it with Django's own `MEDIA_URL` setting for user uploads.

## Image versions

Images are stored and served as **WebP** (about 97% of browsers; there's no other format to fall back to). The **Sync media to Ongale** step makes them in the repository's GitHub Actions run, with libvips, not on Ongale's servers:
- **The full size** of every image, always.
- **Each width the code explicitly mentions**, at exactly that width and never wider than the image. A width is mentioned by:
  - `?w=` right after the image's path, anywhere in the repository's text files (HTML, templates, JS/TS, CSS, Markdown, JSON…), e.g. `/media/hero.jpg?w=640`;
  - `data-ongale-widths="320,640"` on a tag that uses the image;
  - `"widths"` in `ongale.json`, for images named at run time: `{"widths": {"media/products/**": [320, 640]}}`.
- **Any other width** asked for (`?w=` computed at run time) gets the nearest larger version, or the full size: never blurry, sometimes larger than needed. Declare such widths in `ongale.json`.
- Versions count toward the plan's storage, at most 40 per image. **Storage → Media** shows each image's versions.
- If libvips can't be installed in the run, the step warns and uploads images as they are.

## Storage and cleanup

- Synced files count toward the plan's storage, shared with Media and the buckets. When a push would go over it, the sync is skipped with a warning and the app serves the files from its own build (a static site keeps them in its upload).
- **Removing a file from `media/`** takes it off the site with the next deploy. If one of the app's 2 previous releases still uses it (a rollback), only its full-size WebP is kept and everything else is deleted at once; when no kept release uses it, it shows **Deleted <date>** in **Storage → Media** and is deleted 24 hours later. Each automatic deletion is listed in **Analytics → Activity**. A later build that uses the same file again uploads it again.
- **After a rollback**, pages show the full-size images at once; Ongale then starts the repository's deploy workflow in a media-only mode at that release's commit, which makes the widths again within a few minutes and builds nothing. It needs the Ongale GitHub App's **Actions** permission; without it, pages keep the full size.
- In **Storage → Media**, synced files are in the **App** folder; **Unused** filters the ones going away, with **Select all** to delete them sooner. A file the app's live release uses can't be deleted there: remove it from `media/` and push.

## Without GitHub

Build sync runs in Ongale's GitHub workflow. Apps deployed from an image can upload files in **Storage → Media** (or with `media_upload_url` and `media_upload_complete` through the MCP server), make them public and use their addresses.
