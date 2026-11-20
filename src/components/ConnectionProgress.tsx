import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConnectionSnapshot } from '@/lib/connection';

/** Shown until the Mac screen is playing. */
export function ConnectionProgress({ status, videoReady }: { status: ConnectionSnapshot['status']; videoReady: boolean }) {
  const approved = status === 'negotiating' || status === 'connected';
  const peerReady = status === 'connected';
  const title = peerReady ? 'Waiting for your Mac’s screen' : approved ? 'Connecting devices…' : 'Approve on your Mac';
  const steps = [['Mac approval', approved], ['Peer connection', peerReady], ['Screen playing', peerReady && videoReady]] as const;
  return <section className="connection-progress" aria-label="Connection progress">
    <h2 role="status" aria-atomic="true" className="connection-title"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{title}</h2>
    <ol className="progress-steps" aria-label="Connection stages">
      {steps.map(([label, complete]) => <li key={label} className={cn(complete && 'is-complete')}><span aria-hidden="true">{complete && <Check size={12} />}</span>{label}<span className="sr-only">{complete ? ': complete' : ': waiting'}</span></li>)}
    </ol>
  </section>;
}
