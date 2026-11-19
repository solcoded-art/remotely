import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, Laptop, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { InputField } from '@/components/InputField';
import { StatusNotice } from '@/components/StatusNotice';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MacSetup, MacSetupHelp } from '@/components/MacSetup';
import { accountServer, saveSession, signInLinkToken } from '@/lib/auth-session';
import { request, serviceURL, signIn } from '@/lib/api';
import type { Auth } from '@/lib/types';

export function Login({ onLogin, initialToken = '', restoreError = '' }: { onLogin(auth: Auth): void; initialToken?: string; restoreError?: string }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(accountServer);
  const [showServer, setShowServer] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(restoreError);
  const [magicAvailable, setMagicAvailable] = useState(false); const [magic, setMagic] = useState(false);
  const [sent, setSent] = useState(false); const [token, setToken] = useState(initialToken);
  const [pasteLink, setPasteLink] = useState(false); const [link, setLink] = useState('');
  useEffect(() => {
    let current = true; setMagicAvailable(false);
    const timer = setTimeout(() => { try { void request<{ magicLink: boolean }>(serviceURL(server), '/api/auth/config').then(data => { if (current) setMagicAvailable(data.magicLink); }).catch(() => {}); } catch {} }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [server]);
  async function finish(auth: Auth) { await saveSession(auth); onLogin(auth); }
  async function verifyLink() {
    if (busy) return; setBusy(true); setError('');
    try {
      const service = serviceURL(server); const value = token || signInLinkToken(link, service);
      const result = await request<Omit<Auth, 'service'>>(service, '/api/auth/verify-link', { method: 'POST', data: { token: value, email } });
      await finish({ ...result, service });
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to verify this sign-in link.'); }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const url = serviceURL(server);
      if (magic) { await request(url, '/api/auth/magic-link', { method: 'POST', data: { email } }); setSent(true); }
      else await finish(await signIn(url, email, password, register));
    }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  return <AppShell actions={window.macRemote ? <span className="eyebrow">Mac app</span> : <MacSetupHelp />}>
    <main className="auth-layout" id="main-content" tabIndex={-1}>
      <section className="auth-intro" aria-labelledby="auth-title">
        <div className="connection-art" aria-hidden="true"><span className="connection-node"><Laptop size={30} strokeWidth={1.3} /></span><span className="connection-path" /><span className="connection-node"><Smartphone size={27} strokeWidth={1.3} /></span></div>
        <div className="eyebrow">A little closer to your Mac</div>
        <h1 className="auth-title" id="auth-title">Your desk.<br />In your <em>pocket.</em></h1>
        <p className="auth-copy">Your editor, your apps, your Mac. Install Mac Remote on your Mac, then sign in on your phone with the same account.</p>
        {!window.macRemote && <MacSetup />}
      </section>
      <Card className="auth-panel gap-0" aria-labelledby="login-title">
        <h2 className="text-2xl font-medium tracking-tight" id="login-title">{register ? 'Create your account' : 'Welcome back'}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{register ? 'Use one account on your iPhone and Mac.' : window.macRemote ? 'Sign in to make this Mac available to your phone.' : 'Sign in to find the Macs connected to your account.'}</p>
        {(token || pasteLink) ? <div className="mt-5 space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">Continue only if you requested this email link. It signs this device in to your account.</p>
          <InputField label="Email address" id="confirm-link-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} onChange={event => setEmail(event.target.value)} required />
          {pasteLink && <InputField label="Email sign-in link" type="url" value={link} onChange={event => setLink(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />}
          {error && <StatusNotice title="Sign-in failed" error>{error}</StatusNotice>}
          <Button className="w-full" disabled={busy || !email || !token && !link} onClick={verifyLink}>{busy ? 'Signing in…' : 'Continue with email link'}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { setToken(''); setPasteLink(false); setLink(''); setError(''); }}>Back to sign in</Button>
        </div> : <form onSubmit={submit} aria-busy={busy}>
          <InputField label="Email address" id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} />
          {!magic && <><InputField label="Password" id="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} hint="Use at least 12 characters. You can paste from a password manager." value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={256} />
          <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Show password</label></>}
          <Button type="button" variant="ghost" className="advanced-trigger" onClick={() => setShowServer(!showServer)} aria-expanded={showServer} aria-controls="account-server-settings">Advanced connection settings<ChevronDown aria-hidden="true" size={15} /></Button>
          {showServer && <div id="account-server-settings"><InputField label="Account server URL" type="url" value={server} onChange={event => setServer(event.target.value)} hint="Only change this if you host your own service. Both devices must use the same HTTPS server." required /></div>}
          {sent && <StatusNotice title="Check your inbox">If this email is eligible, a sign-in link will arrive shortly. It expires in five minutes. Check your spam folder too.</StatusNotice>}{error && <StatusNotice title={register ? 'Account creation failed' : 'Sign-in failed'} error>{error}</StatusNotice>}
          <Button className="mt-5 w-full" size="lg" disabled={busy || magic && sent}>{busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{busy ? magic ? 'Sending link…' : register ? 'Creating account…' : 'Signing in…' : magic ? sent ? 'Link requested' : 'Send sign-in link' : register ? 'Create account' : 'Sign in'}{!busy && <ArrowRight size={17} aria-hidden="true" />}</Button>
        </form>}
        {!token && !pasteLink && magicAvailable && <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { setMagic(!magic); setPassword(''); setError(''); setSent(false); }}>{magic ? 'Use a password' : 'Email me a sign-in link'}</Button><Button variant="ghost" disabled={busy} onClick={() => { setPasteLink(true); setError(''); }}>Paste a sign-in link</Button></div>}
        {magic && !token && !pasteLink && <p className="mt-3 text-sm text-muted-foreground">One email link signs in or creates an account. Open it on this device, or paste the link here. For an existing unverified account, the first email sign-in replaces the old password and signs out other devices. Those devices need an updated app with email sign-in.</p>}
        <p hidden={magic || !!token || pasteLink} className="mt-4 text-center text-sm text-muted-foreground">{register ? 'Already have an account?' : 'First time here?'} <button className="account-toggle" disabled={busy} onClick={() => { setRegister(!register); setPassword(''); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button></p>
        <p className="auth-security"><ShieldCheck size={18} aria-hidden="true" />Stay signed in for up to 30 days. Sign out on shared devices. Your Mac still approves every screen-sharing session.</p>
      </Card>
    </main>
  </AppShell>;
}
