const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, writeFile, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { createIdentityStore } = require('../desktop/identity.cjs');

test('pairing proofs bind both device keys, the account, invitation and request', async () => {
  const trust = await import('../shared/trust.mjs');
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const key = trust.publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey)); const id = await trust.keyId(key);
  const secret = trust.nonce(); const message = trust.pairing('invite', 'request', 'account', 'desktop', id, key);
  const proof = await trust.proof(secret, message);
  assert.ok(await trust.verifyProof(secret, message, proof));
  for (const changed of [trust.pairing('other-invite', 'request', 'account', 'desktop', id, key), trust.pairing('invite', 'other-request', 'account', 'desktop', id, key), trust.pairing('invite', 'request', 'other-account', 'desktop', id, key), trust.pairing('invite', 'request', 'account', 'attacker-desktop', id, key)]) assert.equal(await trust.verifyProof(secret, changed, proof), false);
  assert.equal(await trust.verifyProof(trust.nonce(), message, proof), false);
  assert.throws(() => trust.publicKey({ ...key, d: trust.nonce() }));
  assert.throws(() => trust.publicKey({ ...key, crv: 'P-384' }));
  assert.throws(() => trust.publicKey({ ...key, x: 'bad' }));
  await assert.rejects(() => crypto.subtle.exportKey('jwk', keys.privateKey));
});

test('native keys stay encrypted, survive restart, retain revocation and fail closed on corruption', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'remotely-keys-')); t.after(() => rm(root, { recursive: true, force: true }));
  const wrappingKey = randomBytes(32);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv); const encrypted = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decryptStringAsync: async bytes => { const decipher = createDecipheriv('aes-256-gcm', wrappingKey, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: false }; },
  };
  const trust = await import('../shared/trust.mjs'); const scope = JSON.stringify(['https://remote.example', 'account-12345678']);
  let vault = createIdentityStore(root, safeStorage); const key = await vault.identity(scope); const id = await trust.keyId(key);
  const message = trust.hello(trust.nonce(), 'account-12345678', id);
  assert.ok(await trust.verify(key, message, await vault.sign(scope, message)));
  await vault.pin(scope, id, { grantId: 'grant-12345678', key, name: 'Phone' });
  vault = createIdentityStore(root, safeStorage); assert.deepEqual(await vault.identity(scope), key); assert.equal((await vault.pins(scope))[id].name, 'Phone');
  await vault.pin(scope, id, null); assert.deepEqual(await createIdentityStore(root, safeStorage).pins(scope), {});
  const file = path.join(root, (await readdir(root))[0]); const bytes = await readFile(file);
  assert.equal(bytes.includes(Buffer.from('PRIVATE KEY')), false); assert.equal((await stat(file)).mode & 0o777, 0o600);
  await writeFile(file, 'corrupt'); await assert.rejects(() => createIdentityStore(root, safeStorage).identity(scope), /not replaced/);
  const other = JSON.stringify(['https://remote.example', 'account-87654321']);
  await assert.rejects(() => createIdentityStore(root, { ...safeStorage, isAsyncEncryptionAvailable: async () => false }).identity(other), /Keychain is unavailable/);
  await assert.rejects(() => vault.identity(JSON.stringify(['http://untrusted.example', 'account-12345678'])));
});

test('session attestations reject changed client nonces even when a relay reuses a session ID', async () => {
  const trust = await import('../shared/trust.mjs');
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const key = trust.publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey));
  const sign = async text => trust.b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, trust.encode(text)));
  const phoneNonce = trust.nonce(); const macNonce = trust.nonce();
  const approval = trust.sessionApproval('same-session', 'account', 'grant', 'mac', 'phone', phoneNonce, macNonce);
  const signature = await sign(approval);
  assert.ok(await trust.verify(key, approval, signature));
  assert.equal(await trust.verify(key, trust.sessionApproval('same-session', 'account', 'grant', 'mac', 'phone', trust.nonce(), macNonce), signature), false);
  assert.equal(await trust.verify(key, trust.sessionApproval('same-session', 'account', 'grant', 'mac', 'phone', phoneNonce, trust.nonce()), signature), false);
  const signal = { type: 'offer', sdp: 'certificate-fingerprint' };
  const original = trust.signalText('same-session', 'grant', 'mac', 1, signal, phoneNonce + '.' + macNonce);
  assert.equal(await trust.verify(key, trust.signalText('same-session', 'grant', 'mac', 1, signal, phoneNonce + '.' + trust.nonce()), await sign(original)), false);
});
