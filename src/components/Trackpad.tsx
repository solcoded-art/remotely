import { useEffect, useRef, useState } from 'react';
import { Hand, MousePointer2, MousePointerClick } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Command } from '@/lib/types';

export function Trackpad({ connected, send }: { connected: boolean; send(command: Command): boolean }) {
  const [drag, setDrag] = useState(false);
  const [sensitivity, setSensitivity] = useState(() => Number(localStorage.getItem('macremote.sensitivity')) || 1.4);
  const gesture = useRef({ last: { x: 0, y: 0 }, start: 0, moved: 0, fingers: 0, cancelled: false });
  const active = useRef(new Map<number, { x: number; y: number }>());
  const pending = useRef({ dx: 0, dy: 0, scroll: false, frame: 0 });
  const dragRef = useRef(false);
  const sendRef = useRef(send); sendRef.current = send;
  const release = () => {
    if (dragRef.current) sendRef.current({ action: 'up', button: 'left' });
    dragRef.current = false; setDrag(false);
    active.current.clear(); gesture.current.cancelled = true;
    cancelAnimationFrame(pending.current.frame); pending.current = { dx: 0, dy: 0, scroll: false, frame: 0 };
  };
  useEffect(() => {
    if (!connected) release();
    const onHide = () => { if (document.visibilityState === 'hidden') release(); };
    const onBlur = () => release();
    document.addEventListener('visibilitychange', onHide); window.addEventListener('blur', onBlur);
    return () => { release(); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('blur', onBlur); };
  }, [connected]);
  function flush() {
    const { dx, dy, scroll } = pending.current;
    pending.current = { dx: 0, dy: 0, scroll, frame: 0 };
    if (dx || dy) send({ action: scroll ? 'scroll' : dragRef.current ? 'drag' : 'move', dx: scroll ? -dx * 1.5 : dx, dy: scroll ? -dy * 1.5 : dy });
  }
  return <>
    <div className={`trackpad ${connected ? '' : 'disabled'}`} aria-label="Remote trackpad"
      onPointerDown={event => {
        if (!connected) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        if (!active.current.size) gesture.current = { last: { x: event.clientX, y: event.clientY }, start: Date.now(), moved: 0, fingers: 1, cancelled: false };
        active.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        gesture.current.fingers = Math.max(gesture.current.fingers, active.current.size);
        flush();
        gesture.current.last = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={event => {
        if (!connected || !active.current.has(event.pointerId)) return;
        event.preventDefault();
        const previous = active.current.get(event.pointerId)!;
        const dx = (event.clientX - previous.x) * sensitivity / active.current.size;
        const dy = (event.clientY - previous.y) * sensitivity / active.current.size;
        active.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        gesture.current.moved += Math.abs(dx) + Math.abs(dy);
        const scroll = active.current.size >= 2;
        if (pending.current.scroll !== scroll) flush();
        pending.current.dx += dx; pending.current.dy += dy; pending.current.scroll = scroll;
        if (!pending.current.frame) pending.current.frame = requestAnimationFrame(flush);
      }}
      onPointerUp={event => {
        if (!active.current.has(event.pointerId)) return;
        active.current.delete(event.pointerId); flush();
        if (!active.current.size && !gesture.current.cancelled && gesture.current.moved < 12 && Date.now() - gesture.current.start < 300 && !dragRef.current) send({ action: 'click', button: gesture.current.fingers >= 2 ? 'right' : 'left' });
      }}
      onPointerCancel={release}>
      <MousePointer2 size={22} strokeWidth={1.3} /><span>Move with one finger</span><span className="text-[10px] text-muted-foreground">Two fingers to scroll · tap to click</span>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Button variant="secondary" disabled={!connected} onClick={() => send({ action: 'click', button: 'left' })}><MousePointerClick />Left click</Button>
      <Button variant="secondary" disabled={!connected} onClick={() => send({ action: 'click', button: 'right' })}>Right click</Button>
    </div>
    <Button className="mt-2 w-full" variant={drag ? 'default' : 'outline'} disabled={!connected} aria-pressed={drag} onClick={() => {
      const next = !drag;
      if (send({ action: next ? 'down' : 'up', button: 'left' })) { dragRef.current = next; setDrag(next); }
    }}><Hand />{drag ? 'Release drag' : 'Hold to drag'}</Button>
    <label className="mt-5 flex items-center gap-3 text-xs text-muted-foreground">Speed
      <input aria-label="Trackpad speed" className="min-w-0 flex-1 accent-[#a5e2bd]" type="range" min="0.5" max="3" step="0.1" value={sensitivity} onChange={event => { const value = Number(event.target.value); setSensitivity(value); localStorage.setItem('macremote.sensitivity', String(value)); }} />
      <span>{sensitivity.toFixed(1)}×</span>
    </label>
  </>;
}
