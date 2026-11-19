import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Check, Copy, Download, Laptop, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import release from '../../release.config.json';
import { PRODUCTION_SERVICE } from '../../shared/account-service.mjs';

const production = PRODUCTION_SERVICE;
function setupOrigin() { return Capacitor.isNativePlatform() ? production : window.location.origin; }

export function MacSetupInstructions({ compact = false }: { compact?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const phone = Capacitor.getPlatform() === 'ios' || /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const origin = setupOrigin();
  async function check(signal?: AbortSignal) {
    setChecking(true);
    try {
      const response = await fetch(origin + '/api/downloads/mac', { signal: signal || AbortSignal.timeout(8000) });
      if (!response.ok) throw Error();
      const info = await response.json();
      if (!signal?.aborted) setAvailable(info.available === true);
    } catch { if (!signal?.aborted) setAvailable(false); }
    finally { if (!signal?.aborted) setChecking(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    return () => controller.abort();
  }, [origin]);
  return <section className={`mac-setup ${compact ? 'mac-setup-compact' : ''}`} aria-label="Set up your Mac">
    <div className="flex items-start gap-3"><span className="mac-setup-icon"><Laptop size={21} /></span><div>
      <div className="eyebrow">Mac app required</div>
      <h2 className="mt-1 text-base font-medium">Start by installing Mac Remote on your Mac</h2>
    </div></div>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">The Mac app shares your screen and receives your controls. Keep it open while you use this site on your phone.</p>
    {phone ? <div className="mt-4"><p className="mb-3 text-xs leading-5 text-primary">You’re on your phone. Open this setup page on your Mac to install the app.</p><Button className="w-full" onClick={async () => {
      try { await navigator.clipboard.writeText(origin + '/docs/getting-started/'); setCopied(true); }
      catch { setShowLink(true); }
    }}>{copied ? <Check /> : <Copy />}{copied ? 'Setup link copied' : 'Copy Mac setup link'}</Button>{showLink && <input className="mt-3 w-full rounded border bg-background p-2 text-xs" aria-label="Mac setup link" readOnly value={origin + '/docs/getting-started/'} onFocus={event => event.target.select()} />}</div> : <div className="mt-4">
      {available ? <Button asChild size="lg" className="w-full"><a href={origin + '/download/mac'}><Download />Download Mac app</a></Button> : <Button className="w-full" size="lg" disabled>{checking ? <Loader2 className="animate-spin" /> : <Download />}{checking ? 'Checking Mac download…' : 'Mac download temporarily unavailable'}</Button>}
      {!available && !checking && <div className="mt-2 flex items-center justify-between gap-3"><p className="text-xs leading-5 text-muted-foreground">The installer is being prepared or its host is unavailable.</p><Button size="sm" variant="ghost" onClick={() => check()}><RefreshCw size={13} />Retry</Button></div>}
    </div>}
    <p className="mt-2 text-sm leading-5 text-muted-foreground">v{release.version} · Apple Silicon (M1 or newer) · macOS {release.minimumMacOS}+</p>
    <p className="mt-2 text-sm leading-5 text-amber-200/80">Developer beta: no Apple Developer ID signature or notarization. macOS may block opening. A verified consumer installer and an Intel build aren’t available yet.</p>
    <ol className="mac-setup-steps">
      <li><span>1</span><div><strong>Download and open the Mac app</strong><p>Unzip the download, move Mac Remote to Applications, and open it.</p></div></li>
      <li><span>2</span><div><strong>Sign in and choose a display</strong><p>Use the same account as your phone. Allow Screen Recording and Accessibility when macOS asks.</p></div></li>
      <li><span>3</span><div><strong>Connect from your phone</strong><p>Your Mac appears in My devices. Tap Connect, then approve the request on your Mac.</p></div></li>
    </ol>
    <p className="mt-3 text-xs text-muted-foreground">Already installed? Open Mac Remote on your Mac and sign in with the same account.</p>
  </section>;
}

export function MacSetup({ compact = false }: { compact?: boolean }) {
  return <section className={`mac-setup ${compact ? 'mac-setup-compact' : ''}`} aria-label="Set up your Mac">
    <div className="flex items-center gap-2 text-sm font-medium"><Laptop size={18} className="text-primary" />Mac app required</div>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Install and keep Mac Remote open on your Mac to share its screen with your phone.</p>
    <Button asChild variant="outline" className="mt-3"><a href={setupOrigin() + '/docs/getting-started/'} target="_blank" rel="noopener">Read setup guide</a></Button>
  </section>;
}

export function MacSetupHelp() {
  return <Button asChild variant="outline" size="sm"><a href={setupOrigin() + '/docs/getting-started/'} target="_blank" rel="noopener" aria-label="Setup documentation"><Laptop size={15} /><span className="hidden sm:inline">Documentation</span></a></Button>;
}
