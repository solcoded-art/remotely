// Regenerates tests/fixtures/remember-vectors.json by running the real Mac-side
// checks in src/lib/remember.ts (verifyUnlock, verifyUnlockKey) on WebAuthn
// responses built here with WebCrypto: valid ones and deliberately broken ones.
// src/remember.rs must return the same answer for every case.
// Usage: node desktop-gpui/tests/remember-vectors.mjs
import { writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import * as trust from '../../shared/trust.mjs';
const remember = await import('../../src/lib/remember.ts');

const enc = s => new TextEncoder().encode(s);
const sha = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? enc(bytes) : bytes));
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const toBig = bytes => BigInt('0x' + Buffer.from(bytes).toString('hex'));
const fromBig = (n, len = 32) => Uint8Array.from(Buffer.from(n.toString(16).padStart(len * 2, '0'), 'hex'));
function derInt(bytes) {
  let i = 0; while (i < bytes.length - 1 && bytes[i] === 0) i++;
  let v = bytes.slice(i); if (v[0] & 0x80) v = Uint8Array.from([0, ...v]);
  return [0x02, v.length, ...v];
}
const der = (r, s) => { const body = [...derInt(r), ...derInt(s)]; return Uint8Array.from([0x30, body.length, ...body]); };

const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = trust.b64(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey)));
const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const otherSpki = trust.b64(new Uint8Array(await crypto.subtle.exportKey('spki', other.publicKey)));

async function authData(origin, flags = 0x05, extra = []) {
  return Uint8Array.from([...await sha(new URL(origin).hostname), flags, 0, 0, 0, 7, ...extra]);
}
async function assertion({ origin, challenge, type = 'webauthn.get', flags = 0x05, key = keys.privateKey, highS = false, rpOrigin = origin }) {
  const data = await authData(rpOrigin, flags);
  const client = enc(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const signed = new Uint8Array([...data, ...await sha(client)]);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed));
  let s = toBig(raw.slice(32));
  s = highS ? (s > N / 2n ? s : N - s) : (s > N / 2n ? N - s : s);
  return { credentialId: trust.b64(enc('credential-1')), authenticatorData: trust.b64(data), clientDataJSON: trust.b64(client), signature: trust.b64(der(raw.slice(0, 32), fromBig(s))) };
}

const origin = 'https://enftify.com';
const challenge = trust.b64(enc(remember.unlockText('user-0001', 'd_mac', 'd_phone', 'B'.repeat(43))));
const unlocks = {
  valid: await assertion({ origin, challenge }),
  highS: await assertion({ origin, challenge, highS: true }),
  wrongChallenge: await assertion({ origin, challenge: trust.b64(enc('other')) }),
  wrongOrigin: await assertion({ origin: 'https://evil.example', challenge }),
  wrongRpId: await assertion({ origin, challenge, rpOrigin: 'https://evil.example' }),
  createType: await assertion({ origin, challenge, type: 'webauthn.create' }),
  notVerified: await assertion({ origin, challenge, flags: 0x01 }),
  otherKey: await assertion({ origin, challenge, key: other.privateKey }),
};
const tampered = { ...unlocks.valid, authenticatorData: trust.b64(await authData(origin, 0x05).then(d => { d[36] = 9; return d; })) };
unlocks.tamperedCounter = tampered;

const cases = [];
for (const [name, unlock] of Object.entries(unlocks)) {
  cases.push({ name, kind: 'unlock', publicKey: spki, unlock, challenge, origin, expected: await remember.verifyUnlock(spki, unlock, challenge, origin) });
}
cases.push({ name: 'wrongKey', kind: 'unlock', publicKey: otherSpki, unlock: unlocks.valid, challenge, origin, expected: await remember.verifyUnlock(otherSpki, unlocks.valid, challenge, origin) });
cases.push({ name: 'isUnlockRejectsLongField', kind: 'isUnlock', unlock: { ...unlocks.valid, signature: 'A'.repeat(2049) }, expected: remember.isUnlock({ ...unlocks.valid, signature: 'A'.repeat(2049) }) });
cases.push({ name: 'isUnlockAcceptsValid', kind: 'isUnlock', unlock: unlocks.valid, expected: remember.isUnlock(unlocks.valid) });

// Turning remembering on: the phone offers its passkey (new or existing) for the Mac's challenge.
const offer = trust.nonce();
async function created({ origin: o = origin, type = 'webauthn.create', flags = 0x45, publicKey = spki, credentialId = trust.b64(enc('credential-1')) } = {}) {
  const client = enc(JSON.stringify({ type, challenge: offer, origin: o, crossOrigin: false }));
  return { kind: 'create', credentialId, publicKey, authenticatorData: trust.b64(await authData(o, flags, [1, 2, 3])), clientDataJSON: trust.b64(client) };
}
const keyCases = {
  create: await created(),
  createLocalhost: await created({ origin: 'http://localhost:5173' }),
  createPlainHttp: await created({ origin: 'http://enftify.com' }),
  createWrongType: await created({ type: 'webauthn.get' }),
  createNotVerified: await created({ flags: 0x41 }),
  createBadKey: await created({ publicKey: trust.b64(enc('not a key')) }),
  createLongKey: await created({ publicKey: 'A'.repeat(513) }),
  get: { kind: 'get', publicKey: spki, ...await assertion({ origin, challenge: offer }) },
  getWrongKey: { kind: 'get', publicKey: otherSpki, ...await assertion({ origin, challenge: offer }) },
  getNoSignature: { ...(await assertion({ origin, challenge: offer })), kind: 'get', publicKey: spki, signature: undefined },
  unknownKind: { ...(await created()), kind: 'import' },
};
for (const [name, key] of Object.entries(keyCases)) {
  cases.push({ name, kind: 'key', key, challenge: offer, expected: await remember.verifyUnlockKey(key, offer) });
}

writeFileSync(new URL('./fixtures/remember-vectors.json', import.meta.url), JSON.stringify({
  unlockText: { args: ['user-0001', 'd_mac', 'd_phone', 'B'.repeat(43)], text: remember.unlockText('user-0001', 'd_mac', 'd_phone', 'B'.repeat(43)) },
  cases,
}, null, 1) + '\n');
console.log(`wrote ${cases.length} remember vectors:`, cases.map(c => `${c.name}=${c.expected === null ? 'null' : typeof c.expected === 'string' ? 'origin' : c.expected}`).join(' '));
