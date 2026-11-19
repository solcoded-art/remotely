-- Password authentication is intentionally retired. Keep account and device identities.
UPDATE remote_auth_accounts SET password = NULL WHERE password IS NOT NULL;
DELETE FROM remote_auth_accounts WHERE provider_id = 'credential';
DELETE FROM remote_auth_sessions WHERE user_id IN (SELECT id FROM remote_users WHERE NOT email_verified);
DROP TABLE remote_sessions;
ALTER TABLE remote_users DROP COLUMN salt;
ALTER TABLE remote_users DROP COLUMN hash;
ALTER TABLE remote_users DROP COLUMN auth_migrated;
-- Better Auth's core schema retains this optional column; credential storage is forbidden.
ALTER TABLE remote_auth_accounts ADD CONSTRAINT remote_no_password CHECK (password IS NULL);
ALTER TABLE remote_auth_accounts ADD CONSTRAINT remote_no_credential_provider CHECK (provider_id <> 'credential');
