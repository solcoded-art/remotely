// Regenerates tests/fixtures/trust-vectors.json from shared/trust.mjs, the
// reference implementation the phone and server use. The Rust port in
// src/trust.rs must reproduce every transcript byte-for-byte and accept these
// signatures. Usage: node desktop-gpui/tests/trust-vectors.mjs
// The key below is a fixed TEST-ONLY key; it is not used by any app.
import { writeFileSync } from 'node:fs';
import * as trust from '../../shared/trust.mjs';

const jwk = { kty: 'EC', crv: 'P-256', x: 'kZUR-xQ6MDbrcHqUV1YUDLv-3hjHv2UyeNF36SmEerw', y: 'jh-PojJslrkZ6LNk4eI0qm1MVzK2Luz6DKU8lRt2Eg4', d: '_FqakcFH5J7zVWlSXIozzP_PAY90fVUOG6d-e1w99YU' };
const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
const key = trust.publicKey({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
const id = await trust.keyId(key);
const sign = async text => trust.b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, trust.encode(text)));

// Strings that differ between naive and JSON.stringify serialisation.
const tricky = 'Eí’s “Mac” \\ / \n\t\u0001   😀 <tag>&';
const challenge = 'A'.repeat(43);
const nonceA = 'B'.repeat(43); const nonceB = 'C'.repeat(43);
const secret = 'S2VlcCB0aGlzIHNlY3JldCBmb3IgdGVzdHMgb25seSE';
const grant = { id: 'grant-0001', userId: 'user-0001', desktopId: id, controllerId: 'd_phone', desktopKey: key, controllerKey: key, inviteId: 'invite-0001', requestId: 'request-0001' };
const data = { type: 'pair-open', inviteId: 'invite-0001', expires: 1767225600000 };
const signal = { type: 'ice', candidate: { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 } };

const transcripts = {
  registration: trust.registration(challenge, 'user-0001', { id, name: tricky, kind: 'desktop', publicKey: key }),
  hello: trust.hello(challenge, 'user-0001', id),
  envelope: trust.envelope(challenge, 'user-0001', id, 7, data),
  pairing: trust.pairing('invite-0001', 'request-0001', 'user-0001', id, 'd_phone', key),
  grant: trust.grantText(grant),
  sessionRequest: trust.sessionRequest('user-0001', 'grant-0001', id, 'd_phone', nonceA),
  sessionApproval: trust.sessionApproval('session-0001', 'user-0001', 'grant-0001', id, 'd_phone', nonceA, nonceB),
  signal: trust.signalText('session-0001', 'grant-0001', id, 3, signal, nonceA + '.' + nonceB),
};
const signatures = {};
for (const [name, text] of Object.entries(transcripts)) signatures[name] = await sign(text);

writeFileSync(new URL('./fixtures/trust-vectors.json', import.meta.url), JSON.stringify({
  privateKey: jwk.d, publicKey: key, keyId: id, tricky, challenge, nonceA, nonceB, secret, grant, data, signal,
  transcripts, signatures, proof: await trust.proof(secret, transcripts.pairing),
}, null, 2) + '\n');
console.log('wrote trust-vectors.json for', id);
