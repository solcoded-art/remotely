import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { AuthCover } from '@/components/auth/auth-cover';
import { InputField } from '@/components/InputField';
import { StatusNotice } from '@/components/StatusNotice';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { MetalButton } from '@/components/ui/metal-button';
import { MacSetup, MacSetupHelp } from '@/components/MacSetup';
import { accountServer, saveSession, signInLinkToken } from '@/lib/auth-session';
import { request, serviceURL } from '@/lib/api';
import { isWebClient } from '@/lib/routes';
import type { Auth } from '@/lib/types';

export type AuthMode = 'sign-in' | 'sign-up';

const COPY: Record<AuthMode, { title: string; description: string; submit: string; switchText: string; switchLink: string; switchTo: AuthMode; path: string }> = {
  'sign-in': {
    title: 'Welcome back',
    description: 'Enter your email and we’ll send you a sign-in link. No password needed.',
    submit: 'Send sign-in link',
    switchText: 'New to Remotely?', switchLink: 'Create an account', switchTo: 'sign-up', path: '/login',
  },
  'sign-up': {
    title: 'Create your account',
    description: 'Enter your email to get started. We’ll send a link to confirm it. No password needed.',
    submit: 'Create account',
    switchText: 'Already have an account?', switchLink: 'Sign in', switchTo: 'sign-in', path: '/signup',
  },
};

/**
 * Email-only sign-in and sign-up, laid out like shadcn's `signup-02` block:
 * form column plus a cover panel. Sign-up and sign-in are the same magic-link
 * request; the mode only changes the copy.
 */
export function Login({ onLogin, initialToken = '', restoreError = '', mode: initialMode = 'sign-in' }: { onLogin(auth: Auth): void; initialToken?: string; restoreError?: string; mode?: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [server, setServer] = useState(accountServer);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(restoreError);
  const [mailReady, setMailReady] = useState<boolean | null>(null); const [availabilityCheck, setAvailabilityCheck] = useState(0);
  const [sent, setSent] = useState(false); const [cooldown, setCooldown] = useState(0);
  const [token, setToken] = useState(initialToken); const [pasteLink, setPasteLink] = useState(false); const [link, setLink] = useState('');
  const confirming = !!token || pasteLink;
  const copy = COPY[mode];
  useEffect(() => { document.title = mode === 'sign-up' ? 'Create account · Remotely' : 'Sign in · Remotely'; }, [mode]);
  useEffect(() => {
    let current = true; setMailReady(null);
    const timer = setTimeout(() => {
      try { void request<{ magicLink: boolean }>(serviceURL(server), '/api/auth/config').then(data => { if (current) setMailReady(data.magicLink === true); }).catch(() => { if (current) setMailReady(false); }); }
      catch { if (current) setMailReady(false); }
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [server, availabilityCheck]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const service = serviceURL(server);
      if (confirming) {
        const value = token || signInLinkToken(link, service);
        const result = await request<Omit<Auth, 'service'>>(service, '/api/auth/verify-link', { method: 'POST', data: { token: value, email } });
        const auth = { ...result, service }; await saveSession(auth); onLogin(auth);
      } else {
        await request(service, '/api/auth/magic-link', { method: 'POST', data: { email } }); setSent(true); setCooldown(60);
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  function switchMode(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const next = COPY[copy.switchTo];
    setMode(copy.switchTo);
    if (isWebClient()) history.replaceState(null, '', next.path);
  }
  const submitLabel = busy ? confirming ? 'Signing in…' : 'Sending link…' : confirming ? 'Continue with email link' : sent ? cooldown ? `Resend in ${cooldown}s` : 'Resend sign-in link' : copy.submit;

  return <div className="app-shell dark grid min-h-dvh overflow-x-clip lg:grid-cols-2">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <div className="flex min-w-0 flex-col gap-4 p-6 md:p-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <a aria-label="Remotely home" className="shrink-0 rounded-md text-foreground" href={isWebClient() ? '/' : undefined}>
          <Logo className="h-7 w-auto" />
        </a>
        <div className="header-actions">{window.macRemote ? <span className="eyebrow">Mac app</span> : <MacSetupHelp />}</div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center py-8" id="main-content" tabIndex={-1}>
        <section aria-labelledby="login-title" className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col items-center gap-1 text-center">
            {confirming && <span className="mb-3 flex size-12 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-500/15 text-brand-200" aria-hidden="true"><MailCheck size={20} /></span>}
            <h1 className="text-2xl font-semibold tracking-tight" id="login-title">{confirming ? 'Confirm your sign-in' : copy.title}</h1>
            <p className="text-sm text-balance text-muted-foreground">{confirming ? 'Enter the email that received this link. Continue only if you requested it.' : copy.description}</p>
          </div>

          <form onSubmit={submit} aria-busy={busy} className="flex flex-col">
            <InputField label="Email address" id="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="you@example.com" value={email} onChange={event => { setEmail(event.target.value); if (!confirming) { setSent(false); setCooldown(0); } }} required maxLength={254} />
            {pasteLink && <InputField label="Email sign-in link" type="url" value={link} onChange={event => setLink(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required />}
            {!confirming && <><Button type="button" variant="ghost" className="advanced-trigger self-start" onClick={() => setShowServer(!showServer)} aria-expanded={showServer} aria-controls="account-server-settings">Advanced connection settings<ChevronDown aria-hidden="true" size={15} /></Button>
              {showServer && <div id="account-server-settings"><InputField label="Account server URL" type="url" value={server} onChange={event => setServer(event.target.value)} hint="Only change this if you host your own service. Both devices must use the same HTTPS server." required /></div>}
              {mailReady === null && <p role="status" className="mt-3 text-sm text-muted-foreground">Checking email sign-in…</p>}
              {mailReady === false && <StatusNotice title="Email sign-in is temporarily unavailable"><p>Please try again shortly or contact support.</p><Button type="button" variant="outline" className="mt-2" onClick={() => setAvailabilityCheck(value => value + 1)}>Check availability</Button></StatusNotice>}
            </>}
            {sent && !confirming && <StatusNotice title="Check your inbox">If this email is eligible, a sign-in link will arrive shortly. It expires in five minutes. Check your spam folder too.</StatusNotice>}
            {error && <StatusNotice title="Sign-in failed" error>{error}</StatusNotice>}
            <MetalButton type="submit" className="h-11 w-full gap-2 text-sm" metalFxClassName="mt-5 w-full" theme="dark" variant="outline" disabled={busy || (confirming ? !email || !token && !link : mailReady !== true || cooldown > 0)}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}{submitLabel}{!busy && <ArrowRight aria-hidden="true" />}
            </MetalButton>
          </form>

          <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" aria-hidden="true" />{confirming ? 'Wrong link?' : 'Opened the email elsewhere?'}<span className="h-px flex-1 bg-border" aria-hidden="true" /></div>

          <div className="flex flex-col gap-3">
            <Button variant="outline" className="h-11 w-full border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => { setToken(''); setPasteLink(!confirming); setLink(''); setError(''); }}>{confirming ? 'Back to sign in' : 'Paste a sign-in link'}</Button>
            {!confirming && <p className="text-center text-xs leading-5 text-muted-foreground">Use the link on this device, or paste it here. Keep the Mac app updated so both devices use email sign-in.</p>}
          </div>

          <p className="flex items-start gap-2.5 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-px shrink-0 text-primary" aria-hidden="true" />Stay signed in for up to 30 days. Sign out on shared devices. Your Mac still approves every screen-sharing session.</p>

          {!confirming && <p className="text-center text-sm text-muted-foreground">{copy.switchText} <a className="text-foreground underline underline-offset-4" href={COPY[copy.switchTo].path} onClick={switchMode}>{copy.switchLink}</a></p>}

          {!window.macRemote && <MacSetup />}
        </section>
      </main>
    </div>

    <AuthCover />
  </div>;
}
