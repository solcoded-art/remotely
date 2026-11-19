import { ArrowLeft } from 'lucide-react';
import { Brand } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { MacSetupInstructions } from './MacSetup';

export function DocsPage() {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="app-header"><Brand href="/" /><Button asChild variant="outline"><a href="/"><ArrowLeft size={15} />Back to app</a></Button></header>
    <main className="docs-page" id="main-content" tabIndex={-1}>
      <div className="eyebrow">Documentation</div><h1 className="page-title">Get your Mac ready to connect</h1>
      <p className="docs-lead">Install the Mac app once, then control your Mac from this website on your phone. You do not need to run terminal commands or start a local server.</p>
      <nav className="docs-nav" aria-label="On this page"><a href="#install">Install & download</a><a href="#permissions">Mac permissions</a><a href="#connect">Connect your phone</a><a href="#troubleshooting">Troubleshooting</a></nav>
      <section id="install" className="docs-section"><h2>1. Install and open Mac Remote</h2><MacSetupInstructions compact /></section>
      <section id="permissions" className="docs-section"><h2>2. Sign in and allow Mac permissions</h2>
        <p>Open Mac Remote from Applications and sign in with the same account you use on your phone. Choose the display you want to share.</p>
        <ul><li><strong>Screen Recording</strong> allows the app to show your selected display.</li><li><strong>Accessibility</strong> allows your approved phone session to move the pointer, click, and type.</li></ul>
        <p>Use <strong>Check permissions</strong> in the Mac app. If a permission is missing, enable Mac Remote in <strong>System Settings → Privacy & Security</strong>. If macOS asks you to quit and reopen the app after a change, do so and choose the display again.</p>
        <p>The Mac app must remain open while you connect. Closing it ends remote access. Automatic launch at login is not available in this beta.</p>
      </section>
      <section id="connect" className="docs-section"><h2>3. Connect from your phone</h2>
        <ol><li>Open this website on your phone and sign in with the same account.</li><li>Find your Mac under <strong>My devices</strong> and tap <strong>Connect</strong>.</li><li>On your Mac, choose <strong>Allow connection</strong>. Your selected display appears on the phone.</li></ol>
        <p>Use <strong>Apps</strong> to bring your editor or another running app forward, <strong>Mouse</strong> for the trackpad or pointer and scroll buttons, and <strong>Keys</strong> for typing. A window on a different display requires ending the session and selecting that display on your Mac.</p>
        <p><strong>Signed in</strong> confirms your account connection. <strong>Session connected</strong> confirms the peer connection is open and your screen is playing. Controls stay disabled while the display video starts. Keep the phone page in the foreground; backgrounding it ends the session.</p>
      </section>
      <section id="troubleshooting" className="docs-section"><h2>Troubleshooting</h2>
        <details open><summary>My Mac is missing or offline</summary><p>Open the installed Mac Remote app, sign in with the same account, and keep it open. Opening the website in a Mac browser creates a controller; it does not share that Mac’s screen.</p></details>
        <details><summary>The Mac app says “Failed to fetch”</summary><p>Check the internet connection and retry. Both devices must use the same account service. The download defaults to this hosted service; if advanced connection settings were changed, use this website’s HTTPS address. If the address is correct and login still fails, report it to the app owner.</p></details>
        <details><summary>The screen is blank or controls do not respond</summary><p>Check Screen Recording and Accessibility permissions on the Mac, confirm the intended display is selected, then disconnect and approve a fresh connection.</p></details>
        <details><summary>The connection times out on mobile data or another Wi-Fi network</summary><p>Try both devices on the same Wi-Fi to isolate the issue. Connections across networks can require a relay configured by the app owner; changing your password or reinstalling is not a solution to a missing relay.</p></details>
        <details><summary>The Mac download is unavailable or macOS blocks the app</summary><p>The download control is enabled only when a published installer is reachable. Use Retry if the download host is temporarily unavailable. This developer beta has an ad-hoc integrity signature, but no Apple Developer ID signature or notarization. macOS can still block it. A signed consumer installer and Intel build are not currently available.</p></details>
        <details><summary>macOS says the app is damaged</summary><p>Version 0.2.2 had an invalid bundle signature. Remove that copy and download version 0.2.3 or newer. Do not disable Gatekeeper or remove quarantine attributes to work around a damaged-app warning.</p><p>If macOS instead says the developer cannot be verified, this beta is not Apple-notarized. Review <a className="underline" href="https://support.apple.com/en-us/102445" target="_blank" rel="noopener">Apple’s opening guidance</a>. Only consider an app-specific exception after verifying the source; if the damaged warning persists with the new copy, stop and report it.</p></details>
      </section>
      <section className="docs-section" aria-labelledby="accessibility-help"><h2 id="accessibility-help">Accessibility in this beta</h2><p>The app provides keyboard-operable local controls, pointer movement buttons, and scroll buttons as alternatives to gestures. Remote desktop video does not expose the Mac’s interface to your phone’s screen reader. Full screen reader access to remote apps and a complete WCAG evaluation are still outstanding; this beta does not claim WCAG or ADA compliance.</p></section>
      <Button asChild className="mt-6"><a href="/">Return to Mac Remote</a></Button>
    </main>
  </div>;
}
