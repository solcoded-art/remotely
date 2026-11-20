import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Connection } from '@/lib/connection';

/** Plays the shared display stream. Input is handled by the surrounding surface. */
export function Viewer({ connection, stream, desktop, onReadyChange }: { connection: Connection; stream: MediaStream | null; desktop: boolean; onReadyChange?(ready: boolean): void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const label = desktop ? 'Shared display preview' : 'Live Mac display';
  useEffect(() => {
    const video = ref.current; setPlaying(false); onReadyChange?.(false);
    if (video) { video.srcObject = stream; if (stream) void video.play().catch(() => {}); }
    return () => { if (video) video.srcObject = null; };
  }, [stream, onReadyChange]);
  useEffect(() => {
    // Phones pause video in the background; resume when the page is visible again.
    const resume = () => { const video = ref.current; if (document.visibilityState === 'visible' && video?.srcObject && video.paused) void video.play().catch(() => {}); };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);
  function updatePlaying(value: boolean) { setPlaying(value); onReadyChange?.(value); }
  return <figure className="viewer" aria-label={label}>
    <video ref={ref} muted autoPlay playsInline aria-label={label} onPlaying={() => updatePlaying(true)} onWaiting={() => updatePlaying(false)} onPause={() => updatePlaying(false)} onError={() => { updatePlaying(false); connection.report(Error('The display video could not play. Disconnect and try again.')); }} />
    {!desktop && <figcaption className="sr-only">Streamed video of your Mac. Screen readers cannot read its contents; use the remote controls.</figcaption>}
    {(!stream || !playing) && <div className="viewer-empty"><Monitor size={37} strokeWidth={1} aria-hidden="true" /><span>{stream ? 'Starting display video…' : 'Your Mac display will appear here'}</span>{stream && <Button variant="outline" onClick={() => ref.current?.play().catch(error => connection.report(error))}>Play video</Button>}</div>}
  </figure>;
}
