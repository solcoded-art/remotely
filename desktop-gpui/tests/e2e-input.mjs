// Measures input from the phone web app to the Mac's input driver while video
// streams: every keystroke and pointer move must arrive, in order, quickly.
// Uses tests/fake-driver.mjs instead of the real driver, so nothing on this Mac
// is clicked or typed.
//
//   (cd desktop-gpui && CARGO_TARGET_DIR=target/e2e cargo build --features e2e)
//   node scripts/test-with-postgres.cjs node desktop-gpui/tests/e2e-input.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { cleanups, deleteKeychainItem, runCleanups, startMac, startService } from './e2e-common.mjs';

const step = name => console.log(`• ${name}`);
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : NaN;
let failurePage;

async function main() {
  const { url, api, mails, account } = await startService();
  const email = `input-${Date.now()}@example.com`;
  const macSession = await account(email);
  const driverLog = path.join(mkdtempSync(path.join(tmpdir(), 'fake-driver-')), 'commands.jsonl');
  const commands = () => existsSync(driverLog) ? readFileSync(driverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

  step('Mac ready (fake driver), phone signed in, paired, connected');
  const mac = startMac(url, macSession.token, { MAC_REMOTE_DRIVER: new URL('./fake-driver.mjs', import.meta.url).pathname, FAKE_DRIVER_LOG: driverLog });
  let state = await mac.until(s => s.ready && s.deviceId, 'Mac ready');
  cleanups.push(() => deleteKeychainItem(url));
  mac.send('displays');
  state = await mac.until(s => s.displays.length > 0, 'displays');
  mac.send(`select ${state.displays[0]}`);
  await mac.until(s => s.setupReady, 'setup ready');
  const macName = (await api('/api/devices', macSession.token)).data.devices.find(d => d.id === state.deviceId).name;
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  cleanups.unshift(() => browser.close());
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  failurePage = phone;
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
  await mac.until(s => s.pairing, 'pairing');
  mac.send('approve');
  await mac.until(s => s.pins.length === 1, 'paired');
  await phone.getByRole('button', { name: `Connect to ${macName}`, exact: true }).click();
  await mac.until(s => s.pending, 'prompt');
  mac.send('allow');
  await mac.until(s => s.sessionStatus === 'connected', 'connected', 30000);
  await expect(phone.getByText('Session connected', { exact: true })).toBeAttached({ timeout: 30000 });
  await expect.poll(() => phone.locator('video').evaluate(v => v.videoWidth), { timeout: 20000 }).toBeGreaterThan(0);
  await phone.waitForTimeout(1000);

  step('typing: 60 keys on the phone keyboard while video streams');
  const keyboard = phone.getByRole('group', { name: 'Keyboard', exact: true });
  await expect(keyboard).toBeVisible({ timeout: 10000 });
  const text = 'the quick brown fox jumps over the lazy dog again and again';
  const typedAt = [];
  for (const char of text) {
    const name = char === ' ' ? 'Space' : char;
    typedAt.push(Date.now());
    await keyboard.getByRole('button', { name, exact: true }).click();
  }
  await expect.poll(() => commands().filter(c => c.command.action === 'type').map(c => c.command.text).join(''), { timeout: 10000 }).toBe(text);
  const typeEvents = commands().filter(c => c.command.action === 'type');
  // Each type command carries one or more characters; latency is from the first key in it.
  let index = 0; const typeLatency = [];
  for (const event of typeEvents) { typeLatency.push(event.t - typedAt[index]); index += event.command.text.length; }

  step('pointer: 120 trackpad moves while video streams');
  const pad = phone.getByRole('application', { name: 'Trackpad' });
  const box = await pad.boundingBox();
  const startCount = commands().filter(c => ['move', 'drag'].includes(c.command.action)).length;
  const start = { x: box.x + 20, y: box.y + box.height / 2 };
  await phone.mouse.move(start.x, start.y); await phone.mouse.down();
  const movedAt = [];
  for (let i = 1; i <= 120; i++) {
    movedAt.push(Date.now());
    await phone.mouse.move(start.x + (i % 60) * 4, start.y + Math.sin(i / 8) * 20);
    await phone.waitForTimeout(16);
  }
  await phone.mouse.up();
  await phone.waitForTimeout(1500);
  const moves = commands().filter(c => ['move', 'drag'].includes(c.command.action)).slice(startCount);
  const gaps = moves.slice(1).map((m, i) => m.t - moves[i].t);
  const total = moves.reduce((sum, m) => sum + Math.abs(m.command.dx) + Math.abs(m.command.dy), 0);
  const stats = {
    typeCommands: typeEvents.length,
    typeLatencyMs: { p50: percentile(typeLatency, 0.5), p95: percentile(typeLatency, 0.95), max: Math.max(...typeLatency) },
    pointerCommands: moves.length,
    pointerEndToEndMs: moves.length ? moves.at(-1).t - movedAt[0] : NaN,
    pointerGapMs: { p50: percentile(gaps, 0.5), p95: percentile(gaps, 0.95), max: Math.max(...gaps) },
    pointerDistance: Math.round(total),
  };
  console.log('  ' + JSON.stringify(stats));
  assert.ok(moves.length >= 30, 'pointer moves arrive');
  assert.ok(stats.typeLatencyMs.p95 < 500, 'typing reaches the driver quickly');
  assert.ok(stats.pointerGapMs.max < 500, 'no long pointer stalls');

  mac.send('quit'); await mac.exited;
  console.log('E2E INPUT PASSED');
}

try { await main(); }
catch (error) {
  console.error('E2E INPUT FAILED:', error.message);
  await failurePage?.screenshot({ path: new URL('../target/e2e/input-failure.png', import.meta.url).pathname }).catch(() => {});
  process.exitCode = 1;
}
finally { await runCleanups(); }
