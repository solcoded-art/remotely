import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, MousePointer2, MousePointerClick } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Command } from '@/lib/types';

export function Trackpad({ connected, send }: { connected: boolean; send(command: Command): boolean }) {
  const [step, setStep] = useState(20);
  const [drag, setDrag] = useState(false);
  const [sensitivity, setSensitivity] = useState(() => { const saved = Number(localStorage.getItem('macremote.sensitivity')); return Number.isFinite(saved) && saved >= 0.5 && saved <= 3 ? saved : 1.4; });
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
  function nudge(dx: number, dy: number) {
    if (connected) send({ action: dragRef.current ? 'drag' : 'move', dx: dx * step, dy: dy * step });
  }
  return <>
    <div className={`trackpad ${connected ? '' : 'disabled'}`} role="group" aria-label="Gesture trackpad"
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
      <MousePointer2 size={22} strokeWidth={1.3} /><span>Move with one finger</span><span className="text-sm text-muted-foreground">Two fingers to scroll · tap to click</span>
    </div>
    <fieldset className="pointer-controls" disabled={!connected}>
      <legend>Move the pointer without gestures</legend>
      <p className="field-hint">Choose a step size, then press a direction. Turn on Hold to drag, move with these buttons, then release.</p>
      <label className="field">Pointer step<select className="rounded-md border border-input bg-background px-3 text-sm" value={step} onChange={event => setStep(Number(event.target.value))}>{[1, 5, 20, 50].map(value => <option key={value} value={value}>{value} {value === 1 ? 'pixel' : 'pixels'}</option>)}</select></label>
      <div className="pointer-pad">
        <Button className="pointer-up" variant="outline" aria-label="Move pointer up" onClick={() => nudge(0, -1)}><ArrowUp aria-hidden="true" /></Button>
        <Button className="pointer-left" variant="outline" aria-label="Move pointer left" onClick={() => nudge(-1, 0)}><ArrowLeft aria-hidden="true" /></Button>
        <Button className="pointer-down" variant="outline" aria-label="Move pointer down" onClick={() => nudge(0, 1)}><ArrowDown aria-hidden="true" /></Button>
        <Button className="pointer-right" variant="outline" aria-label="Move pointer right" onClick={() => nudge(1, 0)}><ArrowRight aria-hidden="true" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">{([['Scroll up', 0, 80], ['Scroll down', 0, -80], ['Scroll left', 80, 0], ['Scroll right', -80, 0]] as const).map(([label, dx, dy]) => <Button variant="outline" key={label} onClick={() => send({ action: 'scroll', dx, dy })}>{label}</Button>)}</div>
    </fieldset>
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
