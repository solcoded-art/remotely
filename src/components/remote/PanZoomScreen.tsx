import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Command } from '@/lib/types';
import { toLocalDelta, toLocalPoint, useScreenSpace } from './screen-space';

/** `scale` is relative to the resting view: 1 is fit (or fill, when filling). */
export type ZoomApi = { zoomBy(factor: number): void; reset(): void; scale: number };
type View = { s: number; x: number; y: number };
/** The Mac frame inside the unscaled content, after the video's letterboxing. */
type Frame = { x: number; y: number; w: number; h: number };
const MAX_ZOOM = 5;

/**
 * The streamed Mac screen. Pinch or ⌘ +/− to zoom, drag to pan, tap to click there,
 * long-press to right-click. With `fill`, the resting view covers the whole stage and
 * the rest of the Mac screen is a pan away. Panning never shows letterbox bars.
 */
export function PanZoomScreen({ children, enabled, fill = false, covered = 0, send, zoomRef, onZoomChange }: { children: ReactNode; enabled: boolean; fill?: boolean; /** Stage pixels hidden under controls at the bottom; panning can lift the screen above them. */ covered?: number; send(command: Command): boolean; zoomRef?: Ref<ZoomApi>; onZoomChange?(scale: number): void }) {
  const { rotated } = useScreenSpace();
  const stage = useRef<HTMLDivElement>(null); const content = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const minRef = useRef(1);
  const reported = useRef(1);
  const coveredRef = useRef(covered); coveredRef.current = covered;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ start: 0, moved: 0, pinched: false, distance: 0, mid: [0, 0] as [number, number], longPress: 0 as ReturnType<typeof setTimeout> | 0, origin: [0, 0] as [number, number] });

  const frame = useCallback((): Frame | null => {
    const video = content.current?.querySelector('video');
    if (!video?.videoWidth || !video.videoHeight || !video.offsetWidth || !video.offsetHeight) return null;
    let ox = 0, oy = 0;
    for (let node: HTMLElement | null = video; node && node !== content.current; node = node.offsetParent as HTMLElement | null) { ox += node.offsetLeft; oy += node.offsetTop; }
    const fit = Math.min(video.offsetWidth / video.videoWidth, video.offsetHeight / video.videoHeight);
    const w = video.videoWidth * fit, h = video.videoHeight * fit;
    return { x: ox + (video.offsetWidth - w) / 2, y: oy + (video.offsetHeight - h) / 2, w, h };
  }, []);

  const setView = useCallback((next: View) => {
    const el = stage.current; if (!el) return;
    const W = el.offsetWidth, H = Math.max(1, el.offsetHeight - coveredRef.current), min = minRef.current;
    const s = Math.min(MAX_ZOOM * min, Math.max(min, next.s));
    const f = frame() ?? { x: 0, y: 0, w: W, h: H };
    // Keep the frame covering the visible stage on any axis where it is larger; center it otherwise.
    const axis = (pos: number, size: number, start: number, length: number) => length * s >= size - 0.5
      ? Math.min(-start * s, Math.max(size - (start + length) * s, pos))
      : (size - length * s) / 2 - start * s;
    const clamped = { s, x: axis(next.x, W, f.x, f.w), y: axis(next.y, H, f.y, f.h) };
    const relative = s / min;
    if (Math.abs(relative - reported.current) > 1e-3) { reported.current = relative; onZoomChange?.(relative); }
    viewRef.current = clamped; setViewState(clamped);
  }, [frame, onZoomChange]);

  /** The view at scale s centered on the Mac frame. */
  const centered = useCallback((s: number): View => {
    const el = stage.current!; const f = frame() ?? { x: 0, y: 0, w: el.offsetWidth, h: el.offsetHeight };
    return { s, x: el.offsetWidth / 2 - (f.x + f.w / 2) * s, y: (el.offsetHeight - coveredRef.current) / 2 - (f.y + f.h / 2) * s };
  }, [frame]);

  /** Zooms keeping the stage point (px, py) fixed. */
  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const el = stage.current; if (!el) return;
    const { s, x, y } = viewRef.current; const min = minRef.current;
    const cx = px ?? el.offsetWidth / 2, cy = py ?? el.offsetHeight / 2;
    const next = Math.min(MAX_ZOOM * min, Math.max(min, s * factor));
    setView({ s: next, x: cx - (cx - x) * next / s, y: cy - (cy - y) * next / s });
  }, [setView]);

  // The resting scale follows the stage size, the stream's shape and fit/fill.
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const video = content.current?.querySelector('video');
    const update = () => {
      const f = frame(); const W = el.offsetWidth, H = el.offsetHeight;
      const previous = minRef.current;
      const atRest = viewRef.current.s <= previous * 1.001;
      minRef.current = fill && f && W && H ? Math.max(1, W / f.w, H / f.h) : 1;
      setView(atRest ? centered(minRef.current) : viewRef.current);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    video?.addEventListener('loadedmetadata', update); video?.addEventListener('resize', update);
    return () => { observer?.disconnect(); video?.removeEventListener('loadedmetadata', update); video?.removeEventListener('resize', update); };
  }, [fill, frame, centered, setView]);
  // Controls opening or closing over the screen re-clamp the view so nothing stays hidden under them.
  useEffect(() => { setView(viewRef.current); }, [covered, setView]);

  useImperativeHandle(zoomRef, () => ({ zoomBy: factor => zoomAt(factor), reset: () => setView(centered(minRef.current)), scale: view.s / minRef.current }), [zoomAt, setView, centered, view.s]);

  const local = (clientX: number, clientY: number) => toLocalPoint(rotated, stage.current!, clientX, clientY);

  /** Sends a click at a stage point, mapped through zoom and the video's letterboxing. */
  function clickAt([lx, ly]: [number, number], button: 'left' | 'right') {
    const f = frame(); if (!enabled || !f) return;
    const { s, x, y } = viewRef.current;
    const cx = (lx - x) / s - f.x, cy = (ly - y) / s - f.y;
    if (cx < 0 || cy < 0 || cx > f.w || cy > f.h) return;
    if (send({ action: 'moveTo', normX: cx / f.w, normY: cy / f.h })) send({ action: 'click', button });
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
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
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
        const { s, x, y } = viewRef.current; const min = minRef.current;
        const next = Math.min(MAX_ZOOM * min, Math.max(min, s * (distance / (g.distance || distance))));
        // Scale about the previous midpoint, then follow the midpoint's movement.
        setView({ s: next, x: mid[0] - (g.mid[0] - x) * next / s, y: mid[1] - (g.mid[1] - y) * next / s });
        g.distance = distance; g.mid = mid; return;
      }
      const [dx, dy] = toLocalDelta(rotated, event.clientX - previous.x, event.clientY - previous.y);
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      if (gesture.current.moved > 8) {
        cancelLongPress();
        // Pans whenever part of the Mac frame is off-stage (zoomed in, or filling).
        setView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy });
      }
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
