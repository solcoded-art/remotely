import { useState } from 'react';
import { AppWindow, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Code2, Keyboard, MousePointer2, RefreshCw, Send, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trackpad } from './Trackpad';
import type { Connection } from '@/lib/connection';
import type { RunningApp } from '@/lib/types';

const launchers = [
  ['VS Code', 'com.microsoft.VSCode', Code2], ['Cursor', 'com.todesktop.230313mzl4w4u92', Code2],
  ['Zed', 'dev.zed.Zed', Code2], ['Terminal', 'com.apple.Terminal', Terminal],
] as const;
const shortcuts = [['⌘ Tab', 48, ['cmd']], ['⌘ Space', 49, ['cmd']], ['Escape', 53, []], ['⌘ C', 8, ['cmd']], ['⌘ V', 9, ['cmd']], ['⌘ Z', 6, ['cmd']], ['⌘ W', 13, ['cmd']], ['Return', 36, []], ['Delete', 51, []]] as const;

const shortcutNames: Record<string, string> = { '⌘ Tab': 'Switch apps (Command Tab)', '⌘ Space': 'Open Spotlight (Command Space)', '⌘ C': 'Copy (Command C)', '⌘ V': 'Paste (Command V)', '⌘ Z': 'Undo (Command Z)', '⌘ W': 'Close window (Command W)' };

export function RemoteControls({ connection, connected, apps }: { connection: Connection; connected: boolean; apps: RunningApp[] }) {
  const [text, setText] = useState('');
  function sendText(event: React.FormEvent) {
    event.preventDefault();
    if (text && connection.sendCommand({ action: 'type', text })) setText('');
  }
  function refreshSoon() { setTimeout(() => { if (connection.snapshot().status === 'connected') connection.refreshApps(); }, 700); }
  return <aside aria-label="Remote controls" className="control-panel rounded-xl border border-border bg-card">
    <Tabs defaultValue="apps">
      <TabsList aria-label="Remote control modes" className="grid h-auto min-h-11 w-full grid-cols-3 bg-background">
        <TabsTrigger value="apps" className="min-h-10 gap-1.5"><AppWindow size={15} />Apps</TabsTrigger>
        <TabsTrigger value="trackpad" className="min-h-10 gap-1.5"><MousePointer2 size={15} />Mouse</TabsTrigger>
        <TabsTrigger value="keyboard" className="min-h-10 gap-1.5"><Keyboard size={15} />Keys</TabsTrigger>
      </TabsList>
      <TabsContent value="apps" className="mt-5">
        <div className="mb-3 flex items-center justify-between"><span className="eyebrow">Open applications</span><Button variant="ghost" size="icon" aria-label="Refresh open applications" disabled={!connected} onClick={connection.refreshApps}><RefreshCw size={14} /></Button></div>
        <div className="app-list">
          {apps.map(app => <button key={app.pid} aria-pressed={app.active} className={`app-row ${app.active ? 'active' : ''}`} disabled={!connected} onClick={() => { connection.sendCommand({ action: 'activateApp', pid: app.pid }); refreshSoon(); }}>
            <span className="app-avatar" aria-hidden="true">{app.name.charAt(0)}</span><span className="min-w-0 flex-1 truncate text-xs">{app.name}</span>{app.active && <span className="status-dot online !mr-0" aria-hidden="true" />}
          </button>)}
          {!apps.length && <p className="py-4 text-xs leading-6 text-muted-foreground">{connected ? 'Refresh to see running apps on your Mac.' : 'Your Mac’s running apps appear here after connecting.'}</p>}
        </div>
        <div className="my-5 h-px bg-border" /><div className="eyebrow mb-3">Open your workspace</div>
        <div className="grid grid-cols-2 gap-2">{launchers.map(([name, bundleId, Icon]) => <Button key={bundleId} className="justify-start text-xs" variant="outline" disabled={!connected} onClick={() => { connection.sendCommand({ action: 'launchApp', bundleId }); refreshSoon(); }}><Icon size={15} />{name}</Button>)}</div>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">Opens the app on your Mac. The selected display shows whichever window is in front.</p>
      </TabsContent>
      <TabsContent value="trackpad" className="mt-5"><div className="eyebrow">Precision trackpad</div><Trackpad send={connection.sendCommand} connected={connected} /></TabsContent>
      <TabsContent value="keyboard" className="mt-5">
        <div className="eyebrow mb-3">Send text to your Mac</div>
        <form className="flex gap-2" onSubmit={sendText}><Input value={text} onChange={event => setText(event.target.value)} placeholder="Type or paste text…" aria-label="Text to send" maxLength={4096} disabled={!connected} autoCapitalize="none" autoCorrect="off" /><Button size="icon" aria-label="Send text" disabled={!connected || !text}><Send size={16} /></Button></form>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">Click the editor or text field on your Mac first.</p>
        <div className="eyebrow mb-3 mt-6">Shortcuts</div><div className="shortcut-grid">{shortcuts.map(([label, code, modifiers]) => <Button variant="outline" className="px-1 text-xs" key={label} aria-label={shortcutNames[label] ? `${label}: ${shortcutNames[label]}` : label} disabled={!connected} onClick={() => connection.sendCommand({ action: 'key', code, modifiers: [...modifiers] })}>{label}</Button>)}</div>
        <div className="mt-3 grid grid-cols-4 gap-2">{([[ArrowLeft, 123, 'Left arrow key'], [ArrowUp, 126, 'Up arrow key'], [ArrowDown, 125, 'Down arrow key'], [ArrowRight, 124, 'Right arrow key']] as const).map(([Arrow, code, label]) => <Button variant="secondary" key={code} disabled={!connected} aria-label={label} onClick={() => connection.sendCommand({ action: 'key', code, modifiers: [] })}><Arrow size={16} aria-hidden="true" /></Button>)}</div>
      </TabsContent>
    </Tabs>
  </aside>;
}
