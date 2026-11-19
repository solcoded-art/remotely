const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign } = require('node:crypto');

// OS-encrypted software keys, never exposed over IPC. No plaintext or unavailable-Keychain fallback.
function createIdentityStore(root, safeStorage) {
  const cache = new Map();
  let serial = Promise.resolve();
  function scope(value) {
    if (typeof value !== 'string' || value.length > 500) throw Error('Invalid identity scope.');
    const [origin, userId] = JSON.parse(value);
    const url = new URL(origin);
    if (url.origin !== origin || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) || !/^[\w-]{8,80}$/.test(userId)) throw Error('Invalid identity scope.');
    return createHash('sha256').update(value).digest('hex');
  }
  async function save(id, record) {
    const available = await safeStorage.isAsyncEncryptionAvailable();
    if (!available) throw Error('Mac Keychain is unavailable. Unlock it and try again.');
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(record));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const file = path.join(root, id + '.key');
    const temp = file + '.tmp';
    await fs.writeFile(temp, encrypted, { mode: 0o600 });
    await fs.rename(temp, file);
  }
  async function load(value) {
    const id = scope(value);
    if (cache.has(id)) return [id, cache.get(id)];
    let record;
    try {
      const encrypted = await fs.readFile(path.join(root, id + '.key'));
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      record = JSON.parse(decrypted.result);
      if (decrypted.shouldReEncrypt) await save(id, record);
      createPrivateKey(record.privateKey); // Corruption must not silently generate a new identity.
    } catch (error) {
      if (error.code !== 'ENOENT') throw Error('Cannot unlock your device key. Restore Keychain access; your key was not replaced.');
      const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      record = { privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), pins: {} };
      await save(id, record);
    }
    cache.set(id, record); return [id, record];
  }
  function locked(fn) {
    const result = serial.then(fn); serial = result.catch(() => {}); return result;
  }
  return {
    identity: value => locked(async () => { const [, record] = await load(value); return createPublicKey(record.privateKey).export({ format: 'jwk' }); }),
    sign: (value, message) => locked(async () => {
      if (typeof message !== 'string' || message.length > 250000 || !message.startsWith('["remotely-trust-v1",')) throw Error('Invalid identity request.');
      const [, record] = await load(value);
      return sign('sha256', Buffer.from(message), { key: record.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    }),
    pins: value => locked(async () => { const [, record] = await load(value); return record.pins; }),
    pin: (value, peerId, pin) => locked(async () => {
      if (typeof peerId !== 'string' || !/^d_[\w-]{43}$/.test(peerId) || pin !== null && JSON.stringify(pin).length > 3000) throw Error('Invalid trusted device.');
      const [id, record] = await load(value);
      const next = { ...record, pins: { ...record.pins } };
      if (pin === null) delete next.pins[peerId]; else next.pins[peerId] = pin;
      await save(id, next); cache.set(id, next);
    }),
  };
}
module.exports = { createIdentityStore };
