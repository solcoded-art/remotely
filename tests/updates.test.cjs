const { test } = require('node:test');
const assert = require('node:assert/strict');
const { downloadPageURL, isNewerVersion } = require('../desktop/updates.cjs');

test('update downloads open only the account service download page over HTTPS', () => {
  assert.equal(downloadPageURL('https://remotely.example.com'), 'https://remotely.example.com/download/mac');
  assert.equal(downloadPageURL('https://remotely.example.com/some/path?x=1#y'), 'https://remotely.example.com/download/mac');
  assert.equal(downloadPageURL('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/download/mac');
  for (const bad of ['http://remotely.example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@remotely.example.com', 'not a url', undefined]) {
    assert.throws(() => downloadPageURL(bad), undefined, String(bad));
  }
});

test('only strictly newer x.y.z versions count as updates', () => {
  assert.equal(isNewerVersion('0.3.2', '0.3.1'), true);
  assert.equal(isNewerVersion('0.10.0', '0.9.9'), true);
  assert.equal(isNewerVersion('1.0.0', '0.99.99'), true);
  assert.equal(isNewerVersion('0.3.1', '0.3.1'), false);
  assert.equal(isNewerVersion('0.3.0', '0.3.1'), false);
  for (const bad of ['0.3', '0.3.2-beta', 'v0.3.2', '', null, 3]) assert.equal(isNewerVersion(bad, '0.3.1'), false);
});
