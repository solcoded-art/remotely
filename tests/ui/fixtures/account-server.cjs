// Test-only entry point. Production server.js never exposes or writes a test mailbox.
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createService } = require('../../../signaling/service.cjs');
async function main() {
 if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || !process.env.TEST_MAILBOX_DIR) throw Error('Use the disposable PostgreSQL test runner.');
 const service = await createService({ publicURL: 'http://127.0.0.1:3000', authSecret: randomBytes(48).toString('base64url'), enableMagicLinks: true,
  sendMail: async ({ email, url }) => {
   const file = path.join(process.env.TEST_MAILBOX_DIR, createHash('sha256').update(email).digest('hex') + '.json');
   await fs.writeFile(file + '.tmp', JSON.stringify({ email, url, id: randomUUID() }), { mode: 0o600 }); await fs.rename(file + '.tmp', file);
  }
 });
 service.server.listen(3000, '127.0.0.1');
 const shutdown = () => service.close().then(() => { process.exitCode = 0; });
 process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
main().catch(() => { console.error('Disposable account server failed.'); process.exitCode = 1; });
