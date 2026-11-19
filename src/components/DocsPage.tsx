import { useEffect, type ReactNode } from 'react';
import { ArrowRight, BookOpen, ChevronDown } from 'lucide-react';
import { Header } from '@/components/sections/header';
import { HeroBackdrop } from '@/components/sections/hero';
import { Button } from '@/components/ui/button';
import { MetalButton } from '@/components/ui/metal-button';
import { MacSetupInstructions } from './MacSetup';

const SECTIONS = [
  { id: 'install', label: 'Install & download' },
  { id: 'permissions', label: 'Mac permissions' },
  { id: 'connect', label: 'Connect your phone' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'accessibility', label: 'Accessibility' },
];

// Shared typography for documentation body copy.
const prose = 'text-[0.9375rem] leading-7 text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_li+li]:mt-2.5 [&_ol]:list-decimal [&_ol]:space-y-0 [&_ol]:pl-5 [&_p+p]:mt-4 [&_p+ul]:mt-4 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul+p]:mt-4';

export function DocsPage() {
  useEffect(() => { document.documentElement.classList.add('dark'); }, []);
  return <div className="dark min-h-dvh overflow-x-clip bg-background text-foreground">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <Header />
    <main className="relative isolate" id="main-content" tabIndex={-1}>
      <HeroBackdrop className="h-[360px] opacity-40 sm:h-[400px]" />

      <div className="mx-auto max-w-6xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pr-3 pl-2 text-sm text-muted-foreground"><BookOpen size={14} className="text-brand-300" aria-hidden="true" />Documentation</p>
        <h1 className="mt-5 text-[2.1rem] leading-[1.05] font-semibold tracking-[-0.04em] text-balance sm:text-[2.625rem]">Get your Mac ready to connect</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-pretty text-muted-foreground">Install the Mac app once, then control your Mac from this website on your phone. You do not need to run terminal commands or start a local server.</p>
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-20 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-2 hidden text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase lg:block">On this page</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border pb-4 lg:flex-col lg:gap-0 lg:border-b-0 lg:border-l lg:pb-0">
            {SECTIONS.map(section => <li key={section.id}><a className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground lg:-ml-px lg:border-l lg:border-transparent lg:pl-4 lg:hover:border-brand-300" href={`#${section.id}`}>{section.label}</a></li>)}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <DocSection id="install" step={1} title="Install and open Mac Remote">
            <MacSetupInstructions compact />
          </DocSection>

          <DocSection id="permissions" step={2} title="Sign in and allow Mac permissions">
            <div className={prose}>
              <p>Open Mac Remote from Applications and sign in with the same account you use on your phone. Choose the display you want to share.</p>
              <ul><li><strong>Screen Recording</strong> allows the app to show your selected display.</li><li><strong>Accessibility</strong> allows your approved phone session to move the pointer, click, and type.</li></ul>
              <p>Use <strong>Check permissions</strong> in the Mac app. If a permission is missing, enable Mac Remote in <strong>System Settings → Privacy & Security</strong>. If macOS asks you to quit and reopen the app after a change, do so and choose the display again.</p>
              <p>The Mac app must remain open while you connect. Closing it ends remote access. Automatic launch at login is not available in this beta.</p>
            </div>
          </DocSection>

          <DocSection id="connect" step={3} title="Pair and connect from your phone">
            <div className={prose}>
              <ol><li>Open this website on your phone and sign in with the same account.</li><li>In the Mac app, choose <strong>Create pairing link</strong>. Scan its QR code with your phone’s Camera, or paste the full link into <strong>Pairing link from your Mac</strong> on your phone. Links expire after two minutes.</li><li>Check that you just requested pairing, then choose <strong>Allow pairing</strong> in the Mac app. Pairing does not share your display.</li><li>Find your Mac under <strong>My devices</strong> and tap <strong>Connect</strong>.</li><li>On your Mac, choose <strong>Allow connection</strong>. Your selected display appears on the phone.</li></ol>
              <p className="mt-4">To remove access, choose <strong>Revoke</strong> beside the device in <strong>Paired phones</strong> or <strong>Paired Macs</strong>. An active session ends, and reconnecting requires a new pairing link and Mac approval. For an installation you no longer have, revoke it from the other paired device.</p><p>The Mac stores its device key encrypted with Keychain protection. If macOS asks for Keychain access, allow it only for your verified Mac Remote installation. This developer beta is not Developer ID signed, so an update may prompt again. Phone keys currently use protected browser storage, including in the iOS wrapper; they are not Secure Enclave keys. Clearing site data or changing browsers requires pairing again.</p><p>Use <strong>Apps</strong> to bring your editor or another running app forward, <strong>Mouse</strong> for the trackpad or pointer and scroll buttons, and <strong>Keys</strong> for typing. A window on a different display requires ending the session and selecting that display on your Mac.</p>
              <p>In <strong>Keys</strong>, use <strong>Tab</strong> or <strong>Shift Tab</strong> to move focus forward or backward. <strong>Next tab</strong> and <strong>Prev tab</strong> send Control-Tab and Control-Shift-Tab to the active Mac app. Select your browser or editor under <strong>Apps</strong> first; each app decides how those shortcuts behave.</p>
              <p>The text box accepts multiple lines: press Enter for a new line, then choose <strong>Send text</strong>. Enable <strong>Live typing</strong> to send while typing; the input pad clears after sending, and the Mac screen shows the result. Pending live input is discarded if video or control access stops. Select the target Mac app or field before typing. Use <strong>⌘ A</strong> for Select All and <strong>⌘ Space</strong> for Spotlight; <strong>⌘ V</strong> pastes the Mac’s clipboard, while pasting into the text box sends your phone’s text.</p>
              <p>The screen stays pinned while you scroll through the controls. Choose <strong>Fullscreen view</strong> to enlarge the streamed screen; browsers without fullscreen support use an expanded view. <strong>Exit fullscreen</strong> or Escape returns to the controls. <strong>Mac fullscreen</strong> under Keys sends Control-Command-F to the active Mac app instead.</p>
              <p>Updated clients can stay signed in for up to 30 days. Refreshing restores account access; connecting still requires your Mac’s approval. Use <strong>Account settings → Sign out</strong> on shared devices. Signup and sign-in both use your email; no password is required. Enter your email, choose <strong>Send sign-in link</strong>, then open it on the device you want to sign in to. If sending is unavailable, retry or contact support. In a native app, use <strong>Paste a sign-in link</strong>. Enter the receiving email and confirm the request. Links expire after five minutes and work once.</p>
              <p>Password sign-in has been removed. Sign in with an email link in an updated Mac app. Existing accounts and device pairings remain. Passwordless account deletion requires a fresh email sign-in and confirmation of your email.</p>
              <p><strong>Signed in</strong> confirms your account connection. <strong>Session connected</strong> confirms the peer connection is open and your screen is playing. Controls stay disabled while the display video starts. Keep the phone page in the foreground; backgrounding it ends the session.</p>
            </div>
          </DocSection>

          <DocSection id="troubleshooting" title="Troubleshooting">
            <div className="flex flex-col gap-2">
              <Faq open summary="My Mac is missing or offline"><p>Open the installed Mac Remote app, sign in with the same account, and keep it open. Opening the website in a Mac browser creates a controller; it does not share that Mac’s screen.</p></Faq>
              <Faq summary="Connect is disabled or pairing has expired"><p>Install the current Mac app and reload your phone. Older account-only clients cannot connect to the trusted-device protocol. Create a fresh link in your own Mac app, use the same account and account-server address on both devices, and allow pairing on the Mac. A previous link cannot restore revoked access. Restoring account login does not restore lost device keys.</p></Faq>
              <Faq summary="The Mac app says “Failed to fetch”"><p>Check the internet connection and retry. Both devices must use the same account service. The download defaults to this hosted service; if advanced connection settings were changed, use this website’s HTTPS address. If the address is correct and login still fails, report it to the app owner.</p></Faq>
              <Faq summary="The screen is blank or controls do not respond"><p>Check Screen Recording and Accessibility permissions on the Mac, confirm the intended display is selected, then disconnect and approve a fresh connection.</p></Faq>
              <Faq summary="The connection times out on mobile data or another Wi-Fi network"><p>Try both devices on the same Wi-Fi to isolate the issue. Connections across networks can require a relay configured by the app owner; reinstalling does not configure a missing relay.</p></Faq>
              <Faq summary="The Mac download is unavailable or macOS blocks the app"><p>The download control is enabled only when a published installer is reachable. Use Retry if the download host is temporarily unavailable. This developer beta has an ad-hoc integrity signature, but no Apple Developer ID signature or notarization. macOS can still block it. A signed consumer installer and Intel build are not currently available.</p></Faq>
              <Faq summary="macOS says the app is damaged"><p>Version 0.2.2 had an invalid bundle signature. Remove that copy and download version 0.2.3 or newer. Do not disable Gatekeeper or remove quarantine attributes to work around a damaged-app warning.</p><p>If macOS instead says the developer cannot be verified, this beta is not Apple-notarized. Review <a href="https://support.apple.com/en-us/102445" target="_blank" rel="noopener">Apple’s opening guidance</a>. Only consider an app-specific exception after verifying the source; if the damaged warning persists with the new copy, stop and report it.</p></Faq>
            </div>
          </DocSection>

          <DocSection id="accessibility" title="Accessibility in this beta">
            <div className={prose}><p>The app provides keyboard-operable local controls, pointer movement buttons, and scroll buttons as alternatives to gestures. Remote desktop video does not expose the Mac’s interface to your phone’s screen reader. Full screen reader access to remote apps and a complete WCAG evaluation are still outstanding; this beta does not claim WCAG or ADA compliance.</p></div>
          </DocSection>

          <section aria-labelledby="docs-cta" className="flex flex-col items-start gap-4 rounded-2xl border border-brand-500/30 bg-brand-500/[0.07] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div>
              <h2 className="text-lg font-semibold tracking-tight" id="docs-cta">Ready to connect?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Create your account, then sign in with the same email on your Mac and phone.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <MetalButton asChild className="h-11 gap-2 px-5 text-sm" theme="dark" variant="outline"><a href="/signup">Get started<ArrowRight aria-hidden="true" /></a></MetalButton>
              <Button asChild variant="outline" className="h-11 border-white/10 bg-white/[0.03] px-5 text-sm text-muted-foreground hover:text-foreground"><a href="/login">Sign in</a></Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>;
}

function DocSection({ id, step, title, children }: { id: string; step?: number; title: string; children: ReactNode }) {
  return <section aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-2xl border border-border bg-card/60 p-5 sm:p-7" id={id}>
    <div className="mb-5 flex items-center gap-3">
      {step && <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-300/30 bg-brand-500/15 text-sm font-semibold text-brand-200">{step}</span>}
      <h2 className="text-xl font-semibold tracking-tight" id={`${id}-title`}>{step ? <span className="sr-only">Step {step}: </span> : null}{title}</h2>
    </div>
    {children}
  </section>;
}

function Faq({ summary, open, children }: { summary: string; open?: boolean; children: ReactNode }) {
  return <details className="group rounded-xl border border-border bg-background/40 open:bg-background/70" open={open}>
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-[0.9375rem] font-medium [&::-webkit-details-marker]:hidden">
      {summary}
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className={`${prose} px-4 pb-4`}>{children}</div>
  </details>;
}
