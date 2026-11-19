Apple Silicon developer beta. macOS 13 or newer. **No Apple Developer ID signature or notarization:** macOS may still block this app. No Intel build is included.

Version 0.2.3 replaces 0.2.2, which had an invalid bundle resource signature. Development binaries are now sealed inside-out using ad-hoc signatures, while preserving existing entitlements and runtime flags. Strict bundle/helper verification, tamper rejection, and packaged-app smoke checks run before and after ZIP extraction. Integrity signatures do not establish a trusted developer identity or Apple notarization.

1. Remove the old 0.2.2 app, download and unzip the new app, then move it to Applications.
2. Sign in with the same account as your phone. Choose a display and grant Screen Recording and Accessibility permissions.
3. Keep Mac Remote open, connect from your phone, and approve the request on the Mac.

If macOS reports a damaged app, stop and report the warning. Do not disable Gatekeeper or remove quarantine attributes. For an unverified-developer warning, consult [Apple’s guidance](https://support.apple.com/en-us/102445); an app-specific exception may be available after verifying the source.

You do not run Node, Docker, npm, or a local server. SHA256SUMS contains the ZIP checksum. Actual OS permission grants, native input, and a clean Mac’s browser-download Gatekeeper experience still require manual validation; a local launch test does not establish those results.
