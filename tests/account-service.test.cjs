const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../shared/account-service.mjs');
const NEW = 'https://enftify.com';
const OLD = 'https://remotely-marisol-workspace-k1zb.ongale.dev';

test('the old Ongale address and enftify.com are one account service', async () => {
  const { sameService, PRODUCTION_SERVICE, LEGACY_PRODUCTION_SERVICE } = await load();
  assert.equal(PRODUCTION_SERVICE, NEW); assert.equal(LEGACY_PRODUCTION_SERVICE, OLD);
  assert.equal(sameService(NEW, OLD), true);
  assert.equal(sameService(OLD, NEW), true);
  assert.equal(sameService(NEW, NEW), true);
  assert.equal(sameService('https://self-hosted.example.com', 'https://self-hosted.example.com'), true);
  for (const other of ['https://enftify.com.evil.example', 'http://enftify.com', 'https://self-hosted.example.com', 'https://www.enftify.com']) {
    assert.equal(sameService(other, NEW), false, other);
    assert.equal(sameService(other, OLD), false, other);
  }
});

test('native apps send requests to enftify.com but keep their original storage key', async () => {
  const { canonicalService, storageService } = await load();
  assert.equal(canonicalService(OLD), NEW);
  assert.equal(canonicalService(NEW), NEW);
  assert.equal(canonicalService('https://self-hosted.example.com'), 'https://self-hosted.example.com');
  assert.equal(canonicalService('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  // Sign-ins and device keys saved by 0.3.2 and earlier were keyed by the old address.
  assert.equal(storageService(NEW), OLD);
  assert.equal(storageService(OLD), OLD);
  assert.equal(storageService('https://self-hosted.example.com'), 'https://self-hosted.example.com');
});
