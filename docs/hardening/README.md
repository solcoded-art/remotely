# Product hardening milestone 1

Status: local implementation; not deployed, signed, certified, or penetration-tested. Updated 2026-11-19.

This milestone makes the Mac setup → phone connection journey explicit, establishes reusable shadcn/ui foundations and Satoshi typography, and records the security/accessibility work required for a public release. Email login, paired Mac selection, native clients, editor access, and TestFlight before App Store remain the product direction.

- [Baseline and prioritized backlog](baseline.md)
- [Threat model](threat-model.md)
- [UI foundations and journey contracts](ui-foundations.md)
- [Font provenance and build behavior](fonts.md)
- [Skill source provenance](skill-sources.json)

## Validation

Run `npm run build`, `npm test`, `npm run test:ui`, and `npm run test:image`. Tests use disposable PostgreSQL; production DATABASE_URL must never be used for assessment fixtures. `npm run dev` and `npm run build` prepare the pinned font automatically. The independent quality workflow is configured for build, account/command tests, browser accessibility/journey tests, and a High/Critical dependency advisory gate on pull requests. Its GitHub execution is not yet verified. The Ongale-managed deployment workflow is untouched.

Axe checks cover rendered login, advanced connection settings, errors, setup, approval, and remote control states. Browser tests use synthetic screen capture and mocked native input. The native shell test checks renderer isolation and refusal of an unapproved session; it does not validate OS permission prompts or physical input. Automated tests do not establish complete WCAG conformance.

Before consumer release, complete manual VoiceOver, keyboard, switch/voice-control and real-device tests, a cross-network relay test, authenticated security testing, and signed distribution validation. Track evidence and exceptions per release. See the baseline for the remaining gates.
