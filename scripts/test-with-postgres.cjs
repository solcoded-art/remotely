// Every invocation gets its own disposable container; production DATABASE_URL is ignored.
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  let name; let mailbox;
  let cleaned = false;
  const cleanup = () => {
    if (mailbox) { fs.rmSync(mailbox, { recursive: true, force: true }); mailbox = undefined; }
    if (name && !cleaned) { cleaned = true; try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch {} }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  try {
    let url = process.env.TEST_DATABASE_URL;
    if (!url) {
      name = `ios-remote-test-${randomUUID().slice(0, 8)}`;
      execFileSync('docker', ['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=remote_test', '-p', '127.0.0.1::5432', 'postgres:17-alpine'], { stdio: ['ignore', 'ignore', 'inherit'] });
      const port = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').pop();
      url = `postgresql://postgres@127.0.0.1:${port}/remote_test`;
    }
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const client = new Client({ connectionString: url, connectionTimeoutMillis: 1000 });
      try { await client.connect(); await client.query('SELECT 1'); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
      finally { await client.end().catch(() => {}); }
    }
    if (!ready) throw Error('Disposable PostgreSQL did not become ready.');
    console.log('Testing against disposable PostgreSQL.');
    const args = process.argv.slice(2);
    mailbox = fs.mkdtempSync(path.join(os.tmpdir(), 'remotely-test-mail-'));
    const testEnv = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, HOST: '127.0.0.1', TEST_MAILBOX_DIR: mailbox };
    // Tests use injected mail fakes; never inherit a production sender or auth secret.
    for (const key of Object.keys(testEnv)) if (key.startsWith('SMTP_') || ['BETTER_AUTH_SECRET', 'PUBLIC_URL'].includes(key)) delete testEnv[key];
    const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: testEnv });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', value => resolve(value ?? 1)); });
    process.exitCode = code;
  } finally { cleanup(); }
}
main().catch(() => { console.error('Database test setup failed. Start Docker, or supply TEST_DATABASE_URL for an isolated PostgreSQL cluster with CREATE DATABASE permission.'); process.exitCode = 1; });
