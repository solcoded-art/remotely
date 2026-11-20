import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures/account';
import { installMacFixture } from './fixtures/mac';
import { expectAccessible } from './fixtures/accessibility';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('login is responsive at small phone, phone, landscape, and desktop sizes', async ({ page }) => {
  await page.goto('/login');
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
  await login(desktop, email);
  await desktop.getByRole('button', { name: 'Choose display', exact: true }).click();
  await desktop.getByRole('button', { name: 'Main display' }).click();
  await login(phone, email);
  await expect(phone.getByText('Test Mac', { exact: true })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Connect to Test Mac', exact: true })).toBeDisabled();
  await desktop.getByRole('button', { name: 'Create pairing link', exact: true }).click();
  await expect(desktop.getByRole('img', { name: /Pairing QR/ })).toBeVisible();
  const link = await desktop.getByLabel('One-use pairing link', { exact: true }).inputValue();
  await phone.getByLabel('Pairing link from your Mac').fill(link);
  await phone.getByRole('button', { name: 'Request pairing', exact: true }).click();
  await expect(desktop.getByRole('region', { name: 'Pairing approval' })).toBeVisible();
  await expect(desktop.locator('video')).toHaveCount(0);
  await expectAccessible(desktop); await expectAccessible(phone);
  await desktop.getByRole('button', { name: 'Allow pairing', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Connect to Test Mac', exact: true })).toBeEnabled();
  await phone.screenshot({ path: 'artifacts/cult-devices-390.png', fullPage: true });
  await desktop.screenshot({ path: 'artifacts/cult-mac-setup-1280.png', fullPage: true });
  await phone.screenshot({ path: 'artifacts/trusted-phone.png', fullPage: true });
  await phone.getByRole('button', { name: 'Connect to Test Mac', exact: true }).click();
  await expect(phone.getByText('Approve on your Mac', { exact: true })).toBeVisible();
  await desktop.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'My devices' })).toBeVisible();
  await phone.getByRole('button', { name: 'Connect to Test Mac', exact: true }).click();
  await expect(phone.getByText('Approve on your Mac', { exact: true })).toBeVisible();
  await expectAccessible(desktop);
  await expectAccessible(phone);
  await desktop.evaluate(() => { (window as any).macTest.captureError = 'NotAllowedError'; });
  await desktop.getByRole('button', { name: 'Allow connection', exact: true }).click();
  await expect(desktop.getByRole('alert')).toContainText('macOS blocked screen sharing');
  await expect(phone.getByRole('alert')).toContainText('Screen capture failed on the Mac');
  await expect(desktop.getByRole('alert')).not.toContainText('Mac declined');
  await expect(desktop.locator('video')).toHaveCount(0);
  await desktop.evaluate(() => { delete (window as any).macTest.captureError; });
  await phone.getByRole('button', { name: 'Connect to Test Mac', exact: true }).click();
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
  await phone.getByRole('button', { name: 'Open Zed', exact: true }).click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((value: any) => value.action === 'launchApp' && value.bundleId === 'dev.zed.Zed'))).toBe(true);
  // Running apps are not repeated as launchers.
  await expect(phone.getByRole('button', { name: 'Open VS Code', exact: true })).toHaveCount(0);
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 900]]) {
    await phone.setViewportSize({ width, height }); await noOverflow(phone);
    await phone.screenshot({ path: `artifacts/session-${width}.png`, fullPage: true });
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  const sent = (match: Record<string, unknown>) => desktop.evaluate(expected => (window as any).commands.some((v: any) => Object.entries(expected).every(([key, value]) => JSON.stringify(v[key]) === JSON.stringify(value))), match);
  const typed = () => desktop.evaluate(() => (window as any).commands.filter((v: any) => v.action === 'type').map((v: any) => v.text).join(''));

  // On-screen keyboard types straight into the focused Mac field.
  const keys = phone.getByRole('group', { name: 'Keyboard', exact: true });
  await keys.getByRole('button', { name: 'h', exact: true }).click();
  await keys.getByRole('button', { name: 'i', exact: true }).click();
  await keys.getByRole('button', { name: 'Shift', exact: true }).click();
  await keys.getByRole('button', { name: 'Q', exact: true }).click();
  await keys.getByRole('button', { name: 'q', exact: true }).click();
  await expect.poll(typed).toBe('hiQq');
  await keys.getByRole('button', { name: 'Command', exact: true }).click();
  await keys.getByRole('button', { name: 'c', exact: true }).click();
  await expect.poll(() => sent({ action: 'key', code: 8, modifiers: ['cmd'] })).toBe(true);
  await keys.getByRole('button', { name: 'Return', exact: true }).click();
  await keys.getByRole('button', { name: 'Left arrow key', exact: true }).click();
  await expect.poll(() => sent({ action: 'key', code: 36 })).toBe(true);
  await expect.poll(() => sent({ action: 'key', code: 123 })).toBe(true);
  await keys.getByRole('button', { name: '123', exact: true }).click();
  await keys.getByRole('button', { name: '7', exact: true }).click();
  await expect.poll(typed).toBe('hiQq7');
  await keys.getByRole('button', { name: 'ABC', exact: true }).click();
  await expectAccessible(phone);

  // Shortcuts replace the letter rows and switch back.
  await phone.getByRole('button', { name: 'Show shortcuts', exact: true }).click();
  const shortcuts = phone.getByRole('group', { name: 'Shortcuts', exact: true });
  for (const [label, code, modifiers] of [['Next tab', 48, ['ctrl']], ['Previous tab', 48, ['ctrl', 'shift']], ['Focus back', 48, ['shift']], ['Spotlight', 49, ['cmd']], ['Select all', 0, ['cmd']]] as const) {
    await shortcuts.getByRole('button', { name: new RegExp('^' + label + ' ') }).click();
    await expect.poll(() => desktop.evaluate(([code, expected]) => (window as any).commands.some((v: any) => v.action === 'key' && v.code === code && JSON.stringify(v.modifiers) === JSON.stringify(expected)), [code, [...modifiers]] as const)).toBe(true);
  }
  await phone.setViewportSize({ width: 320, height: 568 }); await noOverflow(phone);
  await expectAccessible(phone);
  await phone.screenshot({ path: 'artifacts/keyboard-shortcuts-320.png', fullPage: true });
  await phone.getByRole('button', { name: 'Show keyboard', exact: true }).click();

  // The phone's own keyboard stays available for dictation, emoji, IME and paste.
  const field = phone.getByRole('textbox', { name: 'Phone keyboard input', exact: true });
  await field.fill('Hello 世界 👋');
  await expect.poll(() => sent({ action: 'type', text: 'Hello 世界 👋' })).toBe(true);
  await expect(field).toHaveValue('');
  await field.dispatchEvent('compositionstart');
  await field.fill('ni');
  await phone.waitForTimeout(200);
  expect(await sent({ action: 'type', text: 'ni' })).toBe(false);
  await field.fill('你');
  await field.dispatchEvent('compositionend', { data: '你' });
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.filter((v: any) => v.action === 'type' && v.text === '你').length)).toBe(1);
  await expect(field).toHaveValue('');
  const deletesBefore = await desktop.evaluate(() => (window as any).commands.filter((v: any) => v.action === 'key' && v.code === 51).length);
  await field.evaluate(element => element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' })));
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.filter((v: any) => v.action === 'key' && v.code === 51).length)).toBe(deletesBefore + 1);
  await field.evaluate(element => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, 'discard-on-pause');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('video')!.pause();
  });
  await expect(field).toBeDisabled();
  await expect(keys.getByRole('button', { name: 'a', exact: true })).toBeDisabled();
  await phone.waitForTimeout(200);
  expect(await sent({ action: 'type', text: 'discard-on-pause' })).toBe(false);
  await phone.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(field).toBeEnabled();

  // The screen stays pinned while the controls scroll.
  await keys.getByRole('button', { name: 'Right arrow key', exact: true }).scrollIntoViewIfNeeded();
  const screenRect = await phone.getByRole('region', { name: 'Your Mac screen', exact: true }).boundingBox();
  expect(screenRect!.y).toBeGreaterThanOrEqual(0); expect(screenRect!.y + screenRect!.height).toBeLessThan(568);
  await phone.screenshot({ path: 'artifacts/sticky-screen-keyboard-320.png', fullPage: false });

  // Tap the screen to click there; zoom with buttons or ⌘/Ctrl +, −, 0.
  await phone.locator('video').click();
  await expect.poll(() => desktop.evaluate(() => (window as any).commands.some((v: any) => v.action === 'moveTo' && v.normX > 0.3 && v.normX < 0.7))).toBe(true);
  await phone.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveText('125%');
  await phone.keyboard.press('Control+Minus');
  await expect(phone.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveCount(0);
  await phone.keyboard.press('Control+Equal'); await phone.keyboard.press('Control+Equal');
  await expect(phone.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveText('156%');
  await phone.keyboard.press('Control+0');
  await expect(phone.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveCount(0);

  // Fullscreen: landscape surface, a draggable controls button, the full dock on demand.
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  const surface = phone.getByRole('dialog', { name: 'Test Mac screen' });
  await expect(surface).toBeVisible();
  await expect(surface.locator('video')).toBeVisible();
  await expect(surface.getByRole('region', { name: 'Remote controls' })).toBeHidden();
  const fab = surface.getByRole('button', { name: 'Show controls', exact: true });
  const before = await fab.boundingBox();
  await phone.mouse.move(before!.x + 24, before!.y + 24); await phone.mouse.down();
  await phone.mouse.move(before!.x - 60, before!.y - 100, { steps: 4 }); await phone.mouse.move(before!.x - 120, before!.y - 200, { steps: 4 });
  await phone.mouse.up();
  const after = await fab.boundingBox();
  expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y)).toBeGreaterThan(50);
  await expect(surface.getByRole('region', { name: 'Remote controls' })).toBeHidden();
  await phone.screenshot({ path: 'artifacts/fullscreen-closed-390.png' });
  await fab.click();
  await expect(surface.getByRole('region', { name: 'Remote controls' })).toBeVisible();
  await expect(surface.getByRole('button', { name: 'Hide controls', exact: true })).toBeVisible();
  await expectAccessible(phone);
  await phone.screenshot({ path: 'artifacts/fullscreen-open-390.png' });
  // Portrait phones without an orientation lock rotate the surface to landscape.
  expect(await phone.evaluate(() => { const surface = document.querySelector('.remote-surface')!; const rect = surface.getBoundingClientRect(); return surface.hasAttribute('data-rotated') && getComputedStyle(surface).transform !== 'none' && Math.round(rect.width) === 390 && Math.round(rect.height) === 844; })).toBe(true);
  await phone.setViewportSize({ width: 844, height: 390 }); await noOverflow(phone);
  await phone.screenshot({ path: 'artifacts/fullscreen-open-844.png' });
  await surface.getByRole('button', { name: 'Hide controls', exact: true }).click();
  await expect(fab).toBeFocused();
  await phone.keyboard.press('Escape');
  await expect(phone.getByRole('dialog')).toHaveCount(0);
  await expect(phone.getByRole('button', { name: 'Fullscreen', exact: true })).toBeFocused();
  // iPhone Safari has no element fullscreen: the expanded view covers the page and rotates itself.
  await phone.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }));
  await phone.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await phone.screenshot({ path: 'artifacts/expanded-closed-390.png' });
  await phone.getByRole('dialog').getByRole('button', { name: 'Show controls', exact: true }).click();
  await phone.screenshot({ path: 'artifacts/expanded-open-390.png' });
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.screenshot({ path: 'artifacts/expanded-open-844.png' });
  await phone.getByRole('button', { name: 'Show shortcuts', exact: true }).click();
  await phone.screenshot({ path: 'artifacts/expanded-shortcuts-844.png' });
  await phone.getByRole('button', { name: 'Show keyboard', exact: true }).click();
  await phone.getByRole('dialog').getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(phone.getByRole('dialog')).toHaveCount(0);
  await expect(phone.getByText('Session connected', { exact: true })).toBeAttached();

  // Mouse buttons and the trackpad.
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.getByRole('button', { name: 'Right click', exact: true }).click();
  await expect.poll(() => sent({ action: 'click', button: 'right' })).toBe(true);
  const trackpad = phone.getByRole('application', { name: 'Trackpad' });
  await trackpad.focus(); await phone.keyboard.press('PageDown');
  await expect.poll(() => sent({ action: 'scroll', dy: -80 })).toBe(true);
  await phone.getByRole('button', { name: 'Hold to drag', exact: true }).click();
  await expect.poll(() => sent({ action: 'down', button: 'left' })).toBe(true);
  await trackpad.focus(); await phone.keyboard.press('ArrowRight');
  await expect.poll(() => sent({ action: 'drag', dx: 10 })).toBe(true);
  await phone.getByRole('button', { name: 'Hold to drag', exact: true }).click();
  await expect.poll(() => sent({ action: 'up' })).toBe(true);

  // Settings: trackpad speed and custom shortcuts live outside the screen.
  await phone.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = phone.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByLabel('Trackpad speed')).toBeVisible();
  await settings.getByRole('button', { name: 'Remove Copy', exact: true }).click();
  await settings.getByLabel('Shortcut name').fill('Lock screen');
  await settings.getByRole('button', { name: 'Command', exact: true }).click(); // default ⌘ off
  await settings.getByRole('button', { name: 'Control', exact: true }).click();
  await settings.getByRole('button', { name: 'Command', exact: true }).click();
  await settings.getByLabel('Key', { exact: true }).selectOption('q');
  await settings.getByRole('button', { name: 'Add shortcut', exact: true }).click();
  await expect(settings.getByText('Lock screen', { exact: true })).toBeVisible();
  await settings.getByLabel('Shortcut name').fill('Duplicate');
  await settings.getByRole('button', { name: 'Add shortcut', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('already a shortcut');
  await expectAccessible(phone);
  await phone.screenshot({ path: 'artifacts/settings-shortcuts-390.png', fullPage: false });
  await phone.keyboard.press('Escape');
  await phone.getByRole('button', { name: 'Show shortcuts', exact: true }).click();
  await expect(phone.getByRole('button', { name: /^Copy / })).toHaveCount(0);
  await phone.getByRole('button', { name: 'Lock screen ⌃⌘ Q', exact: true }).click();
  await expect.poll(() => sent({ action: 'key', code: 12, modifiers: ['ctrl', 'cmd'] })).toBe(true);
  // Switching tabs or locking the phone keeps the session.
  const setVisibility = (state: 'hidden' | 'visible') => phone.evaluate(value => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value }); document.dispatchEvent(new Event('visibilitychange')); }, state);
  await setVisibility('hidden'); await phone.waitForTimeout(400); await setVisibility('visible');
  await expect(phone.getByText('Session connected', { exact: true })).toBeAttached();
  expect(await desktop.evaluate(() => (window as any).commands.length)).toBeGreaterThan(0);
  await expect(desktop.getByRole('button', { name: 'End session', exact: true })).toBeVisible();
  // A failed server logout must still stop local screen sharing and control immediately.
  await phone.route('**/api/auth/logout', route => route.abort('failed'));
  await phone.getByRole('button', { name: 'Settings', exact: true }).click();
  await phone.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(phone.getByRole('alert').filter({ hasText: 'Sign-out could not finish' })).toBeVisible();
  await expect(desktop.getByText('Session active', { exact: true })).not.toBeVisible();
  await expect(phone.locator('video')).toHaveCount(0);
  await phone.unroute('**/api/auth/logout');
  await phone.getByRole('button', { name: 'Connect to Test Mac', exact: true }).click();
  await desktop.getByRole('button', { name: 'Allow connection', exact: true }).click();
  await expect(phone.getByText('Session connected', { exact: true })).toBeVisible();
  await desktop.getByRole('button', { name: 'Revoke My iPhone', exact: true }).click();
  await expectAccessible(desktop);
  await desktop.getByRole('button', { name: 'Revoke device', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'My devices' })).toBeVisible();
  await expect(phone.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(desktop.getByText('Session active', { exact: true })).not.toBeVisible();
  await expect(phone.getByRole('button', { name: 'Connect to Test Mac', exact: true })).toBeDisabled();
  await phone.getByLabel('Pairing link from your Mac').fill(link);
  await phone.getByRole('button', { name: 'Request pairing', exact: true }).click();
  await expect(phone.getByRole('alert').filter({ hasText: 'expired' })).toBeVisible();
  await desktopContext.close(); await phoneContext.close();
});


test('the app links to a dedicated public setup guide instead of showing installation instructions inline', async ({ page }) => {
  await page.route('**/api/downloads/mac', route => route.fulfill({ json: { available: true } }));
  await page.goto('/login');
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
    await login(page, `setup-${Date.now()}@example.com`);
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

test('a wrong pairing secret and a signaling relay that changes the Mac certificate are rejected', async ({ browser }) => {
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let altered = false; let alterRequest = true;
  await desktopContext.routeWebSocket('**/ws', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const data = JSON.parse(String(message));
      if (data.type === 'request' && alterRequest) { data.requestSignature = 'forged-by-signaling-service'; alterRequest = false; }
      socket.send(JSON.stringify(data));
    });
  });
  await phoneContext.routeWebSocket('**/ws', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      const data = JSON.parse(String(message));
      if (data.type === 'signal' && data.signal?.type === 'offer') { data.signal.sdp += '\r\na=fingerprint:sha-256 changed-by-relay\r\n'; altered = true; }
      socket.send(JSON.stringify(data));
    });
  });
  await installMacFixture(desktopContext);
  const desktop = await desktopContext.newPage(); const phone = await phoneContext.newPage();
  try {
    const email = `tamper-${Date.now()}@example.com`;
    await login(desktop, email); await login(phone, email);
    await desktop.getByRole('button', { name: 'Create pairing link', exact: true }).click();
    const original = await desktop.getByLabel('One-use pairing link', { exact: true }).inputValue();
    const wrong = new URL(original);
    wrong.hash = await phone.evaluate(hash => {
      const value = JSON.parse(atob(hash.slice(6).replaceAll('-', '+').replaceAll('_', '/')));
      value.secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      return '#pair=' + btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    }, wrong.hash);
    await phone.getByLabel('Pairing link from your Mac').fill(wrong.toString()); await phone.getByRole('button', { name: 'Request pairing', exact: true }).click();
    await expect(phone.getByRole('status').filter({ hasText: 'Mac declined pairing' })).toBeVisible();
    await expect(desktop.getByRole('button', { name: 'Allow pairing', exact: true })).toHaveCount(0);
    await phone.getByLabel('Pairing link from your Mac').fill(original); await phone.getByRole('button', { name: 'Request pairing', exact: true }).click();
    await desktop.getByRole('button', { name: 'Allow pairing', exact: true }).click();
    await expect(phone.getByRole('button', { name: 'Connect to Test Mac', exact: true })).toBeEnabled();
    // Reload restores the login session as well as the device key and approved Mac pin.
    await phone.reload();
    await expect(phone.getByText('Signed in', { exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Connect to Test Mac', exact: true })).toBeEnabled();
    await desktop.getByRole('button', { name: 'Choose display', exact: true }).click(); await desktop.getByRole('button', { name: 'Main display', exact: true }).click();
    await phone.getByRole('button', { name: 'Connect to Test Mac', exact: true }).click();
    await expect(desktop.getByRole('alert')).toContainText('phone did not prove this connection request');
    await expect(phone.getByRole('heading', { name: 'My devices' })).toBeVisible();
    await expect(desktop.getByRole('button', { name: 'Allow connection', exact: true })).toHaveCount(0);
    await expect(desktop.locator('video')).toHaveCount(0);
    await phone.getByRole('button', { name: 'Connect to Test Mac', exact: true }).click(); await desktop.getByRole('button', { name: 'Allow connection', exact: true }).click();
    await expect(phone.getByRole('alert')).toContainText('Peer identity verification failed');
    expect(altered).toBe(true);
    await expect(phone.locator('video')).toHaveCount(0);
    await expect.poll(() => desktop.evaluate(() => (window as any).commands.length)).toBe(0);
    await expect(desktop.locator('video')).toHaveCount(0);
  } finally { await desktopContext.close(); await phoneContext.close(); }
});
