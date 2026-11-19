import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures/account';
import { installMacFixture } from './fixtures/mac';
import { expectAccessible } from './fixtures/accessibility';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('login is responsive at small phone, phone, landscape, and desktop sizes', async ({ page }) => {
  await page.goto('/');
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    await page.setViewportSize({ width, height }); await noOverflow(page);
    await expect(page.getByLabel('Email address')).toBeVisible();
    await page.screenshot({ path: `artifacts/login-${width}.png`, fullPage: true });
  }
});

test('real login and WebRTC connection with a synthetic desktop capture', async ({ browser }) => {
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await installMacFixture(desktopContext);
  const desktop = await desktopContext.newPage(); const phone = await phoneContext.newPage();
  const email = `browser-${Date.now()}@example.com`;
  await login(desktop, email, true);
  await desktop.getByRole('button', { name: 'Choose display', exact: true }).click();
  await desktop.getByRole('button', { name: 'Main display' }).click();
  await login(phone, email);
  await expect(phone.getByText('Test Mac', { exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Connect to Test Mac', exact: true }).click();
  await expect(phone.getByText('Approve on your Mac', { exact: true })).toBeVisible();
  await expectAccessible(desktop);
  await expectAccessible(phone);
  await desktop.getByRole('button', { name: 'Allow connection', exact: true }).click();
  await expect(phone.getByText('Session connected', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(phone.getByRole('button', { name: 'Visual Studio Code', exact: true })).toBeVisible();
  await expect.poll(() => phone.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await expectAccessible(phone);
  await phone.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
  await expect(phone.getByText('Waiting for your Mac’s screen', { exact: true })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Safari', exact: true })).toBeDisabled();
  await phone.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(phone.getByText('Session connected', { exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Safari', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'activateApp' && value.pid === 124))).toBe(true);
  await phone.getByRole('button', { name: 'VS Code', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'launchApp' && value.bundleId === 'com.microsoft.VSCode'))).toBe(true);
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    await phone.setViewportSize({ width, height }); await noOverflow(phone);
    await phone.screenshot({ path: `artifacts/session-${width}.png`, fullPage: true });
  }
  await phone.getByRole('tab', { name: 'Keys', exact: true }).click();
  await phone.getByLabel('Text to send').fill('Hello 世界 👋');
  await phone.getByRole('button', { name: 'Send text', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'type' && value.text === 'Hello 世界 👋'))).toBe(true);
  await phone.getByRole('button', { name: 'Left arrow key', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'key' && value.code === 123))).toBe(true);
  await expectAccessible(phone);
  await phone.getByRole('tab', { name: 'Mouse', exact: true }).click();
  await expectAccessible(phone);
  await phone.getByRole('button', { name: 'Move pointer up', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'move' && value.dy === -20))).toBe(true);
  await phone.getByRole('button', { name: 'Scroll down', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'scroll' && value.dy === -80))).toBe(true);
  await phone.getByRole('button', { name: 'Hold to drag', exact: true }).click();
  await phone.getByRole('button', { name: 'Move pointer right', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'drag' && value.dx === 20))).toBe(true);
  await phone.getByRole('tab', { name: 'Apps', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'up'))).toBe(true);
  await phone.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'My devices' })).toBeVisible();
  await expect(desktop.getByText('Session active', { exact: true })).not.toBeVisible();
  await expect(phone.getByRole('heading', { level: 1 })).toBeFocused();
  await desktopContext.close(); await phoneContext.close();
});


test('the app links to a dedicated public setup guide instead of showing installation instructions inline', async ({ page }) => {
  await page.route('**/api/downloads/mac', route => route.fulfill({ json: { available: true } }));
  await page.goto('/');
  await expect(page.getByText('Mac app required', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read setup guide' })).toHaveAttribute('href', 'http://127.0.0.1:5173/docs/getting-started/');
  await expect(page.getByText('Sign in and choose a display', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Setup documentation' })).toBeVisible();
  await page.goto('/docs/getting-started/');
  await expect(page.getByRole('heading', { name: 'Get your Mac ready to connect' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download Mac app', exact: true })).toHaveAttribute('href', 'http://127.0.0.1:5173/download/mac');
  await expect(page.getByText('Sign in and choose a display', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/docs-desktop.png', fullPage: true });
});

test('phone visitors get installation guidance in documentation and links from the no-device state', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.route('**/api/downloads/mac', route => route.fulfill({ json: { available: true } }));
    await page.goto('/docs/getting-started/');
    await expect(page.getByRole('button', { name: 'Copy Mac setup link' })).toBeVisible();
    for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height }); await noOverflow(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'artifacts/docs-phone.png', fullPage: true });
    await login(page, `setup-${Date.now()}@example.com`, true);
    await expect(page.getByRole('link', { name: 'Read setup guide' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Mac setup link' })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: 'artifacts/docs-app-link.png', fullPage: true });
  } finally { await context.close(); }
});

test('the documentation keeps unpublished installers disabled', async ({ page }) => {
  await page.route('**/api/downloads/mac', route => route.fulfill({ json: { available: false } }));
  await page.goto('/docs/getting-started/');
  await expect(page.getByRole('button', { name: 'Mac download temporarily unavailable' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Download Mac app' })).toHaveCount(0);
});
