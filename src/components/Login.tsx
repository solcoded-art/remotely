import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowRight, ChevronDown, Laptop, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { InputField } from '@/components/InputField';
import { StatusNotice } from '@/components/StatusNotice';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MacSetup, MacSetupHelp } from '@/components/MacSetup';
import { serviceURL, signIn } from '@/lib/api';
import type { Auth } from '@/lib/types';

export function Login({ onLogin }: { onLogin(auth: Auth): void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(() => localStorage.getItem('macremote.server') || import.meta.env.VITE_ACCOUNT_SERVER || (window.macRemote || Capacitor.isNativePlatform() ? 'https://remotely-marisol-workspace-k1zb.ongale.dev' : window.location.origin));
  const [showServer, setShowServer] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { const url = serviceURL(server); const auth = await signIn(url, email, password, register); localStorage.setItem('macremote.server', url); onLogin(auth); }
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
        <form onSubmit={submit} aria-busy={busy}>
          <InputField label="Email address" id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} inputMode="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} />
          <InputField label="Password" id="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} hint="Use at least 12 characters. You can paste from a password manager." value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={256} />
          <label className="password-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Show password</label>
          <Button type="button" variant="ghost" className="advanced-trigger" onClick={() => setShowServer(!showServer)} aria-expanded={showServer} aria-controls="account-server-settings">Advanced connection settings<ChevronDown aria-hidden="true" size={15} /></Button>
          {showServer && <div id="account-server-settings"><InputField label="Account server URL" type="url" value={server} onChange={event => setServer(event.target.value)} hint="Only change this if you host your own service. Both devices must use the same HTTPS server." required /></div>}
          {error && <StatusNotice title={register ? 'Account creation failed' : 'Sign-in failed'} error>{error}</StatusNotice>}
          <Button className="mt-5 w-full" size="lg" disabled={busy}>{busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{busy ? register ? 'Creating account…' : 'Signing in…' : register ? 'Create account' : 'Sign in'}{!busy && <ArrowRight size={17} aria-hidden="true" />}</Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">{register ? 'Already have an account?' : 'First time here?'} <button className="account-toggle" disabled={busy} onClick={() => { setRegister(!register); setPassword(''); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button></p>
        <p className="auth-security"><ShieldCheck size={18} aria-hidden="true" />Your Mac approves each session. Closing a session stops sharing and control.</p>
      </Card>
    </main>
  </AppShell>;
}
