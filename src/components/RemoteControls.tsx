import { AppWindow, Code2, Keyboard, MousePointer2, RefreshCw, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RemoteKeyboard } from './RemoteKeyboard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trackpad } from './Trackpad';
import type { Connection } from '@/lib/connection';
import type { RunningApp } from '@/lib/types';

const launchers = [
  ['VS Code', 'com.microsoft.VSCode', Code2], ['Cursor', 'com.todesktop.230313mzl4w4u92', Code2],
  ['Zed', 'dev.zed.Zed', Code2], ['Terminal', 'com.apple.Terminal', Terminal],
] as const;
export function RemoteControls({ connection, connected, apps, inputBusy, onInputBusyChange }: { connection: Connection; connected: boolean; apps: RunningApp[]; inputBusy: boolean; onInputBusyChange(busy: boolean): void }) {
  function refreshSoon() { setTimeout(() => { if (connection.snapshot().status === 'connected') connection.refreshApps(); }, 700); }
  return <aside aria-label="Remote controls" className="control-panel rounded-xl border border-border bg-card">
    <Tabs defaultValue="apps">
      <TabsList aria-label="Remote control modes" className="grid h-auto min-h-11 w-full grid-cols-3 bg-background">
        <TabsTrigger disabled={inputBusy} value="apps" className="min-h-10 gap-1.5"><AppWindow size={15} />Apps</TabsTrigger>
        <TabsTrigger disabled={inputBusy} value="trackpad" className="min-h-10 gap-1.5"><MousePointer2 size={15} />Mouse</TabsTrigger>
        <TabsTrigger value="keyboard" className="min-h-10 gap-1.5"><Keyboard size={15} />Keys</TabsTrigger>
      </TabsList>
      <TabsContent value="apps" className="mt-5">
        <div className="mb-3 flex items-center justify-between"><span className="eyebrow">Open applications</span><Button variant="ghost" size="icon" aria-label="Refresh open applications" disabled={!connected || inputBusy} onClick={connection.refreshApps}><RefreshCw size={14} /></Button></div>
        <div className="app-list">
          {apps.map(app => <button key={app.pid} aria-pressed={app.active} className={`app-row ${app.active ? 'active' : ''}`} disabled={!connected || inputBusy} onClick={() => { connection.sendCommand({ action: 'activateApp', pid: app.pid }); refreshSoon(); }}>
            <span className="app-avatar" aria-hidden="true">{app.name.charAt(0)}</span><span className="min-w-0 flex-1 truncate text-xs">{app.name}</span>{app.active && <span className="status-dot online !mr-0" aria-hidden="true" />}
          </button>)}
          {!apps.length && <p className="py-4 text-xs leading-6 text-muted-foreground">{connected ? 'Refresh to see running apps on your Mac.' : 'Your Mac’s running apps appear here after connecting.'}</p>}
        </div>
        <div className="my-5 h-px bg-border" /><div className="eyebrow mb-3">Open your workspace</div>
        <div className="grid grid-cols-2 gap-2">{launchers.map(([name, bundleId, Icon]) => <Button key={bundleId} className="justify-start text-xs" variant="outline" disabled={!connected || inputBusy} onClick={() => { connection.sendCommand({ action: 'launchApp', bundleId }); refreshSoon(); }}><Icon size={15} />{name}</Button>)}</div>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">Opens the app on your Mac. The selected display shows whichever window is in front.</p>
      </TabsContent>
      <TabsContent value="trackpad" className="mt-5"><div className="eyebrow">Precision trackpad</div><Trackpad send={connection.sendCommand} connected={connected && !inputBusy} /></TabsContent>
      <TabsContent forceMount value="keyboard" className="mt-5 data-[state=inactive]:hidden"><RemoteKeyboard connection={connection} connected={connected} onBusyChange={onInputBusyChange} /></TabsContent>
    </Tabs>
  </aside>;
}
