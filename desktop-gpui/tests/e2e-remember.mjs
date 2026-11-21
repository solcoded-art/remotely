// End-to-end check of remembered approval: the real phone web app in headless
// Chrome, with Chrome's WebAuthn virtual authenticator standing in for Face ID,
// and the GPUI Mac app (e2e build). Covers: allowing with "3 days", the phone
// turning remembering on with a new passkey, the Mac verifying and recording it,
// a reconnect approved by the Mac on its own after the phone proves a fresh
// unlock, and Forget bringing the prompt back.
//
//   (cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)
//   node scripts/test-with-postgres.cjs node desktop-gpui/tests/e2e-remember.mjs
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { cleanups, deleteKeychainItem, runCleanups, startMac, startService } from './e2e-common.mjs';

const step = name => console.log(`• ${name}`);
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
let failurePage;

async function main() {
  const { url, api, mails, account } = await startService({ localhost: true });
  const email = `remember-${Date.now()}@example.com`;
  const macSession = await account(email);

  step('Mac ready, phone signed in and paired');
  const mac = startMac(url, macSession.token);
  let state = await mac.until(s => s.ready && s.deviceId, 'Mac ready');
  cleanups.push(() => deleteKeychainItem(url));
  mac.send('displays');
  state = await mac.until(s => s.displays.length > 0, 'displays');
  mac.send(`select ${state.displays[0]}`);
  await mac.until(s => s.setupReady, 'setup ready');
  const macName = (await api('/api/devices', macSession.token)).data.devices.find(d => d.id === state.deviceId).name;

  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  cleanups.unshift(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await context.newPage();
  failurePage = phone;
  const cdp = await context.newCDPSession(phone);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await phone.goto(url + '/login');
  await phone.getByLabel('Email address').fill(email);
  const before = mails.length;
  await phone.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  await expect.poll(() => mails.length).toBeGreaterThan(before);
  await phone.getByRole('button', { name: 'Paste a sign-in link', exact: true }).click();
  await phone.getByLabel('Email sign-in link', { exact: true }).fill(url + '/' + new URL(mails.at(-1).url).hash);
  await phone.getByRole('button', { name: 'Continue with email link', exact: true }).click();
  await expect(phone.getByText('Signed in', { exact: true })).toBeVisible({ timeout: 15000 });
  mac.send('invite');
  state = await mac.until(s => s.invite, 'invite');
  await phone.getByLabel('Pairing link from your Mac').fill(state.invite);
  await phone.getByRole('button', { name: 'Request pairing', exact: true }).click();
  await mac.until(s => s.pairing, 'pairing request');
  mac.send('approve');
  state = await mac.until(s => s.pins.length === 1, 'paired');
  const phoneId = state.pins[0].id;
  const connect = phone.getByRole('button', { name: `Connect to ${macName}`, exact: true });
  await expect(connect).toBeEnabled({ timeout: 15000 });

  step('allow with "3 days"; the phone turns remembering on with a new passkey');
  await connect.click();
  await mac.until(s => s.pending === phoneId && !s.unlocked, 'prompt');
  mac.send(`allow ${THREE_DAYS}`);
  await mac.until(s => s.sessionStatus === 'connected', 'connected', 30000);
  const offer = phone.getByRole('region', { name: 'Skip Mac approval' });
  await expect(offer).toBeVisible({ timeout: 15000 });
  await offer.getByRole('button', { name: 'Turn on', exact: true }).click();
  await mac.until(s => s.remembered.includes(phoneId), 'Mac records the passkey');
  await expect(offer).toHaveCount(0, { timeout: 15000 });
  assert.equal((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length, 1, 'one passkey on the phone');

  step('reconnect: the phone proves a fresh unlock and the Mac approves on its own');
  mac.send('end');
  await mac.until(s => s.sessionStatus === 'none' && !s.session, 'ended');
  await expect(connect).toBeEnabled({ timeout: 15000 });
  await connect.click();
  await mac.until(s => s.sessionStatus === 'connected', 'connected without a prompt', 30000);
  await expect(phone.getByText('Session connected', { exact: true })).toBeAttached({ timeout: 30000 });

  step('Forget on the Mac brings the prompt back');
  mac.send('end');
  await mac.until(s => s.sessionStatus === 'none' && !s.session, 'ended');
  mac.send(`forget ${phoneId}`);
  await mac.until(s => !s.remembered.includes(phoneId), 'forgotten');
  await expect(connect).toBeEnabled({ timeout: 15000 });
  await connect.click();
  await mac.until(s => s.pending === phoneId && !s.unlocked, 'prompt again');
  mac.send('deny');
  await mac.until(s => !s.pending, 'declined');

  mac.send('quit'); await mac.exited;
  console.log('E2E REMEMBER PASSED');
}

try { await main(); }
catch (error) {
  console.error('E2E REMEMBER FAILED:', error.message);
  await failurePage?.screenshot({ path: new URL('../target/e2e/remember-failure.png', import.meta.url).pathname }).catch(() => {});
  process.exitCode = 1;
}
finally { await runCleanups(); }
