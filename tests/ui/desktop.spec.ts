import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('native desktop shell boots with isolated renderer and authenticated API access', async () => {
  test.skip(process.platform !== 'darwin', 'The native Mac companion requires macOS.');
  const fs = await import('node:fs/promises'); const os = await import('node:os');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'remotely-desktop-auth-'));
  const profileArg = '--user-data-dir=' + profile;
  const app = await electron.launch({ ...(process.env.MAC_APP_EXECUTABLE ? { executablePath: process.env.MAC_APP_EXECUTABLE, args: [profileArg] } : { args: [path.resolve('.'), profileArg] }), env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as unknown as Record<string, string> });
  try {
    expect(await fs.realpath(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(await fs.realpath(profile));
    const page = await app.firstWindow();
    await expect(page.getByText('Mac app', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(await page.evaluate(() => (window as any).macRemote.platform)).toBe('mac');
    await page.getByRole('button', { name: 'Advanced connection settings' }).click();
    await page.getByLabel('Account server URL').fill('http://127.0.0.1:3000');
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Email address').fill(`native-${Date.now()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('native-test-password-123');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Share your workspace' })).toBeVisible();
    const denied = await page.evaluate(async () => {
      try { await (window as any).macRemote.command('unapproved-session', { action: 'type', text: 'must not type' }); return false; }
      catch { return true; }
    });
    expect(denied).toBe(true);
    await page.reload();
    await expect(page.getByText('Signed in', { exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Account settings' }).click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await page.reload(); await expect(page.getByLabel('Email address')).toBeVisible();
    await page.screenshot({ path: 'artifacts/desktop-auth-logout.png', fullPage: true });
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
});

test('native capture policy accepts Electron origin serialization without capturing the physical screen', async () => {
  test.skip(process.platform !== 'darwin', 'The native origin regression requires Electron on macOS.');
  const fs = await import('node:fs/promises'); const os = await import('node:os');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remotely-capture-test-'));
  const main = path.join(root, 'main.cjs');
  await fs.writeFile(main, `
    const { app, protocol, BrowserWindow, session } = require('electron');
    const { createDisplayCaptureHandler } = require(${JSON.stringify(path.resolve('desktop/display-capture.cjs'))});
    protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
    global.probe = { approved: false, enumerations: 0, events: [] };
    app.whenReady().then(async () => {
      protocol.handle('app', () => new Response('<button onclick="navigator.mediaDevices.getDisplayMedia({video:true,audio:false}).catch(e=>{document.body.dataset.attempt=String(Number(document.body.dataset.attempt||0)+1)})">Request capture</button>', {headers:{'Content-Type':'text/html'}}));
      const window = new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(permission === 'display-capture'));
      const handler = createDisplayCaptureHandler(
        () => ({ sessionId: global.probe.approved ? 'approved-session' : null, sourceId: 'synthetic-screen', frame: window.webContents.mainFrame }),
        async () => { global.probe.enumerations++; return [{id:'synthetic-screen',name:'Synthetic display'}]; }
      );
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => handler(request, streams => {
        global.probe.events.push({ origin: request.securityOrigin, selected: streams.video?.id || null });
        callback({}); // Always deny OS capture; no real screen is requested or shared.
      }));
      await window.loadURL('app://macremote/');
    });
    app.on('window-all-closed', () => app.quit());
  `);
  let app;
  try {
    app = await electron.launch({ args: [main], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as unknown as Record<string, string> });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Request capture' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-attempt', '1');
    expect(await app.evaluate(() => (globalThis as any).probe.enumerations)).toBe(0);
    await app.evaluate(() => { (globalThis as any).probe.approved = true; });
    await page.getByRole('button', { name: 'Request capture' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-attempt', '2');
    const events = await app.evaluate(() => (globalThis as any).probe.events) as { origin: string; selected: string | null }[];
    expect(events.every(event => event.origin === 'app://macremote/')).toBe(true);
    expect(events.filter(event => event.selected)).toEqual([{ origin: 'app://macremote/', selected: 'synthetic-screen' }]);
    expect(await app.evaluate(() => (globalThis as any).probe.enumerations)).toBe(1);
  } finally { await app?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
