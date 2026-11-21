// End-to-end check of the GPUI Mac app against the real signaling service and
// a simulated iPhone that uses shared/trust.mjs exactly like src/lib/connection.ts.
// It opens the app window and writes (then deletes) a Keychain device-key item
// for this run's throwaway account.
//
//   (cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)
//   node scripts/test-with-postgres.cjs node desktop-gpui/tests/e2e-pairing.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign as nodeSign } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import * as trust from '../../shared/trust.mjs';
import { cleanups, deleteKeychainItem, runCleanups, startMac, startService } from './e2e-common.mjs';

const WebSocket = createRequire(import.meta.url)('ws');
const step = name => console.log(`• ${name}`);
const signature = (key, text) => nodeSign('sha256', Buffer.from(text), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');

async function main() {
  const { url, api, mails } = await startService();

  step('account via email link');
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  assert.equal((await api('/api/auth/magic-link', null, { email })).status, 200);
  const link = mails.findLast(mail => mail.email === email).url;
  const session = (await api('/api/auth/verify-link', null, { email, token: new URL(link).hash.slice('#sign-in='.length) })).data;
  const userId = session.user.id;

  step('phone registers and opens its socket');
  const phoneKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const phoneKey = trust.publicKey(phoneKeys.publicKey.export({ format: 'jwk' }));
  const phoneId = await trust.keyId(phoneKey);
  const phoneDevice = { id: phoneId, name: 'E2E iPhone', kind: 'controller', publicKey: phoneKey };
  const enrol = (await api('/api/device-challenge', session.token, {})).data.challenge;
  assert.equal((await api('/api/devices', session.token, { ...phoneDevice, challenge: enrol, signature: signature(phoneKeys.privateKey, trust.registration(enrol, userId, phoneDevice)) })).status, 200);
  const phone = await openPhone(url, session.token, userId, phoneId, phoneKeys.privateKey);
  cleanups.unshift(() => phone.ws.terminate());

  step('Mac app (GPUI) starts, enrols and signs in to the socket');
  let mac = startMac(url, session.token);
  let state = await mac.until(s => s.ready && s.deviceId, 'Mac ready');
  const macId = state.deviceId;
  cleanups.push(() => deleteKeychainItem(url, userId));
  const devices = (await api('/api/devices', session.token)).data.devices;
  const macDevice = devices.find(d => d.id === macId);
  assert.equal(macDevice?.kind, 'desktop', 'Mac registered as a desktop');
  assert.equal(await trust.keyId(macDevice.publicKey), macId, 'device id is the key id');
  await phone.until(m => m.type === 'devices' && m.devices.some(d => d.id === macId && d.online), 'phone sees the Mac online');

  step('pairing: Mac invite → phone proof → Mac approval → signed grant');
  mac.send('invite');
  state = await mac.until(s => s.invite, 'invite link');
  const pairUrl = new URL(state.invite);
  const payload = JSON.parse(new TextDecoder().decode(trust.unb64(pairUrl.hash.slice('#pair='.length))));
  // The same checks the phone app makes in connection.ts pair().
  assert.equal(pairUrl.origin, url); assert.equal(pairUrl.pathname, '/'); assert.equal(payload.v, 1);
  assert.equal(payload.service, url); assert.equal(payload.userId, userId); assert.equal(payload.desktopId, macId);
  assert.ok(payload.expires > Date.now() && payload.expires <= Date.now() + 180000);
  assert.equal(await trust.keyId(payload.key), payload.desktopId);
  assert.equal(trust.unb64(payload.secret).length, 32);
  const requestId = randomUUID();
  phone.send({ type: 'pair-request', requestId, inviteId: payload.id, proof: await trust.proof(payload.secret, trust.pairing(payload.id, requestId, userId, payload.desktopId, phoneId, phoneKey)) });
  state = await mac.until(s => s.pairing === phoneId, 'Mac shows the pairing request');
  mac.send('approve');
  const paired = await phone.until(m => m.type === 'paired', 'phone receives the grant');
  const grant = paired.grant;
  assert.equal(grant.controllerId, phoneId); assert.equal(grant.desktopId, macId); assert.equal(grant.inviteId, payload.id); assert.equal(grant.requestId, requestId);
  assert.ok(await trust.verify(payload.key, trust.grantText(grant), paired.signature), 'grant signed by the Mac key from the link');
  state = await mac.until(s => s.pins.some(p => p.id === phoneId && p.grantId === grant.id) && !s.pairing, 'Mac pins the phone');

  step('a forged pairing proof is declined');
  mac.send('invite');
  const second = await mac.until(s => s.invite && s.invite !== state.invite, 'second invite');
  const secondPayload = JSON.parse(new TextDecoder().decode(trust.unb64(new URL(second.invite).hash.slice('#pair='.length))));
  const forged = randomUUID();
  phone.send({ type: 'pair-request', requestId: forged, inviteId: secondPayload.id, proof: await trust.proof(trust.nonce(), trust.pairing(secondPayload.id, forged, userId, macId, phoneId, phoneKey)) });
  await phone.until(m => m.type === 'pair-declined' && m.requestId === forged, 'forged proof declined');

  step('a verified connection request waits for the Mac, which declines it');
  const controllerNonce = trust.nonce();
  phone.send({ type: 'connect', targetId: macId, controllerNonce, requestSignature: signature(phoneKeys.privateKey, trust.sessionRequest(userId, grant.id, macId, phoneId, controllerNonce)), canRemember: false });
  await phone.until(m => m.type === 'pending', 'phone pending');
  await mac.until(s => s.pending === phoneId, 'Mac shows the approval prompt');
  mac.send('deny');
  const ended = await phone.until(m => m.type === 'ended', 'request ended');
  assert.equal(ended.reason, 'Mac declined the connection');
  await mac.until(s => !s.pending, 'prompt cleared');

  step('a request with a forged signature never reaches the prompt');
  const forgedNonce = trust.nonce();
  const otherKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  phone.send({ type: 'connect', targetId: macId, controllerNonce: forgedNonce, requestSignature: signature(otherKey, trust.sessionRequest(userId, grant.id, macId, phoneId, forgedNonce)), canRemember: false });
  await phone.until(m => m.type === 'error' || m.type === 'pending', 'service reaction');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await mac.until(() => true, 'state')).pending, null, 'no prompt for a forged request');

  step('restart: device key and pins persist in the Keychain');
  mac.send('quit'); await mac.exited;
  mac = startMac(url, session.token);
  state = await mac.until(s => s.ready && s.deviceId, 'Mac ready again');
  assert.equal(state.deviceId, macId, 'same device key after restart');
  assert.ok(state.pins.some(p => p.id === phoneId && p.grantId === grant.id), 'pin survived restart');

  step('revoke from the Mac reaches the phone');
  mac.send(`revoke ${phoneId}`);
  const revoked = await phone.until(m => m.type === 'revoked', 'phone sees revocation');
  assert.equal(revoked.grantId, grant.id);
  await mac.until(s => s.pins.length === 0, 'Mac pin removed');
  mac.send('quit'); await mac.exited;
  console.log('E2E PASSED');
}

async function openPhone(url, token, userId, deviceId, privateKey) {
  const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
  const messages = []; const waiters = [];
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString()); messages.push(message);
    for (const waiter of [...waiters]) if (waiter.test(message)) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(message); }
  });
  const until = (test, label, ms = 20000) => {
    const found = messages.find(test); if (found) { messages.splice(messages.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => waiters.push({ test, resolve, timer: setTimeout(() => reject(Error(`Timed out: ${label}`)), ms) }));
  };
  await once(ws, 'open');
  const { challenge } = await until(m => m.type === 'challenge', 'challenge');
  ws.send(JSON.stringify({ type: 'hello', token, deviceId, signature: signature(privateKey, trust.hello(challenge, userId, deviceId)) }));
  await until(m => m.type === 'ready', 'phone ready');
  let seq = 0;
  return { ws, until, send: data => { const n = ++seq; ws.send(JSON.stringify({ data, seq: n, signature: signature(privateKey, trust.envelope(challenge, userId, deviceId, n, data)) })); } };
}

try { await main(); }
catch (error) { console.error('E2E FAILED:', error.message); process.exitCode = 1; }
finally { await runCleanups(); }
