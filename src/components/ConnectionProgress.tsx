import { Check, Loader2, Monitor, ShieldCheck } from 'lucide-react';
import type { ConnectionSnapshot } from '@/lib/connection';

export function ConnectionProgress({ status, videoReady }: { status: ConnectionSnapshot['status']; videoReady: boolean }) {
  const approved = status === 'negotiating' || status === 'connected';
  const peerReady = status === 'connected';
  const live = peerReady && videoReady;
  const title = live ? 'Session connected' : peerReady ? 'Waiting for your Mac’s screen' : approved ? 'Connecting devices…' : 'Approve on your Mac';
  const description = live ? 'Your display and controls are ready.' : peerReady ? 'The control connection is open. Controls unlock when video is playing.' : approved ? 'Approval received. Establishing the screen and control connection.' : 'Open Mac Remote on your Mac and choose Allow connection.';
  return <section className="connection-progress" aria-label="Connection progress">
    <div role="status" aria-atomic="true" className="connection-summary"><span className="progress-icon" aria-hidden="true">{live ? <ShieldCheck size={20} /> : <Loader2 size={20} className="animate-spin" />}</span><div><h2>{title}</h2><p>{description}</p></div></div>
    <ol className="progress-steps" aria-label="Connection stages">
      {[['Mac approval', approved], ['Peer connection', peerReady], ['Screen playing', live]].map(([label, complete], index) => <li key={String(label)} className={complete ? 'is-complete' : ''}><span aria-hidden="true">{complete ? <Check size={14} /> : index === 2 ? <Monitor size={14} /> : index + 1}</span>{label}<span className="sr-only">{complete ? ': complete' : ': waiting'}</span></li>)}
    </ol>
  </section>;
}
