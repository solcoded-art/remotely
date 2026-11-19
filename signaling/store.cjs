const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

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
  return {
    pool,
    async authenticate(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      return (await pool.query(`SELECT u.id, u.email FROM remote_auth_sessions s JOIN remote_users u ON u.id = s.user_id
        WHERE s.token = $1 AND s.expires_at > NOW() AND u.email_verified = TRUE`, [token])).rows[0] || null;
    },
    async revoke(token) { await pool.query('DELETE FROM remote_auth_sessions WHERE token = $1', [token]); },
    async session(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      const row = (await pool.query(`SELECT u.id, u.email, (EXTRACT(EPOCH FROM s.expires_at) * 1000)::BIGINT AS expires
        FROM remote_auth_sessions s JOIN remote_users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW() AND u.email_verified = TRUE`, [token])).rows[0];
      return row ? { user: { id: row.id, email: row.email }, token, expires: Number(row.expires) } : null;
    },
    async freshSession(token) {
      return !!(await pool.query(`SELECT 1 FROM remote_auth_sessions s JOIN remote_users u ON u.id = s.user_id
        WHERE s.token = $1 AND s.created_at > NOW() - INTERVAL '5 minutes' AND s.expires_at > NOW() AND u.email_verified = TRUE`, [token])).rowCount;
    },
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
module.exports = { createStore };
