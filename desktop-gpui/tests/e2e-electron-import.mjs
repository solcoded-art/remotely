// End-to-end check of the Electron → GPUI upgrade path. Real Electron runs the
// real desktop/identity.cjs (safeStorage-encrypted device key + a pinned phone)
// under a throwaway app name, Keychain item and folder; then the GPUI app (e2e
// build) must come up with Electron's exact device id and the pinned phone.
// Nothing touches the real "Mac Remote" data or Keychain item.
//
//   (cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)
//   node scripts/test-with-postgres.cjs node desktop-gpui/tests/e2e-electron-import.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as trust from '../../shared/trust.mjs';
import { cleanups, deleteKeychainItem, runCleanups, startMac, startService } from './e2e-common.mjs';

const repo = new URL('../..', import.meta.url).pathname;
const name = `MacRemoteImportTest${randomBytes(4).toString('hex')}`;

async function main() {
  const { url, account } = await startService();
  const session = await account(`import-${Date.now()}@example.com`);
  const userId = session.user.id;

  console.log('• Electron stores a device key and a paired phone');
  const work = mkdtempSync(path.join(tmpdir(), 'electron-import-'));
  cleanups.push(() => rmSync(work, { recursive: true, force: true }));
  execFileSync('security', ['add-generic-password', '-s', `${name} Safe Storage`, '-a', `${name} Key`, '-w', randomBytes(16).toString('base64'), '-A']);
  cleanups.push(() => { try { execFileSync('security', ['delete-generic-password', '-s', `${name} Safe Storage`, '-a', `${name} Key`], { stdio: 'ignore' }); } catch {} });
  const phoneKey = trust.publicKey(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }));
  const phoneId = await trust.keyId(phoneKey);
  const pin = { grantId: 'grant-electron-1', key: phoneKey, name: 'Electron-paired iPhone' };
  const script = path.join(work, 'main.cjs');
  writeFileSync(script, `
    const { app, safeStorage } = require('electron');
    const { createIdentityStore } = require(${JSON.stringify(path.join(repo, 'desktop/identity.cjs'))});
    app.setName(${JSON.stringify(name)});
    app.whenReady().then(async () => {
      const store = createIdentityStore(${JSON.stringify(path.join(work, 'device-keys'))}, safeStorage);
      const scope = JSON.stringify([${JSON.stringify(url)}, ${JSON.stringify(userId)}]);
      const key = await store.identity(scope);
      await store.pin(scope, ${JSON.stringify(phoneId)}, ${JSON.stringify(pin)});
      console.log('KEY ' + JSON.stringify(key));
      app.quit();
    }).catch(error => { console.error(error); app.exit(1); });`);
  const output = execFileSync(path.join(repo, 'node_modules/.bin/electron'), [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const electronId = await trust.keyId(JSON.parse(output.split('\n').find(line => line.startsWith('KEY ')).slice(4)));

  console.log('• the GPUI app starts with Electron’s device key and pins');
  cleanups.push(() => deleteKeychainItem(url));
  const mac = startMac(url, session.token, { MAC_REMOTE_E2E_ELECTRON_NAME: name, MAC_REMOTE_E2E_ELECTRON_ROOT: work });
  const state = await mac.until(s => s.ready && s.deviceId, 'Mac ready');
  assert.equal(state.deviceId, electronId, 'same device id as the Electron app');
  assert.deepEqual(state.pins, [{ id: phoneId, grantId: pin.grantId, name: pin.name }], 'Electron pin imported');
  mac.send('quit'); await mac.exited;
  console.log('E2E ELECTRON IMPORT PASSED');
}

try { await main(); }
catch (error) { console.error('E2E ELECTRON IMPORT FAILED:', error.message); process.exitCode = 1; }
finally { await runCleanups(); }
