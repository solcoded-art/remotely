import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Link2, ShieldCheck, Smartphone, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Connection, ConnectionSnapshot } from '@/lib/connection';

// Keep the secret only in memory while signing in; remove it from the address bar immediately.
let scannedLink = location.hash.startsWith('#pair=') ? location.href : '';
if (scannedLink) history.replaceState(null, '', location.pathname + location.search);

export function DevicePairing({ connection, state }: { connection: Connection; state: ConnectionSnapshot }) {
  const [link, setLink] = useState(() => { const value = scannedLink; scannedLink = ''; return value; });
  const [qr, setQR] = useState(''); const [copyStatus, setCopyStatus] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [autoPair, setAutoPair] = useState(!!link);
  useEffect(() => {
    if (autoPair && state.ready && !connection.desktop) { setAutoPair(false); void connection.pair(link); setLink(''); }
  }, [autoPair, state.ready, connection, link]);
  useEffect(() => {
    let active = true; setQR(''); setCopyStatus('');
    if (state.invite) QRCode.toDataURL(state.invite.link, { width: 420, margin: 4, errorCorrectionLevel: 'M' }).then(value => { if (active) setQR(value); }).catch(() => { if (active) setCopyStatus('QR unavailable. Copy the pairing link instead.'); });
    return () => { active = false; };
  }, [state.invite]);
  return <Card className="journey-card my-5" aria-labelledby="pairing-title">
    <div className="panel-heading"><div><span className="eyebrow">Trusted devices</span><h2 id="pairing-title" className="section-title mt-2">{connection.desktop ? 'Pair your phone' : 'Pair with your Mac'}</h2></div><ShieldCheck className="text-primary shrink-0" aria-hidden="true" /></div>
    {connection.desktop ? <>
      <p className="panel-copy">Create a one-use link, scan it with your phone’s Camera, then approve pairing here. Only share it with your own phone.</p>
      <Button variant="outline" disabled={!state.ready || busy} onClick={async () => { setBusy(true); try { await connection.createInvite(); } finally { setBusy(false); } }}><Link2 aria-hidden="true" />{state.invite ? 'Create a new pairing link' : 'Create pairing link'}</Button>
      {state.invite && <div className="mt-4 space-y-3">
        {qr && <img src={qr} alt="Pairing QR code. Scan with your phone’s Camera, or use the pairing link below." className="w-full max-w-[420px] h-auto rounded-lg" width={420} height={420} />}
        <label htmlFor="mac-pairing-link" className="block text-sm">One-use pairing link</label>
        <Input id="mac-pairing-link" value={state.invite.link} readOnly autoComplete="off" spellCheck={false} onFocus={event => event.target.select()} />
        <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(state.invite!.link); setCopyStatus('Pairing link copied.'); } catch { setCopyStatus('Select and copy the link above.'); } }}><Copy aria-hidden="true" />Copy pairing link</Button>
        <p className="text-xs text-muted-foreground">Expires at {new Date(state.invite.expires).toLocaleTimeString()}. Your screen stays private during pairing.</p>
      </div>}
      {state.pairing && <div className="mt-5 space-y-3 border-t border-border pt-4" role="region" aria-label="Pairing approval">
        <h3 className="font-medium"><Smartphone className="inline mr-2" size={18} aria-hidden="true" />Pair {state.pairing.name}?</h3>
        <p className="text-sm leading-6 text-muted-foreground">This device proved it has your one-use link. Approve only if you just scanned or pasted it on your phone. Pairing does not start screen sharing.</p>
        <p className="break-all text-xs font-mono text-muted-foreground">Device key: {state.pairing.peerId.slice(2)}</p>
        <div className="setup-actions"><Button disabled={busy} onClick={async () => { setBusy(true); try { await connection.approvePair(); } finally { setBusy(false); } }}>Allow pairing</Button><Button variant="outline" disabled={busy} onClick={connection.declinePair}>Decline pairing</Button></div>
      </div>}
    </> : <>
      <p className="panel-copy">In the Mac app, choose Create pairing link. Scan its QR code with your Camera, or paste the full link here. Then approve pairing on your Mac.</p>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void connection.pair(link); setLink(''); }}>
        <label htmlFor="phone-pairing-link" className="block text-sm">Pairing link from your Mac</label>
        <Input id="phone-pairing-link" type="url" autoComplete="off" spellCheck={false} required maxLength={4096} value={link} onChange={event => setLink(event.target.value)} placeholder="Paste your one-use pairing link" />
        <Button disabled={!state.ready || !link.trim()}><Link2 aria-hidden="true" />Request pairing</Button>
      </form>
      <p className="mt-3 text-xs leading-6 text-muted-foreground">This installation uses a browser device key. Clearing site data or using a different browser requires pairing again. It is not a hardware-backed identity.</p>
    </>}
    <p role="status" className="mt-3 text-sm leading-6 text-muted-foreground">{copyStatus || state.pairStatus}</p>
    {!!Object.keys(state.pins).length && <div className="mt-5 border-t border-border pt-4"><h3 className="font-medium mb-3">Paired {connection.desktop ? 'phones' : 'Macs'}</h3><ul className="space-y-3" aria-label="Trusted device keys">{Object.entries(state.pins).map(([id, pin]) => <li key={id} className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-sm">{pin.name}</p><p className="break-all text-xs font-mono text-muted-foreground">{id.slice(2)}</p></div><Button variant="outline" size="sm" onClick={() => setRevokeId(id)} aria-label={`Revoke ${pin.name}`}><Unplug size={15} aria-hidden="true" />Revoke</Button></li>)}</ul></div>}
    <Dialog open={!!revokeId} onOpenChange={open => { if (!open) setRevokeId(null); }}><DialogContent><DialogHeader><DialogTitle>Revoke this device?</DialogTitle><DialogDescription>Its active session will end. A new pairing link and approval on the Mac will be required to reconnect.</DialogDescription></DialogHeader><div className="setup-actions"><Button variant="destructive" disabled={busy} onClick={async () => { if (!revokeId) return; setBusy(true); try { await connection.revoke(revokeId); setRevokeId(null); } finally { setBusy(false); } }}>Revoke device</Button><Button variant="outline" onClick={() => setRevokeId(null)}>Cancel</Button></div></DialogContent></Dialog>
  </Card>;
}
