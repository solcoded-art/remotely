-- Existing UUID devices remain visible for upgrade guidance, but cannot authenticate without a key.
ALTER TABLE remote_devices ADD COLUMN public_key JSONB;
CREATE TABLE remote_trust (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES remote_users(id) ON DELETE CASCADE,
    desktop_id TEXT NOT NULL REFERENCES remote_devices(id) ON DELETE CASCADE,
    controller_id TEXT NOT NULL REFERENCES remote_devices(id) ON DELETE CASCADE,
    document JSONB NOT NULL,
    UNIQUE (desktop_id, controller_id)
);
CREATE INDEX remote_trust_user ON remote_trust(user_id);
