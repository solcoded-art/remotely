import { useCallback, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Command } from '@/lib/types';
import { toLocalDelta, toLocalPoint, useScreenSpace } from './screen-space';

export type ZoomApi = { zoomBy(factor: number): void; reset(): void; scale: number };
type View = { s: number; x: number; y: number };
const MAX_SCALE = 5;

/**
 * The streamed Mac screen. Pinch or ⌘ +/− to zoom, drag to pan when zoomed,
 * tap to click there, long-press to right-click.
 */
export function PanZoomScreen({ children, enabled, send, zoomRef, onZoomChange }: { children: ReactNode; enabled: boolean; send(command: Command): boolean; zoomRef?: Ref<ZoomApi>; onZoomChange?(scale: number): void }) {
  const { rotated } = useScreenSpace();
  const stage = useRef<HTMLDivElement>(null); const content = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ start: 0, moved: 0, pinched: false, distance: 0, mid: [0, 0] as [number, number], longPress: 0 as ReturnType<typeof setTimeout> | 0, origin: [0, 0] as [number, number] });

  const setView = useCallback((next: View) => {
    const el = stage.current; if (!el) return;
    const s = Math.min(MAX_SCALE, Math.max(1, next.s));
    const w = el.offsetWidth, h = el.offsetHeight;
    const clamped = { s, x: Math.min(0, Math.max(w - w * s, next.x)), y: Math.min(0, Math.max(h - h * s, next.y)) };
    if (s === 1) { clamped.x = 0; clamped.y = 0; }
    if (clamped.s !== viewRef.current.s) onZoomChange?.(clamped.s);
    viewRef.current = clamped; setViewState(clamped);
  }, [onZoomChange]);

  /** Zooms keeping the stage point (px, py) fixed. */
  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const el = stage.current; if (!el) return;
    const { s, x, y } = viewRef.current;
    const cx = px ?? el.offsetWidth / 2, cy = py ?? el.offsetHeight / 2;
    const next = Math.min(MAX_SCALE, Math.max(1, s * factor));
    setView({ s: next, x: cx - (cx - x) * next / s, y: cy - (cy - y) * next / s });
  }, [setView]);

  useImperativeHandle(zoomRef, () => ({ zoomBy: factor => zoomAt(factor), reset: () => setView({ s: 1, x: 0, y: 0 }), scale: view.s }), [zoomAt, setView, view.s]);

  const local = (clientX: number, clientY: number) => toLocalPoint(rotated, stage.current!, clientX, clientY);

  /** Sends a click at a stage point, mapped through zoom and the video's letterboxing. */
  function clickAt([lx, ly]: [number, number], button: 'left' | 'right') {
    const video = content.current?.querySelector('video');
    if (!enabled || !video?.videoWidth || !video.videoHeight) return;
    const { s, x, y } = viewRef.current;
    let cx = (lx - x) / s, cy = (ly - y) / s;
    for (let node: HTMLElement | null = video; node && node !== content.current; node = node.offsetParent as HTMLElement | null) { cx -= node.offsetLeft; cy -= node.offsetTop; }
    const fit = Math.min(video.offsetWidth / video.videoWidth, video.offsetHeight / video.videoHeight);
    const width = video.videoWidth * fit, height = video.videoHeight * fit;
    const vx = cx - (video.offsetWidth - width) / 2, vy = cy - (video.offsetHeight - height) / 2;
    if (vx < 0 || vy < 0 || vx > width || vy > height) return;
    if (send({ action: 'moveTo', normX: vx / width, normY: vy / height })) send({ action: 'click', button });
  }

  const cancelLongPress = () => { if (gesture.current.longPress) clearTimeout(gesture.current.longPress); gesture.current.longPress = 0; };
  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    const [ax, ay] = local(a.x, a.y), [bx, by] = local(b.x, b.y);
    return { distance: Math.hypot(ax - bx, ay - by), mid: [(ax + bx) / 2, (ay + by) / 2] as [number, number] };
  };

  return <div ref={stage} className="panzoom-stage"
    onWheel={event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const [px, py] = local(event.clientX, event.clientY);
      zoomAt(Math.exp(-event.deltaY / 200), px, py);
    }}
    onPointerDown={event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if ((event.target as HTMLElement).closest('button, a, input')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 1) {
        const origin = local(event.clientX, event.clientY);
        gesture.current = { ...gesture.current, start: Date.now(), moved: 0, pinched: false, origin };
        cancelLongPress();
        gesture.current.longPress = setTimeout(() => { gesture.current.longPress = 0; gesture.current.pinched = true; clickAt(origin, 'right'); }, 550);
      } else if (pointers.current.size === 2) {
        cancelLongPress(); gesture.current.pinched = true;
        Object.assign(gesture.current, pinchState());
      }
    }}
    onPointerMove={event => {
      const previous = pointers.current.get(event.pointerId); if (!previous) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size >= 2) {
        const { distance, mid } = pinchState(); const g = gesture.current;
        const { s, x, y } = viewRef.current;
        const next = Math.min(MAX_SCALE, Math.max(1, s * (distance / (g.distance || distance))));
        // Scale about the previous midpoint, then follow the midpoint's movement.
        setView({ s: next, x: mid[0] - (g.mid[0] - x) * next / s, y: mid[1] - (g.mid[1] - y) * next / s });
        g.distance = distance; g.mid = mid; return;
      }
      const [dx, dy] = toLocalDelta(rotated, event.clientX - previous.x, event.clientY - previous.y);
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      if (gesture.current.moved > 8) cancelLongPress();
      if (viewRef.current.s > 1 && gesture.current.moved > 8) setView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy });
    }}
    onPointerUp={event => {
      if (!pointers.current.delete(event.pointerId)) return;
      if (pointers.current.size) return;
      cancelLongPress();
      const g = gesture.current;
      if (!g.pinched && g.moved <= 8 && Date.now() - g.start < 550) clickAt(g.origin, 'left');
    }}
    onPointerCancel={event => { pointers.current.delete(event.pointerId); cancelLongPress(); gesture.current.pinched = true; }}>
    <div ref={content} className="panzoom-content" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>{children}</div>
  </div>;
}
