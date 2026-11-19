const release = require('../release.config.json');

function createDownloads(fetchRelease = fetch) {
  let cached;
  let pending;
  async function status() {
    if (cached && cached.until > Date.now()) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      let available = false;
      try {
        const response = await fetchRelease(release.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        // A release page or error page is not an installer.
        available = response.ok && /application\/(?:octet-stream|zip|x-zip-compressed)/i.test(response.headers.get('content-type') || '');
      } catch {}
      const value = { ...release, url: '/download/mac', available };
      cached = { value, until: Date.now() + (available ? 60000 : 10000) };
      return value;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function handle(route, req, res) {
    if (req.method !== 'GET' || !['/api/downloads/mac', '/download/mac'].includes(route)) return false;
    const info = await status();
    if (route === '/api/downloads/mac') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(info));
    } else if (info.available) {
      res.writeHead(302, { Location: release.url }); res.end();
    } else {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '10' });
      res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mac Remote download</title><body><h1>Mac download temporarily unavailable</h1><p>The installer has not been published or the download host is unavailable. Please return to setup and try again.</p><a href="/">Back to Mac Remote setup</a></body></html>');
    }
    return true;
  }
  return { handle };
}
module.exports = { createDownloads };
