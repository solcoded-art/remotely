// Shared helpers for the GPUI end-to-end tests (run through scripts/test-with-postgres.cjs).
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createService } = require('../../signaling/service.cjs');
const { Client } = require('pg');
export const binary = new URL('../target/e2e/debug/mac-remote', import.meta.url).pathname;
export const cleanups = [];

/** The real signaling service on a fresh database, with mail captured in memory. */
export async function startService() {
  assert.ok(process.env.TEST_DATABASE_URL, 'Run through scripts/test-with-postgres.cjs.');
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const dbName = `remote_e2e_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  cleanups.push(async () => { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await admin.end(); });
  const databaseURL = new URL(process.env.TEST_DATABASE_URL); databaseURL.pathname = '/' + dbName;
  const mails = [];
  const service = await createService({ publicURL: 'http://127.0.0.1:3000', authSecret: randomBytes(48).toString('base64url'), sendMail: async mail => { mails.push(mail); }, databaseURL: databaseURL.toString() });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  cleanups.unshift(() => service.close());
  const url = `http://127.0.0.1:${service.server.address().port}`;
  const api = async (route, token, data) => {
    const response = await fetch(url + route, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  /** Signs in by email link through the API and returns `{ user, token, expires }`. */
  const account = async email => {
    assert.equal((await api('/api/auth/magic-link', null, { email })).status, 200);
    const link = mails.findLast(mail => mail.email === email).url;
    return (await api('/api/auth/verify-link', null, { email, token: new URL(link).hash.slice('#sign-in='.length) })).data;
  };
  return { url, api, mails, account };
}

export async function runCleanups() {
  for (const cleanup of cleanups) { try { await cleanup(); } catch {} }
}

/** Starts the GPUI app (e2e build) signed in with `token`, reading its `E2E` state lines. */
export function startMac(url, token) {
  const child = spawn(binary, [], { env: { ...process.env, MAC_REMOTE_E2E_SERVER: url, MAC_REMOTE_E2E_TOKEN: token }, stdio: ['pipe', 'pipe', 'inherit'] });
  cleanups.unshift(() => { if (child.exitCode === null) child.kill(); });
  const states = []; const waiters = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!line.startsWith('E2E ')) continue;
      const state = JSON.parse(line.slice(4)); states.push(state);
      if (state.error) console.log(`  (Mac error: ${state.error})`);
      for (const waiter of [...waiters]) if (waiter.test(state)) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(state); }
    }
  });
  const exited = once(child, 'exit');
  return {
    exited,
    send: line => child.stdin.write(line + '\n'),
    until: (test, label, ms = 20000) => {
      const last = states.at(-1); if (last && test(last)) return Promise.resolve(last);
      return new Promise((resolve, reject) => waiters.push({ test, resolve, timer: setTimeout(() => reject(Error(`Timed out: ${label}. Last state: ${JSON.stringify(states.at(-1))}`)), ms) }));
    },
  };
}


/** Removes the Keychain vault item the app created for this run's throwaway server. */
export function deleteKeychainItem(url) {
  try { execFileSync('security', ['delete-generic-password', '-s', 'app.enftify.macremote.gpui', '-a', url], { stdio: 'ignore' }); } catch {}
}
