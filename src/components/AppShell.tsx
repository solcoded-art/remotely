import type { ReactNode } from 'react';

export function Brand({ href }: { href?: string }) {
  const artwork = <><img className="brand-logo" src="/icons/remotely-logo-5.svg" width="210" height="48" alt="Remotely" /><span className="brand-fallback">Remotely</span></>;
  return href ? <a href={href} className="brand" aria-label="Remotely home">{artwork}</a> : <div className="brand">{artwork}</div>;
}

export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return <div className="app-shell dark">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="app-header"><div className="brand-lockup"><Brand /><span className="brand-context">Your workspace, anywhere.</span></div><div className="header-actions">{actions}</div></header>
    {children}
  </div>;
}
