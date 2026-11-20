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
import { SettingsDialog } from '@/components/SettingsDialog';
import { ApprovalCard } from '@/components/ApprovalCard';
import type { Auth } from '@/lib/types';

const BACKGROUND_LIMIT_MS = 5 * 60_000;

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
  const [desktopReady, setDesktopReady] = useState(false);
  // A remembered phone reconnects without a prompt only while the Mac setup is complete.
  useEffect(() => { connection.setAutoApprove(connection.desktop && desktopReady); }, [connection, desktopReady]);
  const heading = useRef<HTMLHeadingElement>(null);
  const desktop = connection.desktop;
  const connected = state.status === 'connected';
  const remoteView = !desktop && !!state.session;
  useEffect(() => { void connection.start(); return () => connection.dispose(); }, [connection]);
  useEffect(() => { heading.current?.focus(); }, [remoteView]);
  // Locking the phone or switching tabs keeps the session; it ends only after a long absence.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden' && !connection.desktop && connection.snapshot().session) timer = setTimeout(() => { if (document.visibilityState === 'hidden') connection.end(); }, BACKGROUND_LIMIT_MS);
    };
    document.addEventListener('visibilitychange', changed);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', changed); };
  }, [connection]);
  const signOut = () => { connection.end(); if (desktop) connection.forgetRemembered(); logout(); };
  const accountLabel = state.ready ? 'Signed in' : state.status === 'connecting' ? 'Connecting account…' : 'Account disconnected';
  return <AppShell actions={<><span className="account-label muted">{auth.user.email}</span>{!desktop && <MacSetupHelp />}<SettingsDialog auth={auth} logout={signOut} /></>}>
    <main className={`page ${remoteView ? 'remote-main' : ''}`} id="main-content" tabIndex={-1}>
      <div className={`page-heading ${remoteView ? 'sr-only' : ''}`}><div className="min-w-0"><h1 ref={heading} tabIndex={-1} className="page-title">{remoteView ? state.session?.name : desktop ? 'Get your Mac ready.' : 'Your Mac, a little closer.'}</h1></div>{!remoteView && <div role="status" aria-atomic="true"><Badge variant="outline" className="account-badge"><span className={`status-dot ${state.ready ? 'online' : ''}`} aria-hidden="true" />{accountLabel}</Badge></div>}</div>
      {accountError && <StatusNotice title="Account needs attention" error>{accountError}</StatusNotice>}
      {state.error && <StatusNotice title="Something needs attention" error dismiss={connection.clearError}>{state.error}</StatusNotice>}
      {!state.ready && state.status === 'offline' && <StatusNotice title="Account connection interrupted"><p>Your desktop session has stopped. Check your network, retry, or sign in again.</p><div className="setup-actions"><Button variant="outline" onClick={connection.retry}>Retry connection</Button><Button variant="ghost" onClick={signOut}>Sign out</Button></div></StatusNotice>}
      {state.pending && desktop && <ApprovalCard key={state.pending.id} connection={connection} pending={state.pending} ready={desktopReady} />}
      {remoteView ? <RemoteSession key={state.session!.id} connection={connection} state={state} /> : <div className={`dashboard-grid ${desktop ? '' : 'devices-only'}`}><div className="min-w-0">
        {desktop ? <><DevicePairing connection={connection} state={state} /><DesktopSetup accountReady={state.ready} busy={!!state.session} onReadyChange={setDesktopReady} />{state.session && <Card className="journey-card mt-5"><div className="session-actions"><p>{state.session.name} · {connected ? 'Connected' : 'Connecting…'}</p><Button variant="destructive" onClick={connection.end}>End session</Button></div><Viewer connection={connection} stream={state.stream} desktop /></Card>}</> : <>{!!Object.keys(state.pins).length && <DevicesPanel devices={state.devices} ready={state.ready} pins={state.pins} connect={connection.connect} />}<DevicePairing key="device-pairing" connection={connection} state={state} />{!Object.keys(state.pins).length && <DevicesPanel devices={state.devices} ready={state.ready} pins={state.pins} connect={connection.connect} />}</>}
      </div>{desktop && <PhoneSetupSteps />}</div>}
      {!remoteView && <p className="connection-footer"><Globe2 size={16} aria-hidden="true" /><span>Your Mac approves every connection.</span></p>}
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
