-- Additive auth migration: preserve account and device IDs.
ALTER TABLE remote_users ALTER COLUMN salt DROP NOT NULL;
ALTER TABLE remote_users ALTER COLUMN hash DROP NOT NULL;
ALTER TABLE remote_users ADD COLUMN auth_migrated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE remote_users ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE remote_users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE remote_users ADD COLUMN image TEXT;
ALTER TABLE remote_users ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE remote_users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE TABLE remote_auth_sessions (
 id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL,
 user_id TEXT NOT NULL REFERENCES remote_users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 ip_address TEXT, user_agent TEXT
);
CREATE INDEX remote_auth_sessions_user ON remote_auth_sessions(user_id);
CREATE TABLE remote_auth_accounts (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES remote_users(id) ON DELETE CASCADE,
 password TEXT, access_token TEXT, refresh_token TEXT, id_token TEXT,
 access_token_expires_at TIMESTAMPTZ, refresh_token_expires_at TIMESTAMPTZ, scope TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider_id, account_id)
);
CREATE INDEX remote_auth_accounts_user ON remote_auth_accounts(user_id);
CREATE TABLE remote_auth_verifications (
 id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX remote_auth_verifications_identifier ON remote_auth_verifications(identifier);
INSERT INTO remote_auth_accounts (id, account_id, provider_id, user_id, password)
 SELECT id, id, 'credential', id, 'legacy$' || salt || '$' || hash FROM remote_users WHERE salt IS NOT NULL AND hash IS NOT NULL;
UPDATE remote_users SET auth_migrated = TRUE WHERE salt IS NOT NULL AND hash IS NOT NULL;
CREATE TABLE remote_auth_email_flags (
 email_hash TEXT PRIMARY KEY, reason TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
