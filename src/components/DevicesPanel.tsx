import { ArrowRight, Laptop, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MacSetup } from '@/components/MacSetup';
import type { Device } from '@/lib/types';

export function DeviceCard({ device, ready, connect }: { device: Device; ready: boolean; connect(device: Device): void }) {
  return <li className="device-card">
    <span className="device-icon" aria-hidden="true"><Laptop size={28} strokeWidth={1.4} /></span>
    <div className="device-info"><h3 className="device-name">{device.name}</h3><p className="device-meta"><span className={`status-dot ${device.online ? 'online' : ''}`} aria-hidden="true" />{!ready ? 'Checking availability…' : device.online ? 'Online · permission approval happens on your Mac' : 'Offline · open Mac Remote on this Mac'}</p></div>
    <Button disabled={!ready || !device.online} onClick={() => connect(device)} aria-label={`Connect to ${device.name}`}>Connect<ArrowRight size={16} aria-hidden="true" /></Button>
  </li>;
}

export function DevicesPanel({ devices, ready, connect }: { devices: Device[]; ready: boolean; connect(device: Device): void }) {
  const macs = devices.filter(device => device.kind === 'desktop');
  return <Card className="journey-card">
    <div className="panel-heading"><div><span className="eyebrow">Choose your workspace</span><h2 className="section-title mt-2" id="devices-heading">My devices</h2></div><span className="text-sm text-muted-foreground">{macs.length} {macs.length === 1 ? 'Mac' : 'Macs'}</span></div>
    <p className="panel-copy">Signing in finds your devices. Connecting starts a separate request that you approve on your Mac.</p>
    <ul className="device-list" aria-label="Paired Macs">{macs.map(device => <DeviceCard key={device.id} device={device} ready={ready} connect={connect} />)}</ul>
    {!macs.length && (ready ? <MacSetup compact /> : <p className="empty-copy" role="status">Connecting to your account to find your Macs…</p>)}
    <p className="connection-footer"><Wifi size={16} aria-hidden="true" /><span>Your Mac appears when the installed Mac app is open and signed in to the same account.</span></p>
  </Card>;
}
