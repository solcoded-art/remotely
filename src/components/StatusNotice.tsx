import type { ReactNode } from 'react';
import { AlertCircle, Info, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function StatusNotice({ title, children, error = false, dismiss }: { title: string; children: ReactNode; error?: boolean; dismiss?(): void }) {
  const Icon = error ? AlertCircle : Info;
  return <Alert variant={error ? 'destructive' : 'default'} role={error ? 'alert' : 'status'} className="status-notice">
    <Icon aria-hidden="true" size={18} />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>{children}</AlertDescription>
    {dismiss && <Button className="notice-dismiss" variant="ghost" size="icon" aria-label="Dismiss error" onClick={dismiss}><X aria-hidden="true" /></Button>}
  </Alert>;
}
