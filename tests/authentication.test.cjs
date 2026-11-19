const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { once } = require('node:events');
const { createService } = require('../signaling/service.cjs');
const { createAuthSessionStore } = require('../desktop/auth-session.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function fixture(t, extra = {}) {
 const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await admin.connect();
 const name = 'auth_test_' + randomUUID().replaceAll('-', ''); await admin.query(`CREATE DATABASE ${name}`);
 const databaseURL = new URL(process.env.TEST_DATABASE_URL); databaseURL.pathname = '/' + name;
 const mails = []; const options = { enableMagicLinks: true, databaseURL: databaseURL.toString(), publicURL: 'http://127.0.0.1:3000', authSecret: randomBytes(48).toString('base64url'), sendMail: async mail => { mails.push(mail); }, ...extra };
 if (extra.prepare) await extra.prepare(databaseURL.toString());
 let service = await createService(options); service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
 let url = `http://127.0.0.1:${service.server.address().port}`;
 const db = new Client({ connectionString: databaseURL.toString() }); await db.connect();
 t.after(async () => { await service.close(); await db.end(); await admin.query(`DROP DATABASE ${name}`); await admin.end(); });
 const api = async (route, data, headers = {}, method) => {
  const response = await fetch(url + route, { method: method || (data ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
 };
 const restart = async (changes = {}) => { Object.assign(options, changes); await service.close(); service = await createService(options); service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening'); url = `http://127.0.0.1:${service.server.address().port}`; };
 return { api, mails, db, restart };
}
const password = 'account-test-password-123';
const linkToken = mail => new URL(mail.url).hash.slice('#sign-in='.length);

test('Better Auth password sessions survive restart, use HttpOnly cookies, and revoke on logout', async t => {
 const { api, restart } = await fixture(t);
 const signed = await api('/api/auth/register', { email: 'persistent@example.com', password, remember: true });
 assert.equal(signed.status, 200); assert.ok(signed.data.token); assert.match(signed.cookie, /HttpOnly/); assert.match(signed.cookie, /SameSite=Lax/); assert.ok(signed.data.expires > Date.now() + 29 * 86400000);
 const cookie = signed.cookie.split(';')[0]; await restart();
 const restored = await api('/api/auth/session', null, { Cookie: cookie }); assert.equal(restored.status, 200); assert.equal(restored.data.user.id, signed.data.user.id);
 assert.equal((await api('/api/auth/session', null, { Cookie: cookie, Origin: 'https://attacker.invalid' })).status, 403);
 assert.equal((await api('/api/auth/logout', {}, { Cookie: cookie })).status, 200);
 assert.equal((await api('/api/auth/session', null, { Cookie: cookie })).status, 401);
 assert.equal((await api('/api/me', null, { Authorization: 'Bearer ' + signed.data.token })).status, 401);
});

test('magic links are hashed, expire, consume atomically once and create passwordless accounts', async t => {
 const { api, mails, db } = await fixture(t);
 assert.equal((await api('/api/auth/config')).data.magicLink, true);
 const sent = await api('/api/auth/magic-link', { email: 'owner@example.com', callbackURL: 'https://attacker.invalid' }); assert.equal(sent.status, 200); assert.equal(mails.length, 1);
 assert.equal(new URL(mails[0].url).origin, 'http://127.0.0.1:3000'); const token = linkToken(mails[0]);
 const saved = (await db.query('SELECT * FROM remote_auth_verifications')).rows; assert.ok(saved.length); assert.ok(!JSON.stringify(saved).includes(token));
 assert.equal((await api('/api/auth/verify-link', { token, email: 'different@example.com' })).status, 400);
 const results = await Promise.all([api('/api/auth/verify-link', { token, email: 'owner@example.com' }), api('/api/auth/verify-link', { token, email: 'owner@example.com' })]);
 assert.deepEqual(results.map(r => r.status).sort(), [200, 400]); const signed = results.find(r => r.status === 200).data;
 assert.equal(signed.hasPassword, false); assert.equal(signed.user.email, 'owner@example.com');
 assert.equal((await api('/api/auth/verify-link', { token, email: 'owner@example.com' })).status, 400);
 await api('/api/auth/magic-link', { email: 'expire@example.com' });
 await db.query("UPDATE remote_auth_verifications SET expires_at = NOW() - INTERVAL '1 minute'");
 assert.equal((await api('/api/auth/verify-link', { token: linkToken(mails.at(-1)), email: mails.at(-1).email })).status, 400);
 const auth = { Authorization: 'Bearer ' + signed.token };
 assert.equal((await api('/api/account', { confirmEmail: 'wrong@example.com' }, auth, 'DELETE')).status, 403);
 await db.query("UPDATE remote_auth_sessions SET created_at = NOW() - INTERVAL '6 minutes' WHERE token = $1", [signed.token]);
 assert.equal((await api('/api/account', { confirmEmail: signed.user.email }, auth, 'DELETE')).status, 403);
 await api('/api/auth/magic-link', { email: signed.user.email });
 const fresh = await api('/api/auth/verify-link', { token: linkToken(mails.at(-1)), email: signed.user.email }); assert.equal(fresh.status, 200);
 assert.equal((await api('/api/account', { confirmEmail: signed.user.email }, { Authorization: 'Bearer ' + fresh.data.token }, 'DELETE')).status, 200);
 assert.equal((await api('/api/me', null, auth)).status, 401);
});

test('first inbox verification revokes unproven passwords and old sessions while preserving device records', async t => {
 const { api, mails, db, restart } = await fixture(t, { authSecret: '' });
 const old = await api('/api/auth/register', { email: 'legacy@example.com', password, remember: true }); assert.equal(old.status, 200);
 await db.query("INSERT INTO remote_devices (id, user_id, name, kind) VALUES ('legacy-device-1234', $1, 'Existing Mac', 'desktop')", [old.data.user.id]);
 assert.equal((await api('/api/auth/config')).data.magicLink, false);
 assert.equal((await api('/api/auth/session', null, { Cookie: old.cookie.split(';')[0] })).status, 200);
 assert.equal((await api('/api/auth/magic-link', { email: 'legacy@example.com' })).status, 503);
 await restart({ authSecret: randomBytes(48).toString('base64url') });
 const passwordLogin = await api('/api/auth/login', { email: 'legacy@example.com', password, remember: true }); assert.equal(passwordLogin.status, 200); assert.equal(passwordLogin.data.user.id, old.data.user.id);
 assert.equal((await api('/api/auth/magic-link', { email: 'legacy@example.com' })).status, 200);
 const verified = await api('/api/auth/verify-link', { token: linkToken(mails.at(-1)), email: mails.at(-1).email }); assert.equal(verified.status, 200); assert.equal(verified.data.user.id, old.data.user.id);
 assert.equal((await api('/api/me', null, { Authorization: 'Bearer ' + old.data.token })).status, 401);
 assert.equal((await api('/api/me', null, { Authorization: 'Bearer ' + passwordLogin.data.token })).status, 401);
 assert.equal((await api('/api/auth/login', { email: 'legacy@example.com', password })).status, 401);
 assert.equal((await db.query('SELECT id FROM remote_devices WHERE user_id = $1', [old.data.user.id])).rowCount, 1);
});

test('known disposable domains are flagged privately, SMTP absence is explicit, and requests are bounded', async t => {
 const { api, db, mails } = await fixture(t);
 assert.equal((await api('/api/auth/register', { email: 'spam@mailinator.com', password })).status, 400);
 assert.equal((await api('/api/auth/magic-link', { email: 'spam@mailinator.com' })).status, 400);
 const flag = (await db.query('SELECT * FROM remote_auth_email_flags')).rows[0]; assert.equal(flag.reason, 'disposable_domain'); assert.ok(!JSON.stringify(flag).includes('spam@')); assert.equal(mails.length, 0);
 for (let i = 0; i < 3; i++) assert.equal((await api('/api/auth/magic-link', { email: 'rate@example.com' })).status, 200);
 assert.equal((await api('/api/auth/magic-link', { email: 'rate@example.com' })).status, 429);
 assert.equal((await api('/api/auth/magic-link', { email: 'bad\r\nmail@example.com' })).status, 400);
});

test('native session store persists encrypted data, scopes servers, rejects plaintext fallback and clears on sign-out', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-auth-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value).reverse(), decryptStringAsync: async value => ({ result: Buffer.from(value).reverse().toString() }) };
 const token = randomBytes(32).toString('base64url'); const value = { token, expires: Date.now() + 100000 };
 const store = createAuthSessionStore(root, safeStorage); await store('https://one.example', value);
 const file = (await fs.readdir(root))[0]; assert.ok(!(await fs.readFile(path.join(root, file), 'utf8')).includes(token));
 assert.deepEqual(await createAuthSessionStore(root, safeStorage)('https://one.example'), value); assert.equal(await store('https://two.example'), null);
 await assert.rejects(() => store('https://one.example/path', value), /Invalid account/);
 const locked = createAuthSessionStore(root, { ...safeStorage, isAsyncEncryptionAvailable: async () => false }); await assert.rejects(() => locked('https://one.example', value), /Keychain/);
 await store('https://one.example', null); assert.equal(await store('https://one.example'), null);
});


test('original salted-password database upgrades without changing account or device IDs', async t => {
 const id = randomUUID(); const salt = randomBytes(16).toString('hex');
 const { passwordHash } = require('../signaling/store.cjs'); const hash = await passwordHash(password, salt);
 const { api, db } = await fixture(t, { prepare: async databaseURL => {
   const db = new Client({ connectionString: databaseURL }); await db.connect();
   try {
    await db.query(await fs.readFile(path.resolve('signaling/migrations/001_initial.sql'), 'utf8'));
    await db.query("CREATE TABLE remote_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); INSERT INTO remote_schema_migrations (name) VALUES ('001_initial.sql')");
    await db.query('INSERT INTO remote_users (id, email, salt, hash) VALUES ($1, $2, $3, $4)', [id, 'migrated@example.com', salt, hash]);
    await db.query("INSERT INTO remote_devices (id, user_id, name, kind) VALUES ('original-device-123', $1, 'Original Mac', 'desktop')", [id]);
   } finally { await db.end(); }
 } });
 const signed = await api('/api/auth/login', { email: 'migrated@example.com', password, remember: true }); assert.equal(signed.status, 200); assert.equal(signed.data.user.id, id);
 const devices = await api('/api/devices', null, { Authorization: 'Bearer ' + signed.data.token }); assert.equal(devices.data.devices[0].id, 'original-device-123');
 const lateId = randomUUID();
 await db.query('INSERT INTO remote_users (id, email, salt, hash) VALUES ($1, $2, $3, $4)', [lateId, 'rolling@example.com', salt, hash]);
 const late = await api('/api/auth/login', { email: 'rolling@example.com', password }); assert.equal(late.status, 200); assert.equal(late.data.user.id, lateId);
});


test('magic links require explicit rollout and a mailer; delivery failures never report success', async t => {
 const gated = await fixture(t, { enableMagicLinks: false });
 assert.equal((await gated.api('/api/auth/config')).data.magicLink, false);
 assert.equal((await gated.api('/api/auth/magic-link', { email: 'disabled@example.com' })).status, 503); assert.equal(gated.mails.length, 0);
 const missing = await fixture(t, { sendMail: null });
 assert.equal((await missing.api('/api/auth/config')).data.magicLink, false);
 assert.equal((await missing.api('/api/auth/register', { email: 'still-works@example.com', password, remember: true })).status, 200);
 const failing = await fixture(t, { sendMail: async () => { throw Error('Synthetic delivery failure'); } });
 const sent = await failing.api('/api/auth/magic-link', { email: 'send-fails@example.com' }); assert.equal(sent.status, 503); assert.ok(!JSON.stringify(sent.data).includes('Synthetic'));
});
