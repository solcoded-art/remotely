const { _electron: electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
async function main() {
  if (process.platform !== 'darwin') throw Error('The packaged Mac smoke test requires macOS.');
  const appPath = path.resolve(process.argv[2] || 'release/mac-arm64/Mac Remote.app');
  const app = await electron.launch({ executablePath: path.join(appPath, 'Contents/MacOS/Mac Remote'), env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.macRemote.info()).driverReady);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.sandbox, true);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Geist Variable' && font.status === 'loaded')), true);
    await page.getByRole('button', { name: 'Advanced connection settings' }).click();
    assert.equal(await page.getByLabel('Account server URL').inputValue(), 'https://enftify.com');
    const denied = await page.evaluate(async () => { try { await window.macRemote.command('unapproved-session', { action: 'type', text: 'must not type' }); return false; } catch { return true; } });
    assert.equal(denied, true);
    console.log('Packaged launch, helper, renderer isolation, bundled font, server default, and approval boundary passed.');
  } finally { await app.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
