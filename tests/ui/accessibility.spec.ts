import { test, expect } from '@playwright/test';
import { expectAccessible } from './fixtures/accessibility';
import { installMacFixture } from './fixtures/mac';
import { login } from './fixtures/account';

test('login and documentation reflow with enlarged text and expose keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Satoshi' && font.status === 'loaded'))).toBe(true);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Advanced connection settings' }).click();
  await expect(page.getByLabel('Account server URL')).toBeVisible();
  await expectAccessible(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, className: element.className, width: element.getBoundingClientRect().width }))))).toBe(true);
  await page.route('**/api/downloads/mac', route => route.fulfill({ json: { available: false } }));
  await page.goto('/docs/getting-started/');
  await expectAccessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('network failures offer actionable sign-in recovery without discarding email', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/auth/login', route => route.abort('failed'));
  await page.getByLabel('Email address').fill('network-test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-password-long-enough');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Check your internet connection');
  await expect(page.getByLabel('Email address')).toHaveValue('network-test@example.com');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expectAccessible(page);
});

test('Mac checklist detects missing permission and refreshes after returning from Settings', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 620, height: 820 } });
  await installMacFixture(context, { permissions: { accessibility: false, screen: 'denied' } });
  const page = await context.newPage();
  try {
    await login(page, `permissions-${Date.now()}@example.com`, true);
    await expect(page.getByText('Setup needed', { exact: true })).toBeVisible();
    await expect(page.getByText('Finish the checklist before approving a connection.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Choose display', exact: true }).click();
    await page.getByRole('button', { name: 'Main display', exact: true }).click();
    await expect(page.getByText('Ready for a request', { exact: true })).toHaveCount(0);
    await expectAccessible(page);
    await page.evaluate(() => { (window as any).macTest.permissions = { accessibility: true, screen: 'granted' }; window.dispatchEvent(new Event('focus')); });
    await expect(page.getByText('Ready for a request', { exact: true })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Account settings' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Account settings' })).toBeFocused();
    await page.screenshot({ path: 'artifacts/setup-milestone-mac.png', fullPage: true });
  } finally { await context.close(); }
});

test('an older account server shows upgrade guidance before creating any device key', async ({ page }) => {
  await page.route('**/api/auth/login', route => route.fulfill({ json: { user: { id: 'legacy-user-12345678', email: 'legacy@example.com' }, token: 'test-only-token', expires: Date.now() + 60000 } }));
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/');
  await page.getByLabel('Email address').fill('legacy@example.com'); await page.getByLabel('Password', { exact: true }).fill('legacy-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('needs a trusted-device update');
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  expect(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'remotely-trusted-devices'))).toBe(false);
  await expectAccessible(page);
});


test('refresh restores an HttpOnly login and sign-out stays signed out', async ({ page, context }) => {
  await login(page, `remember-${Date.now()}@example.com`, true);
  expect((await context.cookies()).some(cookie => cookie.name === 'remotely-session' && cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /token|password|session/i.test(key)))).toEqual([]);
  await page.reload(); await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account settings' }).click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.reload(); await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(''); await expectAccessible(page);
});

test('email-link confirmation removes the URL token and waits for explicit consent', async ({ page }) => {
  const token = 'syntheticMagicLinkTokenForUITestOnly'; let verifies = 0;
  await page.route('**/api/auth/verify-link', route => { verifies++; return route.fulfill({ status: 400, json: { error: 'This sign-in link is invalid or expired. Request a new one.' } }); });
  await page.goto('/#sign-in=' + token);
  await expect(page.getByRole('button', { name: 'Continue with email link' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(''); expect(verifies).toBe(0);
  await expectAccessible(page);
  await page.getByLabel('Email address').fill('email-test@example.com');
  await page.getByRole('button', { name: 'Continue with email link' }).click(); await expect(page.getByRole('alert')).toContainText('invalid or expired'); expect(verifies).toBe(1);
  await page.getByRole('button', { name: 'Back to sign in' }).click(); await expect(page.getByLabel('Email address')).toBeVisible();
});

test('email-link request journey is accessible and does not claim account existence', async ({ page }) => {
  await page.route('**/api/auth/config', route => route.fulfill({ json: { magicLink: true } }));
  await page.route('**/api/auth/magic-link', route => route.fulfill({ json: { status: 'ok' } }));
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click(); await page.getByLabel('Email address').fill('email-test@example.com');
  await page.getByRole('button', { name: 'Send sign-in link' }).click(); await expect(page.getByRole('status')).toContainText('If this email is eligible');
  await expectAccessible(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/magic-link-request-320.png', fullPage: true });
});
