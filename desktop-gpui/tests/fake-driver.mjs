#!/usr/bin/env node
// Stand-in for bin/mac_driver in tests: records every command with its arrival
// time (to $FAKE_DRIVER_LOG) and answers listApps, so input tests never move the
// real pointer or type on this Mac.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const log = process.env.FAKE_DRIVER_LOG;
for await (const line of createInterface({ input: process.stdin })) {
  const command = JSON.parse(line);
  if (log) appendFileSync(log, JSON.stringify({ t: Date.now(), command }) + '\n');
  if (command.action === 'listApps') {
    process.stdout.write(JSON.stringify({ action: 'listApps', requestId: command.requestId, apps: [{ pid: 1, name: 'Finder', bundleId: 'com.apple.finder', active: true }], features: [] }) + '\n');
  }
}
