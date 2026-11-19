const { Pool } = require('pg');
const { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');

async function passwordHash(password, salt) {
  return (await derive(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 })).toString('hex');
}

async function createStore(connectionString) {
  if (!connectionString) throw Object.assign(new Error('Database configuration is missing.'), { code: 'DATABASE_URL_MISSING' });
  try {
    if (!['postgres:', 'postgresql:'].includes(new URL(connectionString).protocol)) throw Error();
  } catch { throw Object.assign(new Error('Invalid database configuration.'), { code: 'DATABASE_URL_INVALID' }); }
  // Ongale supplies DATABASE_URL at runtime. Preserve its authentication and SSL settings.
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  pool.on('error', () => console.error('[Database] An idle connection failed; it will be replaced.'));
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(57203709)');
      await client.query('CREATE TABLE IF NOT EXISTS remote_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      const dir = path.join(__dirname, 'migrations');
      for (const name of fs.readdirSync(dir).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
        if ((await client.query('SELECT name FROM remote_schema_migrations WHERE name = $1', [name])).rowCount) continue;
        await client.query(fs.readFileSync(path.join(dir, name), 'utf8'));
        await client.query('INSERT INTO remote_schema_migrations (name) VALUES ($1)', [name]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } catch (error) { await pool.end(); throw error; }
  async function importLegacyAccount(email) {
    // A previous release may register an account while a candidate is starting.
    // Mark the row atomically, so email verification cannot resurrect an old password.
    await pool.query(`WITH promoted AS (UPDATE remote_users SET auth_migrated = TRUE
      WHERE email = $1 AND NOT auth_migrated AND salt IS NOT NULL AND hash IS NOT NULL RETURNING id, salt, hash)
      INSERT INTO remote_auth_accounts (id, account_id, provider_id, user_id, password)
      SELECT id, id, 'credential', id, 'legacy$' || salt || '$' || hash FROM promoted
      ON CONFLICT (provider_id, account_id) DO NOTHING`, [email]);
  }
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = randomBytes(64).toString('hex');
  return {
    pool, importLegacyAccount,
    async register(email, password) {
      const id = randomUUID();
      const salt = randomBytes(16).toString('hex');
      const hash = await passwordHash(password, salt);
      try {
        await pool.query(`WITH added AS (INSERT INTO remote_users (id, email, salt, hash, auth_migrated) VALUES ($1, $2, $4, $5, TRUE) RETURNING id)
          INSERT INTO remote_auth_accounts (id, account_id, provider_id, user_id, password)
          SELECT id, id, 'credential', id, $3 FROM added`, [id, email, `legacy$${salt}$${hash}`, salt, hash]);
      }
      catch (error) {
        if (error.code === '23505') throw Object.assign(new Error('Unable to create this account. Try signing in.'), { status: 409 });
        throw error;
      }
      return { id, email };
    },
    async login(email, password) {
      await importLegacyAccount(email);
      const user = (await pool.query(`SELECT u.id, u.email, a.password FROM remote_users u
        LEFT JOIN remote_auth_accounts a ON a.user_id = u.id AND a.provider_id = 'credential' WHERE u.email = $1`, [email])).rows[0];
      const saved = user?.password;
      let matches = false;
      if (!saved || saved.startsWith('legacy$')) {
        const [, salt, hash] = (saved || '').split('$');
        const actual = await passwordHash(password, salt || dummySalt);
        matches = timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(hash || dummyHash, 'hex'));
      } else {
        const { verifyPassword } = await import('better-auth/crypto');
        matches = await verifyPassword({ password, hash: saved });
      }
      return user && matches ? { id: user.id, email: user.email } : null;
    },
    async issue(userId, remember = false) {
      await pool.query('DELETE FROM remote_sessions WHERE expires <= $1', [Date.now()]);
      const token = randomBytes(32).toString('base64url');
      const expires = Date.now() + (remember ? 30 : 1) * 24 * 60 * 60 * 1000;
      await pool.query('INSERT INTO remote_sessions (hash, user_id, expires) VALUES ($1, $2, $3)', [digest(token), userId, expires]);
      return { token, expires };
    },
    async authenticate(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      return (await pool.query(`SELECT u.id, u.email FROM remote_sessions s JOIN remote_users u ON u.id = s.user_id WHERE s.hash = $1 AND s.expires > $2
        UNION ALL SELECT u.id, u.email FROM remote_auth_sessions s JOIN remote_users u ON u.id = s.user_id WHERE s.token = $3 AND s.expires_at > NOW() LIMIT 1`, [digest(token), Date.now(), token])).rows[0] || null;
    },
    async revoke(token) {
      await pool.query('DELETE FROM remote_sessions WHERE hash = $1', [digest(token)]);
      await pool.query('DELETE FROM remote_auth_sessions WHERE token = $1', [token]);
    },
    async session(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      const user = await this.authenticate(token);
      if (!user) return null;
      const result = await pool.query(`SELECT expires FROM remote_sessions WHERE hash = $1
        UNION ALL SELECT (EXTRACT(EPOCH FROM expires_at) * 1000)::BIGINT FROM remote_auth_sessions WHERE token = $2 LIMIT 1`, [digest(token), token]);
      return { user, token, expires: Number(result.rows[0].expires) };
    },
    async freshSession(token) {
      return !!(await pool.query(`SELECT 1 FROM remote_auth_sessions WHERE token = $1 AND created_at > NOW() - INTERVAL '5 minutes' AND expires_at > NOW()`, [token])).rowCount;
    },
    async hasPassword(id) { return !!(await pool.query("SELECT 1 FROM remote_auth_accounts WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL", [id])).rowCount; },
    async deleteUser(id) { await pool.query('DELETE FROM remote_users WHERE id = $1', [id]); },
    async registerDevice(id, userId, name, kind, publicKey) {
      const result = await pool.query(`INSERT INTO remote_devices (id, user_id, name, kind, public_key) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name
        WHERE remote_devices.user_id = EXCLUDED.user_id AND remote_devices.kind = EXCLUDED.kind AND remote_devices.public_key = EXCLUDED.public_key
        RETURNING id, name, kind, public_key AS "publicKey"`, [id, userId, name, kind, JSON.stringify(publicKey)]);
      if (!result.rowCount) throw Object.assign(new Error('Device does not belong to this account.'), { status: 403 });
      return result.rows[0];
    },
    async device(id) { return (await pool.query('SELECT *, public_key AS "publicKey" FROM remote_devices WHERE id = $1', [id])).rows[0]; },
    async devices(userId) { return (await pool.query('SELECT id, name, kind, public_key AS "publicKey" FROM remote_devices WHERE user_id = $1 ORDER BY name', [userId])).rows; },
    async pair(grant) {
      await pool.query(`INSERT INTO remote_trust (id, user_id, desktop_id, controller_id, document)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (desktop_id, controller_id)
        DO UPDATE SET id = EXCLUDED.id, document = EXCLUDED.document`, [grant.id, grant.userId, grant.desktopId, grant.controllerId, JSON.stringify(grant)]);
    },
    async pairing(desktop, controller) { return (await pool.query('SELECT id, document FROM remote_trust WHERE desktop_id = $1 AND controller_id = $2', [desktop, controller])).rows[0]; },
    async unpair(id, deviceId) { return (await pool.query('DELETE FROM remote_trust WHERE id = $1 AND (desktop_id = $2 OR controller_id = $2) RETURNING *', [id, deviceId])).rows[0]; },
    async close() { await pool.end(); },
  };
}
module.exports = { createStore, passwordHash };
