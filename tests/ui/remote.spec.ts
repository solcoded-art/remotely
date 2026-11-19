import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, email: string, register = false) {
  await page.goto('/');
  if (await page.getByLabel('Account server URL').isVisible()) await page.getByLabel('Account server URL').fill('http://127.0.0.1:3000');
  if (register) await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password-123');
  await page.getByRole('button', { name: register ? 'Create account' : 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
}
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
  await desktopContext.addInitScript(() => {
    const listeners = new Set<(value: unknown) => void>();
    (window as any).commands = [];
    (window as any).macRemote = {
      platform: 'mac', info: async () => ({ name: 'Test Mac', driverReady: true }),
      permissions: async () => ({ accessibility: true, screen: 'granted' }),
      sources: async () => [{ id: 'screen:1', displayId: '1', name: 'Main display', thumbnail: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="360" height="225"><rect width="360" height="225" fill="%23272d30"/></svg>' }],
      selectDisplay: async () => {}, approve: async () => {}, end: async () => {},
      command: async (_id: string, value: any) => {
        (window as any).commands.push(value);
        if (value.action === 'listApps') listeners.forEach(listener => listener({ action: 'listApps', apps: [{ pid: 123, name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode', active: true }, { pid: 124, name: 'Safari', bundleId: 'com.apple.Safari', active: false }] }));
      },
      onDriver: (listener: (value: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
      const ctx = canvas.getContext('2d')!;
      const paint = () => { ctx.fillStyle = '#1b2024'; ctx.fillRect(0, 0, 1280, 800); ctx.fillStyle = '#a5e2bd'; ctx.font = '28px monospace'; ctx.fillText('Synthetic desktop · WebRTC integration test', 50, 80); ctx.fillText(new Date().toISOString(), 50, 135); };
      paint(); const timer = setInterval(paint, 100); const stream = canvas.captureStream(10);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    } });
  });
  const desktop = await desktopContext.newPage(); const phone = await phoneContext.newPage();
  const email = `browser-${Date.now()}@example.com`;
  await login(desktop, email, true);
  await desktop.getByRole('button', { name: 'Choose display', exact: true }).click();
  await desktop.getByRole('button', { name: 'Main display' }).click();
  await login(phone, email);
  await expect(phone.getByText('Test Mac', { exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(phone.getByText('Approve on your Mac', { exact: true })).toBeVisible();
  await desktop.getByRole('button', { name: 'Allow connection', exact: true }).click();
  await expect(phone.getByText('Session connected', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(phone.getByRole('button', { name: 'Visual Studio Code', exact: true })).toBeVisible();
  await expect.poll(() => phone.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
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
  await phone.getByRole('tab', { name: 'Mouse', exact: true }).click();
  await phone.getByRole('button', { name: 'Hold to drag', exact: true }).click();
  await phone.getByRole('tab', { name: 'Apps', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'up'))).toBe(true);
  await phone.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'My devices' })).toBeVisible();
  await expect(desktop.getByText('Session active', { exact: true })).not.toBeVisible();
  await desktopContext.close(); await phoneContext.close();
});
