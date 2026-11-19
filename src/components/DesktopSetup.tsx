import { useEffect } from 'react';
import { Check, Loader2, Monitor, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SetupStep } from '@/components/SetupStep';
import { StatusNotice } from '@/components/StatusNotice';
import { useMacSetup } from '@/hooks/useMacSetup';

export function DesktopSetup({ busy, accountReady, onReadyChange }: { busy: boolean; accountReady: boolean; onReadyChange(ready: boolean): void }) {
  const setup = useMacSetup();
  const screenReady = setup.permissions?.screen === 'granted';
  const controlReady = setup.permissions?.accessibility === true && setup.driverReady;
  const ready = accountReady && screenReady && controlReady && !!setup.selected;
  useEffect(() => { onReadyChange(ready); }, [ready, onReadyChange]);
  return <Card className="journey-card">
    <div className="panel-heading"><div><span className="eyebrow">Mac setup</span><h2 className="section-title mt-2">Share your workspace</h2></div><Badge variant="outline" className="setup-badge">{busy ? 'Session active' : ready ? 'Ready for a request' : 'Setup needed'}</Badge></div>
    <p className="panel-copy">Share a full display to switch between your editor, browser, and other apps. Your screen stays private until you approve a request.</p>
    <ol className="setup-checklist" aria-label="Mac setup checklist">
      <SetupStep number={1} title="Connect your account" complete={accountReady} description={accountReady ? 'Signed in. Use the same account on your phone.' : 'Waiting for the account connection.'} />
      <SetupStep number={2} title="Allow Screen Recording" complete={screenReady} description={screenReady ? 'Mac Remote can share your selected display.' : 'Choose a display below. If macOS asks, enable Mac Remote in Privacy & Security → Screen Recording.'} />
      <SetupStep number={3} title="Allow Accessibility" complete={controlReady} description={!setup.permissions ? 'Checking permission and input driver…' : !setup.permissions.accessibility ? 'Enable Mac Remote in System Settings → Privacy & Security → Accessibility.' : !setup.driverReady ? 'Permission is enabled, but the input driver is unavailable. Reopen Mac Remote.' : 'The input driver and control permission are ready.'} />
      <SetupStep number={4} title="Choose a display" complete={!!setup.selected} description={setup.selected ? 'This is the display your phone will see. End a session before changing it.' : 'Select the display containing the editor or apps you want to use.'}>
        <div className="source-grid">{setup.sources.map(source => <button key={source.id} className={`source-card ${setup.selected === source.id ? 'selected' : ''}`} aria-label={source.name} aria-pressed={setup.selected === source.id} disabled={busy || setup.loading || setup.selecting} onClick={() => setup.select(source)}><img src={source.thumbnail} alt="" /><span className="source-name">{source.name}{setup.selected === source.id && <Check size={17} className="text-primary" aria-hidden="true" />}</span></button>)}</div>
      </SetupStep>
    </ol>
    {setup.error && <StatusNotice title="Mac setup needs attention" error>{setup.error}</StatusNotice>}
    <div className="setup-actions"><Button variant="outline" disabled={busy || setup.loading || setup.selecting} onClick={setup.loadSources}>{setup.loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Monitor aria-hidden="true" />}{setup.sources.length ? 'Refresh displays' : 'Choose display'}</Button><Button variant="outline" disabled={busy || setup.loading || setup.selecting} onClick={setup.checkPermissions}><ShieldCheck aria-hidden="true" />Check permissions</Button></div>
    <p role="status" className="setup-outcome">{busy ? 'A session is active. Use End session to stop sharing and control.' : ready ? 'Ready. Select this Mac on your phone, then approve the request here.' : 'Finish the checklist before approving a connection.'}</p>
    <p className="field-hint">Keep Mac Remote open. If macOS asks you to reopen the app after changing permissions, do so and choose your display again.</p>
  </Card>;
}
