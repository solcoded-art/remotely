import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowRight, Check, ChevronDown, Code2, Globe2, Laptop, Loader2, LogOut, Monitor, Settings2, ShieldCheck, Smartphone, Video, Wifi, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { request, serviceURL, signIn } from '@/lib/api';
import { Connection } from '@/lib/connection';
import { RemoteControls } from '@/components/RemoteControls';
import type { Auth, DisplaySource, Permissions } from '@/lib/types';

function Brand() { return <div className="brand"><span className="brand-mark"><Monitor size={19} strokeWidth={1.8} /></span>Mac Remote</div>; }

function Login({ onLogin }: { onLogin(auth: Auth): void }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [server, setServer] = useState(() => localStorage.getItem('macremote.server') || import.meta.env.VITE_ACCOUNT_SERVER || (window.macRemote || Capacitor.isNativePlatform() ? 'https://remotely-marisol-workspace-k1zb.ongale.dev' : window.location.origin));
  const [showServer, setShowServer] = useState(Capacitor.isNativePlatform() || !!window.macRemote);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const url = serviceURL(server); const auth = await signIn(url, email, password, register); localStorage.setItem('macremote.server', url); onLogin(auth); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  return <div className="app-shell"><header className="app-header"><Brand /><span className="eyebrow">{window.macRemote ? 'Mac companion' : 'Your workspace, anywhere'}</span></header>
    <main className="auth-layout">
      <section>
        <div className="connection-art" aria-hidden="true"><span className="connection-node"><Laptop size={30} strokeWidth={1.3} /></span><span className="connection-path" /><span className="connection-node"><Smartphone size={27} strokeWidth={1.3} /></span></div>
        <div className="eyebrow">A little closer to your Mac</div>
        <h1 className="auth-title">Your desk.<br />In your <em>pocket.</em></h1>
        <p className="auth-copy">See your desktop, switch to your editor, and pick up where you left off. Connect your iPhone and Mac with one account.</p>
        <div className="feature-line"><Video />Live screen sharing over WebRTC</div>
        <div className="feature-line"><Code2 />Your code editor. Your apps. Your Mac.</div>
        <div className="feature-line"><ShieldCheck />Every connection approved on your Mac</div>
      </section>
      <Card className="auth-panel gap-0">
        <h2 className="text-xl font-medium tracking-tight">{register ? 'Create your account' : 'Welcome back'}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{register ? 'Use this account on your iPhone and Mac.' : 'Sign in to find your paired devices.'}</p>
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="email">Email address</label><Input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} /></div>
          <div className="field"><label htmlFor="password">Password</label><Input id="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder="At least 12 characters" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={256} /></div>
          <button type="button" className="mt-3 flex items-center gap-1 text-xs text-muted-foreground" onClick={() => setShowServer(!showServer)} aria-expanded={showServer}>Account server<ChevronDown size={13} /></button>
          {showServer && <div className="field !mt-1"><Input type="url" aria-label="Account server URL" placeholder="https://remote.example.com" value={server} onChange={event => setServer(event.target.value)} required /><p className="text-[11px] leading-5 text-muted-foreground">Use the same server on both devices.</p></div>}
          {error && <div className="notice mt-4" role="alert">{error}</div>}
          <Button className="mt-5 w-full" size="lg" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}{register ? 'Create account' : 'Sign in'}{!busy && <ArrowRight size={16} />}</Button>
        </form>
        <p className="mt-5 text-center text-xs text-muted-foreground">{register ? 'Already have an account?' : 'First time here?'} <button className="min-h-8 text-foreground underline underline-offset-4" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button></p>
        <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground"><ShieldCheck size={14} className="mt-0.5" />Screen video and controls travel over the encrypted peer connection.</div>
      </Card>
    </main>
  </div>;
}

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

function DesktopSetup({ connection, busy }: { connection: Connection; busy: boolean }) {
  const [sources, setSources] = useState<DisplaySource[]>([]); const [selected, setSelected] = useState('');
  const [permissions, setPermissions] = useState<Permissions | null>(null); const [loading, setLoading] = useState(false);
  async function loadSources() {
    setLoading(true);
    try { setPermissions(await window.macRemote!.permissions(false)); setSources(await window.macRemote!.sources()); }
    catch (error) { connection.report(error); } finally { setLoading(false); }
  }
  return <Card className="gap-0 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><span className="eyebrow">Desktop companion</span><h2 className="section-title mt-2">Share your workspace</h2></div><Badge variant="outline"><span className={`status-dot ${busy ? 'online' : ''}`} />{busy ? 'Session active' : 'Approval required'}</Badge></div>
    <p className="mb-5 mt-3 text-sm leading-6 text-muted-foreground">Choose the display your iPhone should see. Sharing a full display lets you switch between your editor, browser, and other apps.</p>
    {!sources.length && <div className="empty"><Monitor size={32} strokeWidth={1.2} /><h3 className="text-sm">Choose a display to get ready</h3><p>macOS may ask for screen recording permission. You decide when a connection starts.</p></div>}
    <div className="source-grid">{sources.map(source => <button key={source.id} className={`source-card ${selected === source.id ? 'selected' : ''}`} aria-pressed={selected === source.id} disabled={busy} onClick={async () => { try { await window.macRemote!.selectDisplay(source.id); setSelected(source.id); } catch (error) { connection.report(error); } }}><img src={source.thumbnail} alt={`Preview of ${source.name}`} /><span className="mt-3 flex items-center justify-between text-xs">{source.name}{selected === source.id && <Check size={15} className="text-primary" />}</span></button>)}</div>
    <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" disabled={busy || loading} onClick={loadSources}>{loading ? <Loader2 className="animate-spin" /> : <Monitor />}{sources.length ? 'Refresh displays' : 'Choose display'}</Button><Button variant="ghost" onClick={async () => { try { setPermissions(await window.macRemote!.permissions(true)); } catch (error) { connection.report(error); } }}><ShieldCheck />Check permissions</Button></div>
    {permissions && <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground"><span><span className={`status-dot ${permissions.accessibility ? 'online' : ''}`} />Accessibility: {permissions.accessibility ? 'enabled' : 'enable in System Settings'}</span><span><span className={`status-dot ${permissions.screen === 'granted' ? 'online' : ''}`} />Screen recording: {permissions.screen}</span></div>}
    <p className="mt-4 text-[11px] leading-5 text-muted-foreground">Keep this app open while connecting. You’ll approve each request here. Changing displays requires ending the session.</p>
  </Card>;
}

function SetupSteps({ desktop }: { desktop: boolean }) {
  const steps = desktop ? [['Sign in on your iPhone', 'Use the same email and account server on both devices.'], ['Select this Mac', 'Your iPhone will show this companion in My devices.'], ['Approve the connection', 'Allow the request here to start sharing your selected display.']] : [['Open the Mac companion', 'Sign in with the same email account you used here.'], ['Choose a display on your Mac', 'Enable Screen Recording and Accessibility when asked.'], ['Connect and pick up your work', 'Approve on your Mac, then open your editor from Apps.']];
  return <Card className="gap-0 p-6"><span className="eyebrow">A quick start</span><h2 className="section-title mt-2">{desktop ? 'Ready when you are' : 'Your Mac, three steps away'}</h2>{steps.map(([title, description], index) => <div className="step" key={title}><span className="step-number">{index + 1}</span><div><div className="text-sm">{title}</div><p>{description}</p></div></div>)}<div className="connection-footer"><ShieldCheck size={14} /><span>Only Macs signed in to your account appear here.</span></div></Card>;
}

function Viewer({ connection, stream, connected, desktop }: { connection: Connection; stream: MediaStream | null; connected: boolean; desktop: boolean }) {
  const ref = useRef<HTMLVideoElement>(null); const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const video = ref.current; setPlaying(false);
    if (video) { video.srcObject = stream; if (stream) video.play().catch(() => {}); }
    return () => { if (video) video.srcObject = null; };
  }, [stream]);
  return <div className="viewer">
    <video ref={ref} muted autoPlay playsInline onPlaying={() => setPlaying(true)} aria-label={desktop ? 'Shared display preview' : 'Live Mac display'} onClick={event => {
      if (desktop || !connected || !playing) return;
      const video = event.currentTarget; if (!video.videoWidth || !video.videoHeight) return;
      const rect = video.getBoundingClientRect(); const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
      const width = video.videoWidth * scale; const height = video.videoHeight * scale;
      const x = event.clientX - rect.left - (rect.width - width) / 2; const y = event.clientY - rect.top - (rect.height - height) / 2;
      if (x < 0 || y < 0 || x > width || y > height) return;
      connection.sendCommand({ action: 'moveTo', normX: x / width, normY: y / height }); connection.sendCommand({ action: 'click', button: 'left' });
    }} />
    {(!stream || !playing) && <div className="viewer-empty"><Monitor size={37} strokeWidth={1} /><span>{stream ? 'Starting display video…' : 'Your Mac display will appear here'}</span>{stream && <Button variant="outline" onClick={() => ref.current?.play().catch(error => connection.report(error))}>Play video</Button>}</div>}
  </div>;
}

function Workspace({ auth, logout }: { auth: Auth; logout(): void }) {
  const connection = useMemo(() => new Connection(auth), [auth]);
  const state = useSyncExternalStore(connection.subscribe, connection.snapshot);
  const [approving, setApproving] = useState(false);
  useEffect(() => { connection.start(); return () => connection.dispose(); }, [connection]);
  useEffect(() => {
    const endOnBackground = () => { if (document.visibilityState === 'hidden' && !connection.desktop && connection.snapshot().session) connection.end(); };
    document.addEventListener('visibilitychange', endOnBackground);
    return () => document.removeEventListener('visibilitychange', endOnBackground);
  }, [connection]);
  const desktop = connection.desktop;
  const connected = state.status === 'connected';
  const remoteView = !desktop && !!state.session;
  return <div className="app-shell">
    <header className="app-header"><Brand /><div className="flex min-w-0 items-center gap-3"><span className="account-label muted">{auth.user.email}</span><Settings auth={auth} logout={logout} /></div></header>
    <main className={`page ${remoteView ? 'remote-main' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="eyebrow">{desktop ? 'Mac companion' : remoteView ? 'Remote workspace' : 'Your personal workspace'}</div><h1 className="page-title">{remoteView ? state.session?.name : desktop ? 'Make yourself available.' : 'A familiar place to work.'}</h1><p className="text-sm leading-6 text-muted-foreground">{remoteView ? 'Your apps and your editor, right where you left them.' : desktop ? 'Your iPhone connects when you say so.' : 'Connect to your Mac and get back to what matters.'}</p></div><Badge variant="outline" className="mt-1 min-h-8 px-3 text-xs"><span className={`status-dot ${state.ready ? 'online' : ''}`} />{state.ready ? 'Signed in' : state.status === 'connecting' ? 'Connecting…' : 'Offline'}</Badge></div>
      {state.error && <div className="notice mt-5 flex items-start justify-between gap-3" role="alert"><span>{state.error}</span><button aria-label="Dismiss error" className="!-my-2 !min-h-9" onClick={connection.clearError}><X size={15} /></button></div>}
      {state.pending && desktop && <Card className="mt-6 gap-4 border-primary/40 bg-[#1e2b23] p-6"><div className="flex items-center gap-3"><Smartphone className="text-primary" /><div><h2 className="font-medium">{state.pending.name} wants to connect</h2><p className="mt-1 text-xs text-muted-foreground">Your account · view and control the selected display</p></div></div><div className="flex flex-wrap gap-2"><Button disabled={approving} onClick={async () => { setApproving(true); try { await connection.approve(); } finally { setApproving(false); } }}>{approving && <Loader2 className="animate-spin" />}Allow connection</Button><Button variant="outline" disabled={approving} onClick={connection.decline}>Decline</Button></div></Card>}
      {remoteView ? <>
        <div className="session-layout"><div><Viewer connection={connection} stream={state.stream} connected={connected} desktop={false} /><div className="viewer-status"><span className="flex items-center gap-1.5"><ShieldCheck size={12} />{state.route || (connected ? 'Encrypted peer connection' : state.status === 'pending' ? 'Waiting for approval on your Mac' : 'Establishing peer connection…')}</span><span>{state.latency !== null ? `${state.latency} ms round trip` : 'Tap the display to click'}</span></div><div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2"><span className="flex items-center gap-2 text-xs"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Session connected' : state.status === 'pending' ? 'Approve on your Mac' : 'Connecting devices…'}</span><Button variant="outline" onClick={connection.end}>{connected ? 'Disconnect' : 'Cancel'}</Button></div></div><RemoteControls connection={connection} connected={connected} apps={state.apps} /></div>
      </> : <div className="dashboard-grid"><div className="min-w-0">
        {desktop ? <><DesktopSetup connection={connection} busy={!!state.session} />{state.session && <Card className="mt-5 gap-3 p-5"><div className="flex items-center justify-between gap-3"><span className="text-sm">{state.session.name} · {connected ? 'Connected' : 'Connecting…'}</span><Button variant="outline" onClick={connection.end}>End session</Button></div><Viewer connection={connection} stream={state.stream} connected={connected} desktop /></Card>}</> : <Card className="gap-0 p-6"><div className="mb-5 flex items-center justify-between"><h2 className="section-title">My devices</h2><span className="text-xs text-muted-foreground">{state.devices.filter(device => device.kind === 'desktop').length} Macs</span></div><div className="grid gap-3">{state.devices.filter(device => device.kind === 'desktop').map(device => <div className="device-card" key={device.id}><span className="device-icon"><Laptop size={29} strokeWidth={1.3} /></span><div className="device-info"><div className="device-name">{device.name}</div><div className="device-meta"><span className={`status-dot ${device.online ? 'online' : ''}`} />{device.online ? 'Online · Mac companion' : 'Offline · open the companion'}</div></div><Button disabled={!state.ready || !device.online || !!state.session} onClick={() => connection.connect(device)}>Connect<ArrowRight size={15} /></Button></div>)}</div>{!state.devices.some(device => device.kind === 'desktop') && <div className="empty"><Laptop size={37} strokeWidth={1.2} /><h3 className="text-sm">Your first Mac starts here</h3><p>Open Mac Remote on your Mac and sign in with this account. Your Mac appears here once its screen is ready to share.</p></div>}<div className="connection-footer"><Wifi size={14} /><span>Devices update automatically when your companion comes online.</span></div></Card>}
      </div><SetupSteps desktop={desktop} /></div>}
      <div className="connection-footer"><Globe2 size={13} /><span>Your Mac approves every connection.{!desktop && ' Keep the app open during a session.'}</span></div>
    </main>
  </div>;
}

export default function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  function logout() { if (auth) request(auth.service, '/api/auth/logout', { token: auth.token, method: 'POST' }).catch(() => {}); setAuth(null); }
  return auth ? <Workspace auth={auth} logout={logout} /> : <Login onLogin={setAuth} />;
}
