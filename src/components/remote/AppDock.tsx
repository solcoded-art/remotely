import { Code2, Compass, RefreshCw, SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RunningApp } from '@/lib/types';
import type { Command } from '@/lib/types';

const LAUNCHERS = [
  { name: 'VS Code', bundleId: 'com.microsoft.VSCode', Icon: Code2 },
  { name: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92', Icon: Code2 },
  { name: 'Zed', bundleId: 'dev.zed.Zed', Icon: Code2 },
  { name: 'Terminal', bundleId: 'com.apple.Terminal', Icon: SquareTerminal },
  { name: 'Safari', bundleId: 'com.apple.Safari', Icon: Compass },
] as const;

/** Running Mac apps, then shortcuts to open apps that are not running. Scrolls. */
export function AppDock({ apps, enabled, send, refresh }: { apps: RunningApp[]; enabled: boolean; send(command: Command): boolean; refresh(): void }) {
  const running = new Set(apps.map(app => app.bundleId));
  const refreshSoon = () => setTimeout(refresh, 700);
  return <nav className="app-dock" aria-label="Apps">
    <button type="button" className="dock-item dock-refresh" aria-label="Refresh open applications" title="Refresh" disabled={!enabled} onClick={refresh}><RefreshCw size={14} aria-hidden="true" /></button>
    {apps.map(app => <button type="button" key={app.pid} className={cn('dock-item', app.active && 'is-active')} aria-label={app.name} aria-pressed={app.active} title={app.name} disabled={!enabled}
      onClick={() => { send({ action: 'activateApp', pid: app.pid }); refreshSoon(); }}>
      <span aria-hidden="true">{app.name.charAt(0)}</span>
    </button>)}
    {LAUNCHERS.filter(item => !running.has(item.bundleId)).map(({ name, bundleId, Icon }) => <button type="button" key={bundleId} className="dock-item dock-launcher" aria-label={`Open ${name}`} title={`Open ${name}`} disabled={!enabled}
      onClick={() => { send({ action: 'launchApp', bundleId }); refreshSoon(); }}>
      <Icon size={15} aria-hidden="true" />
    </button>)}
  </nav>;
}
