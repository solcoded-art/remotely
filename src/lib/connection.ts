import { request } from './api';
import type { Auth, Command, Device, DriverEvent, RunningApp, ServerMessage, Signal } from './types';

type Session = { id: string; name: string };
type Snapshot = {
  ready: boolean; status: 'offline' | 'connecting' | 'ready' | 'pending' | 'negotiating' | 'connected';
  devices: Device[]; pending: Session | null; session: Session | null; error: string;
  stream: MediaStream | null; apps: RunningApp[]; route: string; latency: number | null;
};
const initial: Snapshot = { ready: false, status: 'connecting', devices: [], pending: null, session: null, error: '', stream: null, apps: [], route: '', latency: null };

export class Connection {
  private value: Snapshot = { ...initial };
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private capture: MediaStream | null = null;
  private ice: RTCIceServer[] = [];
  private candidates: RTCIceCandidateInit[] = [];
  private disposed = false;
  private serial = Promise.resolve();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private negotiationTimer?: ReturnType<typeof setTimeout>;
  private statsTimer?: ReturnType<typeof setInterval>;
  private authTimer?: ReturnType<typeof setTimeout>;
  private removeDriver?: () => void;
  private messageCount = 0;
  private messageWindow = 0;
  readonly desktop = !!window.macRemote;
  private deviceId = '';

  constructor(readonly auth: Auth) {}
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(data: Partial<Snapshot>) { this.value = { ...this.value, ...data }; this.listeners.forEach(fn => fn()); }
  clearError = () => this.update({ error: '' });
  report = (error: unknown) => this.update({ error: error instanceof Error ? error.message : String(error) });

  async start() {
    try {
      const key = `macremote.device.${this.auth.user.id}.${this.desktop ? 'mac' : 'ios'}`;
      this.deviceId = localStorage.getItem(key) || crypto.randomUUID();
      localStorage.setItem(key, this.deviceId);
      const name = this.desktop ? (await window.macRemote!.info()).name : /iPad/.test(navigator.userAgent) ? 'My iPad' : 'My iPhone';
      await request(this.auth.service, '/api/devices', { token: this.auth.token, method: 'POST', data: { id: this.deviceId, name, kind: this.desktop ? 'desktop' : 'controller' } });
      if (this.disposed) return;
      if (this.desktop) this.removeDriver = window.macRemote!.onDriver(event => this.driverEvent(event));
      this.authTimer = setTimeout(() => { this.update({ error: 'Your login expired. Sign in again.' }); this.dispose(); }, Math.max(0, this.auth.expires - Date.now()));
      this.openSocket();
    } catch (error) { this.update({ status: 'offline' }); this.report(error); }
  }
  private openSocket() {
    if (this.disposed) return;
    this.update({ ready: false, status: 'connecting' });
    const url = new URL('/ws', this.auth.service); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: this.auth.token, deviceId: this.deviceId }));
    ws.onmessage = event => {
      this.serial = this.serial.then(async () => {
        if (this.ws !== ws || this.disposed) return;
        await this.message(JSON.parse(event.data) as ServerMessage);
      }).catch(error => { this.report(error); this.end(); });
    };
    ws.onerror = () => this.report(Error('Cannot reach the account server. Check the URL and network.'));
    ws.onclose = event => {
      if (this.ws !== ws) return;
      this.cleanupPeer();
      this.update({ ready: false, status: 'offline', pending: null, session: null, devices: this.value.devices.map(device => ({ ...device, online: false })) });
      if (!this.disposed && ![4000, 4001].includes(event.code)) this.reconnectTimer = setTimeout(() => this.openSocket(), 2000);
      else if (!this.disposed) this.report(Error('Device session closed. Sign in again.'));
    };
  }
  private send(data: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) throw Error('The account service is disconnected.');
    this.ws.send(JSON.stringify(data));
  }
  private async message(data: ServerMessage) {
    if (data.type === 'ready') this.update({ ready: true, status: 'ready', error: '' });
    if (data.type === 'devices') this.update({ devices: data.devices || [] });
    if (data.type === 'error') { this.report(Error(data.message || 'Connection failed.')); if (this.value.session) this.end(); }
    if (data.type === 'pending') this.update({ session: { id: data.sessionId!, name: data.name! }, status: 'pending', error: '' });
    if (data.type === 'request') this.update({ pending: { id: data.sessionId!, name: data.name! }, error: '' });
    if (data.type === 'approved') {
      const session = this.value.session || this.value.pending;
      if (!session || session.id !== data.sessionId) throw Error('Unexpected session approval.');
      this.update({ session, pending: null, status: 'negotiating' });
      await this.createPeer(session.id);
    }
    if (data.type === 'signal' && data.sessionId === this.value.session?.id && data.signal) await this.signal(data.signal);
    if (data.type === 'ended' && [this.value.session?.id, this.value.pending?.id].includes(data.sessionId)) {
      this.cleanupPeer();
      this.update({ session: null, pending: null, status: this.value.ready ? 'ready' : 'offline', error: data.reason === 'Session ended' ? '' : data.reason || '' });
    }
  }
  connect = (device: Device) => {
    try { this.clearError(); this.send({ type: 'connect', targetId: device.id }); }
    catch (error) { this.report(error); }
  };
  approve = async () => {
    const pending = this.value.pending;
    if (!pending || !this.desktop) return;
    try {
      await window.macRemote!.approve(pending.id);
      this.capture = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (this.disposed || this.value.pending?.id !== pending.id || !this.value.ready) { this.cleanupPeer(); return; }
      for (const track of this.capture.getTracks()) track.addEventListener('ended', () => this.end(), { once: true });
      this.update({ stream: this.capture });
      this.send({ type: 'approve', sessionId: pending.id, allowed: true });
    } catch (error) {
      this.report(error);
      try { this.send({ type: 'approve', sessionId: pending.id, allowed: false }); } catch {}
      this.cleanupPeer();
    }
  };
  decline = () => {
    if (!this.value.pending) return;
    try { this.send({ type: 'approve', sessionId: this.value.pending.id, allowed: false }); }
    catch (error) { this.report(error); }
  };
  private async createPeer(id: string) {
    // TURN REST credentials are short-lived. Refresh for every new connection.
    this.ice = (await request<{ iceServers: RTCIceServer[] }>(this.auth.service, '/api/ice', { token: this.auth.token })).iceServers;
    if (this.disposed || this.value.session?.id !== id) return;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    this.pc = pc; this.candidates = [];
    const signal = (value: Signal) => this.send({ type: 'signal', sessionId: id, signal: value });
    pc.onicecandidate = event => { if (event.candidate && this.pc === pc) { try { signal({ type: 'ice', candidate: event.candidate.toJSON() }); } catch (error) { this.report(error); } } };
    pc.ontrack = event => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.update({ stream });
      event.track.onended = () => this.end();
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'failed') { this.report(Error('Peer connection failed. Configure a TURN relay for connections across different networks.')); this.end(); }
      if (pc.connectionState === 'disconnected') this.update({ status: 'negotiating', route: 'Reconnecting peer…' });
      if (pc.connectionState === 'connected' && this.channel?.readyState === 'open') this.update({ status: 'connected' });
    };
    if (this.desktop) {
      if (!this.capture) throw Error('Select and share a display before connecting.');
      this.capture.getTracks().forEach(track => pc.addTrack(track, this.capture!));
      this.setupChannel(pc.createDataChannel('mac-remote', { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal({ type: 'offer', sdp: offer.sdp! });
    } else pc.ondatachannel = event => this.setupChannel(event.channel);
    this.negotiationTimer = setTimeout(() => { if (this.pc === pc && this.value.status !== 'connected') { this.report(Error('Connection timed out. Check Mac permissions and TURN configuration.')); this.end(); } }, 25000);
  }
  private async signal(signal: Signal) {
    const pc = this.pc;
    if (!pc) throw Error('Peer is not ready.');
    if (signal.type === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
      else this.candidates.push(signal.candidate);
      return;
    }
    await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    for (const candidate of this.candidates) await pc.addIceCandidate(candidate);
    this.candidates = [];
    if (signal.type === 'offer') {
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      this.send({ type: 'signal', sessionId: this.value.session!.id, signal: { type: 'answer', sdp: answer.sdp! } });
    }
  }
  private setupChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      if (this.channel !== channel) return;
      clearTimeout(this.negotiationTimer);
      this.update({ status: 'connected', error: '' });
      if (!this.desktop) this.sendCommand({ action: 'listApps' });
      this.readStats().catch(() => {});
      this.statsTimer = setInterval(() => this.readStats().catch(() => {}), 2000);
    };
    channel.onclose = () => { if (this.channel === channel) this.end(); };
    channel.onerror = () => { this.report(Error('Remote control channel failed.')); this.end(); };
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 32768) { this.end(); return; }
      if (Date.now() - this.messageWindow > 1000) { this.messageWindow = Date.now(); this.messageCount = 0; }
      if (++this.messageCount > 250) { this.report(Error('Remote sent too many commands.')); this.end(); return; }
      try {
        const command = JSON.parse(event.data) as Command;
        if (this.desktop) {
          if (!this.value.session || !window.macRemote) return;
          window.macRemote.command(this.value.session.id, command).catch(error => { this.sendData({ action: 'error', error: error.message }); });
        } else this.driverEvent(command as DriverEvent);
      } catch { this.report(Error('Invalid control message.')); }
    };
  }
  private driverEvent(event: DriverEvent) {
    if (event.error || event.action === 'error') { this.report(Error(event.error || event.message || 'The Mac could not complete this action.')); }
    if (this.desktop) this.sendData(event);
    else if (event.action === 'listApps' && event.apps) this.update({ apps: event.apps });
  }
  private sendData(value: unknown) {
    if (this.channel?.readyState !== 'open') return false;
    if (this.channel.bufferedAmount > 65536) return false;
    this.channel.send(JSON.stringify(value)); return true;
  }
  sendCommand = (command: Command) => {
    if (!this.sendData(command)) {
      this.report(Error('Remote control is not connected.'));
      if (this.value.status === 'connected') this.end();
      return false;
    }
    return true;
  };
  refreshApps = () => this.sendCommand({ action: 'listApps' });
  private async readStats() {
    const pc = this.pc;
    if (!pc) return;
    const stats = await pc.getStats();
    if (pc !== this.pc) return;
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
        const local = stats.get(report.localCandidateId); const remote = stats.get(report.remoteCandidateId);
        this.update({ route: local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'TURN relay' : 'Direct peer connection', latency: typeof report.currentRoundTripTime === 'number' ? Math.round(report.currentRoundTripTime * 1000) : null });
      }
    });
  }
  private cleanupPeer() {
    clearTimeout(this.negotiationTimer); clearInterval(this.statsTimer);
    const channel = this.channel; this.channel = null;
    if (channel) { channel.onclose = null; channel.onerror = null; channel.close(); }
    const pc = this.pc; this.pc = null;
    if (pc) { pc.onconnectionstatechange = null; pc.close(); }
    this.capture?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.capture = null; this.candidates = [];
    window.macRemote?.end().catch(() => {});
    this.update({ stream: null, apps: [], route: '', latency: null });
  }
  end = () => {
    const id = this.value.session?.id || this.value.pending?.id;
    if (id && this.ws?.readyState === WebSocket.OPEN) this.send({ type: 'end', sessionId: id });
    this.cleanupPeer();
    this.update({ session: null, pending: null, status: this.value.ready ? 'ready' : 'offline' });
  };
  dispose = () => {
    this.end(); this.disposed = true;
    clearTimeout(this.reconnectTimer); clearTimeout(this.authTimer);
    this.removeDriver?.();
    const ws = this.ws; this.ws = null; ws?.close();
    this.update({ ready: false, status: 'offline' });
  };
}
