# Remotely brand assets

The supplied SVGs in `public/icons` are the source artwork and remain unmodified.

- `remotely-logo-5.svg`: blue tile with white wordmark, used by the shared app and documentation header.
- `remotely-logo.svg`: blue mark and dark wordmark for light backgrounds.
- `remotely-logo-2.svg`: white mark and wordmark variant.
- `remotely-logo-1.svg` and `remotely-logo-3.svg`: blue and white standalone marks.
- `remotely-favicon.svg`: gradient app tile, used directly as the browser favicon and as the native icon source.

`Brand` in `src/components/AppShell.tsx` centralizes the header artwork, accessible name, responsive dimensions and forced-colors text fallback. SVGs are referenced directly rather than traced or recolored.

Run `npm run icons:brand` on macOS with Chrome installed to reproduce 192, 512 and 1024 pixel PNGs and the opaque 1024 pixel iOS catalog icon. `PLAYWRIGHT_CHANNEL` can select another installed Chromium channel. The iOS canvas uses the artwork’s blue background to flatten transparent corners; the Mac icon retains transparency. The compatibility `icon.svg` is a copy of the supplied favicon.

Native PNGs are committed so production builds do not need a browser for icon generation. Mac downloads receive the new icon when a new versioned release is built; existing installed copies need that update. Signing and notarization limits are unchanged by this artwork update.
