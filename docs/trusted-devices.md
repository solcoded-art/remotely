# Trusted devices (protocol v1 / app 0.3.0)

This replaces account-only connection authorization. It identifies an approved app/browser installation by possession of a P-256 device key, not by its Wi-Fi MAC address. It does not identify a physical phone independently of its operating system and software.

## User journey

1. Install Mac Remote 0.3.0 or newer. Sign in on the Mac and phone using the same account and server origin.
2. On the Mac, choose **Create pairing link**. Scan the locally rendered QR with the phone Camera, or privately copy and paste the entire link into the phone page. The 256-bit invitation secret expires after two minutes. Never send it to someone else.
3. On the Mac, approve only the pairing request you just made. Pairing saves the two public keys; it does not capture the screen or grant remote input.
4. Select a display, enable the required macOS permissions, then select **Connect** on the paired phone. The Mac must approve every session separately.
5. Use **Revoke** on either paired installation to end its session and remove trust. Reconnecting requires a fresh link and local Mac approval. If one installation is lost, revoke it from the surviving peer.

Phone installations with approved keys show their Macs before the pairing form. Connect remains disabled for unpaired installations. A device listed under an account is not necessarily paired.

## Keys and protocol

- Device IDs are SHA-256 JWK thumbprints (`d_` plus base64url, RFC 7638 canonical EC members). Public keys are restricted to P-256, public coordinates only. Registration binds a one-use, account-bound, 60-second service challenge, name, role and public key to a device signature. A key cannot replace another key or change account/role through registration.
- Each WebSocket has a fresh random challenge. Account authentication **and** a device signature are required. Every subsequent message is signed over that connection challenge, account, device ID and a strictly increasing sequence. Replaying an old message on the same or another connection fails.
- The Mac generates invitation entropy locally. The link carries its public key and secret in a URL fragment; the phone removes that fragment from the address bar before login. The service receives only invitation metadata and an HMAC proof binding invitation/request/account/both devices/the phone key. QR generation stays local. Neither the secret nor private keys are stored in PostgreSQL or sent through signaling.
- The Mac verifies the HMAC locally before showing an approval request. Explicit local approval pins the phone key and signs a grant binding both keys, account and request. The phone verifies that grant against the Mac key from the scanned link before pinning it. A server-side grant is insufficient without the corresponding local pin.
- Both peers check the local pin and grant ID for each session. The phone signs a fresh controller nonce for its connection request, which the Mac checks before showing consent. The Mac signs approval with its own fresh nonce and the controller nonce, and both peers verify approval. This prevents session freshness from depending solely on a server-generated ID. Offer, answer and trickled ICE messages carry additional signatures over the session ID, grant ID, both client nonces, sender, sequence and complete signal. The peer checks its pinned key and sequence **before** accepting the remote SDP or ICE. This authenticates the SDP's DTLS certificate fingerprints, in addition to WebRTC transport encryption.
- Revocation deletes the local pin and ends local capture/input before requesting deletion of the durable service grant. The service ends sessions and informs the other endpoint. Offline peers with a stale pin cannot reconnect through an honest service after its grant has been removed. Re-pairing issues a new grant and ends an older session between those devices.
- The hosted service continues to handle only accounts, discovery, public trust records and signaling. Native capture and bounded input remain in the explicitly approved Mac peer.

Implementation: `shared/trust.mjs` contains the versioned transcripts and crypto primitives; `desktop/identity.cjs` owns native key storage and signing; `src/lib/identity.ts` owns browser storage; `src/lib/connection.ts` coordinates pairing, pin checks and peer negotiation. `002_device_trust.sql` adds public keys and durable trust grants. Migrations run automatically under the existing startup transaction lock.

## Storage and limits

**Mac:** the main process creates a software P-256 key and encrypts its PKCS#8 representation and trust pins with Electron's asynchronous OS-backed safeStorage API. Files are private to the user (0600; directory 0700). Preload exposes public keys and signing operations, never private key material. Encryption or decryption failure stops enrollment; there is no plaintext fallback or silent replacement of an unreadable key. Keychain protection is not a Secure Enclave key or per-operation biometric approval. Because the beta has only an ad-hoc signature, macOS may prompt for Keychain access again after an update.

**Phone website and current Capacitor wrapper:** WebCrypto creates a non-extractable software private key saved as a CryptoKey in IndexedDB. Trust pins are saved in the same origin's storage. Browser storage may be removed by the browser/user, and origin scripts can invoke the key even though they cannot export it. The current iOS wrapper uses this same provider; it has no Keychain/Secure Enclave plugin yet. Do not describe these as hardware-backed or physical-device attestation.

Pairings are scoped to both account and exact service origin. A different browser, app reinstall without retained storage, site-data removal, service-origin change or lost Keychain access can require new pairing. Account login does not recover a device key or bypass local Mac approval. Unreadable native keys require restoring access or a deliberate recovery process; they are not silently reset.

If revocation cannot reach the service, local trust and the local session are still removed, but remote grant deletion is unconfirmed. Revoke from the surviving peer when connected. This version has no logout-all, account MFA, verified-email or device-key recovery flow. Device registration is capped at 20 keyed installations per account; older keyless records do not consume this cap.

## Threat boundaries and outstanding work

A stolen account token alone cannot impersonate a registered installation or authorize a new controller on an existing Mac. It can still expose account discovery metadata and create unrelated installations. Pairing is a possession check for the invitation and device keys; it is not account MFA. Add verified email, MFA/step-up authentication, secure recovery, managed sessions and redacted security event auditing as separate account work.

Pinned signatures protect a correctly installed client from a signaling relay substituting peer certificates. They cannot protect a compromised endpoint or malicious replacement of the website's own JavaScript: origin code can use browser-held keys. A compromised Mac renderer can invoke its permitted signing and approval IPC. Keychain encryption protects at-rest files, not an already compromised running app. Software key backups/clones and an administrator/root attacker remain outside a physical-device identity guarantee. Independently review this protocol and native boundaries before broad release.

No MAC-address allowlist, unattended access, screen recording, arbitrary shell, file transfer or clipboard synchronization is introduced. Apple Developer ID signing/notarization, hardware-backed native iOS keys, physical-device/VoiceOver and carrier/TURN validation remain outstanding.

## Release and testing

This is a breaking authorization change: old account-only clients fail closed with an upgrade message. New clients check the health endpoint’s protocol capability before creating a key, and show an actionable update message when pointed at an older server. Publish `mac-v0.3.0` with its ZIP/checksum **before** deploying the matching web/service revision. `release.config.json` targets that version; the download stays disabled until its artifact is reachable. Update both clients and pair once. Do not roll back to the account-only server as a security workaround; preserve the database migration and fix forward. No new server secret/environment variable or manual production SQL is required.

Automated evidence is recorded in [the validation log](hardening/validation.md). Security tests include enrollment challenge reuse/account/key binding; stolen-token-only authentication; replay across socket connections; cross-account connection rules; endpoint-only revocation and session teardown; rejected stale invitations; and modified/cross-session SDP signatures. Browser tests exercise actual local WebRTC with synthetic capture and mocked input, verify rejected invitation-secret/certificate substitution, storage persistence, revocation and selected axe/reflow states. Native vault unit tests use a fake OS encryption provider and do not establish Apple's platform security guarantees.

References: [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638), [WebRTC Security Architecture](https://www.rfc-editor.org/rfc/rfc8827), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). This document does not claim a completed penetration test, security certification, full WCAG conformance or ADA compliance.
