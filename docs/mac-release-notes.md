Apple Silicon developer beta. macOS 13 or newer. **No Apple Developer ID signature or notarization:** macOS may still block this app. No Intel build is included.

Version 0.3.1 fixes screen capture being rejected after local approval: Electron serializes the bundled origin with a trailing slash. Capture still requires the approved session, selected screen and trusted main frame. Setup/capture errors now remain visible instead of being overwritten by “Mac declined the connection”.

Version 0.3.0 introduced cryptographically paired installations. It adds protected device keys, one-use QR/link pairing with explicit Mac approval, signed session challenges and WebRTC negotiation, and revocation that ends an active session. Account-only 0.2.x clients are incompatible: update both clients and pair once. Device pairing is separate from account MFA, which is not implemented yet.

1. Download and unzip the app, then move it to Applications. Update the phone website when the matching service is deployed.
2. Sign in with the same account and server address on both devices. On the Mac, choose **Create pairing link**. Scan the QR using the phone Camera, or privately paste the full link on the phone, then choose **Allow pairing** on the Mac. The link expires in two minutes; pairing alone does not share the screen.
3. Choose a display and grant Screen Recording and Accessibility permissions. Connect from the paired phone and approve every connection on the Mac. Keep the Mac app open.
4. Use **Revoke** next to a paired device to end its session and require new pairing. Phone keys currently use browser storage, including in the iOS wrapper; clearing storage requires pairing again. They are not hardware-backed keys.

Mac private keys and trust records use OS-backed encrypted storage. macOS can ask for Keychain access, including after an ad-hoc beta update. An unavailable or unreadable Keychain stops key enrollment rather than saving a plaintext key. There is no lost-key recovery through account login.

The bundle retains the v0.2.3 resource-signature repair. Strict bundle/helper verification, tamper rejection, and packaged-app smoke checks run before and after ZIP extraction. Ad-hoc integrity signatures do not establish a trusted developer identity or Apple notarization.

If macOS reports a damaged app, stop and report the warning. Do not disable Gatekeeper or remove quarantine attributes. For an unverified-developer warning, consult [Apple’s guidance](https://support.apple.com/en-us/102445); an app-specific exception may be available after verifying the source.

You do not run Node, Docker, npm, or a local server. SHA256SUMS contains the ZIP checksum. Actual OS permission grants, native input, and a clean Mac’s browser-download Gatekeeper experience still require manual validation; a local launch test does not establish those results.
