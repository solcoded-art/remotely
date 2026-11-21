// End-to-end session check: the real phone web app (built `dist/`, served by the
// real signaling service) in headless Chrome, and the GPUI Mac app in its test-only
// `e2e` build, which streams a synthetic test pattern because automated runs cannot
// grant Screen Recording. Covers sign-in, pairing through the phone UI, the Mac's
// approval prompt, WebRTC with VideoToolbox H.264 decoded by the browser, the data
// channel round trip through the real input driver (listApps only: nothing is
// clicked or typed on this Mac), declining, and ending a session from the Mac.
//
//   npm run build && npm run build:driver
//   (cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)
//   node scripts/test-with-postgres.cjs node desktop-gpui/tests/e2e-session.mjs
//
// This is not a Safari or physical-iPhone test.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { cleanups, deleteKeychainItem, runCleanups, startMac, startService } from './e2e-common.mjs';

const step = name => console.log(`• ${name}`);

async function main() {
  const { url, api, mails, account } = await startService();
  const email = `session-${Date.now()}@example.com`;
  const macSession = await account(email);

  step('Mac app starts and its setup checklist completes');
  const mac = startMac(url, macSession.token);
  let state = await mac.until(s => s.ready && s.deviceId, 'Mac ready');
  cleanups.push(() => deleteKeychainItem(url, macSession.user.id));
  const macId = state.deviceId;
  mac.send('displays');
  state = await mac.until(s => s.displays.length > 0, 'displays listed');
  mac.send(`select ${state.displays[0]}`);
  await mac.until(s => s.setupReady, 'setup ready');
  const macName = (await api('/api/devices', macSession.token)).data.devices.find(d => d.id === macId).name;

  step('phone signs in with the web app');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  cleanups.unshift(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await context.newPage();
  failurePage = phone;
  phone.on('pageerror', error => console.log('  (phone page error)', error.message));
  await phone.goto(url + '/login');
  await phone.getByLabel('Email address').fill(email);
  const before = mails.length;
  await phone.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  await expect.poll(() => mails.length).toBeGreaterThan(before);
  await phone.getByRole('button', { name: 'Paste a sign-in link', exact: true }).click();
  // Test mail always names the service's fixed public URL; the page runs on a random port.
  await phone.getByLabel('Email sign-in link', { exact: true }).fill(url + '/' + new URL(mails.at(-1).url).hash);
  await phone.getByRole('button', { name: 'Continue with email link', exact: true }).click();
  await expect(phone.getByText('Signed in', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(phone.getByText(macName, { exact: true }).first()).toBeVisible({ timeout: 15000 });

  step('pairing through the phone UI');
  mac.send('invite');
  state = await mac.until(s => s.invite, 'invite link');
  await phone.getByLabel('Pairing link from your Mac').fill(state.invite);
  await phone.getByRole('button', { name: 'Request pairing', exact: true }).click();
  await mac.until(s => s.pairing, 'Mac shows the pairing request');
  mac.send('approve');
  await mac.until(s => s.pins.length === 1, 'Mac pins the phone');
  const connect = phone.getByRole('button', { name: `Connect to ${macName}`, exact: true });
  await expect(connect).toBeEnabled({ timeout: 15000 });

  step('the Mac can decline a connection');
  await connect.click();
  await expect(phone.getByText('Approve on your Mac', { exact: true })).toBeVisible();
  await mac.until(s => s.pending, 'approval prompt');
  mac.send('deny');
  await expect(phone.getByText(/Mac declined the connection/).first()).toBeVisible({ timeout: 15000 });
  await mac.until(s => !s.pending, 'prompt cleared');

  step('allow → WebRTC session with H.264 video from VideoToolbox');
  await expect(connect).toBeEnabled({ timeout: 15000 });
  await connect.click();
  await mac.until(s => s.pending, 'approval prompt');
  mac.send('allow');
  await mac.until(s => s.sessionStatus === 'connected', 'Mac data channel open', 30000);
  await expect(phone.getByText('Session connected', { exact: true })).toBeAttached({ timeout: 30000 });
  await expect.poll(() => phone.locator('video').evaluate(video => `${video.videoWidth}x${video.videoHeight}`), { timeout: 20000 }).toBe('1280x800');
  const decoded = async () => phone.locator('video').evaluate(video => video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0);
  const first = await decoded();
  await expect.poll(decoded, { timeout: 10000 }).toBeGreaterThan(first + 10);

  step('data channel → validate → real driver (listApps) → phone app dock');
  await expect(phone.getByRole('button', { name: /^Finder/ }).first()).toBeVisible({ timeout: 15000 });

  step('End session on the Mac stops the phone session');
  mac.send('end');
  await mac.until(s => s.session === null && s.sessionStatus === 'none', 'Mac session cleared');
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal((await mac.until(() => true, 'state')).error, null, 'a clean end leaves no error on the Mac');
  await expect(phone.getByRole('heading', { name: 'My devices' })).toBeVisible({ timeout: 15000 });
  await phone.screenshot({ path: new URL('../target/e2e/phone-after-session.png', import.meta.url).pathname });

  mac.send('quit'); await mac.exited;
  console.log('E2E SESSION PASSED');
}

let failurePage;
try { await main(); }
catch (error) {
  console.error('E2E SESSION FAILED:', error.message);
  await failurePage?.screenshot({ path: new URL('../target/e2e/phone-failure.png', import.meta.url).pathname }).catch(() => {});
  process.exitCode = 1;
}
finally { await runCleanups(); }
