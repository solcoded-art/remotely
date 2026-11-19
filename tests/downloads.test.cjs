const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDownloads } = require('../signaling/downloads.cjs');
const release = require('../release.config.json');
function response() {
  return { status: null, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body = '') { this.body = body; } };
}
test('only a published binary installer enables a download and public metadata needs no login', async () => {
  let calls = 0;
  const downloads = createDownloads(async (url, options) => {
    calls++;
    assert.equal(url, release.url); assert.equal(options.method, 'HEAD');
    return new Response('', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  });
  const info = response();
  assert.equal(await downloads.handle('/api/downloads/mac', { method: 'GET' }, info), true);
  assert.equal(info.status, 200); assert.equal(JSON.parse(info.body).available, true);
  const download = response(); await downloads.handle('/download/mac', { method: 'GET' }, download);
  assert.equal(download.status, 302); assert.equal(download.headers.Location, release.url);
  assert.equal(calls, 1);
});
test('a missing, unreachable, or HTML-only release cannot redirect visitors to a broken installer', async () => {
  for (const fetchRelease of [
    async () => new Response('', { status: 404 }),
    async () => new Response('<html>not an installer</html>', { headers: { 'Content-Type': 'text/html' } }),
    async () => { throw Error('download host unreachable'); },
  ]) {
    const downloads = createDownloads(fetchRelease);
    const info = response(); await downloads.handle('/api/downloads/mac', { method: 'GET' }, info);
    assert.equal(JSON.parse(info.body).available, false);
    const download = response(); await downloads.handle('/download/mac', { method: 'GET' }, download);
    assert.equal(download.status, 503); assert.ok(!download.headers.Location);
    assert.match(download.body, /Back to Mac Remote setup/);
  }
});
