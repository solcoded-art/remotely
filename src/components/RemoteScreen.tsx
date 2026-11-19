import { useEffect, useRef, useState } from 'react';
import { Expand, Minimize, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Viewer } from './Viewer';
import type { Connection, ConnectionSnapshot } from '@/lib/connection';

export function RemoteScreen({ connection, state, inputBusy, onReadyChange }: { connection: Connection; state: ConnectionSnapshot; inputBusy: boolean; onReadyChange(ready: boolean): void }) {
  const [expanded, setExpanded] = useState(false); const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const panel = useRef<HTMLDivElement>(null); const wasFullscreen = useRef(false);
  const connected = state.status === 'connected';
  useEffect(() => {
    const changed = () => {
      const active = !!document.fullscreenElement && document.fullscreenElement === panel.current;
      setNativeFullscreen(active);
      if (wasFullscreen.current && !active) setExpanded(false);
      wasFullscreen.current = active;
    };
    document.addEventListener('fullscreenchange', changed);
    return () => { document.removeEventListener('fullscreenchange', changed); };
  }, []);
  function changeExpanded(open: boolean) {
    if (!open && document.fullscreenElement === panel.current) void document.exitFullscreen().catch(() => {});
    setExpanded(open);
  }
  const screen = <Viewer connection={connection} stream={state.stream} connected={connected} desktop={false} interactive={!inputBusy} onReadyChange={onReadyChange} />;
  return <section className="remote-screen-panel" aria-label="Your Mac screen">
    <Dialog open={expanded} onOpenChange={changeExpanded}>
      <div className="screen-toolbar"><span className="text-sm font-medium">Mac screen</span><div className="flex gap-2"><DialogTrigger asChild><Button variant="outline" size="sm" disabled={!state.stream || inputBusy}><Expand size={16} aria-hidden="true" />Fullscreen view</Button></DialogTrigger><Button variant="outline" size="sm" onClick={connection.end}>{connected ? 'Disconnect' : 'Cancel'}</Button></div></div>
      {!expanded && screen}
      <DialogContent ref={panel} className="screen-fullscreen" showCloseButton={false} onOpenAutoFocus={() => {
        // Call from the opening interaction. Rejection/unsupported APIs retain the accessible expanded view.
        if (document.fullscreenEnabled && panel.current?.requestFullscreen) void panel.current.requestFullscreen().catch(() => {});
      }}>
        <DialogHeader><DialogTitle>Mac screen</DialogTitle><DialogDescription>{nativeFullscreen ? 'Fullscreen view. Exit to return to your controls.' : 'Expanded view. Your browser may keep its toolbar visible.'}</DialogDescription></DialogHeader>
        {expanded && screen}
        <div className="screen-toolbar"><p className="text-sm text-muted-foreground">Tap the screen to click.</p><div className="flex gap-2"><Button variant="outline" onClick={() => changeExpanded(false)}><Minimize size={16} aria-hidden="true" />Exit fullscreen</Button><Button variant="outline" onClick={connection.end}>Disconnect</Button></div></div>
      </DialogContent>
    </Dialog>
    <div className="screen-connection"><span><ShieldCheck size={14} aria-hidden="true" />{inputBusy ? 'Sending keyboard input…' : state.route || 'Encrypted peer connection'}</span>{state.latency !== null && <span>{state.latency} ms</span>}</div>
    <p className="screen-hint">Tap the screen to click, or use the controls below.</p>
  </section>;
}
