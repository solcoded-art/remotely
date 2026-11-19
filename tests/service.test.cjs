const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
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
  const service = await createService({ ...options, databaseURL: databaseURL.toString() });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const url = `http://127.0.0.1:${service.server.address().port}`;
  t.after(async () => { await service.close(); await admin.query(`DROP DATABASE ${name}`); await admin.end(); });
  const api = async (route, token, data, method) => {
    const response = await fetch(url + route, { method: method || (data ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const account = async email => (await api('/api/auth/register', null, { email, password: 'long-password-for-tests' })).data;
  const device = async (token, kind, id = randomUUID()) => {
    const result = await api('/api/devices', token, { id, kind, name: kind }); assert.equal(result.status, 200); return result.data.device;
  };
  const socket = async (token, deviceId, origin) => {
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws', origin ? { origin } : {});
    const queue = []; const waiters = [];
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      const index = waiters.findIndex(waiter => waiter.type === message.type);
      if (index < 0) queue.push(message); else { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    });
    const next = type => {
      const index = queue.findIndex(message => message.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => { const waiter = { type, resolve, timer: setTimeout(() => reject(Error(`Timed out waiting for ${type}`)), 2000) }; waiters.push(waiter); });
    };
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'hello', token, deviceId }));
    await next('ready');
    t.after(() => ws.terminate());
    return { ws, next, send: data => ws.send(JSON.stringify(data)) };
  };
  return { api, account, device, socket, url };
}

test('login, device ownership, logout revocation, and legacy command removal', async t => {
  const { api, account, device } = await fixture(t);
  const first = await account('owner@example.com'); const second = await account('other@example.com');
  assert.ok(first.token); assert.equal(first.user.email, 'owner@example.com');
  const mac = await device(first.token, 'desktop');
  assert.equal((await api('/api/devices', second.token, { ...mac, name: 'stolen' })).status, 403);
  assert.deepEqual((await api('/api/devices', second.token)).data.devices, []);
  assert.equal((await api('/api/devices')).status, 401);
  assert.equal((await api('/api/action', first.token, { action: 'shell', payload: { command: 'not-run' } })).status, 404);
  assert.equal((await api('/api/auth/login', null, { email: 'owner@example.com', password: 'wrong-password-123' })).status, 401);
  const login = await api('/api/auth/login', null, { email: 'OWNER@example.com', password: 'long-password-for-tests' });
  assert.equal(login.status, 200);
  assert.equal((await api('/api/auth/logout', login.data.token, {}, 'POST')).status, 200);
  assert.equal((await api('/api/me', login.data.token)).status, 401);
  assert.equal((await api('/api/me', first.token)).status, 200);
});

test('signaling requires matching ownership and explicit desktop approval', async t => {
  const { account, device, socket } = await fixture(t);
  const owner = await account('owner@example.com'); const other = await account('other@example.com');
  const mac = await device(owner.token, 'desktop'); const phone = await device(owner.token, 'controller'); const stranger = await device(other.token, 'controller');
  const desktop = await socket(owner.token, mac.id); const ios = await socket(owner.token, phone.id); const outsider = await socket(other.token, stranger.id);
  outsider.send({ type: 'connect', targetId: mac.id }); assert.match((await outsider.next('error')).message, /unavailable/);
  ios.send({ type: 'connect', targetId: mac.id });
  const pending = await ios.next('pending'); const incoming = await desktop.next('request');
  assert.equal(pending.sessionId, incoming.sessionId);
  desktop.send({ type: 'signal', sessionId: pending.sessionId, signal: { type: 'offer', sdp: 'test' } });
  assert.match((await desktop.next('error')).message, /approval/);
  ios.send({ type: 'approve', sessionId: pending.sessionId, allowed: true }); assert.match((await ios.next('error')).message, /Only the Mac/);
  desktop.send({ type: 'approve', sessionId: pending.sessionId, allowed: true }); await desktop.next('approved'); await ios.next('approved');
  desktop.send({ type: 'signal', sessionId: pending.sessionId, signal: { type: 'offer', sdp: 'test-sdp' } });
  assert.equal((await ios.next('signal')).signal.sdp, 'test-sdp');
  outsider.send({ type: 'signal', sessionId: pending.sessionId, signal: { type: 'ice', candidate: {} } }); assert.match((await outsider.next('error')).message, /unavailable/);
  ios.ws.close(); assert.equal((await desktop.next('ended')).reason, 'Device disconnected');
});

test('hostile origins are rejected and account deletion removes sessions and devices', async t => {
  const { api, account, device, url } = await fixture(t);
  const owner = await account('owner@example.com'); await device(owner.token, 'desktop');
  const response = await fetch(url + '/api/health', { headers: { Origin: 'https://hostile.example' } });
  assert.equal(response.status, 403); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws', { origin: 'https://hostile.example' });
  const [error] = await once(ws, 'error'); assert.match(error.message, /403/);
  assert.equal((await api('/api/account', owner.token, { password: 'incorrect-password' }, 'DELETE')).status, 403);
  assert.equal((await api('/api/account', owner.token, { password: 'long-password-for-tests' }, 'DELETE')).status, 200);
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
    const response = await fetch(url + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
});
