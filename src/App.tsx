import { DevicePairing } from '@/components/DevicePairing';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Globe2, Loader2, LogOut, Settings2, ShieldCheck, Smartphone } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Login } from '@/components/Login';
import { Landing } from '@/components/Landing';
import { UpdateBanner } from '@/components/UpdateBanner';
import { isWebClient, publicRoute } from '@/lib/routes';
import { DesktopSetup } from '@/components/DesktopSetup';
import { DevicesPanel } from '@/components/DevicesPanel';
import { RemoteSession } from '@/components/RemoteSession';
import { SetupStep } from '@/components/SetupStep';
import { StatusNotice } from '@/components/StatusNotice';
import { Viewer } from '@/components/Viewer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { clearSession, restoreSession, takeSignInToken } from '@/lib/auth-session';
import { request } from '@/lib/api';
import { Connection } from '@/lib/connection';
import { MacSetupHelp } from '@/components/MacSetup';
import type { Auth } from '@/lib/types';

function Settings({ auth, logout }: { auth: Auth; logout(): void }) {
  const [confirmEmail, setConfirmEmail] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  return <Dialog onOpenChange={() => { setConfirmEmail(''); setError(''); setConfirmDelete(false); }}><DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="Account settings"><Settings2 size={17} /></Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Account settings</DialogTitle><DialogDescription>Your account connects your iPhone and Mac.</DialogDescription></DialogHeader>
      <p className="break-all text-sm">{auth.user.email}</p><p className="break-all text-xs text-muted-foreground">{auth.service}</p>
      <p className="text-xs leading-6 text-muted-foreground">Stay signed in for up to 30 days. Sign out before someone else uses this device.</p>
      <DialogClose asChild><Button variant="outline" onClick={logout}><LogOut />Sign out</Button></DialogClose>
      <div className="border-t border-border pt-4">
        {!confirmDelete ? <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>Delete account…</Button> : <form onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError('');
          try { await request(auth.service, '/api/account', { token: auth.token, method: 'DELETE', data: { confirmEmail } }); logout(); }
          catch (error) { setError(error instanceof Error ? error.message : 'Deletion failed.'); } finally { setBusy(false); }
        }}><p className="mb-3 text-xs leading-6 text-muted-foreground">Permanently delete your account, login sessions, and paired devices. Sign in with a fresh email link (within five minutes), then enter your email to confirm.</p><Input aria-label="Confirm account email" type="email" autoComplete="email" required value={confirmEmail} onChange={event => setConfirmEmail(event.target.value)} />{error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}<Button variant="destructive" className="mt-3 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Permanently delete account</Button></form>}
      </div>
    </DialogContent>
  </Dialog>;
}

function PhoneSetupSteps() {
  return <Card className="journey-card"><span className="eyebrow">Next, on your phone</span><h2 className="section-title mt-2">Connect in three steps</h2>
    <ol className="setup-checklist">
      <SetupStep number={1} title="Sign in on your phone" description="Use the same email account as this Mac." />
      <SetupStep number={2} title="Pair this installation" description="Scan the one-use link above with your phone’s Camera, then allow pairing here." />
      <SetupStep number={3} title="Connect and approve here" description="Select your paired Mac on your phone. Choose Allow connection to share the selected display and enable controls." />
    </ol><p className="connection-footer"><ShieldCheck size={17} aria-hidden="true" />You stay in control. End the session here at any time.</p>
  </Card>;
}

function Workspace({ auth, logout, accountError = '' }: { auth: Auth; logout(): void; accountError?: string }) {
  const connection = useMemo(() => new Connection(auth), [auth]);
  const state = useSyncExternalStore(connection.subscribe, connection.snapshot);
  const [approving, setApproving] = useState(false);
  const [desktopReady, setDesktopReady] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const desktop = connection.desktop;
  const connected = state.status === 'connected';
  const remoteView = !desktop && !!state.session;
  useEffect(() => { void connection.start(); return () => connection.dispose(); }, [connection]);
  useEffect(() => { heading.current?.focus(); }, [remoteView]);
  useEffect(() => {
    const endOnBackground = () => { if (document.visibilityState === 'hidden' && !connection.desktop && connection.snapshot().session) connection.end(); };
    document.addEventListener('visibilitychange', endOnBackground);
    return () => document.removeEventListener('visibilitychange', endOnBackground);
  }, [connection]);
  const signOut = () => { connection.end(); logout(); };
  const accountLabel = state.ready ? 'Signed in' : state.status === 'connecting' ? 'Connecting account…' : 'Account disconnected';
  return <AppShell actions={<><span className="account-label muted">{auth.user.email}</span>{!desktop && <MacSetupHelp />}<Settings auth={auth} logout={signOut} /></>}>
    <main className={`page ${remoteView ? 'remote-main' : ''}`} id="main-content" tabIndex={-1}>
      <div className="page-heading"><div className="min-w-0"><div className="eyebrow">{desktop ? 'Mac app' : remoteView ? 'Remote workspace' : 'Your personal workspace'}</div><h1 ref={heading} tabIndex={-1} className="page-title">{remoteView ? state.session?.name : desktop ? 'Get your Mac ready.' : 'Your Mac, a little closer.'}</h1><p className="text-base leading-7 text-muted-foreground">{remoteView ? 'Your apps and your editor, right where you left them.' : desktop ? 'Finish setup, then approve your phone’s connection here.' : 'Choose a Mac to request screen sharing and control.'}</p></div><div role="status" aria-atomic="true"><Badge variant="outline" className="account-badge"><span className={`status-dot ${state.ready ? 'online' : ''}`} aria-hidden="true" />{accountLabel}</Badge></div></div>
      {accountError && <StatusNotice title="Account needs attention" error>{accountError}</StatusNotice>}
      {state.error && <StatusNotice title="Something needs attention" error dismiss={connection.clearError}>{state.error}</StatusNotice>}
      {!state.ready && state.status === 'offline' && <StatusNotice title="Account connection interrupted"><p>Your desktop session has stopped. Check your network, retry, or sign in again.</p><div className="setup-actions"><Button variant="outline" onClick={connection.retry}>Retry connection</Button><Button variant="ghost" onClick={signOut}>Sign out</Button></div></StatusNotice>}
      {state.pending && desktop && <Card className="approval-card" aria-labelledby="approval-title"><div role="status" aria-atomic="true" className="flex items-start gap-3"><Smartphone className="text-primary" aria-hidden="true" /><div><h2 id="approval-title" className="text-lg font-medium">{state.pending.name} wants to connect</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Paired with this Mac using its device key. Allowing this request shares your selected display and enables mouse and keyboard control.</p></div></div>{!desktopReady && <p className="text-sm text-muted-foreground">Complete the Mac setup checklist below before allowing this request.</p>}<div className="setup-actions"><Button disabled={approving || !desktopReady} onClick={async () => { setApproving(true); try { await connection.approve(); } finally { setApproving(false); } }}>{approving && <Loader2 className="animate-spin" aria-hidden="true" />}Allow connection</Button><Button variant="outline" disabled={approving} onClick={connection.decline}>Decline</Button></div></Card>}
      {remoteView ? <RemoteSession key={state.session!.id} connection={connection} state={state} /> : <div className={`dashboard-grid ${desktop ? '' : 'devices-only'}`}><div className="min-w-0">
        {desktop ? <><DevicePairing connection={connection} state={state} /><DesktopSetup accountReady={state.ready} busy={!!state.session} onReadyChange={setDesktopReady} />{state.session && <Card className="journey-card mt-5"><div className="session-actions"><p>{state.session.name} · {connected ? 'Connected' : 'Connecting…'}</p><Button variant="destructive" onClick={connection.end}>End session</Button></div><Viewer connection={connection} stream={state.stream} connected={connected} desktop /></Card>}</> : <>{!!Object.keys(state.pins).length && <DevicesPanel devices={state.devices} ready={state.ready} pins={state.pins} connect={connection.connect} />}<DevicePairing key="device-pairing" connection={connection} state={state} />{!Object.keys(state.pins).length && <DevicesPanel devices={state.devices} ready={state.ready} pins={state.pins} connect={connection.connect} />}</>}
      </div>{desktop && <PhoneSetupSteps />}</div>}
      <p className="connection-footer"><Globe2 size={16} aria-hidden="true" /><span>Your Mac approves every connection.{!desktop && ' Keep this page in the foreground during a session.'}</span></p>
    </main>
  </AppShell>;
}

const initialSignInToken = takeSignInToken();
export default function App() {
  // The update prompt only exists in the Mac app; it overlays every screen.
  return <><AppContent />{window.macRemote && <UpdateBanner />}</>;
}

function AppContent() {
  const [linkToken, setLinkToken] = useState(initialSignInToken);
  const [auth, setAuth] = useState<Auth | null>(null); const [restoring, setRestoring] = useState(!initialSignInToken);
  const [accountError, setAccountError] = useState('');
  useEffect(() => {
    if (initialSignInToken) return;
    let current = true;
    void restoreSession().then(value => { if (current) setAuth(value); }).catch(error => {
      if (current) setAccountError(error instanceof Error ? error.message : 'Unable to restore your sign-in.');
    }).finally(() => { if (current) setRestoring(false); });
    return () => { current = false; };
  }, []);
  async function logout() {
    if (!auth) return;
    try {
      try { await request(auth.service, '/api/auth/logout', { token: auth.token, method: 'POST' }); }
      catch (error) { if (!(error instanceof Error && 'status' in error && error.status === 401)) throw error; }
      await clearSession(auth.service);
      // After signing out on the web, land on the sign-in page rather than the marketing page.
      if (isWebClient()) history.replaceState(null, '', '/login');
      setAuth(null); setAccountError('');
    } catch { setAccountError('Sign-out could not finish. Check your connection and try again.'); }
  }
  const route = publicRoute();
  // Web visitors at `/` get the landing page straight away (even while a stored
  // session is being checked); sign-in links and native apps go to sign-in.
  if (!auth && route === 'home' && !linkToken) return <Landing />;
  if (restoring) return <AppShell><main id="main-content" className="page" tabIndex={-1}><p role="status" className="flex items-center gap-2"><Loader2 className="animate-spin" aria-hidden="true" />Restoring your sign-in…</p></main></AppShell>;
  return auth ? <Workspace auth={auth} logout={logout} accountError={accountError} /> : <Login key={route} mode={route === 'sign-up' ? 'sign-up' : 'sign-in'} initialToken={linkToken} restoreError={accountError} onLogin={value => {
    setLinkToken(''); setAccountError('');
    if (isWebClient() && route !== 'home') history.replaceState(null, '', '/');
    setAuth(value);
  }} />;
}
