import { useId, useState } from 'react';
import { Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { REMEMBER_OPTIONS } from '@/lib/remember';
import type { Connection, ConnectionSnapshot } from '@/lib/connection';

/** The Mac's prompt for a phone's connection request, or the status of a remembered phone reconnecting. */
export function ApprovalCard({ connection, pending, ready }: { connection: Connection; pending: NonNullable<ConnectionSnapshot['pending']>; ready: boolean }) {
  const [approving, setApproving] = useState(false);
  const [remember, setRemember] = useState(0);
  const selectId = useId();
  if (pending.unlocked) return <Card className="approval-card" aria-labelledby="approval-title">
    <div role="status" aria-atomic="true" className="flex items-center gap-3"><Loader2 className="animate-spin text-primary" aria-hidden="true" /><h2 id="approval-title" className="text-lg font-medium">{pending.name} is reconnecting</h2></div>
  </Card>;
  return <Card className="approval-card" aria-labelledby="approval-title">
    <div role="status" aria-atomic="true" className="flex items-start gap-3"><Smartphone className="text-primary" aria-hidden="true" /><div><h2 id="approval-title" className="text-lg font-medium">{pending.name} wants to connect</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Paired with this Mac using its device key. Allowing this request shares your selected display and enables mouse and keyboard control.</p></div></div>
    {!ready && <p className="text-sm text-muted-foreground">Complete the Mac setup checklist below before allowing this request.</p>}
    {pending.canRemember && <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={selectId}>Skip approval for</label>
      <select id={selectId} className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={remember} disabled={approving} onChange={event => setRemember(Number(event.target.value))}>
        {REMEMBER_OPTIONS.map(option => <option key={option.ms} value={option.ms}>{option.label}</option>)}
      </select>
    </div>}
    <div className="setup-actions">
      <Button disabled={approving || !ready} onClick={async () => { setApproving(true); try { await connection.approve(remember); } finally { setApproving(false); } }}>{approving && <Loader2 className="animate-spin" aria-hidden="true" />}Allow connection</Button>
      <Button variant="outline" disabled={approving} onClick={connection.decline}>Decline</Button>
    </div>
  </Card>;
}
