import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Expand, Maximize2, Minimize2, Plus, ShieldCheck, Shrink, Unplug, X, ZoomIn, ZoomOut } from 'lucide-react';
import { ConnectionProgress } from '@/components/ConnectionProgress';
import { Button } from '@/components/ui/button';
import { Viewer } from '@/components/Viewer';
import { ControlDock } from '@/components/remote/ControlDock';
import { PanZoomScreen, type ZoomApi } from '@/components/remote/PanZoomScreen';
import { ScreenSpaceContext, toLocalDelta } from '@/components/remote/screen-space';
import { cn } from '@/lib/utils';
import { RemoteInput } from '@/lib/remote-input';
import { preferences, usePreferences } from '@/lib/preferences';
import type { Connection, ConnectionSnapshot } from '@/lib/connection';

type OrientationLock = ScreenOrientation & { lock?(orientation: 'landscape'): Promise<void> };
const FAB_KEY = 'remotely.controls-position';
function readFab(): [number, number] {
  try { const [x, y] = JSON.parse(localStorage.getItem(FAB_KEY) || 'null'); if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return [x, y]; } catch { /* default */ }
  return [1, 1];
}

/** Floating button that opens the controls in fullscreen. Drag it anywhere; tap to open. */
function ControlsButton({ rotated, onOpen, buttonRef }: { rotated: boolean; onOpen(): void; buttonRef: React.RefObject<HTMLButtonElement | null> }) {
  const [position, setPosition] = useState(readFab);
  const drag = useRef<{ x: number; y: number; moved: number; start: [number, number] } | null>(null);
  const dragged = useRef(false);
  return <button ref={buttonRef} type="button" className="controls-fab" aria-label="Show controls" title="Show controls"
    style={{ left: `calc(12px + (100% - 72px) * ${position[0]})`, top: `calc(12px + (100% - 72px) * ${position[1]})` }}
    onPointerDown={event => { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ } dragged.current = false; drag.current = { x: event.clientX, y: event.clientY, moved: 0, start: position }; }}
    onPointerMove={event => {
      const state = drag.current; const area = event.currentTarget.parentElement; if (!state || !area) return;
      const [dx, dy] = toLocalDelta(rotated, event.clientX - state.x, event.clientY - state.y);
      state.moved = Math.max(state.moved, Math.hypot(dx, dy));
      if (state.moved < 6) return;
      dragged.current = true;
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      const next: [number, number] = [clamp(state.start[0] + dx / Math.max(1, area.offsetWidth - 72)), clamp(state.start[1] + dy / Math.max(1, area.offsetHeight - 72))];
      setPosition(next);
      try { localStorage.setItem(FAB_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    }}
    onPointerUp={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    // A drag ends with a click event; only a tap or keyboard activation opens the controls.
    onClick={() => { if (dragged.current) { dragged.current = false; return; } onOpen(); }}><Plus size={22} aria-hidden="true" /></button>;
}

export function RemoteSession({ connection, state }: { connection: Connection; state: ConnectionSnapshot }) {
  const [videoReady, setVideoReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [scale, setScale] = useState(1);
  const root = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const [covered, setCovered] = useState(0);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const zoom = useRef<ZoomApi>(null);
  const { screenFill } = usePreferences();
  const input = useMemo(() => new RemoteInput(connection), [connection]);
  const connected = state.status === 'connected';
  const live = connected && videoReady;
  const coarse = useMemo(() => window.matchMedia?.('(pointer: coarse)').matches ?? false, []);
  const rotated = fullscreen && portrait && coarse;

  input.enabled = live;
  useEffect(() => { if (!live) input.cancel(); }, [live, input]);
  useEffect(() => {
    // Typing that has not reached the Mac is discarded when the page is hidden.
    const hidden = () => { if (document.visibilityState === 'hidden') input.cancel(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); input.cancel(); };
  }, [input]);

  // Track the visible viewport so fullscreen fits above the iOS keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height || window.innerHeight; const width = viewport?.width || window.innerWidth;
      root.current?.style.setProperty('--remote-visible-height', `${height}px`);
      root.current?.style.setProperty('--remote-visible-width', `${width}px`);
      root.current?.style.setProperty('--remote-viewport-top', `${viewport?.offsetTop || 0}px`);
      setPortrait(height > width);
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => {});
    try { screen.orientation?.unlock?.(); } catch { /* unsupported */ }
    setFullscreen(false); setDockOpen(false); zoom.current?.reset();
    requestAnimationFrame(() => fullscreenButton.current?.focus());
  }, []);

  async function enterFullscreen() {
    setFullscreen(true); setDockOpen(false); zoom.current?.reset();
    requestAnimationFrame(() => root.current?.focus());
    const element = root.current;
    if (!document.fullscreenEnabled || !element?.requestFullscreen) return;
    try {
      await element.requestFullscreen();
      await (screen.orientation as OrientationLock | undefined)?.lock?.('landscape');
    } catch { /* Fullscreen or orientation lock unavailable: the expanded view rotates itself on phones. */ }
  }

  useEffect(() => {
    const changed = () => { if (!document.fullscreenElement && fullscreen) exitFullscreen(); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [fullscreen, exitFullscreen]);

  // Fullscreen is modal: everything outside the session is inert.
  useEffect(() => {
    if (!fullscreen || !root.current) return;
    const changed: Element[] = [];
    for (let node: Element | null = root.current; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) if (sibling !== node && !sibling.hasAttribute('inert')) { sibling.setAttribute('inert', ''); changed.push(sibling); }
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); exitFullscreen(); } };
    document.addEventListener('keydown', escape);
    return () => { changed.forEach(element => element.removeAttribute('inert')); document.removeEventListener('keydown', escape); };
  }, [fullscreen, exitFullscreen]);

  // In fullscreen the open dock overlays the bottom of the screen; tell the zoom how much it hides.
  useEffect(() => {
    const element = controls.current;
    if (!fullscreen || !dockOpen || !element) { setCovered(0); return; }
    const measure = () => { const surface = element.offsetParent as HTMLElement | null; setCovered(surface ? Math.max(0, surface.offsetHeight - element.offsetTop) : 0); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element); if (element.offsetParent) observer?.observe(element.offsetParent);
    return () => observer?.disconnect();
  }, [fullscreen, dockOpen]);

  // ⌘/Ctrl + and − zoom the Mac screen, ⌘/Ctrl 0 resets.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea:not(.phone-keyboard-field), [contenteditable="true"]')) return;
      if (event.key === '=' || event.key === '+') zoom.current?.zoomBy(1.25);
      else if (event.key === '-' || event.key === '_') zoom.current?.zoomBy(0.8);
      else if (event.key === '0') zoom.current?.reset();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);

  const tools = <div className="session-tools">
    {scale > 1 && <button type="button" className="tool-button tool-zoom" aria-label="Reset zoom" title="Reset zoom" onClick={() => zoom.current?.reset()}>{Math.round(scale * 100)}%</button>}
    <button type="button" className="tool-button" aria-label="Zoom out" title="Zoom out (⌘ −)" disabled={scale <= 1} onClick={() => zoom.current?.zoomBy(0.8)}><ZoomOut size={16} aria-hidden="true" /></button>
    <button type="button" className="tool-button" aria-label="Zoom in" title="Zoom in (⌘ +)" disabled={!state.stream || scale >= 5} onClick={() => zoom.current?.zoomBy(1.25)}><ZoomIn size={16} aria-hidden="true" /></button>
    {fullscreen && <button type="button" className="tool-button" aria-label="Fill screen" aria-pressed={screenFill} title={screenFill ? 'Fit whole screen' : 'Fill screen'} onClick={() => preferences.setScreenFill(!screenFill)}>
      {screenFill ? <Shrink size={16} aria-hidden="true" /> : <Expand size={16} aria-hidden="true" />}
    </button>}
    <button ref={fullscreen ? undefined : fullscreenButton} type="button" className="tool-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} disabled={!state.stream} onClick={fullscreen ? exitFullscreen : () => void enterFullscreen()}>
      {fullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
    </button>
    <button type="button" className="tool-button tool-danger" aria-label={connected ? 'Disconnect' : 'Cancel'} title={connected ? 'Disconnect' : 'Cancel'} onClick={connection.end}><Unplug size={16} aria-hidden="true" /></button>
  </div>;

  return <ScreenSpaceContext.Provider value={{ rotated }}>
    <div ref={root} className="remote-session" data-fullscreen={fullscreen || undefined}
      role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? `${state.session?.name ?? 'Mac'} screen` : undefined} tabIndex={-1}>
      {/* Browsers pin the fullscreen element's transform, so rotation happens on this inner surface. */}
      <div className="remote-surface" data-rotated={rotated || undefined}>
      {!live && <ConnectionProgress status={state.status} videoReady={videoReady} />}
      {!fullscreen && <div className="session-bar">
        <p className="session-status" role="status" aria-atomic="true"><span className={cn('status-dot', live && 'online')} aria-hidden="true" /><span className="truncate">{state.session?.name}</span>{live && <span className="sr-only">Session connected</span>}{state.latency !== null && <span className="session-latency">{state.latency} ms</span>}</p>
        {tools}
      </div>}
      {!fullscreen && state.rememberOffer && <div className="remember-offer" role="region" aria-label="Skip Mac approval">
        <ShieldCheck size={16} aria-hidden="true" />
        <p>Skip Mac approval until {new Date(state.rememberOffer.until).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>
        <Button type="button" size="sm" onClick={() => void connection.acceptRemember()}>Turn on</Button>
        <button type="button" className="tool-button" aria-label="Not now" title="Not now" onClick={connection.dismissRemember}><X size={15} aria-hidden="true" /></button>
      </div>}
      <section className="session-screen" aria-label="Your Mac screen">
        <PanZoomScreen enabled={live} fill={fullscreen && screenFill} covered={covered} send={input.send} zoomRef={zoom} onZoomChange={setScale}>
          <Viewer connection={connection} stream={state.stream} desktop={false} onReadyChange={setVideoReady} />
        </PanZoomScreen>
        {fullscreen && !dockOpen && <>
          {scale > 1 && <button type="button" className="tool-button tool-zoom zoom-badge" aria-label="Reset zoom" onClick={() => zoom.current?.reset()}>{Math.round(scale * 100)}%</button>}
          <ControlsButton rotated={rotated} buttonRef={fab} onOpen={() => setDockOpen(true)} />
        </>}
      </section>
      <div ref={controls} className={cn('session-controls', fullscreen && !dockOpen && 'is-hidden')}>
        {fullscreen && tools}
        <ControlDock input={input} enabled={live} apps={state.apps} refreshApps={connection.refreshApps}
          onHide={fullscreen ? () => { setDockOpen(false); requestAnimationFrame(() => fab.current?.focus()); } : undefined} />
      </div>
      </div>
    </div>
  </ScreenSpaceContext.Provider>;
}
