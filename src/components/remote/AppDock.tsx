import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LAUNCHERS, useAppIcons } from '@/lib/app-icons';
import { keyCode } from '@/lib/keymap';
import type { Command, RunningApp } from '@/lib/types';

/** The Mac's own icon when it has sent one; otherwise a tinted letter tile. */
function AppIcon({ name, bundleId, src }: { name: string; bundleId: string; src?: string }) {
  if (src) return <img className="dock-icon" src={src} alt="" draggable={false} />;
  let hash = 0; for (const char of bundleId || name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return <span className="dock-letter" style={{ '--tile-hue': Math.abs(hash) % 360 } as React.CSSProperties} aria-hidden="true">{name.charAt(0)}</span>;
}

/**
 * Running Mac apps, then apps the dock can open. Tap an app to bring it forward;
 * tap the app that is already in front to cycle its windows (⌘`).
 */
export function AppDock({ apps, enabled, send, refresh }: { apps: RunningApp[]; enabled: boolean; send(command: Command): boolean; refresh(): void }) {
  const icons = useAppIcons();
  const running = new Set(apps.map(app => app.bundleId));
  const refreshSoon = () => setTimeout(refresh, 700);
  return <nav className="app-dock" aria-label="Apps">
    <button type="button" className="dock-item dock-refresh" aria-label="Refresh open applications" title="Refresh" disabled={!enabled} onClick={refresh}><RefreshCw size={14} aria-hidden="true" /></button>
    {apps.map(app => <button type="button" key={app.pid} className={cn('dock-item', app.active && 'is-active')}
      aria-label={app.active ? `${app.name}, next window` : app.name} aria-pressed={app.active} title={app.active ? `${app.name}: next window (⌘\`)` : app.name} disabled={!enabled}
      onClick={() => {
        if (app.active) { send({ action: 'key', code: keyCode('`')!, modifiers: ['cmd'] }); return; }
        send({ action: 'activateApp', pid: app.pid }); refreshSoon();
      }}>
      <AppIcon name={app.name} bundleId={app.bundleId} src={icons[app.bundleId]} />
    </button>)}
    {LAUNCHERS.filter(item => !running.has(item.bundleId)).map(({ name, bundleId }) => <button type="button" key={bundleId} className="dock-item dock-launcher" aria-label={`Open ${name}`} title={`Open ${name}`} disabled={!enabled}
      onClick={() => { send({ action: 'launchApp', bundleId }); refreshSoon(); }}>
      <AppIcon name={name} bundleId={bundleId} src={icons[bundleId]} />
    </button>)}
  </nav>;
}
