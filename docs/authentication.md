# Account sessions and email sign-in

Website deployment, a new Mac installer, real outbound delivery and physical iOS Keychain testing are separate release steps. Local validation evidence is recorded in [the validation log](hardening/validation.md). No production email was sent during development.

## Package decision

Use pinned Better Auth 1.7.26 with its magic-link plugin and the existing PostgreSQL pool. Its server API sits behind the existing `/api/auth/*` account routes, so user IDs, device identity scopes and pairing records stay stable. The generic Better Auth HTTP handler is not exposed; the API exposes session restore, logout and magic-link request/confirmation, with no password authentication. Former password endpoint URLs return 410 with update guidance. Updated clients show a single email-only signup/sign-in flow and never switch to a password form. This keeps redirects, origins and native signaling under the existing boundary.

Better Auth supports [magic links](https://better-auth.com/docs/plugins/magic-link) and [database-backed sessions](https://better-auth.com/docs/concepts/session-management) in the current Node web process. [SuperTokens](https://supertokens.com/docs/authentication/passwordless/initial-setup) is another maintained option, but its Core deployment adds a service to operate. That is a poorer fit for this app's single web-process deployment. A hosted identity provider would introduce another account service and operational dependency.

Nodemailer uses Ongale SMTP with required STARTTLS. `disposable-email-domains-js` provides a local, version-pinned domain list; it sends no addresses to an external reputation vendor. The Capacitor secure-storage plugin stores login credentials in iOS Keychain. This does not migrate the separate WebCrypto device identity keys into Secure Enclave.

## Session behavior

New clients request a persistent session lasting up to 30 days. Older password-only clients must be updated and cannot sign in to this release. Sessions have an absolute expiry; this integration does not silently extend them or implement rotating refresh tokens.

The website uses a host-only, HttpOnly, SameSite=Lax cookie, with Secure and the `__Host-` prefix on HTTPS. JavaScript receives the active bearer token in memory for authenticated API calls and device-key-authenticated signaling. It is not written to localStorage, IndexedDB or URLs. Same-origin restoration validates the database session before returning it. Restoring account access never restores a remote desktop session or bypasses Mac consent.

Updated Mac clients store the login token through a scoped IPC method using Electron safeStorage, with no plaintext fallback. Updated iOS clients use local Keychain storage with `whenUnlockedThisDeviceOnly` and no iCloud synchronization. The web fallback of the storage plugin is never used. Native clients restore through a bearer-authenticated session endpoint, avoiding reliance on cross-site cookies in WebViews. Passwords are never saved. Clearing native app/site storage and signing out have separate effects on device identity and pairing.

Logout immediately ends local screen sharing/control, then waits for server revocation and native-store removal before showing the logged-out screen. Network failures leave an actionable error. The existing peer heartbeat closes revoked sessions; native input still requires its own approved session. Per-session UI expiry uses timer chunks because a browser's maximum timer delay is shorter than 30 days.

## Magic-link behavior

Enable email sign-in to send a link for either an existing account or a new account. The response does not reveal whether that account exists. Links expire after five minutes and are consumed once by Better Auth, including concurrent redemption attempts. Only a SHA-256 digest is stored as the verification identifier.

The email opens the app root with a fragment token, which is removed from history before rendering the confirmation UI. A page GET does not authenticate or consume the link. Users enter the receiving email and explicitly choose **Continue with email link**; the server checks the recipient before redemption to prevent account-confusion/login-CSRF flows. No caller-supplied callback or external redirect is honored. For native apps, request the link there, then paste the full emailed link into **Paste a sign-in link** in that same app.

## Password retirement

Migration `004_passwordless_only.sql` clears password values, deletes credential accounts and unverified/password-issued sessions, drops the legacy session table and salt/hash/import columns, and prevents new credential/password rows with database constraints. Account IDs, registered device keys and pairing records remain. Existing verified email sessions remain valid. Historical migration files stay in Git so existing databases can upgrade correctly; they do not leave a password login path enabled.

Better Auth is configured with `emailAndPassword.enabled: false`. No password hashing, validation, issuance fallback or account-deletion password branch remains in the application. Its core account schema keeps an unused optional `password` column constrained to NULL; the application cannot store a password in it. Former `/api/auth/login` and `/api/auth/register` URLs respond with 410 and do not inspect or authenticate submitted credentials.

Account deletion requires an email-link session created within five minutes and entering the account email. Malformed supplied authentication settings are rejected before database migrations start.

This is a forward-only authentication cutover: password-only installed clients and the previous password server cannot be used after migration. Configure and verify mail delivery, publish compatible native clients, and schedule a cutover that stops the old web process before applying it. Do not automatically roll back to a password server after retirement; preserve the migration and fix forward. No device or pairing deletion is part of this migration.

## Ongale setup for enftify.com

`support@enftify.com` is a sender address; `enftify.com` is the domain. Creating an inbox does not itself enable application SMTP.

1. In Ongale's domain page for **enftify.com**, enable **Send from your domain** and wait for the platform's sender/DNS verification. Confirm Remotely receives the variable names `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_DOMAIN`. Keep their values in Ongale.
2. Set `SMTP_FROM_ADDRESS=support@enftify.com`. Its domain must equal the platform's `SMTP_FROM_DOMAIN`. The default sender, if omitted, is `no-reply@SMTP_FROM_DOMAIN`.
3. Set `PUBLIC_URL` to the actual HTTPS web-app origin, currently configured by the operator. Production uses `https://enftify.com`. An email domain does not automatically become the web app's origin.

The Mac and iOS apps default to `https://enftify.com` from 0.3.3. Earlier native releases used `https://remotely-marisol-workspace-k1zb.ongale.dev`, which still serves the same service. `shared/account-service.mjs` treats the two as one service: native apps upgrade a saved old address to `enftify.com`, accept sign-in and pairing links from either address, and keep storing sign-ins and device keys under the original key, so updating neither signs users out nor requires re-pairing. The web app always uses the domain the page is served from, because its session cookie belongs to that domain.
4. Generate a high-entropy secret on your own machine, for example with `openssl rand -base64 32`, and save it as the **Secret** variable `BETTER_AUTH_SECRET` in Ongale. Do not paste the generated value into chat, Git or logs.
5. Publish compatible native clients and configure the secret, public origin and outbound mail before the password-retirement cutover. Email links are the only sign-in mode; no mode switch is required. Deploy the code, then verify actual mailbox delivery, request/confirm/replay/expiry, refresh, logout and paired-device consent on real devices.

If `BETTER_AUTH_SECRET` or `PUBLIC_URL` is absent, no new sign-in is possible. Existing verified email sessions can still be restored until they expire. There is no password fallback. Updated clients show that email sign-in is unavailable, with an availability retry, rather than requesting a password. Email sign-in becomes available when the secret, public origin and SMTP settings are all present. `MAGIC_LINK_ENABLED` is retired and no longer read. An inbox is not proof of outbound delivery. SMTP ports come from Ongale; no implicit TLS or plaintext delivery fallback is enabled. The service continues to use the injected database URL unchanged.

For manual local email testing, use an isolated SMTP server that supports STARTTLS and test-only credentials. Automated browser/native tests launch `tests/ui/fixtures/account-server.cjs` against disposable PostgreSQL. It uses the real Better Auth request/verify endpoints and writes fake mail to a private temporary directory, which the test runner deletes. This test-only entry point is not copied into the production Docker image, is not reachable through the production server, and refuses to start without the disposable-test environment. Tests never send real mail or inherit production SMTP credentials.

## Email risk and remaining work

New signups and magic-link requests reject known disposable domains and explicitly configured blocked domains. Flags are stored server-side as an email digest, reason, count and time; they are not public account lookup endpoints. False positives require an operator allowlist correction; there is no password bypass. `EMAIL_DOMAIN_ALLOWLIST` overrides a mistaken classification; `EMAIL_BLOCKED_DOMAINS` adds an operator blocklist. Both accept comma-separated domains and match subdomains. These checks classify domains; they cannot establish that a person is malicious, detect all phishing mailboxes or guarantee deliverability. Review/update the pinned list and define retention/access policies for flags.

Remaining controls include passkeys/MFA for new devices and sensitive actions, an active-login-session list with logout-all, distributed abuse controls and trusted-proxy policy, outbound delivery/bounce monitoring, real-device Keychain and accessibility testing, and independent auth/security review. Native signing/notarization/TestFlight requirements remain unchanged.
