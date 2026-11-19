import { useEffect, useState } from 'react';
import { ArrowDownToLine, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMacUpdate } from '@/hooks/useMacUpdate';

const DISMISSED_KEY = 'remotely.update-dismissed';
function readDismissed() { try { return localStorage.getItem(DISMISSED_KEY) || ''; } catch { return ''; } }
function writeDismissed(version: string) { try { localStorage.setItem(DISMISSED_KEY, version); } catch { /* storage unavailable */ } }

/**
 * Mac app only. Shows "Update available" when the account service publishes a
 * newer release, plus one native notification per version. If the server sets
 * `minimumSupportedVersion` above this build, the prompt becomes blocking.
 */
export function UpdateBanner() {
  const update = useMacUpdate();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const visible = !!update && (update.required || dismissed !== update.latest);

  useEffect(() => {
    if (!update || !visible) return;
    void window.macRemote?.notifyUpdate?.(update.service, update.latest).catch(() => {});
  }, [update, visible]);

  if (!update || !visible) return null;

  async function download() {
    setOpening(true); setError('');
    try { await window.macRemote?.openUpdate?.(update!.service); }
    catch { setError('Could not open the download. Visit the Remotely website to update.'); }
    finally { setOpening(false); }
  }

  const actions = <div className="mt-4 flex flex-wrap gap-2">
    <Button onClick={download} disabled={opening} className="h-10">
      {opening ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowDownToLine aria-hidden="true" />}Download update
    </Button>
    {!update.required && <Button variant="ghost" className="h-10" onClick={() => { writeDismissed(update.latest); setDismissed(update.latest); }}>Later</Button>}
  </div>;

  if (update.required) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section role="alertdialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-body" className="w-full max-w-md rounded-2xl border border-amber-300/30 bg-card p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-300/15 text-amber-200"><TriangleAlert size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="update-title" className="text-lg font-semibold tracking-tight">Update required</h2>
            <p id="update-body" className="mt-1 text-sm leading-6 text-muted-foreground">This version of Remotely ({update.current}) is no longer supported. Download version {update.latest}, then replace the app in Applications and reopen it.</p>
          </div>
        </div>
        {actions}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>
    </div>;
  }

  return <section aria-labelledby="update-title" className="fixed right-4 bottom-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-brand-500/30 bg-card/95 p-5 shadow-2xl backdrop-blur-md">
    <div role="status" aria-live="polite" className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-200"><Sparkles size={18} aria-hidden="true" /></span>
      <div className="min-w-0">
        <h2 id="update-title" className="text-base font-semibold tracking-tight">Update available</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">Remotely {update.latest} is ready. You have {update.current}. Download it, then replace the app in Applications.</p>
      </div>
    </div>
    {actions}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>;
}
