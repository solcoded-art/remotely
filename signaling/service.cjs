const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHmac } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { createStore } = require('./store.cjs');

const defaults = ['capacitor://localhost', 'app://macremote', 'http://localhost', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://localhost:3000'];
const fail = (status, message) => Object.assign(new Error(message), { status });
function isId(value) { return typeof value === 'string' && /^[\w-]{8,80}$/.test(value); }
function text(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max; }

async function createService(options = {}) {
  let publicOrigin = null;
  if (process.env.PUBLIC_URL) {
    try {
      const url = new URL(process.env.PUBLIC_URL);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error();
      publicOrigin = url.origin;
    } catch { throw Object.assign(new Error('Invalid public origin.'), { code: 'PUBLIC_URL_INVALID' }); }
  }
  const store = await createStore(options.databaseURL || process.env.DATABASE_URL);
  const origins = new Set(options.origins || (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean) : defaults));
  if (publicOrigin) origins.add(publicOrigin);
  const publicDir = path.resolve(__dirname, '../dist');
  const peers = new Map();
  const sessions = new Map();
  const buckets = new Map();
  let activeAuth = 0;
  let closing = false;
  function limited(key, limit, interval) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + interval }; buckets.set(key, bucket); }
    return ++bucket.count > limit;
  }
  const send = (ws, data) => { if (ws?.readyState === 1) ws.send(JSON.stringify(data)); };
  const devices = async userId => (await store.devices(userId)).map(device => ({ ...device, online: peers.has(device.id) }));
  async function broadcast(userId) {
    const list = await devices(userId);
    for (const peer of peers.values()) if (peer.user.id === userId) send(peer.ws, { type: 'devices', devices: list });
  }
  function finish(id, reason = 'Session ended') {
    const session = sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    sessions.delete(id);
    for (const deviceId of [session.desktop, session.controller]) send(peers.get(deviceId)?.ws, { type: 'ended', sessionId: id, reason });
  }
  function closeToken(token) {
    for (const peer of peers.values()) if (peer.token === token) peer.ws.close(4001, 'Signed out');
  }
  async function readBody(req) {
    let bytes = 0;
    const parts = [];
    for await (const part of req) {
      bytes += part.length;
      if (bytes > 16384) throw fail(413, 'Request is too large.');
      parts.push(part);
    }
    try {
      const data = JSON.parse(Buffer.concat(parts).toString());
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
      return data;
    } catch { throw fail(400, 'Expected a JSON object.'); }
  }
  function iceServers(userId) {
    const result = [];
    if (process.env.STUN_URL) result.push({ urls: process.env.STUN_URL });
    if (process.env.TURN_URLS && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
      result.push({ urls: process.env.TURN_URLS.split(','), username, credential: createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64') });
    }
    return result;
  }
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return json(403, { error: 'Origin is not allowed.' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (['/api/health', '/health'].includes(route) && req.method === 'GET') return json(200, { status: 'ok' });
      if (req.method === 'GET' && !route.startsWith('/api/') && route !== '/ws') {
        const relative = route === '/' ? '/index.html' : decodeURIComponent(route);
        const file = path.resolve(publicDir, '.' + relative);
        if (!file.startsWith(publicDir + path.sep)) throw fail(403, 'Forbidden.');
        try {
          const stat = await fs.promises.stat(file);
          if (!stat.isFile()) throw Error();
          const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
          if (route.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
          const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); return;
        } catch { throw fail(404, 'Not found. Build the client with npm run build.'); }
      }
      if (['/api/auth/register', '/api/auth/login'].includes(route) && req.method === 'POST') {
        if (limited(`auth:${req.socket.remoteAddress}`, 25, 15 * 60 * 1000)) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
        const data = await readBody(req);
        const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !text(data.password, 256) || data.password.length < 12) throw fail(400, 'Enter an email and a password of at least 12 characters.');
        if (limited(`email:${email}`, 10, 15 * 60 * 1000)) throw fail(429, 'Too many attempts. Try again in 15 minutes.');
        if (activeAuth >= 4) throw fail(503, 'Sign-in is busy. Try again shortly.');
        activeAuth++;
        let user;
        try {
          if (route.endsWith('register')) {
            if ((options.allowRegistration ?? process.env.ALLOW_REGISTRATION) === 'false') throw fail(403, 'Registration is disabled.');
            user = await store.register(email, data.password);
          } else user = await store.login(email, data.password);
        } finally { activeAuth--; }
        if (!user) throw fail(401, 'Email or password is incorrect.');
        return json(200, { user, ...await store.issue(user.id) });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const user = await store.authenticate(token);
      if (!user) throw fail(401, 'Sign in to continue.');
      if (route === '/api/auth/logout' && req.method === 'POST') {
        await store.revoke(token); closeToken(token); return json(200, { status: 'ok' });
      }
      if (route === '/api/account' && req.method === 'DELETE') {
        if (limited(`delete:${user.id}`, 5, 15 * 60 * 1000)) throw fail(429, 'Too many attempts. Try again later.');
        const data = await readBody(req);
        if (!text(data.password, 256) || !(await store.login(user.email, data.password))) throw fail(403, 'Password is incorrect.');
        for (const peer of peers.values()) if (peer.user.id === user.id) peer.ws.close(4001, 'Account deleted');
        await store.deleteUser(user.id); return json(200, { status: 'ok' });
      }
      if (route === '/api/me' && req.method === 'GET') return json(200, { user });
      if (route === '/api/ice' && req.method === 'GET') return json(200, { iceServers: iceServers(user.id) });
      if (route === '/api/devices' && req.method === 'GET') return json(200, { devices: await devices(user.id) });
      if (route === '/api/devices' && req.method === 'POST') {
        const data = await readBody(req);
        if (!isId(data.id) || !text(data.name, 80) || !['desktop', 'controller'].includes(data.kind)) throw fail(400, 'Invalid device details.');
        if (!await store.device(data.id) && (await store.devices(user.id)).length >= 20) throw fail(409, 'Device limit reached.');
        const device = await store.registerDevice(data.id, user.id, data.name.trim(), data.kind);
        await broadcast(user.id); return json(200, { device });
      }
      throw fail(404, 'Not found.');
    } catch (error) { if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'The service could not complete this request.' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (req.url !== '/ws' || (origin && !origins.has(origin)) || limited(`upgrade:${req.socket.remoteAddress}`, 60, 60000)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let identity = null;
    let alive = true;
    let serial = Promise.resolve();
    let queued = 0;
    const authTimer = setTimeout(() => ws.close(4001, 'Authentication required'), 5000);
    ws.on('pong', () => { alive = true; });
    ws.on('error', () => {});
    async function onMessage(raw, binary) {
      try {
        if (binary) throw fail(400, 'JSON messages only.');
        const data = JSON.parse(raw.toString());
        if (!data || typeof data !== 'object') throw fail(400, 'Invalid message.');
        if (!identity) {
          if (data.type !== 'hello') throw fail(401, 'Authenticate first.');
          const user = await store.authenticate(data.token);
          const device = isId(data.deviceId) && await store.device(data.deviceId);
          if (!user || !device || device.user_id !== user.id) throw fail(401, 'Invalid device session.');
          if (ws.readyState !== 1) return;
          if (peers.has(device.id)) {
            for (const [id, session] of sessions) if ([session.desktop, session.controller].includes(device.id)) finish(id, 'Device reconnected');
            peers.get(device.id).ws.close(4000, 'Device reconnected');
          }
          identity = { user, device, ws, token: data.token, alive: () => alive, ping: () => { alive = false; ws.ping(); } };
          peers.set(device.id, identity);
          clearTimeout(authTimer);
          send(ws, { type: 'ready', deviceId: device.id });
          await broadcast(user.id); return;
        }
        if (!await store.authenticate(identity.token)) { ws.close(4001, 'Session expired'); return; }
        if (limited(`ws:${identity.device.id}`, 180, 1000)) throw fail(429, 'Too many messages.');
        if (data.type === 'connect') {
          if (identity.device.kind !== 'controller') throw fail(403, 'Only a controller can request access.');
          const desktop = peers.get(data.targetId);
          if (!desktop || desktop.device.kind !== 'desktop' || desktop.user.id !== identity.user.id) throw fail(404, 'Mac is offline or unavailable.');
          if ([...sessions.values()].some(s => [s.desktop, s.controller].includes(desktop.device.id) || [s.desktop, s.controller].includes(identity.device.id))) throw fail(409, 'A device already has a pending or active session.');
          const id = randomUUID();
          const timer = setTimeout(() => finish(id, 'Approval timed out'), 60000);
          sessions.set(id, { desktop: desktop.device.id, controller: identity.device.id, approved: false, timer });
          send(ws, { type: 'pending', sessionId: id, name: desktop.device.name });
          send(desktop.ws, { type: 'request', sessionId: id, name: identity.device.name }); return;
        }
        const session = sessions.get(data.sessionId);
        if (!session || ![session.desktop, session.controller].includes(identity.device.id)) throw fail(403, 'Session is unavailable.');
        if (data.type === 'approve') {
          if (session.desktop !== identity.device.id || session.approved) throw fail(403, 'Only the Mac can approve a pending request.');
          if (data.allowed !== true) { finish(data.sessionId, 'Mac declined the connection'); return; }
          clearTimeout(session.timer); session.approved = true;
          for (const id of [session.desktop, session.controller]) send(peers.get(id)?.ws, { type: 'approved', sessionId: data.sessionId }); return;
        }
        if (data.type === 'end') { finish(data.sessionId); return; }
        if (data.type === 'signal') {
          if (!session.approved) throw fail(403, 'Mac approval is required.');
          if (!data.signal || typeof data.signal !== 'object' || !['offer', 'answer', 'ice'].includes(data.signal.type)) throw fail(400, 'Invalid signal.');
          if ((data.signal.type === 'offer' && identity.device.id !== session.desktop) || (data.signal.type === 'answer' && identity.device.id !== session.controller)) throw fail(403, 'Unexpected negotiation role.');
          const recipient = session.desktop === identity.device.id ? session.controller : session.desktop;
          send(peers.get(recipient)?.ws, { type: 'signal', sessionId: data.sessionId, signal: data.signal }); return;
        }
        throw fail(400, 'Unknown message.');
      } catch (error) { send(ws, { type: 'error', message: error.status ? error.message : 'Invalid message.' }); if (!identity) ws.close(4001, 'Authentication failed'); }
    }
    ws.on('message', (raw, binary) => {
      if (++queued > 200) { ws.close(4008, 'Too many pending messages'); return; }
      serial = serial.then(() => ws.readyState === 1 ? onMessage(raw, binary) : undefined).catch(() => ws.close(1011, 'Service error')).finally(() => { queued--; });
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!identity || peers.get(identity.device.id)?.ws !== ws) return;
      peers.delete(identity.device.id);
      for (const [id, session] of sessions) if ([session.desktop, session.controller].includes(identity.device.id)) finish(id, 'Device disconnected');
      if (!closing) broadcast(identity.user.id).catch(() => {});
    });
  });
  const heartbeat = setInterval(async () => {
    for (const peer of peers.values()) {
      try {
        if (!peer.alive() || !await store.authenticate(peer.token)) peer.ws.terminate();
        else peer.ping();
      } catch { peer.ws.terminate(); }
    }
    for (const [key, bucket] of buckets) if (bucket.until <= Date.now()) buckets.delete(key);
  }, 15000);
  heartbeat.unref();
  return {
    server,
    async close() {
      closing = true; clearInterval(heartbeat);
      for (const id of sessions.keys()) finish(id, 'Service stopped');
      for (const ws of wss.clients) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
      await store.close();
    },
  };
}
module.exports = { createService };
