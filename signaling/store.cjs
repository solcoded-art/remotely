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
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = randomBytes(64).toString('hex');
  return {
    async register(email, password) {
      const id = randomUUID();
      const salt = randomBytes(16).toString('hex');
      const hash = await passwordHash(password, salt);
      try { await pool.query('INSERT INTO remote_users (id, email, salt, hash) VALUES ($1, $2, $3, $4)', [id, email, salt, hash]); }
      catch (error) {
        if (error.code === '23505') throw Object.assign(new Error('Unable to create this account. Try signing in.'), { status: 409 });
        throw error;
      }
      return { id, email };
    },
    async login(email, password) {
      const user = (await pool.query('SELECT * FROM remote_users WHERE email = $1', [email])).rows[0];
      const actual = await passwordHash(password, user?.salt || dummySalt);
      const matches = timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(user?.hash || dummyHash, 'hex'));
      return user && matches ? { id: user.id, email: user.email } : null;
    },
    async issue(userId) {
      await pool.query('DELETE FROM remote_sessions WHERE expires <= $1', [Date.now()]);
      const token = randomBytes(32).toString('base64url');
      const expires = Date.now() + 24 * 60 * 60 * 1000;
      await pool.query('INSERT INTO remote_sessions (hash, user_id, expires) VALUES ($1, $2, $3)', [digest(token), userId, expires]);
      return { token, expires };
    },
    async authenticate(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      return (await pool.query('SELECT u.id, u.email FROM remote_sessions s JOIN remote_users u ON u.id = s.user_id WHERE s.hash = $1 AND s.expires > $2', [digest(token), Date.now()])).rows[0] || null;
    },
    async revoke(token) { await pool.query('DELETE FROM remote_sessions WHERE hash = $1', [digest(token)]); },
    async deleteUser(id) { await pool.query('DELETE FROM remote_users WHERE id = $1', [id]); },
    async registerDevice(id, userId, name, kind) {
      const result = await pool.query(`INSERT INTO remote_devices (id, user_id, name, kind) VALUES ($1, $2, $3, $4)
        ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name
        WHERE remote_devices.user_id = EXCLUDED.user_id AND remote_devices.kind = EXCLUDED.kind
        RETURNING id, name, kind`, [id, userId, name, kind]);
      if (!result.rowCount) throw Object.assign(new Error('Device does not belong to this account.'), { status: 403 });
      return result.rows[0];
    },
    async device(id) { return (await pool.query('SELECT * FROM remote_devices WHERE id = $1', [id])).rows[0]; },
    async devices(userId) { return (await pool.query('SELECT id, name, kind FROM remote_devices WHERE user_id = $1 ORDER BY name', [userId])).rows; },
    async close() { await pool.end(); },
  };
}
module.exports = { createStore };
