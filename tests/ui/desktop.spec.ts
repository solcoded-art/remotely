import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('native desktop shell boots with isolated renderer and authenticated API access', async () => {
  test.skip(process.platform !== 'darwin', 'The native Mac companion requires macOS.');
  const app = await electron.launch({ ...(process.env.MAC_APP_EXECUTABLE ? { executablePath: process.env.MAC_APP_EXECUTABLE, args: [] } : { args: [path.resolve('.')] }), env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as unknown as Record<string, string> });
  try {
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
    await page.screenshot({ path: 'artifacts/desktop-companion.png', fullPage: true });
  } finally { await app.close(); }
});
