const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, randomBytes, generateKeyPairSync, sign } = require('node:crypto');
const keys = new Map();
const trustPromise = import('../shared/trust.mjs');
const signature = (device, text) => sign('sha256', Buffer.from(text), { key: device.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const { WebSocket } = require('ws');
const { createService } = require('../signaling/service.cjs');
const { Client } = require('pg');

async function fixture(t, options = {}) {
  assert.ok(process.env.TEST_DATABASE_URL, 'Use npm test to provision disposable PostgreSQL.');
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const name = `remote_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const databaseURL = new URL(process.env.TEST_DATABASE_URL); databaseURL.pathname = '/' + name;
  const mails = [];
  const authOptions = { publicURL: 'http://127.0.0.1:3000', authSecret: randomBytes(48).toString('base64url'), sendMail: async mail => { mails.push(mail); }, sessionGraceMs: 300, ...options };
  let service;
  try { service = await createService({ ...authOptions, databaseURL: databaseURL.toString() }); }
  catch (error) { await admin.query(`DROP DATABASE ${name}`); await admin.end(); throw error; }
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const url = `http://127.0.0.1:${service.server.address().port}`;
  t.after(async () => { await service.close(); await admin.query(`DROP DATABASE ${name}`); await admin.end(); });
  const api = async (route, token, data, method) => {
    const response = await fetch(url + route, { method: method || (data ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const account = async email => {
    const sent = await api('/api/auth/magic-link', null, { email }); assert.equal(sent.status, 200);
    const mail = mails.findLast(item => item.email === email.toLowerCase());
    const verified = await api('/api/auth/verify-link', null, { email, token: new URL(mail.url).hash.slice('#sign-in='.length) });
    assert.equal(verified.status, 200); return verified.data;
  };
  const device = async (token, kind) => {
    const trust = await trustPromise;
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = trust.publicKey(pair.publicKey.export({ format: 'jwk' }));
    const data = { id: await trust.keyId(publicKey), kind, name: kind, publicKey };
    const key = { ...data, privateKey: pair.privateKey, userId: (await api('/api/me', token)).data.user.id };
    const challenge = (await api('/api/device-challenge', token, {})).data.challenge;
    const result = await api('/api/devices', token, { ...data, challenge, signature: signature(key, trust.registration(challenge, key.userId, data)) });
    assert.equal(result.status, 200); keys.set(data.id, key); return result.data.device;
  };
  const grants = new Map();
  const socket = async (token, deviceId, origin) => {
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', origin ? { origin } : {});
    const queue = []; const waiters = []; const sessionInfo = new Map();
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (['pending', 'request'].includes(message.type)) sessionInfo.set(message.sessionId, message);
      if (message.type === 'approved') Object.assign(sessionInfo.get(message.sessionId), message);
      const index = waiters.findIndex(waiter => waiter.type === message.type);
      if (index < 0) queue.push(message); else { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    });
    const next = type => {
      const index = queue.findIndex(message => message.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => { const waiter = { type, resolve, timer: setTimeout(() => reject(Error(`Timed out waiting for ${type}`)), 2000) }; waiters.push(waiter); });
    };
    await once(ws, 'open');
    const trust = await trustPromise; const key = keys.get(deviceId);
    const challenge = (await next('challenge')).challenge;
    ws.send(JSON.stringify({ type: 'hello', token, deviceId, signature: signature(key, trust.hello(challenge, key.userId, deviceId)) }));
    await next('ready');
    t.after(() => ws.terminate());
    let seq = 0;
    const wrap = data => { const number = ++seq; return { data, seq: number, signature: signature(key, trust.envelope(challenge, key.userId, deviceId, number, data)) }; };
    const binding = id => { const session = sessionInfo.get(id); return session.controllerNonce + '.' + session.desktopNonce; };
    const prepare = data => {
      if (data.type === 'connect') {
        const grant = grants.get(data.targetId + ':' + deviceId);
        if (grant && !data.controllerNonce) {
          const controllerNonce = trust.nonce();
          return { ...data, controllerNonce, requestSignature: signature(key, trust.sessionRequest(key.userId, grant.id, data.targetId, deviceId, controllerNonce)) };
        }
      }
      if (data.type === 'approve' && data.allowed && sessionInfo.has(data.sessionId)) {
        const session = sessionInfo.get(data.sessionId); const desktopNonce = trust.nonce();
        return { ...data, desktopNonce, approvalSignature: signature(key, trust.sessionApproval(data.sessionId, key.userId, session.grantId, deviceId, session.peerId, session.controllerNonce, desktopNonce)) };
      }
      return data;
    };
    return { ws, next, key, wrap, binding, send: data => ws.send(JSON.stringify(wrap(prepare(data)))) };
  };
  const pair = async (desktop, ios) => {
    const trust = await trustPromise;
    const inviteId = randomUUID(); const requestId = randomUUID();
    desktop.send({ type: 'pair-open', inviteId, expires: Date.now() + 120000 });
    await desktop.next('pair-opened');
    ios.send({ type: 'pair-request', inviteId, requestId, proof: 'server-relays-proof-host-must-verify' });
    await desktop.next('pair-request');
    const grant = { id: randomUUID(), userId: desktop.key.userId, desktopId: desktop.key.id, controllerId: ios.key.id, desktopKey: desktop.key.publicKey, controllerKey: ios.key.publicKey, inviteId, requestId };
    desktop.send({ type: 'pair-approve', requestId, grant, signature: signature(desktop.key, trust.grantText(grant)) });
    await desktop.next('paired'); await ios.next('paired'); grants.set(grant.desktopId + ':' + grant.controllerId, grant); return grant;
  };
  const restart = async () => {
    const port = service.server.address().port; await service.close();
    service = await createService({ ...authOptions, databaseURL: databaseURL.toString() });
    service.server.listen(port, '127.0.0.1'); await once(service.server, 'listening');
  };
  return { api, account, device, socket, pair, restart, url };
}

test('login, device ownership, logout revocation, and legacy command removal', async t => {
  const { api, account, device } = await fixture(t);
  const first = await account('owner@example.com'); const second = await account('other@example.com');
  assert.ok(first.token); assert.equal(first.user.email, 'owner@example.com');
  const mac = await device(first.token, 'desktop');
  const trust = await trustPromise;
  const challenge = (await api('/api/device-challenge', second.token, {})).data.challenge;
  assert.equal((await api('/api/devices', second.token, { ...mac, name: 'stolen', challenge, signature: signature(keys.get(mac.id), trust.registration(challenge, first.user.id, mac)) })).status, 403);
  assert.deepEqual((await api('/api/devices', second.token)).data.devices, []);
  assert.equal((await api('/api/devices')).status, 401);
  assert.equal((await api('/api/action', first.token, { action: 'shell', payload: { command: 'not-run' } })).status, 404);
  assert.equal((await api('/api/auth/login', null, { email: 'owner@example.com', password: 'retired-password' })).status, 410);
  const login = await account('OWNER@example.com');
  assert.equal((await api('/api/auth/logout', login.token, {}, 'POST')).status, 200);
  assert.equal((await api('/api/me', login.token)).status, 401);
  assert.equal((await api('/api/me', first.token)).status, 200);
});

test('signaling requires matching ownership and explicit desktop approval', async t => {
  const { account, device, socket, pair } = await fixture(t);
  const owner = await account('owner@example.com'); const other = await account('other@example.com');
  const mac = await device(owner.token, 'desktop'); const phone = await device(owner.token, 'controller'); const stranger = await device(other.token, 'controller');
  const desktop = await socket(owner.token, mac.id); const ios = await socket(owner.token, phone.id); const outsider = await socket(other.token, stranger.id);
  outsider.send({ type: 'connect', targetId: mac.id }); assert.match((await outsider.next('error')).message, /unavailable/);
  ios.send({ type: 'connect', targetId: mac.id });
  assert.match((await ios.next('error')).message, /Pair this phone/);
  const grant = await pair(desktop, ios);
  ios.send({ type: 'connect', targetId: mac.id });
  const pending = await ios.next('pending'); const incoming = await desktop.next('request');
  assert.equal(pending.sessionId, incoming.sessionId);
  desktop.send({ type: 'signal', sessionId: pending.sessionId, signal: { type: 'offer', sdp: 'test' } });
  assert.match((await desktop.next('error')).message, /approval/);
  ios.send({ type: 'approve', sessionId: pending.sessionId, allowed: true }); assert.match((await ios.next('error')).message, /Only the Mac/);
  desktop.send({ type: 'approve', sessionId: pending.sessionId, allowed: true }); await desktop.next('approved'); await ios.next('approved');
  const trust = await trustPromise; const signal = { type: 'offer', sdp: 'test-sdp' };
  desktop.send({ type: 'signal', sessionId: pending.sessionId, signal, seq: 1, signature: signature(desktop.key, trust.signalText(pending.sessionId, grant.id, mac.id, 1, signal, desktop.binding(pending.sessionId))) });
  assert.equal((await ios.next('signal')).signal.sdp, 'test-sdp');
  outsider.send({ type: 'signal', sessionId: pending.sessionId, signal: { type: 'ice', candidate: {} } }); assert.match((await outsider.next('error')).message, /unavailable/);
  // A dropped phone socket keeps the approved session for the grace period and resumes on reconnect.
  ios.ws.close();
  const back = await socket(owner.token, phone.id);
  await new Promise(resolve => setTimeout(resolve, 500));
  const resumed = { type: 'ice', candidate: { candidate: 'resumed' } };
  desktop.send({ type: 'signal', sessionId: pending.sessionId, signal: resumed, seq: 2, signature: signature(desktop.key, trust.signalText(pending.sessionId, grant.id, mac.id, 2, resumed, desktop.binding(pending.sessionId))) });
  assert.equal((await back.next('signal')).signal.candidate.candidate, 'resumed');
  // Staying away past the grace period ends it.
  back.ws.close(); assert.equal((await desktop.next('ended')).reason, 'Device disconnected');
});

test('hostile origins are rejected and account deletion removes sessions and devices', async t => {
  const { api, account, device, url } = await fixture(t);
  const owner = await account('owner@example.com'); await device(owner.token, 'desktop');
  const response = await fetch(url + '/api/health', { headers: { Origin: 'https://hostile.example' } });
  assert.equal(response.status, 403); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws', { origin: 'https://hostile.example' });
  const [error] = await once(ws, 'error'); assert.match(error.message, /403/);
  assert.equal((await api('/api/account', owner.token, { confirmEmail: 'incorrect@example.com' }, 'DELETE')).status, 403);
  assert.equal((await api('/api/account', owner.token, { confirmEmail: owner.user.email }, 'DELETE')).status, 200);
  assert.equal((await api('/api/me', owner.token)).status, 401);
  const replacement = await account('owner@example.com'); assert.deepEqual((await api('/api/devices', replacement.token)).data.devices, []);
});


test('unlisted same-origin browser clients can use the API and WebSocket', async t => {
  const { account, device, socket, url } = await fixture(t);
  const owner = await account('same-origin@example.com');
  const phone = await device(owner.token, 'controller');
  const preflight = await fetch(url + '/api/me', { method: 'OPTIONS', headers: { Origin: url } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), url);
  const response = await fetch(url + '/api/me', { headers: { Origin: url, Authorization: `Bearer ${owner.token}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), url);
  const peer = await socket(owner.token, phone.id, url);
  assert.equal(peer.ws.readyState, WebSocket.OPEN);
});


test('packaged clients remain allowed with a browser-only origin override', async t => {
  const { url } = await fixture(t, { origins: ['https://browser.example'] });
  for (const origin of ['app://macremote', 'capacitor://localhost']) {
    const preflight = await fetch(url + '/api/auth/login', { method: 'OPTIONS', headers: { Origin: origin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
    const response = await fetch(url + '/api/auth/magic-link', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
});

test('enrollment binds fresh challenges to the account and possession of the immutable key', async t => {
  const { api, account, device } = await fixture(t);
  const owner = await account('proof@example.com');
  const mac = await device(owner.token, 'desktop'); const key = keys.get(mac.id); const trust = await trustPromise;
  assert.equal((await api('/api/devices', owner.token, { id: randomUUID(), name: 'old', kind: 'desktop' })).status, 426);
  const challenge = (await api('/api/device-challenge', owner.token, {})).data.challenge;
  const data = { id: mac.id, name: 'Renamed Mac', kind: 'desktop', publicKey: key.publicKey };
  const signed = { ...data, challenge, signature: signature(key, trust.registration(challenge, owner.user.id, data)) };
  assert.equal((await api('/api/devices', owner.token, signed)).status, 200);
  assert.equal((await api('/api/devices', owner.token, signed)).status, 403, 'challenge reuse');
  const second = (await api('/api/device-challenge', owner.token, {})).data.challenge;
  assert.equal((await api('/api/devices', owner.token, { ...signed, challenge: second })).status, 403, 'signature for old challenge');
  const third = (await api('/api/device-challenge', owner.token, {})).data.challenge;
  const attacker = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.equal((await api('/api/devices', owner.token, { ...data, challenge: third, signature: signature({ privateKey: attacker.privateKey }, trust.registration(third, owner.user.id, data)) })).status, 403, 'stolen account token without device key');
  assert.equal((await api('/api/devices', owner.token)).data.devices[0].name, 'Renamed Mac');
});

test('socket proofs cannot be replayed, transferred to another connection, or used with a stolen token alone', async t => {
  const { account, device, socket, url } = await fixture(t);
  const owner = await account('replay@example.com'); const phone = await device(owner.token, 'controller');
  const peer = await socket(owner.token, phone.id); const trust = await trustPromise;
  const message = peer.wrap({ type: 'connect', targetId: 'missing-desktop' });
  peer.ws.send(JSON.stringify(message)); assert.match((await peer.next('error')).message, /unavailable/);
  peer.ws.send(JSON.stringify(message)); assert.match((await peer.next('error')).message, /replayed/);
  const replaced = await socket(owner.token, phone.id);
  replaced.ws.send(JSON.stringify(message)); assert.match((await replaced.next('error')).message, /replayed/);
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws'); const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString()))); t.after(() => ws.terminate());
  await once(ws, 'open');
  const close = once(ws, 'close');
  ws.send(JSON.stringify({ type: 'hello', token: owner.token, deviceId: phone.id, signature: 'invalid' }));
  await close; assert.ok(messages.some(m => m.type === 'error' && /proof/.test(m.message)));
  assert.ok(await trust.keyId(keys.get(phone.id).publicKey) === phone.id);
});

test('only paired endpoints can revoke trust; revocation tears down sessions and blocks reconnection', async t => {
  const { account, device, socket, pair } = await fixture(t);
  const owner = await account('revoke@example.com');
  const mac = await device(owner.token, 'desktop'); const phone = await device(owner.token, 'controller'); const third = await device(owner.token, 'controller');
  const desktop = await socket(owner.token, mac.id); const ios = await socket(owner.token, phone.id); const outsider = await socket(owner.token, third.id);
  const grant = await pair(desktop, ios);
  outsider.send({ type: 'revoke', grantId: grant.id }); assert.match((await outsider.next('error')).message, /unavailable/);
  ios.send({ type: 'connect', targetId: mac.id }); const pending = await ios.next('pending'); await desktop.next('request');
  desktop.send({ type: 'approve', sessionId: pending.sessionId, allowed: true }); await ios.next('approved'); await desktop.next('approved');
  desktop.send({ type: 'revoke', grantId: grant.id });
  assert.equal((await ios.next('ended')).reason, 'Device trust revoked'); await ios.next('revoked'); await desktop.next('revoked');
  ios.send({ type: 'connect', targetId: mac.id }); assert.match((await ios.next('error')).message, /Pair this phone/);
  ios.send({ type: 'pair-request', inviteId: grant.inviteId, requestId: randomUUID(), proof: 'old-invite-cannot-be-reused' });
  assert.match((await ios.next('error')).message, /expired/);
  desktop.send({ type: 'pair-approve', requestId: grant.requestId, grant, signature: signature(desktop.key, (await trustPromise).grantText(grant)) });
  assert.match((await desktop.next('error')).message, /expired/);
});

test('tampered and cross-session WebRTC attestations fail before forwarding', async t => {
  const { account, device, socket, pair } = await fixture(t);
  const owner = await account('sdp@example.com');
  const mac = await device(owner.token, 'desktop'); const phone = await device(owner.token, 'controller');
  const desktop = await socket(owner.token, mac.id); const ios = await socket(owner.token, phone.id);
  const grant = await pair(desktop, ios); const trust = await trustPromise;
  ios.send({ type: 'connect', targetId: mac.id }); const pending = await ios.next('pending'); await desktop.next('request');
  desktop.send({ type: 'approve', sessionId: pending.sessionId, allowed: true }); await ios.next('approved'); await desktop.next('approved');
  const signal = { type: 'offer', sdp: 'a=fingerprint:sha-256 actual-certificate' };
  const attestation = signature(desktop.key, trust.signalText(pending.sessionId, grant.id, mac.id, 1, signal, desktop.binding(pending.sessionId)));
  desktop.send({ type: 'signal', sessionId: pending.sessionId, seq: 1, signal: { ...signal, sdp: 'a=fingerprint:sha-256 attacker-certificate' }, signature: attestation });
  assert.match((await desktop.next('error')).message, /signature/);
  desktop.send({ type: 'signal', sessionId: pending.sessionId, seq: 1, signal, signature: signature(desktop.key, trust.signalText(randomUUID(), grant.id, mac.id, 1, signal, desktop.binding(pending.sessionId))) });
  assert.match((await desktop.next('error')).message, /signature/);
  desktop.send({ type: 'signal', sessionId: pending.sessionId, seq: 1, signal, signature: attestation });
  assert.deepEqual((await ios.next('signal')).signal, signal);
});

test('pair grants persist across service restarts and revoked trust stays revoked', async t => {
  const { account, device, socket, pair, restart } = await fixture(t);
  const owner = await account('persistent-trust@example.com');
  const mac = await device(owner.token, 'desktop'); const phone = await device(owner.token, 'controller');
  let desktop = await socket(owner.token, mac.id); let ios = await socket(owner.token, phone.id);
  const grant = await pair(desktop, ios);
  await restart();
  desktop = await socket(owner.token, mac.id); ios = await socket(owner.token, phone.id);
  ios.send({ type: 'connect', targetId: mac.id });
  assert.equal((await ios.next('pending')).grantId, grant.id); await desktop.next('request');
  desktop.send({ type: 'revoke', grantId: grant.id }); await desktop.next('revoked'); await ios.next('revoked');
  await restart();
  desktop = await socket(owner.token, mac.id); ios = await socket(owner.token, phone.id);
  ios.send({ type: 'connect', targetId: mac.id }); assert.match((await ios.next('error')).message, /Pair this phone/);
});
