import * as trust from '../../shared/trust.mjs';
import { sameService } from '../../shared/account-service.mjs';
import { deviceIdentity, type Identity, type Pin } from './identity';
import { request } from './api';
import type { Auth, Command, Device, DriverEvent, RunningApp, ServerMessage, Signal } from './types';

type Session = { id: string; name: string; peerId: string; grantId: string; controllerNonce: string; desktopNonce?: string };
type Invite = { id: string; secret: string; expires: number; link: string };
type PairRequest = { id: string; peerId: string; key: trust.PublicKey; name: string };
type PairCandidate = { inviteId: string; requestId: string; desktopId: string; key: trust.PublicKey; expires: number };
export type ConnectionSnapshot = {
  ready: boolean; status: 'offline' | 'connecting' | 'ready' | 'pending' | 'negotiating' | 'connected';
  pins: Record<string, Pin>; invite: Invite | null; pairing: PairRequest | null; pairStatus: string; devices: Device[]; pending: Session | null; session: Session | null; error: string;
  stream: MediaStream | null; apps: RunningApp[]; route: string; latency: number | null;
};
const initial: ConnectionSnapshot = { ready: false, status: 'connecting', pins: {}, invite: null, pairing: null, pairStatus: '', devices: [], pending: null, session: null, error: '', stream: null, apps: [], route: '', latency: null };

export class Connection {
  private value: ConnectionSnapshot = { ...initial };
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
  private identity!: Identity;
  private challenge = '';
  private sequence = 0;
  private connectAttempt: { peerId: string; nonce: string } | null = null;
  private outbound = Promise.resolve();
  private signalSequence = 0;
  private remoteSequence = 0;
  private openingInvite: Invite | null = null;
  private pairCandidate: PairCandidate | null = null;
  private inviteTimer?: ReturnType<typeof setTimeout>;
  private staleSession = '';

  constructor(readonly auth: Auth) {}
  snapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(data: Partial<ConnectionSnapshot>) { this.value = { ...this.value, ...data }; this.listeners.forEach(fn => fn()); }
  clearError = () => this.update({ error: '' });
  report = (error: unknown) => this.update({ error: error instanceof Error ? error.message : String(error) });

  async start() {
    try {
      const capabilities = await request<{ deviceTrust?: number }>(this.auth.service, '/api/health');
      if (capabilities.deviceTrust !== 1) throw Error('This account server needs a trusted-device update. Use the matching 0.3.0 server and Mac app, then reload your phone.');
      this.identity = await deviceIdentity(this.auth);
      this.deviceId = this.identity.id;
      const name = this.desktop ? (await window.macRemote!.info()).name : /iPad/.test(navigator.userAgent) ? 'My iPad' : 'My iPhone';
      const device = { id: this.deviceId, name, kind: this.desktop ? 'desktop' : 'controller', publicKey: this.identity.publicKey };
      const { challenge } = await request<{ challenge: string }>(this.auth.service, '/api/device-challenge', { token: this.auth.token, method: 'POST', data: {} });
      await request(this.auth.service, '/api/devices', { token: this.auth.token, method: 'POST', data: { ...device, challenge, signature: await this.identity.sign(trust.registration(challenge, this.auth.user.id, device)) } });
      this.update({ pins: await this.identity.pins() });
      if (this.disposed) return;
      if (this.desktop) this.removeDriver = window.macRemote!.onDriver(event => this.driverEvent(event));
      // Browsers clamp delays above ~24.8 days to 1 ms; schedule long sessions in chunks.
      const checkExpiry = () => {
        const remaining = this.auth.expires - Date.now();
        if (remaining <= 0) { this.update({ error: 'Your login expired. Sign in again.' }); this.dispose(); return; }
        this.authTimer = setTimeout(checkExpiry, Math.min(remaining, 2147483647));
      };
      checkExpiry();
      this.openSocket();
    } catch (error) { this.update({ status: 'offline' }); this.report(error); }
  }
  retry = () => {
    if (this.disposed || this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    clearTimeout(this.reconnectTimer);
    if (!this.ws) void this.start();
    else this.openSocket();
  };
  private openSocket() {
    if (this.disposed) return;
    // An active session keeps its status while the account socket reconnects underneath it.
    this.update(this.value.session ? { ready: false } : { ready: false, status: 'connecting' });
    const url = new URL('/ws', this.auth.service); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    this.challenge = ''; this.sequence = 0; this.outbound = Promise.resolve();
    ws.onmessage = event => {
      this.serial = this.serial.then(async () => {
        if (this.ws !== ws || this.disposed) return;
        await this.message(JSON.parse(event.data) as ServerMessage);
      }).catch(error => { this.report(error); this.end(); });
    };
    ws.onerror = () => this.report(Error('Cannot reach the account server. Check the URL and network.'));
    ws.onclose = event => {
      if (this.ws !== ws) return;
      this.clearPairing(); this.connectAttempt = null;
      const offline = this.value.devices.map(device => ({ ...device, online: false }));
      // The peer-to-peer link does not depend on this socket. Keep a live session while it reconnects;
      // the service holds the session for the same device for a short grace period.
      if (this.peerAlive() && !this.disposed && ![4000, 4001].includes(event.code)) this.update({ ready: false, pending: null, devices: offline });
      else { this.cleanupPeer(); this.update({ ready: false, status: 'offline', pending: null, session: null, devices: offline }); }
      if (!this.disposed && ![4000, 4001].includes(event.code)) this.reconnectTimer = setTimeout(() => this.openSocket(), 2000);
      else if (!this.disposed) this.report(Error('Device session closed. Sign in again.'));
    };
  }
  private send(data: Record<string, unknown>) {
    const ws = this.ws; const challenge = this.challenge;
    if (!challenge || ws?.readyState !== WebSocket.OPEN) throw Error('The account service is disconnected.');
    const seq = ++this.sequence;
    this.outbound = this.outbound.then(async () => {
      const signature = await this.identity.sign(trust.envelope(challenge, this.auth.user.id, this.deviceId, seq, data));
      if (this.ws === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ data, seq, signature }));
    }).catch(error => { this.report(error); if (this.ws === ws) ws.close(); });
  }
  private async message(data: ServerMessage) {
    if (data.type === 'challenge') {
      if (this.challenge || !data.challenge || trust.unb64(data.challenge).length !== 32) throw Error('Invalid device challenge.');
      this.challenge = data.challenge;
      const signature = await this.identity.sign(trust.hello(this.challenge, this.auth.user.id, this.deviceId));
      this.ws?.send(JSON.stringify({ type: 'hello', token: this.auth.token, deviceId: this.deviceId, signature })); return;
    }
    if (data.type.startsWith('pair') || data.type === 'revoked') { await this.pairMessage(data); return; }
    if (data.type === 'ready') {
      if (this.staleSession) { this.send({ type: 'end', sessionId: this.staleSession }); this.staleSession = ''; }
      if (this.value.session && !this.peerAlive()) this.end();
      this.update(this.value.session ? { ready: true, error: '' } : { ready: true, status: 'ready', error: '' });
    }
    if (data.type === 'devices') this.update({ devices: data.devices || [] });
    if (data.type === 'error') { this.connectAttempt = null; this.report(Error(data.message || 'Connection failed.')); if (this.value.session) this.end(); }
    if (data.type === 'pending' || data.type === 'request') {
      const pin = (await this.identity.pins())[data.peerId!];
      if (!pin || pin.grantId !== data.grantId) { this.send({ type: 'end', sessionId: data.sessionId }); throw Error('This device is not trusted. Pair it with your Mac first.'); }
      if (!data.controllerNonce || trust.unb64(data.controllerNonce).length !== 32) throw Error('Invalid controller session challenge.');
      if (data.type === 'pending' && (this.connectAttempt?.peerId !== data.peerId || this.connectAttempt?.nonce !== data.controllerNonce)) throw Error('Unexpected connection request.');
      if (data.type === 'request' && (!this.desktop || this.value.session || this.value.pending || !await trust.verify(pin.key, trust.sessionRequest(this.auth.user.id, pin.grantId, this.deviceId, data.peerId!, data.controllerNonce), data.requestSignature!))) {
        this.send({ type: 'end', sessionId: data.sessionId }); throw Error('The phone did not prove this connection request.');
      }
      const session = { id: data.sessionId!, name: pin.name, peerId: data.peerId!, grantId: pin.grantId, controllerNonce: data.controllerNonce };
      if (data.type === 'pending') this.update({ session, status: 'pending', error: '' });
      else this.update({ pending: session, error: '' });
    }
    if (data.type === 'approved') {
      if (this.pc || this.desktop && !this.value.pending || !this.desktop && this.value.status !== 'pending') throw Error('Unexpected repeated session approval.');
      const session = this.value.session || this.value.pending;
      if (!session || session.id !== data.sessionId) throw Error('Unexpected session approval.');
      if (!data.desktopNonce || trust.unb64(data.desktopNonce).length !== 32) throw Error('Invalid Mac session challenge.');
      const pin = (await this.identity.pins())[session.peerId];
      const desktopId = this.desktop ? this.deviceId : session.peerId; const controllerId = this.desktop ? session.peerId : this.deviceId;
      if (!pin || pin.grantId !== session.grantId || this.desktop && session.desktopNonce !== data.desktopNonce || !this.desktop && this.connectAttempt?.nonce !== session.controllerNonce || !await trust.verify(this.desktop ? this.identity.publicKey : pin.key, trust.sessionApproval(session.id, this.auth.user.id, session.grantId, desktopId, controllerId, session.controllerNonce, data.desktopNonce), data.approvalSignature!)) throw Error('Mac session approval could not be verified.');
      this.connectAttempt = null;
      this.update({ session: { ...session, desktopNonce: data.desktopNonce }, pending: null, status: 'negotiating' });
      await this.createPeer(session.id);
    }
    if (data.type === 'signal' && data.sessionId === this.value.session?.id && data.signal) {
      const session = this.value.session!;
      const pin = (await this.identity.pins())[session.peerId];
      if (!pin || pin.grantId !== session.grantId || !Number.isSafeInteger(data.seq) || data.seq !== this.remoteSequence + 1 || !await trust.verify(pin.key, trust.signalText(session.id, session.grantId, session.peerId, data.seq!, data.signal, this.binding(session)), data.signature!)) throw Error('Peer identity verification failed. The connection was stopped.');
      if (this.desktop && data.signal.type === 'offer' || !this.desktop && data.signal.type === 'answer') throw Error('Unexpected peer negotiation role.');
      this.remoteSequence = data.seq!;
      await this.signal(data.signal);
    }
    if (data.type === 'ended' && [this.value.session?.id, this.value.pending?.id].includes(data.sessionId)) {
      this.cleanupPeer(); this.connectAttempt = null;
      this.update({ session: null, pending: null, status: this.value.ready ? 'ready' : 'offline', error: data.reason === 'Session ended' ? '' : data.reason || '' });
    }
  }
  private clearPairing() {
    clearTimeout(this.inviteTimer); this.pairCandidate = null; this.openingInvite = null;
    this.update({ invite: null, pairing: null, pairStatus: '' });
  }
  createInvite = async () => {
    try {
      if (!this.desktop || !this.value.ready) throw Error('Open and sign in to the Mac app first.');
      this.clearPairing();
      const id = crypto.randomUUID(); const secret = trust.nonce(); const expires = Date.now() + 120000;
      const payload = { v: 1, service: this.auth.service, userId: this.auth.user.id, desktopId: this.deviceId, key: this.identity.publicKey, id, secret, expires };
      const link = this.auth.service + '/#pair=' + trust.b64(trust.encode(JSON.stringify(payload)));
      this.send({ type: 'pair-open', inviteId: id, expires });
      this.openingInvite = { id, secret, expires, link };
      this.update({ pairStatus: 'Preparing your pairing link…' });
      this.inviteTimer = setTimeout(() => { this.clearPairing(); this.update({ pairStatus: 'Pairing link expired. Create a new link to try again.' }); }, 120000);
    } catch (error) { this.report(error); }
  };
  pair = async (link: string) => {
    try {
      if (this.desktop || !this.value.ready) throw Error('Sign in on your phone first.');
      const url = new URL(link.trim());
      const payload = JSON.parse(new TextDecoder().decode(trust.unb64(url.hash.slice(6))));
      if (!url.hash.startsWith('#pair=') || !sameService(url.origin, this.auth.service) || url.pathname !== '/' || url.search || url.username || url.password || payload.v !== 1 || !sameService(payload.service, this.auth.service) || payload.userId !== this.auth.user.id || payload.expires <= Date.now() || payload.expires > Date.now() + 180000 || await trust.keyId(payload.key) !== payload.desktopId || trust.unb64(payload.secret).length !== 32) throw Error();
      const requestId = crypto.randomUUID();
      this.pairCandidate = { inviteId: payload.id, requestId, desktopId: payload.desktopId, key: trust.publicKey(payload.key), expires: payload.expires };
      this.send({ type: 'pair-request', requestId, inviteId: payload.id, proof: await trust.proof(payload.secret, trust.pairing(payload.id, requestId, this.auth.user.id, payload.desktopId, this.deviceId, this.identity.publicKey)) });
      this.update({ pairStatus: 'Approve pairing in the Mac app. Screen sharing starts only after a separate connection approval.' });
      clearTimeout(this.inviteTimer);
      this.inviteTimer = setTimeout(() => { this.clearPairing(); this.update({ pairStatus: 'Pairing link expired. Create a new link on your Mac.' }); }, Math.max(0, payload.expires - Date.now()));
    } catch { this.pairCandidate = null; this.report(Error('Invalid or expired pairing link. Use a fresh link from the Mac app, signed in to the same account and server.')); }
  };
  approvePair = async () => {
    try {
      const pending = this.value.pairing; const invite = this.value.invite;
      if (!pending || !invite || invite.expires <= Date.now()) throw Error('Pairing link expired.');
      const grant: trust.Grant = { id: crypto.randomUUID(), userId: this.auth.user.id, desktopId: this.deviceId, controllerId: pending.peerId, desktopKey: this.identity.publicKey, controllerKey: pending.key, inviteId: invite.id, requestId: pending.id };
      if (this.value.session?.peerId === pending.peerId || this.value.pending?.peerId === pending.peerId) this.end();
      await this.identity.pin(pending.peerId, { grantId: grant.id, key: pending.key, name: pending.name });
      const signature = await this.identity.sign(trust.grantText(grant));
      this.send({ type: 'pair-approve', requestId: pending.id, grant, signature });
      this.update({ pins: await this.identity.pins(), pairing: null });
    } catch (error) { this.report(error); }
  };
  declinePair = () => {
    if (!this.value.pairing) return;
    try { this.send({ type: 'pair-decline', requestId: this.value.pairing.id }); this.update({ pairing: null }); }
    catch (error) { this.report(error); }
  };
  revoke = async (peerId: string) => {
    try {
      const pin = (await this.identity.pins())[peerId]; if (!pin) return;
      // Remove the local pin and end capture before asking the service to delete its grant.
      await this.identity.pin(peerId, null);
      if (this.value.session?.peerId === peerId || this.value.pending?.peerId === peerId) this.end();
      this.update({ pins: await this.identity.pins() });
      this.send({ type: 'revoke', grantId: pin.grantId });
    } catch (error) { this.report(error); }
  };
  private async pairMessage(data: ServerMessage) {
    if (data.type === 'pair-opened' && this.openingInvite?.id === data.inviteId) {
      this.update({ invite: this.openingInvite, pairStatus: 'Link ready. It expires in two minutes.' }); this.openingInvite = null;
    }
    if (data.type === 'pair-request' && this.desktop) {
      const invite = this.value.invite;
      if (!invite || invite.id !== data.inviteId || invite.expires <= Date.now() || !data.publicKey || await trust.keyId(data.publicKey) !== data.peerId || !await trust.verifyProof(invite.secret, trust.pairing(invite.id, data.requestId!, this.auth.user.id, this.deviceId, data.peerId!, data.publicKey), data.proof!)) {
        this.send({ type: 'pair-decline', requestId: data.requestId }); return;
      }
      if (this.value.pairing) { this.send({ type: 'pair-decline', requestId: data.requestId }); return; }
      this.update({ pairing: { id: data.requestId!, peerId: data.peerId!, key: data.publicKey, name: data.name! }, pairStatus: '' });
    }
    if (data.type === 'pair-declined') {
      if (this.pairCandidate?.requestId === data.requestId) { this.pairCandidate = null; this.update({ pairStatus: 'Mac declined pairing. Create a new link and try again.' }); }
    }
    if (data.type === 'paired') {
      const grant = data.grant!;
      if (grant.userId !== this.auth.user.id) throw Error('Unexpected pairing account.');
      if (this.desktop) {
        const pin = (await this.identity.pins())[grant.controllerId];
        if (!pin || pin.grantId !== grant.id || grant.desktopId !== this.deviceId || !await trust.verify(this.identity.publicKey, trust.grantText(grant), data.signature!)) throw Error('Unexpected pairing approval.');
      } else {
        const candidate = this.pairCandidate;
        if (!candidate || candidate.expires <= Date.now() || grant.controllerId !== this.deviceId || grant.desktopId !== candidate.desktopId || grant.inviteId !== candidate.inviteId || grant.requestId !== candidate.requestId || await trust.keyId(grant.controllerKey) !== this.deviceId || await trust.keyId(grant.desktopKey) !== candidate.desktopId || !await trust.verify(candidate.key, trust.grantText(grant), data.signature!)) throw Error('Mac identity verification failed. Pairing was stopped.');
        await this.identity.pin(candidate.desktopId, { grantId: grant.id, key: candidate.key, name: data.name || 'My Mac' });
      }
      this.clearPairing(); this.update({ pins: await this.identity.pins(), pairStatus: 'Device paired. Every connection still needs approval on your Mac.' });
    }
    if (data.type === 'revoked') {
      for (const [id, pin] of Object.entries(await this.identity.pins())) if (pin.grantId === data.grantId) await this.identity.pin(id, null);
      if (this.value.session?.grantId === data.grantId || this.value.pending?.grantId === data.grantId) this.end();
      this.update({ pins: await this.identity.pins(), pairStatus: 'Device trust revoked. Pair again before connecting.' });
    }
  }
  connect = async (device: Device) => {
    if (this.connectAttempt || this.value.session) return;
    try {
      const pin = (await this.identity.pins())[device.id];
      if (!pin) throw Error('Pair this phone with your Mac first.');
      const nonce = trust.nonce(); this.connectAttempt = { peerId: device.id, nonce }; this.clearError();
      const requestSignature = await this.identity.sign(trust.sessionRequest(this.auth.user.id, pin.grantId, device.id, this.deviceId, nonce));
      this.send({ type: 'connect', targetId: device.id, controllerNonce: nonce, requestSignature });
    } catch (error) { this.connectAttempt = null; this.report(error); }
  };
  approve = async () => {
    const pending = this.value.pending;
    if (!pending || !this.desktop) return;
    let stage: 'setup' | 'capture' = 'setup';
    try {
      const pin = (await this.identity.pins())[pending.peerId];
      if (!pin || pin.grantId !== pending.grantId) throw Error('Device trust was revoked. Pair again before connecting.');
      const desktopNonce = trust.nonce();
      const approvalSignature = await this.identity.sign(trust.sessionApproval(pending.id, this.auth.user.id, pending.grantId, this.deviceId, pending.peerId, pending.controllerNonce, desktopNonce));
      if (this.value.pending?.id !== pending.id || this.disposed) return;
      this.update({ pending: { ...pending, desktopNonce } });
      await window.macRemote!.approve(pending.id);
      stage = 'capture';
      this.capture = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (this.disposed || this.value.pending?.id !== pending.id || !this.value.ready) { this.cleanupPeer(); return; }
      for (const track of this.capture.getTracks()) track.addEventListener('ended', () => this.end(), { once: true });
      this.update({ stream: this.capture });
      this.send({ type: 'approve', sessionId: pending.id, allowed: true, desktopNonce, approvalSignature });
    } catch (error) {
      if (this.value.pending?.id !== pending.id) return;
      const name = error instanceof Error ? error.name : '';
      const message = stage === 'setup' ? (error instanceof Error ? error.message : 'Mac setup could not be approved.')
        : name === 'NotAllowedError' ? 'macOS blocked screen sharing. Enable Mac Remote in Privacy & Security → Screen & System Audio Recording (Screen Recording on older versions), quit and reopen Mac Remote, then choose your display again.'
        : name === 'InvalidStateError' ? 'Screen sharing could not start from this approval. Retry Allow connection in the Mac app.'
        : 'Screen capture failed. Check Screen Recording permission, quit and reopen Mac Remote, then choose your display again.';
      try { this.send({ type: 'approve', sessionId: pending.id, allowed: false, failure: stage }); } catch {}
      this.cleanupPeer();
      this.update({ pending: null, session: null, status: this.value.ready ? 'ready' : 'offline', error: message });
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
    this.pc = pc; this.candidates = []; this.signalSequence = 0; this.remoteSequence = 0;
    const signal = (value: Signal) => this.sendSignal(value);
    pc.onicecandidate = event => { if (event.candidate && this.pc === pc) { try { signal({ type: 'ice', candidate: event.candidate.toJSON() }); } catch (error) { this.report(error); } } };
    pc.ontrack = event => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.update({ stream });
      event.track.onended = () => this.end();
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'failed') { this.report(Error('Could not connect to your Mac. Check both devices’ internet connections and try again. If it keeps failing across networks, see the setup guide.')); this.end(); }
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
    this.negotiationTimer = setTimeout(() => { if (this.pc === pc && this.value.status !== 'connected') { this.report(Error('Connection timed out. Check the Mac permissions and both internet connections, then try again. See the setup guide if the devices are on different networks.')); this.end(); } }, 25000);
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
      this.sendSignal({ type: 'answer', sdp: answer.sdp! });
    }
  }
  private binding(session: Session) {
    if (!session.desktopNonce) throw Error('Missing Mac session challenge.');
    return session.controllerNonce + '.' + session.desktopNonce;
  }
  private sendSignal(signal: Signal) {
    const session = this.value.session;
    if (!session) throw Error('Session ended.');
    const seq = ++this.signalSequence;
    // Signing and sending share a queue, preserving the order of trickled ICE and SDP.
    const ws = this.ws; const challenge = this.challenge;
    const envelopeSeq = ++this.sequence;
    this.outbound = this.outbound.then(async () => {
      const signature = await this.identity.sign(trust.signalText(session.id, session.grantId, this.deviceId, seq, signal, this.binding(session)));
      const data = { type: 'signal', sessionId: session.id, signal, seq, signature };
      const outer = await this.identity.sign(trust.envelope(challenge, this.auth.user.id, this.deviceId, envelopeSeq, data));
      if (this.ws === ws && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ data, seq: envelopeSeq, signature: outer }));
    }).catch(error => { this.report(error); this.end(); });
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
  /** True while an approved session's peer connection is up or recovering. */
  private peerAlive() { return !!this.value.session && !!this.pc && ['new', 'connecting', 'connected', 'disconnected'].includes(this.pc.connectionState); }
  end = () => {
    this.connectAttempt = null;
    const id = this.value.session?.id || this.value.pending?.id;
    // Ended while the account socket was away: tell the service once it reconnects, so the grace period does not block a new connection.
    if (id && this.ws?.readyState === WebSocket.OPEN) this.send({ type: 'end', sessionId: id }); else if (id) this.staleSession = id;
    this.cleanupPeer();
    this.update({ session: null, pending: null, status: this.value.ready ? 'ready' : 'offline' });
  };
  dispose = () => {
    this.end(); this.disposed = true;
    clearTimeout(this.reconnectTimer); clearTimeout(this.authTimer);
    this.removeDriver?.(); this.clearPairing();
    const ws = this.ws; this.ws = null; ws?.close();
    this.update({ ready: false, status: 'offline' });
  };
}
