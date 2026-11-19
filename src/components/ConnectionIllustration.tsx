import { ArrowUpRight, Laptop, LockKeyhole, Smartphone } from 'lucide-react';

export function ConnectionIllustration() {
  return <div className="connection-illustration" aria-hidden="true">
    <div className="illustration-orbit" />
    <div className="illustration-mac"><div className="illustration-window-bar"><i /><i /><i /><span>YOUR WORKSPACE</span></div><div className="illustration-desktop"><img src="/icons/icon-192.png" width="48" height="48" alt="" /><div className="illustration-lines"><i /><i /><i /></div><Laptop size={20} /></div><div className="illustration-caption"><span>Your Mac</span><ArrowUpRight size={15} /></div></div>
    <div className="illustration-link"><span /><LockKeyhole size={16} /><span /></div>
    <div className="illustration-phone"><div className="illustration-camera" /><Smartphone size={28} /><div className="illustration-phone-lines"><i /><i /></div><span>Your iPhone</span></div>
    <span className="illustration-note">One account. Your devices.</span>
  </div>;
}
