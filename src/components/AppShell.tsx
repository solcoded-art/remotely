import type { ReactNode } from 'react';
import { Monitor } from 'lucide-react';

export function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><Monitor size={19} strokeWidth={1.8} /></span>Mac Remote</div>;
}

export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="app-header"><Brand /><div className="header-actions">{actions}</div></header>
    {children}
  </div>;
}
