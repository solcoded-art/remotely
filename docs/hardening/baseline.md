# Security and accessibility baseline

Assessed 2026-11-19 from the local working tree, including pending documentation/download work. This is a focused source review and local regression assessment, not a full penetration test or a production assessment. Priority is remediation order, not a claimed CVSS score. Owners below are proposed responsibilities.

## Existing controls and evidence

- `signaling/store.cjs`: parameterized SQL, salted scrypt password hashes, hashed expiring bearer sessions, transactional startup migrations.
- `signaling/service.cjs`: authenticated device discovery and signaling, account ownership checks, explicit desktop approval, origin checks, bounded bodies/messages, temporary TURN credentials when configured.
- `desktop/main.cjs`, `desktop/preload.cjs`, `shared/commands.cjs`: isolated/sandboxed renderer, local IPC sender checks, approved-session gate, bounded native command allowlist. Hosted service has no native capture or input execution path.
- `tests/service.test.cjs` and `tests/commands.test.cjs`: ownership, refusal before approval, stranger signaling rejection, logout revocation, hostile origins, removal of the legacy shell endpoint, bounded native commands.

Passing these checks establishes only their tested behavior. It does not prove every authorization, race, native IPC, or infrastructure path is safe.

## Prioritized remaining work

| ID | Priority / classification | Evidence and implication | Required outcome / owner |
| --- | --- | --- | --- |
| SEC-01 | P1 / missing controls | Auth routes and store provide registration/login/logout/deletion, with no email verification, password reset, or MFA. Email ownership is unproven and recovery is incomplete. | Select managed email authentication or extend the existing system; verify address ownership, use expiring one-use reset links, invalidate affected sessions, and add MFA for sensitive/new-device flows. Security/backend. |
| SEC-02 | P1 / missing controls | Tokens expire after 24 hours and live in renderer memory; no native token persistence or per-device login-session management. Protocol v1 now supplies device-key storage and signed pair revocation; this does not implement refresh-token/logout-all management. Local logout currently discards the UI session even if the server request fails. | Design browser/native session lifecycles, Keychain-backed native persistence, refresh/reuse protection, reliable logout, logout-all and device/session revocation that terminates active peers. Security/backend/native. |
| SEC-03 | P1 / risk | Protocol v1 now verifies the full SDP/ICE signal against locally pinned device keys and a session/grant-bound sequence. Automated relay-substitution rejection is covered; independent cryptographic review, compromised-browser-code defenses and hardware-backed iOS key storage remain outstanding. | Independently review the deployed identity protocol; extend replay, recovery, malicious signaling and endpoint-compromise tests; add native iOS hardware-backed key storage. Protocol/security. |
| SEC-04 | P1 / confirmed distribution gap | `release.config.json` and release documentation mark the planned Mac build unsigned/not notarized. iOS signing/TestFlight is not validated. | Sign/notarize the Mac app and helper, verify entitlements, add a trusted update/rollback strategy, and validate TestFlight on physical devices. Release/native. |
| SEC-05 | P1 / configuration review gap | Hosted responses and the Electron custom protocol now set an explicit CSP, including script source restrictions and blocked native framing. Native renderer sign/pin/approval APIs and safeStorage lifecycle still require independent review. | Review native CSP effectiveness, navigation, IPC schemas, fuses, external links, Electron lifecycle and permission loss using the official Electron checklist. Native/security. |
| SEC-06 | P1 / risk and verification gap | Throttles use `req.socket.remoteAddress` and in-memory buckets. Trusted proxy behavior, multi-instance behavior, abuse budgets and deletion password-hash concurrency are unvalidated. | Define trusted proxy policy; test per-account/per-network limits, pre-auth sockets, expensive operations, queue caps and outages under load without spoofable forwarded headers. Backend/platform. |
| SEC-07 | P1 / verification gap | No real-device or carrier/TURN proof is supplied by synthetic capture tests. | Validate real capture/input, permission denial/revocation, backgrounding, disconnect release, driver crash, NAT and relay fallback. QA/native/platform. |
| SEC-08 | P2 / confirmed dependency advisories | npm audit reports six moderate affected-package entries in Electron packaging, rooted in minimatch GHSA-g3hv-75wg-m249. Production-only audit reports zero advisories at assessment time. These are not six independently proven exploits. | Assess build exposure and a compatible parent/resolver upgrade, run Snyk breakability assessment, package and re-scan. Do not blindly force npm's suggested electron-builder downgrade. Release/security. |
| SEC-09 | P1 / operational verification gap | End-to-end operator audit/alert, backup restore, retention, access controls and incident response evidence is absent from this local review. | Redacted login/device/approval/revocation events, actionable alerts, secret/key rotation, encrypted storage/backups, restoration and rollback exercises, retention/deletion policies, incident and vulnerability disclosure contacts. Platform/security. |
| A11Y-01 | P1 / confirmed capability gap | The streamed Mac display is video; no remote accessibility tree or equivalent semantic navigation is transmitted. | Design and assess an accessible remote interaction approach with assistive-technology users. Local accessible controls alone cannot establish full-product conformance. Product/native/accessibility. |
| A11Y-02 | P1 / verification gap | Automated axe and responsive checks cannot test all WCAG success criteria or the complete native experience. | Manual WCAG 2.2 A/AA criterion matrix for full journeys, VoiceOver on iOS and Mac, hardware keyboard, switch/voice control, text settings, contrast/forced colors, 400% zoom and software keyboard. Independent review and an honest accessibility statement. Accessibility/QA. |

## Fixed in this milestone

- Account connectivity, Mac setup readiness, session approval, peer connection and video playback have separate presentation states. Controls remain locked while video is not playing.
- Permissions and driver status are checked without prompting at startup and refreshed on window focus. Choosing displays and prompting for Accessibility remain explicit actions.
- Mac approval remains blocked by the checklist until account/display/permission/driver checks pass; native enforcement still provides the authoritative boundary.
- Direction key labels are meaningful; keyboard/pointer buttons provide gesture alternatives, including one-pixel pointer steps and click-to-toggle drag.
- Shared Geist typography, form descriptions, skip links, focus treatment, reduced motion, reflow and dialog sizing support the accessibility target. No ADA/WCAG compliance claim is made.

## Assessment method and release gate

Use [OWASP ASVS 5.0](https://asvs.owasp.org/) Level 2 as the proposed web/API baseline, the [OWASP Top 10:2025](https://top10.owasp.org/2025/) taxonomy for reporting, applicable [MASVS](https://mas.owasp.org/MASVS/) controls for iOS, and [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security) for the host. These are targets, not certifications.

The requested OWASP skill requires exploit-validated findings and honest category coverage. Schedule authenticated testing on isolated staging with two separate users and their own Macs/controllers; add privileged accounts only if an actual privileged role exists. Define scope, test data, budgets, cleanup and outbound side effects before running Strix. No production exploitation was performed. Source/infra review must supplement runtime scans, particularly logging, cryptography, design and supply chain controls.

The requested Snyk workflow requires an authenticated Snyk MCP connection, which is not available in this session. npm audit is a supplemental advisory baseline, not a substitute for Snyk SAST/SCA or a completed remediation run. Present concrete issue/fix plans, evaluate breaking-change risk and re-scan each fix. Keep security fixes separate from unrelated refactors.

Release only after identified Critical/High findings are resolved or explicitly risk-accepted, critical journey tests pass on real supported devices, signing and download provenance are verified, operational recovery is demonstrated, and accessibility claims match documented manual evidence. Track every open exception with an owner and review date.


## Authentication follow-up, 2026-11-19

The local authentication candidate partially addresses SEC-01/SEC-02: persistent HttpOnly browser sessions, native OS-protected login-token storage, Better Auth magic links, disposable-domain checks, reliable server logout and immediate local disconnection during logout failure. Local evidence and platform limits are in [validation](validation.md); rollout gates and first-verification behavior are in [authentication](../authentication.md).

Password signup remains unverified for legacy-client compatibility. Password reset, MFA/passkeys, login-session administration/logout-all, distributed throttling/proxy validation, production delivery monitoring and physical-device testing remain open. Domain-list matches do not prove malicious intent. This follow-up does not establish complete security or accessibility compliance.
