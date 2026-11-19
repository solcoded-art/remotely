import { useEffect, useId, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Connection } from '@/lib/connection';

export function Viewer({ connection, stream, connected, desktop, onReadyChange, interactive = true }: { connection: Connection; stream: MediaStream | null; connected: boolean; desktop: boolean; interactive?: boolean; onReadyChange?(ready: boolean): void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const helpId = useId();
  useEffect(() => {
    const video = ref.current; setPlaying(false); onReadyChange?.(false);
    if (video) { video.srcObject = stream; if (stream) void video.play().catch(() => {}); }
    return () => { if (video) video.srcObject = null; };
  }, [stream, onReadyChange]);
  function updatePlaying(value: boolean) { setPlaying(value); onReadyChange?.(value); }
  return <figure className="viewer" aria-label={desktop ? 'Shared display preview' : 'Live Mac display'} aria-describedby={helpId}>
    <video ref={ref} muted autoPlay playsInline aria-label={desktop ? 'Shared display preview' : 'Live Mac display'} onPlaying={() => updatePlaying(true)} onWaiting={() => updatePlaying(false)} onPause={() => updatePlaying(false)} onError={() => { updatePlaying(false); connection.report(Error('The display video could not play. Disconnect and try again.')); }} onClick={event => {
      if (desktop || !connected || !playing || !interactive) return;
      const video = event.currentTarget; if (!video.videoWidth || !video.videoHeight) return;
      const rect = video.getBoundingClientRect(); const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
      const width = video.videoWidth * scale; const height = video.videoHeight * scale;
      const x = event.clientX - rect.left - (rect.width - width) / 2; const y = event.clientY - rect.top - (rect.height - height) / 2;
      if (x < 0 || y < 0 || x > width || y > height) return;
      if (connection.sendCommand({ action: 'moveTo', normX: x / width, normY: y / height })) connection.sendCommand({ action: 'click', button: 'left' });
    }} />
    <figcaption id={helpId} className="sr-only">{desktop ? 'Preview of the display shared with your approved device.' : 'Visual stream of your Mac. Use Apps, Mouse, and Keys for remote controls. Streamed desktop content does not expose screen reader navigation.'}</figcaption>
    {(!stream || !playing) && <div className="viewer-empty"><Monitor size={37} strokeWidth={1} aria-hidden="true" /><span>{stream ? 'Starting display video…' : 'Your Mac display will appear here'}</span>{stream && <Button variant="outline" onClick={() => ref.current?.play().catch(error => connection.report(error))}>Play video</Button>}</div>}
  </figure>;
}
