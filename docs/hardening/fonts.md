# Geist provenance and build setup

The interface uses [Geist](https://github.com/vercel/geist-font) by Vercel, licensed under the SIL Open Font License 1.1. A copy of the license ships at `public/licenses/Geist-OFL.txt`.

Geist is installed from npm as `@fontsource-variable/geist` (pinned in `package-lock.json`) and imported once at the top of `src/styles.css`. Vite bundles the variable WOFF2 files for same-origin delivery, so the web app, the iOS app (Capacitor) and the Mac app (Electron) all load it locally. There is no runtime font CDN request and no separate download or checksum step during `npm run dev`, `npm run build` or the Docker build.

The variable upright font covers weights 100–900. `font-display: swap` and a system fallback (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`) keep text usable while loading and for unsupported scripts. The app does not synthesize an italic font.

The UI tests (`tests/ui/accessibility.spec.ts`) and the image and packaged-Mac smoke scripts assert that the `Geist Variable` face has loaded.

To update the font, bump `@fontsource-variable/geist`, review the upstream license for changes, and rebuild and test all clients.

## History

Until the new landing and auth design, the app used Satoshi from Fontshare, downloaded and SHA-256-verified at build time by a `fonts:prepare` step. That pipeline (`fonts.source.json`, `scripts/prepare-fonts.cjs`, the `prebuild`/`predev` hooks and the Dockerfile copy steps) was removed when the interface moved to Geist.
