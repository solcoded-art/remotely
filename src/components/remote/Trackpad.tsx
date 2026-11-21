import { useRef } from 'react';
import { usePreferences } from '@/lib/preferences';
import type { Command } from '@/lib/types';
import { toLocalDelta, useScreenSpace } from './screen-space';

/**
 * Pointer acceleration, like a Mac trackpad: slow, precise movement keeps the set
 * speed; a quick swipe (finger speed in CSS px per ms) covers up to 3× the distance.
 */
export function acceleration(pxPerMs: number) {
  return 1 + 2 * Math.min(1, Math.max(0, (pxPerMs - 0.25) / 1.25));
}

/**
 * One finger moves, two fingers scroll, tap clicks, two-finger tap right-clicks.
 * When focused: arrow keys move (Shift for larger steps), Page Up/Down scroll, Enter clicks.
 */
export function Trackpad({ enabled, dragging, send }: { enabled: boolean; dragging: boolean; send(command: Command): boolean }) {
  const { trackpadSpeed } = usePreferences();
  const { rotated } = useScreenSpace();
  const gesture = useRef({ start: 0, moved: 0, fingers: 0 });
  const active = useRef(new Map<number, { x: number; y: number; t: number }>());
  const pending = useRef({ dx: 0, dy: 0, scroll: false, frame: 0 });
  const motion = () => dragging ? 'drag' : 'move';

  function flush() {
    const { dx, dy, scroll } = pending.current;
    pending.current = { dx: 0, dy: 0, scroll, frame: 0 };
    if (dx || dy) send({ action: scroll ? 'scroll' : motion(), dx: scroll ? -dx * 1.5 : dx, dy: scroll ? -dy * 1.5 : dy });
  }
  function reset() { active.current.clear(); cancelAnimationFrame(pending.current.frame); pending.current = { dx: 0, dy: 0, scroll: false, frame: 0 }; }

  return <div className="trackpad" role="application" aria-label="Trackpad" aria-disabled={!enabled} tabIndex={enabled ? 0 : -1}
    onKeyDown={event => {
      if (!enabled) return;
      const step = event.shiftKey ? 50 : 10;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[event.key]) send({ action: motion(), dx: moves[event.key][0], dy: moves[event.key][1] });
      else if (event.key === 'PageUp' || event.key === 'PageDown') send({ action: 'scroll', dx: 0, dy: event.key === 'PageUp' ? 80 : -80 });
      else if (event.key === 'Enter') send({ action: 'click', button: event.shiftKey ? 'right' : 'left' });
      else return;
      event.preventDefault();
    }}
    onPointerDown={event => {
      if (!enabled) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      if (!active.current.size) gesture.current = { start: Date.now(), moved: 0, fingers: 1 };
      active.current.set(event.pointerId, { x: event.clientX, y: event.clientY, t: event.timeStamp });
      gesture.current.fingers = Math.max(gesture.current.fingers, active.current.size);
      flush();
    }}
    onPointerMove={event => {
      const previous = active.current.get(event.pointerId);
      if (!enabled || !previous) return;
      event.preventDefault();
      const [rawX, rawY] = toLocalDelta(rotated, event.clientX - previous.x, event.clientY - previous.y);
      const scrolling = active.current.size >= 2;
      // Scrolling keeps a constant speed; pointer moves accelerate with finger speed.
      const gain = scrolling ? 1 : acceleration(Math.hypot(rawX, rawY) / Math.max(1, event.timeStamp - previous.t));
      const dx = rawX * trackpadSpeed * gain / active.current.size; const dy = rawY * trackpadSpeed * gain / active.current.size;
      active.current.set(event.pointerId, { x: event.clientX, y: event.clientY, t: event.timeStamp });
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      const scroll = active.current.size >= 2;
      if (pending.current.scroll !== scroll) flush();
      pending.current.dx += dx; pending.current.dy += dy; pending.current.scroll = scroll;
      if (!pending.current.frame) pending.current.frame = requestAnimationFrame(flush);
    }}
    onPointerUp={event => {
      if (!active.current.has(event.pointerId)) return;
      active.current.delete(event.pointerId); flush();
      if (!active.current.size && gesture.current.moved < 12 && Date.now() - gesture.current.start < 300 && !dragging) send({ action: 'click', button: gesture.current.fingers >= 2 ? 'right' : 'left' });
    }}
    onPointerCancel={reset} />;
}
