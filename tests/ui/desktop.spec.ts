import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('native desktop shell boots with isolated renderer and authenticated API access', async () => {
  test.skip(process.platform !== 'darwin', 'The native Mac companion requires macOS.');
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } as unknown as Record<string, string> });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('Mac companion', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(await page.evaluate(() => (window as any).macRemote.platform)).toBe('mac');
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await page.getByLabel('Email address').fill(`native-${Date.now()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('native-test-password-123');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByText('Account connected', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Share your workspace' })).toBeVisible();
    const denied = await page.evaluate(async () => {
      try { await (window as any).macRemote.command('unapproved-session', { action: 'type', text: 'must not type' }); return false; }
      catch { return true; }
    });
    expect(denied).toBe(true);
    await page.screenshot({ path: 'artifacts/desktop-companion.png', fullPage: true });
  } finally { await app.close(); }
});
