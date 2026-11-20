const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHmac } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { createStore } = require('./store.cjs');
const { createAuthentication, validateAuthenticationSettings, normalizeEmail } = require('./authentication.cjs');
const { createDownloads } = require('./downloads.cjs');

const defaults = ['capacitor://localhost', 'app://macremote', 'http://localhost', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://localhost:3000'];
const fail = (status, message) => Object.assign(new Error(message), { status });
function isId(value) { return typeof value === 'string' && /^[\w-]{8,80}$/.test(value); }
function text(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max; }

async function createService(options = {}) {
  const trust = await import('../shared/trust.mjs');
  const challenges = new Map();
  const invites = new Map();
  const pairRequests = new Map();
  const revoking = new Set();
  const pairEpochs = new Map();
  const pairKey = (desktop, controller) => `${desktop}:${controller}`;
  let publicOrigin = null;
  if (options.publicURL || process.env.PUBLIC_URL) {
    try {
      const url = new URL(options.publicURL || process.env.PUBLIC_URL);
      if (!['http:', 'https:'].includes(url.protocol) || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error();
      publicOrigin = url.origin;
    } catch { throw Object.assign(new Error('Invalid public origin.'), { code: 'PUBLIC_URL_INVALID' }); }
  }
  validateAuthenticationSettings({ secret: options.authSecret, sendMail: options.sendMail });
  const store = await createStore(options.databaseURL || process.env.DATABASE_URL);
  // Packaged clients are first-party origins, even with a browser-origin override.
  const origins = new Set(['app://macremote', 'capacitor://localhost', ...(options.origins || (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean) : defaults))]);
  if (publicOrigin) origins.add(publicOrigin);
  let authentication;
  try { authentication = await createAuthentication({ store, publicOrigin, origins, secret: options.authSecret,
    sendMail: options.sendMail, allowRegistration: (options.allowRegistration ?? process.env.ALLOW_REGISTRATION) !== 'false' }); }
  catch (error) { await store.close(); throw error; }
  // Browser module/CSS requests may carry Origin even on the app's own host.
  // Do not rely on a manually configured PUBLIC_URL for same-origin traffic.
  function allowsOrigin(origin, req) {
    if (!origin || origins.has(origin)) return true;
    try {
      const url = new URL(origin);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === req.headers.host?.toLowerCase();
    } catch { return false; }
  }
  const publicDir = path.resolve(__dirname, '../dist');
  // Client-side pages that load the app shell (sign-in/sign-up on the web).
  const appRoutes = new Set(['/login', '/signin', '/signup', '/get-started']);
  const downloads = createDownloads();
  const peers = new Map();
  const sessions = new Map();
  const buckets = new Map();
  let closing = false;
  const sessionGraceMs = options.sessionGraceMs ?? 90000;
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
    clearTimeout(session.timer); clearTimeout(session.awayTimer);
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
    const allowedOrigin = allowsOrigin(origin, req);
    const publicFile = req.method === 'GET' && !req.url.startsWith('/api/') && req.url !== '/ws';
    if (!allowedOrigin && !publicFile) return json(403, { error: 'Origin is not allowed.' });
    if (origin && allowedOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (await downloads.handle(route, req, res)) return;
      if (['/api/health', '/health'].includes(route) && req.method === 'GET') return json(200, { status: 'ok', deviceTrust: 1 });
      if (req.method === 'GET' && route === '/docs/getting-started') { res.writeHead(308, { Location: '/docs/getting-started/' }); res.end(); return; }
      if (req.method === 'GET' && !route.startsWith('/api/') && route !== '/ws') {
        const relative = route === '/' || appRoutes.has(route) ? '/index.html' : route === '/docs/getting-started/' ? '/docs/getting-started/index.html' : decodeURIComponent(route);
        const file = path.resolve(publicDir, '.' + relative);
        if (!file.startsWith(publicDir + path.sep)) throw fail(403, 'Forbidden.');
        try {
          const stat = await fs.promises.stat(file);
          if (!stat.isFile()) throw Error();
          const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
          if (route.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
          const stream = fs.createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); return;
        } catch { throw fail(404, 'Not found. Build the client with npm run build.'); }
      }
      if (['/api/auth/register', '/api/auth/login'].includes(route)) throw fail(410, 'Password sign-in has been removed. Update the app and sign in with an email link.');
      if (route === '/api/auth/config' && req.method === 'GET') return json(200, { magicLink: authentication.magicAvailable });
      if (route === '/api/auth/session' && req.method === 'GET') return json(200, await authentication.restore(req, res));
      if (['/api/auth/magic-link', '/api/auth/verify-link'].includes(route) && req.method === 'POST') {
        if (limited(`magic-ip:${req.socket.remoteAddress}`, 20, 15 * 60 * 1000)) throw fail(429, 'Too many email sign-in attempts. Try again in 15 minutes.');
        const data = await readBody(req);
        if (route.endsWith('verify-link')) return json(200, await authentication.verify(data.token, normalizeEmail(data.email), req, res));
        const email = normalizeEmail(data.email);
        if (limited(`magic-email:${email}`, 3, 15 * 60 * 1000)) throw fail(429, 'Please wait before requesting another sign-in link.');
        return json(200, await authentication.send(email));
      }
      const token = route === '/api/auth/logout' ? authentication.tokenFrom(req) : req.headers.authorization?.replace(/^Bearer /, '');
      const user = await store.authenticate(token);
      if (!user) throw fail(401, 'Sign in to continue.');
      if (route === '/api/auth/logout' && req.method === 'POST') {
        await store.revoke(token); closeToken(token); authentication.cookie(req, res, null, 0); return json(200, { status: 'ok' });
      }
      if (route === '/api/account' && req.method === 'DELETE') {
        if (limited(`delete:${user.id}`, 5, 15 * 60 * 1000)) throw fail(429, 'Too many attempts. Try again later.');
        const data = await readBody(req);
        if (data.confirmEmail !== user.email || !await store.freshSession(token)) throw fail(403, 'Sign in with a fresh email link, then enter your email to confirm deletion.');
        for (const peer of peers.values()) if (peer.user.id === user.id) peer.ws.close(4001, 'Account deleted');
        await store.deleteUser(user.id); return json(200, { status: 'ok' });
      }
      if (route === '/api/me' && req.method === 'GET') return json(200, { user });
      if (route === '/api/ice' && req.method === 'GET') return json(200, { iceServers: iceServers(user.id) });
      if (route === '/api/devices' && req.method === 'GET') return json(200, { devices: await devices(user.id) });
      if (route === '/api/device-challenge' && req.method === 'POST') {
        if (limited(`enroll:${user.id}`, 30, 60000) || challenges.size >= 10000) throw fail(429, 'Too many device enrollments. Try again shortly.');
        const challenge = trust.nonce();
        challenges.set(challenge, { userId: user.id, expires: Date.now() + 60000 });
        return json(200, { challenge });
      }
      if (route === '/api/devices' && req.method === 'POST') {
        const data = await readBody(req);
        if (!data.publicKey) throw fail(426, 'Update the Mac app and reload your phone to use trusted-device pairing.');
        const challenge = challenges.get(data.challenge); challenges.delete(data.challenge);
        if (!challenge || challenge.userId !== user.id || challenge.expires < Date.now()) throw fail(403, 'Device enrollment expired. Try again.');
        let key;
        try { key = trust.publicKey(data.publicKey); } catch { throw fail(400, 'Invalid device key.'); }
        if (await trust.keyId(key) !== data.id || !await trust.verify(key, trust.registration(data.challenge, user.id, data), data.signature)) throw fail(403, 'Device key proof is required.');
        if (!isId(data.id) || !text(data.name, 80) || !['desktop', 'controller'].includes(data.kind)) throw fail(400, 'Invalid device details.');
        if (!await store.device(data.id) && (await store.devices(user.id)).filter(device => device.publicKey).length >= 20) throw fail(409, 'Device limit reached.');
        const device = await store.registerDevice(data.id, user.id, data.name.trim(), data.kind, key);
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
    if (req.url !== '/ws' || !allowsOrigin(origin, req) || limited(`upgrade:${req.socket.remoteAddress}`, 60, 60000)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let identity = null;
    let alive = true;
    let serial = Promise.resolve();
    let queued = 0;
    const socketChallenge = trust.nonce();
    let sequence = 0;
    send(ws, { type: 'challenge', challenge: socketChallenge });
    const authTimer = setTimeout(() => ws.close(4001, 'Authentication required'), 5000);
    ws.on('pong', () => { alive = true; });
    ws.on('error', () => {});
    async function onMessage(raw, binary) {
      try {
        if (binary) throw fail(400, 'JSON messages only.');
        let data = JSON.parse(raw.toString());
        if (!data || typeof data !== 'object') throw fail(400, 'Invalid message.');
        if (!identity) {
          if (data.type !== 'hello') throw fail(401, 'Authenticate first.');
          const user = await store.authenticate(data.token);
          const device = isId(data.deviceId) && await store.device(data.deviceId);
          if (!user || !device || device.user_id !== user.id) throw fail(401, 'Invalid device session.');
          if (!device.publicKey || !await trust.verify(device.publicKey, trust.hello(socketChallenge, user.id, device.id), data.signature)) throw fail(401, 'Device key proof is required. Update the app if needed.');
          if (ws.readyState !== 1) return;
          // An approved session survives the same device signing back in (phone locked, tab
          // switched, network change); a pending request does not.
          for (const [id, session] of sessions) {
            if (![session.desktop, session.controller].includes(device.id)) continue;
            if (!session.approved) { finish(id, 'Device reconnected'); continue; }
            if (session.away === device.id) { clearTimeout(session.awayTimer); session.away = null; }
          }
          if (peers.has(device.id)) peers.get(device.id).ws.close(4000, 'Device reconnected');
          identity = { user, device, ws, token: data.token, alive: () => alive, ping: () => { alive = false; ws.ping(); } };
          peers.set(device.id, identity);
          clearTimeout(authTimer);
          send(ws, { type: 'ready', deviceId: device.id });
          await broadcast(user.id); return;
        }
        if (peers.get(identity.device.id)?.ws !== ws) throw fail(403, 'Device connection was replaced.');
        if (!Number.isSafeInteger(data.seq) || data.seq !== sequence + 1 || !data.data || !await trust.verify(identity.device.publicKey, trust.envelope(socketChallenge, identity.user.id, identity.device.id, data.seq, data.data), data.signature)) throw fail(403, 'Invalid or replayed device proof.');
        sequence = data.seq; data = data.data;
        if (!await store.authenticate(identity.token)) { ws.close(4001, 'Session expired'); return; }
        if (peers.get(identity.device.id)?.ws !== ws) throw fail(403, 'Device connection was replaced.');
        if (limited(`ws:${identity.device.id}`, 180, 1000)) throw fail(429, 'Too many messages.');
        if (data.type === 'pair-open') {
          if (identity.device.kind !== 'desktop' || !isId(data.inviteId) || !Number.isSafeInteger(data.expires) || data.expires <= Date.now() || data.expires > Date.now() + 180000) throw fail(400, 'Invalid pairing invitation.');
          if (invites.has(data.inviteId) && invites.get(data.inviteId).desktop !== identity.device.id) throw fail(403, 'Pairing invitation is unavailable.');
          for (const [id, invite] of invites) if (invite.desktop === identity.device.id) invites.delete(id);
          invites.set(data.inviteId, { desktop: identity.device.id, expires: data.expires }); send(ws, { type: 'pair-opened', inviteId: data.inviteId }); return;
        }
        if (data.type === 'pair-request') {
          if (identity.device.kind !== 'controller' || !isId(data.requestId) || !text(data.proof, 100) || limited(`pair:${identity.user.id}`, 10, 60000)) throw fail(400, 'Invalid pairing request or too many attempts.');
          const invite = invites.get(data.inviteId); const host = peers.get(invite?.desktop);
          if (!invite || invite.expires <= Date.now() || !host || host.user.id !== identity.user.id) throw fail(403, 'Pairing link expired or Mac unavailable. Create a new link on your Mac.');
          if (pairRequests.has(data.requestId) || [...pairRequests.values()].filter(r => r.desktop === host.device.id).length >= 5) throw fail(409, 'Pairing is busy. Try again shortly.');
          pairRequests.set(data.requestId, { desktop: host.device.id, controller: identity.device.id, inviteId: data.inviteId, expires: invite.expires });
          send(host.ws, { type: 'pair-request', requestId: data.requestId, inviteId: data.inviteId, peerId: identity.device.id, name: identity.device.name, publicKey: identity.device.publicKey, proof: data.proof }); return;
        }
        if (['pair-approve', 'pair-decline'].includes(data.type)) {
          const pending = pairRequests.get(data.requestId); const invite = invites.get(pending?.inviteId);
          if (!pending || pending.desktop !== identity.device.id || !invite || invite.expires <= Date.now()) throw fail(403, 'Pairing request expired.');
          if (data.type === 'pair-decline') {
            pairRequests.delete(data.requestId); send(peers.get(pending.controller)?.ws, { type: 'pair-declined', requestId: data.requestId }); return;
          }
          const controller = peers.get(pending.controller); const grant = data.grant;
          if (!controller || !grant || !isId(grant.id) || grant.userId !== identity.user.id || grant.desktopId !== pending.desktop || grant.controllerId !== pending.controller || grant.inviteId !== pending.inviteId || grant.requestId !== data.requestId || await trust.keyId(grant.desktopKey) !== pending.desktop || await trust.keyId(grant.controllerKey) !== pending.controller || !await trust.verify(identity.device.publicKey, trust.grantText(grant), data.signature)) throw fail(403, 'Invalid pairing approval.');
          // Consume before awaiting the database: simultaneous approval cannot reuse the invitation.
          invites.delete(pending.inviteId);
          for (const [id, request] of pairRequests) if (request.inviteId === pending.inviteId) pairRequests.delete(id);
          for (const [id, session] of sessions) if (session.desktop === pending.desktop && session.controller === pending.controller) finish(id, 'Device paired again');
          await store.pair(grant);
          const epochKey = pairKey(grant.desktopId, grant.controllerId); pairEpochs.set(epochKey, (pairEpochs.get(epochKey) || 0) + 1);
          send(controller.ws, { type: 'paired', grant, signature: data.signature, name: identity.device.name });
          send(ws, { type: 'paired', grant, signature: data.signature, name: controller.device.name }); return;
        }
        if (data.type === 'revoke') {
          if (!isId(data.grantId)) throw fail(400, 'Invalid trusted device.');
          revoking.add(data.grantId);
          let pair;
          try { pair = await store.unpair(data.grantId, identity.device.id); }
          finally { revoking.delete(data.grantId); }
          if (!pair) throw fail(403, 'Trusted device is unavailable.');
          const epochKey = pairKey(pair.desktop_id, pair.controller_id); pairEpochs.set(epochKey, (pairEpochs.get(epochKey) || 0) + 1);
          for (const [id, session] of sessions) if (session.grantId === data.grantId) finish(id, 'Device trust revoked');
          for (const id of [pair.desktop_id, pair.controller_id]) send(peers.get(id)?.ws, { type: 'revoked', grantId: data.grantId }); return;
        }
        if (data.type === 'connect') {
          if (identity.device.kind !== 'controller') throw fail(403, 'Only a controller can request access.');
          const desktop = peers.get(data.targetId);
          if (!desktop || desktop.device.kind !== 'desktop' || desktop.user.id !== identity.user.id) throw fail(404, 'Mac is offline or unavailable.');
          const epochKey = pairKey(desktop.device.id, identity.device.id); const epoch = pairEpochs.get(epochKey) || 0;
          const pair = await store.pairing(desktop.device.id, identity.device.id);
          if (!pair || revoking.has(pair.id)) throw fail(403, 'Pair this phone with your Mac before connecting.');
          if (!text(data.controllerNonce, 100) || trust.unb64(data.controllerNonce).length !== 32 || !await trust.verify(identity.device.publicKey, trust.sessionRequest(identity.user.id, pair.id, desktop.device.id, identity.device.id, data.controllerNonce), data.requestSignature)) throw fail(403, 'Controller session proof is required.');
          if (revoking.has(pair.id) || epoch !== (pairEpochs.get(epochKey) || 0)) throw fail(403, 'Device trust changed. Pair again before connecting.');
          if (peers.get(desktop.device.id)?.ws !== desktop.ws || peers.get(identity.device.id)?.ws !== ws) throw fail(409, 'Device reconnected. Try again.');
          if ([...sessions.values()].some(s => [s.desktop, s.controller].includes(desktop.device.id) || [s.desktop, s.controller].includes(identity.device.id))) throw fail(409, 'A device already has a pending or active session.');
          const id = randomUUID();
          const timer = setTimeout(() => finish(id, 'Approval timed out'), 60000);
          sessions.set(id, { desktop: desktop.device.id, controller: identity.device.id, approved: false, timer, grantId: pair.id, controllerNonce: data.controllerNonce });
          send(ws, { type: 'pending', sessionId: id, name: desktop.device.name, peerId: desktop.device.id, grantId: pair.id, controllerNonce: data.controllerNonce });
          send(desktop.ws, { type: 'request', sessionId: id, name: identity.device.name, peerId: identity.device.id, grantId: pair.id, controllerNonce: data.controllerNonce, requestSignature: data.requestSignature }); return;
        }
        const session = sessions.get(data.sessionId);
        if (!session || ![session.desktop, session.controller].includes(identity.device.id)) throw fail(403, 'Session is unavailable.');
        if (data.type === 'approve') {
          if (session.desktop !== identity.device.id || session.approved) throw fail(403, 'Only the Mac can approve a pending request.');
          if (data.allowed !== true) { finish(data.sessionId, data.failure === 'capture' ? 'Screen capture failed on the Mac. Check the Mac app for permission and display instructions.' : data.failure === 'setup' ? 'Mac setup failed. Check the Mac app for instructions.' : 'Mac declined the connection'); return; }
          if (!text(data.desktopNonce, 100) || trust.unb64(data.desktopNonce).length !== 32 || !await trust.verify(identity.device.publicKey, trust.sessionApproval(data.sessionId, identity.user.id, session.grantId, session.desktop, session.controller, session.controllerNonce, data.desktopNonce), data.approvalSignature)) throw fail(403, 'Mac session proof is required.');
          if (sessions.get(data.sessionId) !== session || revoking.has(session.grantId)) throw fail(403, 'Session is unavailable.');
          clearTimeout(session.timer); session.approved = true; session.desktopNonce = data.desktopNonce;
          for (const id of [session.desktop, session.controller]) send(peers.get(id)?.ws, { type: 'approved', sessionId: data.sessionId, desktopNonce: data.desktopNonce, approvalSignature: data.approvalSignature }); return;
        }
        if (data.type === 'end') { finish(data.sessionId); return; }
        if (data.type === 'signal') {
          if (!session.approved) throw fail(403, 'Mac approval is required.');
          if (!data.signal || typeof data.signal !== 'object' || !['offer', 'answer', 'ice'].includes(data.signal.type)) throw fail(400, 'Invalid signal.');
          if ((data.signal.type === 'offer' && identity.device.id !== session.desktop) || (data.signal.type === 'answer' && identity.device.id !== session.controller)) throw fail(403, 'Unexpected negotiation role.');
          if (!Number.isSafeInteger(data.seq) || data.seq < 1 || !text(data.signature, 100) || !await trust.verify(identity.device.publicKey, trust.signalText(data.sessionId, session.grantId, identity.device.id, data.seq, data.signal, session.controllerNonce + '.' + session.desktopNonce), data.signature)) throw fail(403, 'Invalid peer identity signature.');
          if (sessions.get(data.sessionId) !== session || revoking.has(session.grantId)) throw fail(403, 'Session is unavailable.');
          const recipient = session.desktop === identity.device.id ? session.controller : session.desktop;
          send(peers.get(recipient)?.ws, { type: 'signal', sessionId: data.sessionId, signal: data.signal, seq: data.seq, signature: data.signature }); return;
        }
        throw fail(400, 'Unknown message.');
      } catch (error) { send(ws, { type: 'error', message: error.status ? error.message : 'Invalid message.' }); if (!identity) ws.close(4001, 'Authentication failed'); }
    }
    ws.on('message', (raw, binary) => {
      if (++queued > 200) { ws.close(4008, 'Too many pending messages'); return; }
      serial = serial.then(() => ws.readyState === 1 ? onMessage(raw, binary) : undefined).catch(() => ws.close(1011, 'Service error')).finally(() => { queued--; });
    });
    ws.on('close', code => {
      clearTimeout(authTimer);
      if (!identity || peers.get(identity.device.id)?.ws !== ws) return;
      peers.delete(identity.device.id);
      for (const [id, invite] of invites) if (invite.desktop === identity.device.id) invites.delete(id);
      for (const [id, request] of pairRequests) if ([request.desktop, request.controller].includes(identity.device.id)) pairRequests.delete(id);
      for (const [id, session] of sessions) {
        if (![session.desktop, session.controller].includes(identity.device.id)) continue;
        if (!session.approved || closing || code === 4001) { finish(id, code === 4001 ? 'Signed out' : 'Device disconnected'); continue; }
        // The peer-to-peer link can outlive the signaling socket. Hold the session briefly for this device to return.
        clearTimeout(session.awayTimer); session.away = identity.device.id;
        session.awayTimer = setTimeout(() => finish(id, 'Device disconnected'), sessionGraceMs);
      }
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
    for (const key of pairEpochs.keys()) if (key.split(':').every(id => !peers.has(id))) pairEpochs.delete(key);
    for (const collection of [challenges, invites, pairRequests]) for (const [key, value] of collection) if (value.expires <= Date.now()) collection.delete(key);
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
