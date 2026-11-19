import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

export function SetupStep({ number, title, description, complete, children }: { number: number; title: string; description: string; complete?: boolean; children?: ReactNode }) {
  return <li className={`setup-step ${complete ? 'is-complete' : ''}`}>
    <span className="setup-step-marker" aria-hidden="true">{complete ? <Check size={17} /> : number}</span>
    <div className="min-w-0 flex-1"><div className="setup-step-title">{title}{typeof complete === 'boolean' && <span className="sr-only">{complete ? ' — complete' : ' — needs attention'}</span>}</div><p>{description}</p>{children}</div>
  </li>;
}
