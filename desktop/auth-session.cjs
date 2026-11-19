const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Auth tokens are OS-encrypted and scoped by server. No plaintext fallback.
function createAuthSessionStore(root, safeStorage) {
  let serial = Promise.resolve();
  return (origin, value) => {
    const operation = serial.then(async () => {
      const url = new URL(origin);
      if (url.origin !== origin || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw Error('Invalid account server.');
      const file = path.join(root, createHash('sha256').update(origin).digest('hex') + '.session');
      if (value === null) { await fs.rm(file, { force: true }); return null; }
      if (value !== undefined) {
        if (!value || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.token) || !Number.isSafeInteger(value.expires) || value.expires <= Date.now()) throw Error('Invalid login session.');
        if (!await safeStorage.isAsyncEncryptionAvailable()) throw Error('Unlock your Mac Keychain to remember this login.');
        const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ token: value.token, expires: value.expires }));
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        await fs.writeFile(file + '.tmp', encrypted, { mode: 0o600 }); await fs.rename(file + '.tmp', file);
        return null;
      }
      let encrypted;
      try { encrypted = await fs.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      let saved;
      try { saved = JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result); }
      catch { throw Error('Cannot restore your login. Unlock your Mac Keychain and try again, or sign in again.'); }
      if (saved.expires <= Date.now()) { await fs.rm(file, { force: true }); return null; }
      return saved;
    });
    serial = operation.catch(() => {});
    return operation;
  };
}
module.exports = { createAuthSessionStore };
