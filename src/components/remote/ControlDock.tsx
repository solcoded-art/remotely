import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Hand, MouseLeft, MouseRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RemoteInput } from '@/lib/remote-input';
import type { RunningApp } from '@/lib/types';
import { AppDock } from './AppDock';
import { RemoteKeyboard } from './RemoteKeyboard';
import { Trackpad } from './Trackpad';

/** Apps, keyboard, mouse buttons and trackpad. `onHide` adds a minimize button (fullscreen only). */
export function ControlDock({ input, enabled, apps, refreshApps, onHide, className }: { input: RemoteInput; enabled: boolean; apps: RunningApp[]; refreshApps(): void; onHide?(): void; className?: string }) {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false); draggingRef.current = dragging;
  useEffect(() => {
    const release = () => { if (draggingRef.current) input.send({ action: 'up', button: 'left' }); setDragging(false); };
    if (!enabled) release();
    const onHidden = () => { if (document.visibilityState === 'hidden') release(); };
    document.addEventListener('visibilitychange', onHidden); window.addEventListener('blur', release);
    return () => { release(); document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('blur', release); };
  }, [enabled, input]);

  return <section className={cn('control-dock', className)} aria-label="Remote controls">
    <AppDock apps={apps} enabled={enabled} send={input.send} refresh={refreshApps} />
    <RemoteKeyboard input={input} enabled={enabled} />
    <div className="dock-mouse">
      <div className="dock-buttons">
        <button type="button" className="dock-button" aria-label="Hold to drag" title="Hold to drag" aria-pressed={dragging} disabled={!enabled} onClick={() => {
          const next = !dragging;
          if (input.send({ action: next ? 'down' : 'up', button: 'left' })) setDragging(next);
        }}><Hand size={16} aria-hidden="true" /></button>
        <button type="button" className="dock-button" aria-label="Left click" title="Left click" disabled={!enabled} onClick={() => input.send({ action: 'click', button: 'left' })}><MouseLeft size={16} aria-hidden="true" /></button>
        <button type="button" className="dock-button" aria-label="Right click" title="Right click" disabled={!enabled} onClick={() => input.send({ action: 'click', button: 'right' })}><MouseRight size={16} aria-hidden="true" /></button>
        {onHide && <button type="button" className="dock-button" aria-label="Hide controls" title="Hide controls" onClick={onHide}><ChevronDown size={16} aria-hidden="true" /></button>}
      </div>
      <Trackpad enabled={enabled} dragging={dragging} send={input.send} />
    </div>
  </section>;
}
