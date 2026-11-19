import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Globe2, Loader2, LogOut, Settings2, ShieldCheck, Smartphone } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Login } from '@/components/Login';
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { request } from '@/lib/api';
import { Connection } from '@/lib/connection';
import { MacSetupHelp } from '@/components/MacSetup';
import type { Auth } from '@/lib/types';

function Settings({ auth, logout }: { auth: Auth; logout(): void }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  return <Dialog onOpenChange={() => { setPassword(''); setError(''); setConfirmDelete(false); }}><DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="Account settings"><Settings2 size={17} /></Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Account settings</DialogTitle><DialogDescription>Your account connects your iPhone and Mac.</DialogDescription></DialogHeader>
      <p className="break-all text-sm">{auth.user.email}</p><p className="break-all text-xs text-muted-foreground">{auth.service}</p>
      <p className="text-xs leading-6 text-muted-foreground">For this beta, sign in again after closing the app. Your password and login token are not saved on this device.</p>
      <Button variant="outline" onClick={logout}><LogOut />Sign out</Button>
      <div className="border-t border-border pt-4">
        {!confirmDelete ? <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>Delete account…</Button> : <form onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError('');
          try { await request(auth.service, '/api/account', { token: auth.token, method: 'DELETE', data: { password } }); logout(); }
          catch (error) { setError(error instanceof Error ? error.message : 'Deletion failed.'); } finally { setBusy(false); }
        }}><p className="mb-3 text-xs leading-6 text-muted-foreground">Permanently delete your account, login sessions, and paired devices. Enter your password to confirm.</p><Input aria-label="Confirm account password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />{error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}<Button variant="destructive" className="mt-3 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Permanently delete account</Button></form>}
      </div>
    </DialogContent>
  </Dialog>;
}

function PhoneSetupSteps() {
  return <Card className="journey-card"><span className="eyebrow">Next, on your phone</span><h2 className="section-title mt-2">Connect in three steps</h2>
    <ol className="setup-checklist">
      <SetupStep number={1} title="Sign in on your phone" description="Use the same email account as this Mac." />
      <SetupStep number={2} title="Select this Mac" description="Find this Mac in My devices and choose Connect." />
      <SetupStep number={3} title="Approve here on your Mac" description="Choose Allow connection to share the selected display and enable controls." />
    </ol><p className="connection-footer"><ShieldCheck size={17} aria-hidden="true" />You stay in control. End the session here at any time.</p>
  </Card>;
}

function Workspace({ auth, logout }: { auth: Auth; logout(): void }) {
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
  const accountLabel = state.ready ? 'Signed in' : state.status === 'connecting' ? 'Connecting account…' : 'Account disconnected';
  return <AppShell actions={<><span className="account-label muted">{auth.user.email}</span>{!desktop && <MacSetupHelp />}<Settings auth={auth} logout={logout} /></>}>
    <main className={`page ${remoteView ? 'remote-main' : ''}`} id="main-content" tabIndex={-1}>
      <div className="page-heading"><div className="min-w-0"><div className="eyebrow">{desktop ? 'Mac app' : remoteView ? 'Remote workspace' : 'Your personal workspace'}</div><h1 ref={heading} tabIndex={-1} className="page-title">{remoteView ? state.session?.name : desktop ? 'Get your Mac ready.' : 'Your Mac, a little closer.'}</h1><p className="text-base leading-7 text-muted-foreground">{remoteView ? 'Your apps and your editor, right where you left them.' : desktop ? 'Finish setup, then approve your phone’s connection here.' : 'Choose a Mac to request screen sharing and control.'}</p></div><div role="status" aria-atomic="true"><Badge variant="outline" className="account-badge"><span className={`status-dot ${state.ready ? 'online' : ''}`} aria-hidden="true" />{accountLabel}</Badge></div></div>
      {state.error && <StatusNotice title="Something needs attention" error dismiss={connection.clearError}>{state.error}</StatusNotice>}
      {!state.ready && state.status === 'offline' && <StatusNotice title="Account connection interrupted"><p>Your desktop session has stopped. Check your network, retry, or sign in again.</p><div className="setup-actions"><Button variant="outline" onClick={connection.retry}>Retry connection</Button><Button variant="ghost" onClick={logout}>Sign out</Button></div></StatusNotice>}
      {state.pending && desktop && <Card className="approval-card" aria-labelledby="approval-title"><div role="status" aria-atomic="true" className="flex items-start gap-3"><Smartphone className="text-primary" aria-hidden="true" /><div><h2 id="approval-title" className="text-lg font-medium">{state.pending.name} wants to connect</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Signed in to your account. Allowing this request shares your selected display and enables mouse and keyboard control.</p></div></div>{!desktopReady && <p className="text-sm text-muted-foreground">Complete the Mac setup checklist below before allowing this request.</p>}<div className="setup-actions"><Button disabled={approving || !desktopReady} onClick={async () => { setApproving(true); try { await connection.approve(); } finally { setApproving(false); } }}>{approving && <Loader2 className="animate-spin" aria-hidden="true" />}Allow connection</Button><Button variant="outline" disabled={approving} onClick={connection.decline}>Decline</Button></div></Card>}
      {remoteView ? <RemoteSession key={state.session!.id} connection={connection} state={state} /> : <div className={`dashboard-grid ${desktop ? '' : 'devices-only'}`}><div className="min-w-0">
        {desktop ? <><DesktopSetup accountReady={state.ready} busy={!!state.session} onReadyChange={setDesktopReady} />{state.session && <Card className="journey-card mt-5"><div className="session-actions"><p>{state.session.name} · {connected ? 'Connected' : 'Connecting…'}</p><Button variant="destructive" onClick={connection.end}>End session</Button></div><Viewer connection={connection} stream={state.stream} connected={connected} desktop /></Card>}</> : <DevicesPanel devices={state.devices} ready={state.ready} connect={connection.connect} />}
      </div>{desktop && <PhoneSetupSteps />}</div>}
      <p className="connection-footer"><Globe2 size={16} aria-hidden="true" /><span>Your Mac approves every connection.{!desktop && ' Keep this page in the foreground during a session.'}</span></p>
    </main>
  </AppShell>;
}

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  function logout() { if (auth) request(auth.service, '/api/auth/logout', { token: auth.token, method: 'POST' }).catch(() => {}); setAuth(null); }
  return auth ? <Workspace auth={auth} logout={logout} /> : <Login onLogin={setAuth} />;
}
