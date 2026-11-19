import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, Laptop, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { InputField } from '@/components/InputField';
import { StatusNotice } from '@/components/StatusNotice';
import { Button } from '@/components/ui/button';
import { PrimaryAction } from '@/components/PrimaryAction';
import { ConnectionIllustration } from '@/components/ConnectionIllustration';
import { Card } from '@/components/ui/card';
import { MacSetup, MacSetupHelp } from '@/components/MacSetup';
import { accountServer, saveSession, signInLinkToken } from '@/lib/auth-session';
import { request, serviceURL } from '@/lib/api';
import type { Auth } from '@/lib/types';

export function Login({ onLogin, initialToken = '', restoreError = '' }: { onLogin(auth: Auth): void; initialToken?: string; restoreError?: string }) {
  const [email, setEmail] = useState('');
  const [server, setServer] = useState(accountServer);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(restoreError);
  const [mailReady, setMailReady] = useState<boolean | null>(null); const [availabilityCheck, setAvailabilityCheck] = useState(0);
  const [sent, setSent] = useState(false); const [cooldown, setCooldown] = useState(0);
  const [token, setToken] = useState(initialToken); const [pasteLink, setPasteLink] = useState(false); const [link, setLink] = useState('');
  const confirming = !!token || pasteLink;
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
  return <AppShell actions={window.macRemote ? <span className="eyebrow">Mac app</span> : <MacSetupHelp />}>
    <main className="auth-layout" id="main-content" tabIndex={-1}>
      <section className="auth-intro" aria-labelledby="auth-title">
        <span className="auth-kicker"><span />A little closer to your Mac</span>
        <h1 className="auth-title" id="auth-title">Your Mac.<br />Within <em>reach.</em></h1>
        <p className="auth-copy">Your editor, your apps, your own workspace. Connect your devices and pick up where you left off.</p>
        <ConnectionIllustration />
        {!window.macRemote && <MacSetup />}
      </section>
      <Card className="auth-panel gap-0" aria-labelledby="login-title">
        <div className="auth-card-icon" aria-hidden="true"><Mail size={22} /></div>
        <span className="eyebrow auth-card-eyebrow">YOUR PERSONAL WORKSPACE</span>
        <h2 className="text-2xl font-medium tracking-tight" id="login-title">{confirming ? 'Confirm your sign-in' : 'Welcome back'}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{confirming ? 'Enter the email that received this link. Continue only if you requested it.' : 'Enter your email to sign in or create an account. No password needed.'}</p>
        <form onSubmit={submit} aria-busy={busy}>
          <InputField label="Email address" id="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="you@example.com" value={email} onChange={event => { setEmail(event.target.value); if (!confirming) { setSent(false); setCooldown(0); } }} required maxLength={254} />
          {pasteLink && <InputField label="Email sign-in link" type="url" value={link} onChange={event => setLink(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required />}
          {!confirming && <><Button type="button" variant="ghost" className="advanced-trigger" onClick={() => setShowServer(!showServer)} aria-expanded={showServer} aria-controls="account-server-settings">Advanced connection settings<ChevronDown aria-hidden="true" size={15} /></Button>
            {showServer && <div id="account-server-settings"><InputField label="Account server URL" type="url" value={server} onChange={event => setServer(event.target.value)} hint="Only change this if you host your own service. Both devices must use the same HTTPS server." required /></div>}
            {mailReady === null && <p role="status" className="mt-3 text-sm text-muted-foreground">Checking email sign-in…</p>}
            {mailReady === false && <StatusNotice title="Email sign-in is temporarily unavailable"><p>Please try again shortly or contact support.</p><Button type="button" variant="outline" className="mt-2" onClick={() => setAvailabilityCheck(value => value + 1)}>Check availability</Button></StatusNotice>}
          </>}
          {sent && !confirming && <StatusNotice title="Check your inbox">If this email is eligible, a sign-in link will arrive shortly. It expires in five minutes. Check your spam folder too.</StatusNotice>}
          {error && <StatusNotice title="Sign-in failed" error>{error}</StatusNotice>}
          <PrimaryAction type="submit" className="mt-5 w-full" disabled={busy || (confirming ? !email || !token && !link : mailReady !== true || cooldown > 0)}>{busy && <Loader2 className="animate-spin" aria-hidden="true" />}{busy ? confirming ? 'Signing in…' : 'Sending link…' : confirming ? 'Continue with email link' : sent ? cooldown ? `Resend in ${cooldown}s` : 'Resend sign-in link' : 'Send sign-in link'}{!busy && <ArrowRight size={17} aria-hidden="true" />}</PrimaryAction>
        </form>
        <Button variant="ghost" className="mt-3" disabled={busy} onClick={() => { setToken(''); setPasteLink(!confirming); setLink(''); setError(''); }}>{confirming ? 'Back to sign in' : 'Paste a sign-in link'}</Button>
        {!confirming && <p className="mt-3 text-sm text-muted-foreground">Use the link on this device, or paste it here. Keep the Mac app updated so both devices use email sign-in.</p>}
        <p className="auth-security"><ShieldCheck size={18} aria-hidden="true" />Stay signed in for up to 30 days. Sign out on shared devices. Your Mac still approves every screen-sharing session.</p>
      </Card>
    </main>
  </AppShell>;
}
