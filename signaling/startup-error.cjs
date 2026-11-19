// Use fixed messages: driver errors can include connection strings or passwords.
const messages = {
  AUTH_SECRET_INVALID: 'BETTER_AUTH_SECRET must be a high-entropy secret of at least 32 characters.',
  SMTP_FROM_INVALID: 'SMTP_FROM_ADDRESS must be an address at SMTP_FROM_DOMAIN.',
  DATABASE_URL_MISSING: 'DATABASE_URL is missing. Copy .env.example to .env and start with npm start.',
  DATABASE_URL_INVALID: 'DATABASE_URL must be a valid PostgreSQL connection URL. Check .env.',
  PUBLIC_URL_INVALID: 'PUBLIC_URL must be a valid HTTP or HTTPS origin, or be left unset for local development.',
  ECONNREFUSED: 'PostgreSQL is not accepting connections. Run npm run db:dev and wait for it to finish.',
  ENOTFOUND: 'A configured hostname could not be resolved. Check DATABASE_URL and HOST.',
  EAI_AGAIN: 'Hostname lookup temporarily failed. Check connectivity and try again.',
  DATABASE_TIMEOUT: 'PostgreSQL connection timed out. Check that Docker and the database are ready.',
  '28P01': 'PostgreSQL rejected the password. Check that .env matches the credentials used to initialize the Docker volume.',
  '28000': 'PostgreSQL rejected the login. Check the database role and authentication configuration.',
  '3D000': 'The configured PostgreSQL database does not exist. Check the database name in DATABASE_URL.',
  '42501': 'The database role lacks permission to create or update the application tables. Check schema permissions.',
  '42P07': 'A migration found existing tables without its migration record. Check the database schema before retrying.',
  '57014': 'Database initialization timed out. Check PostgreSQL load and migration locks, then retry.',
  '57P03': 'PostgreSQL is still starting. Wait for npm run db:dev to finish, then retry npm start.',
  EADDRINUSE: 'The configured server port is already in use. Stop the other server or change PORT.',
  ERR_SOCKET_BAD_PORT: 'PORT must be a valid TCP port number.',
  EPERM: 'The process is not allowed to connect or listen. Check local execution permissions.',
  EACCES: 'The process lacks permission to access a required resource. Check local execution permissions.',
};

function startupMessage(error) {
  const failures = [error, ...(Array.isArray(error?.errors) ? error.errors : [])];
  for (const failure of failures) {
    if (Object.hasOwn(messages, failure?.code)) return `Startup failed: ${messages[failure.code]}`;
    if (failure?.message === 'Connection terminated due to connection timeout') return `Startup failed: ${messages.DATABASE_TIMEOUT}`;
  }
  return 'Startup failed while initializing the account service. Check PostgreSQL connectivity and application migrations.';
}
module.exports = { startupMessage };
