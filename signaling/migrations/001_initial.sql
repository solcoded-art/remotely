CREATE TABLE remote_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL
);

CREATE TABLE remote_sessions (
    hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES remote_users(id) ON DELETE CASCADE,
    expires BIGINT NOT NULL
);
CREATE INDEX remote_sessions_user ON remote_sessions(user_id);
CREATE INDEX remote_sessions_expiry ON remote_sessions(expires);

CREATE TABLE remote_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES remote_users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('desktop', 'controller'))
);
CREATE INDEX remote_devices_user ON remote_devices(user_id);
