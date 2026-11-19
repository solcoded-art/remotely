# Satoshi provenance and build setup

Satoshi is supplied by [Fontshare / Indian Type Foundry](https://www.fontshare.com/fonts/satoshi). The official download retrieved 2026-11-19 includes ITF Free Font License 2.0 (17 Aug 2026). A copy is retained in `public/licenses/Satoshi-FFL.txt` and bundled with the app.

The license permits self-hosting for the licensee's own website and embedding in mobile/desktop applications. It restricts redistribution through repositories and prohibits modifying/subsetting/converting the font without permission. Therefore font binaries are ignored by Git, Docker ignores local font caches, and clean builds obtain the unmodified font from the official Fontshare CDN. Do not upload the font as a standalone repository asset or offer it as a selectable font for third-party content creation.

`fonts.source.json` pins the official URL and SHA-256. `npm run fonts:prepare` downloads and verifies the WOFF2 signature, size and checksum before writing `src/assets/fonts/Satoshi-Variable.woff2`. An intact cached copy works offline. Both `npm run dev` and `npm run build` call preparation automatically. The Docker build copies the preparation script and manifest and verifies a fresh download.

Vite bundles the font for same-origin delivery and native app use. There is no runtime font CDN request. `font-display: swap` and a system fallback keep text usable while loading. The variable upright font supplies weights 300–900; system fallbacks cover unsupported scripts. The app does not synthesize an italic font.

A clean build needs network access to the pinned Fontshare asset. If unavailable, restore the exact verified file from a permitted internal cache or retry. Do not silently replace the checksum or commit the font. For an upstream update, obtain it from Fontshare, review the current license, verify provenance, update the manifest checksum intentionally, and rebuild/test all clients. Each independent user of the font must comply with the license; see the full bundled text for terms.
