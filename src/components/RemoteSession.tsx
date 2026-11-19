import { useEffect, useRef, useState } from 'react';
import { ConnectionProgress } from '@/components/ConnectionProgress';
import { RemoteControls } from '@/components/RemoteControls';
import { RemoteScreen } from '@/components/RemoteScreen';
import type { Connection, ConnectionSnapshot } from '@/lib/connection';

export function RemoteSession({ connection, state }: { connection: Connection; state: ConnectionSnapshot }) {
  const [videoReady, setVideoReady] = useState(false); const [inputBusy, setInputBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const connected = state.status === 'connected';
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height || window.innerHeight;
      root.current?.style.setProperty('--remote-visible-height', `${height}px`);
      root.current?.toggleAttribute('data-compact-viewport', height < 480);
      root.current?.style.setProperty('--remote-viewport-top', `${viewport?.offsetTop || 0}px`);
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  return <div ref={root} className="remote-workspace">
    <ConnectionProgress status={state.status} videoReady={videoReady} />
    <div className="session-layout">
      <RemoteScreen connection={connection} state={state} inputBusy={inputBusy} onReadyChange={setVideoReady} />
      <RemoteControls connection={connection} connected={connected && videoReady} apps={state.apps} inputBusy={inputBusy} onInputBusyChange={setInputBusy} />
    </div>
  </div>;
}
