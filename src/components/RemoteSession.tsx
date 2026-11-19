import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionProgress } from '@/components/ConnectionProgress';
import { RemoteControls } from '@/components/RemoteControls';
import { Viewer } from '@/components/Viewer';
import type { Connection, ConnectionSnapshot } from '@/lib/connection';

export function RemoteSession({ connection, state }: { connection: Connection; state: ConnectionSnapshot }) {
  const [videoReady, setVideoReady] = useState(false);
  const connected = state.status === 'connected';
  return <>
    <ConnectionProgress status={state.status} videoReady={videoReady} />
    <div className="session-layout"><div className="min-w-0">
      <Viewer connection={connection} stream={state.stream} connected={connected} desktop={false} onReadyChange={setVideoReady} />
      <div className="viewer-status"><span className="flex items-center gap-2"><ShieldCheck size={15} aria-hidden="true" />{state.route || 'Encrypted peer connection'}</span>{state.latency !== null && <span>{state.latency} ms round trip</span>}</div>
      <div className="session-actions"><p>{connected && videoReady ? 'Tap the screen to click, or use Mouse controls.' : 'Your controls unlock when the screen is playing.'}</p><Button variant="outline" onClick={connection.end}>{connected ? 'Disconnect' : 'Cancel'}</Button></div>
    </div><RemoteControls connection={connection} connected={connected && videoReady} apps={state.apps} /></div>
  </>;
}
