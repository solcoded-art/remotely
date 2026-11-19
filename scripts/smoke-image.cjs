const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const id = randomUUID().slice(0, 8);
const network = `remote-smoke-${id}`;
const database = `${network}-db`;
const service = `${network}-app`;
let phase = 'create test network';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function cleanup() {
  for (const name of [service, database]) { try { docker(['rm', '-f', name]); } catch {} }
  try { docker(['network', 'rm', network]); } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
async function main() {
  try {
    docker(['network', 'create', network]);
    phase = 'start test database';
    docker(['run', '-d', '--rm', '--name', database, '--network', network, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=remote_test', 'postgres:17-alpine']);
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { docker(['exec', database, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'remote_test']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    if (!ready) throw Error('Test database did not start.');
    phase = 'start application image';
    docker(['run', '-d', '--rm', '--name', service, '--network', network, '-p', '127.0.0.1::3000', '-e', `DATABASE_URL=postgresql://postgres@${database}:5432/remote_test`, 'ios-remote-ongale:local']);
    const address = () => `http://127.0.0.1:${docker(['port', service, '3000/tcp']).split(':').pop()}`;
    let url = address();
    const healthy = async () => {
      for (let i = 0; i < 40; i++) {
        try { if ((await fetch(url + '/health')).ok) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw Error('Container did not become healthy.');
    };
    phase = 'initial health check'; await healthy();
    phase = 'built client assets';
    const html = await (await fetch(url)).text(); assert.match(html, /<div id="root">/);
    const asset = html.match(/src="([^"]+\.js)"/)[1]; assert.equal((await fetch(new URL(asset, url + '/'))).status, 200);
    assert.equal((await fetch(url + '/api/devices')).status, 401);
    phase = 'production browser render';
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().includes('/assets/') && !response.ok()) errors.push('Asset failed: ' + response.status()); });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
      assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(16, 17, 19)');
      assert.deepEqual(errors, []);
      fs.mkdirSync('artifacts', { recursive: true });
      await page.screenshot({ path: 'artifacts/production-build.png', fullPage: true });
    } finally { await browser.close(); }
    phase = 'account registration';
    const authResponse = await fetch(url + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ email: 'image-test@example.com', password: 'image-smoke-password-123' }) });
    assert.equal(authResponse.status, 200); const auth = await authResponse.json();
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json', Origin: url };
    assert.equal((await fetch(url + '/api/devices', { method: 'POST', headers, body: JSON.stringify({ id: randomUUID(), name: 'Image test Mac', kind: 'desktop' }) })).status, 200);
    phase = 'restart and persistence';
    docker(['restart', service]); url = address(); headers.Origin = url; await healthy();
    const list = await (await fetch(url + '/api/devices', { headers })).json(); assert.equal(list.devices.length, 1);
    console.log('Container smoke passed: health, actual browser rendering of built UI/assets, same-origin API, migrations, and accounts/devices surviving restart.');
  } finally { cleanup(); }
}
main().catch(() => { console.error(`Container smoke failed during: ${phase}. No environment values have been logged.`); process.exitCode = 1; });
