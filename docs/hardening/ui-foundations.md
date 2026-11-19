# UI foundations and journey contracts

The shared React interface serves the browser, Capacitor iOS and Electron Mac. Preserve the native control boundary when reusing components.

## Component responsibilities

| Component | Responsibility and key states |
| --- | --- |
| `ui/*` | Owned shadcn/ui primitives; use the local Tailwind-aware `cn` helper. Buttons wrap text, icon buttons have meaningful names and usable hit areas, dialogs manage focus and scroll. |
| `AppShell` | Shared branding, header actions, skip link and safe areas. Each consuming main has `id="main-content"` and `tabIndex={-1}`. |
| `InputField` | Visible label, stable ID, hint/error association, native input attributes and invalid state. Preserve paste/autofill. |
| `StatusNotice` | Error alerts or informational status with optional dismissal. Do not announce high-frequency transport statistics. |
| `SetupStep` | Ordered requirement, completion text, explanation and optional action/content. Completion is never color-only. |
| `DesktopSetup` / `useMacSetup` | Permission/driver/display readiness; loading, missing permission, unavailable driver and selection failures. OS prompts/capture enumeration require an explicit user action. Refresh permission state on return from Settings. |
| `DevicesPanel` / `DeviceCard` | Account-specific Mac discovery, online/offline/unknown availability, connection request action and empty-state documentation link. Online does not imply permissions granted. |
| `ConnectionProgress` | Approval → peer transport → playing screen. Account sign-in is displayed separately. |
| `Viewer` / `RemoteSession` | Stream playback, retry-play control, pointer shortcut, video readiness and disconnect; controls require both an open channel and playing video. |
| `RemoteControls` / `Trackpad` | App switching/editor launch, text, named keys, gesture trackpad and equivalent pointer/scroll buttons. A drag toggle releases when the tab unmounts or loses availability. |

Use semantic HTML and existing primitives before introducing another UI dependency. Keep feature orchestration out of generic primitives. Connection transport and native platform work should progressively move behind focused, tested interfaces; avoid inheritance or dependency injection solely to satisfy a pattern.

## Layout and interaction rules

- Tokens in `src/styles.css` control Satoshi, surfaces, text, borders, focus and spacing. Font loading is described in `fonts.md`.
- Verify 320/390 CSS-pixel portrait, 844-pixel landscape, tablet and desktop; enlarge text and test WCAG text spacing. Avoid horizontal page scrolling and fixed-height text containers.
- Use 44-pixel action targets where practical, visible keyboard focus, explicit labels, and reduced-motion handling. Cover forced colors and native text settings manually.
- Do not trap page scrolling in a remote gesture surface unless the user interacts with that surface. Preserve button alternatives for gestures and dragging.
- Focus the workspace heading when entering/leaving a session. Dialogs return focus to their trigger. Errors offer recovery without silently replacing useful input.
- Keep detailed Mac installation instructions on the dedicated documentation page. The app should provide concise requirements and a link.
- Full remote screen-reader semantics remain an unresolved product capability. Do not label the whole app WCAG/ADA compliant based on accessible local controls or a clean axe scan.

Tests are living examples of setup-needed/ready, approval, playback stalled/playing, input alternatives, loading/error and download-unavailable states. Future component additions must include relevant keyboard, narrow-layout and recovery checks.
