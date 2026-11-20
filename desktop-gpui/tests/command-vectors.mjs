// Regenerates tests/fixtures/command-vectors.json from shared/commands.cjs, the
// reference validator Electron uses. src/commands.rs must produce the same output
// (or reject) for every case. Usage: node desktop-gpui/tests/command-vectors.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { validateCommand } = createRequire(import.meta.url)('../../shared/commands.cjs');

const cases = [
  { action: 'move', dx: 2, dy: -3 }, { action: 'drag', dx: 0.5, dy: 4000 }, { action: 'scroll', dx: -4000, dy: 1e-9 },
  { action: 'move', dx: 4000.0001, dy: 0 }, { action: 'move', dx: 1 }, { action: 'move', dx: '1', dy: 1 }, { action: 'scroll', dx: 2 ** 32, dy: 0 },
  { action: 'moveTo', normX: 0.1, normY: 0.9 }, { action: 'moveTo', normX: 0, normY: 1 }, { action: 'moveTo', normX: -1, normY: 0.5 }, { action: 'moveTo', normX: 1.01, normY: 0.5 },
  { action: 'click', button: 'left' }, { action: 'click', button: 'right' }, { action: 'click', button: 'double' }, { action: 'down', button: 'double' }, { action: 'up', button: 'left' }, { action: 'click', button: 'middle' },
  { action: 'key', code: 49, modifiers: ['cmd'] }, { action: 'key', code: 0, modifiers: [] }, { action: 'key', code: 126, modifiers: ['cmd', 'ctrl', 'alt', 'shift'] },
  { action: 'key', code: 127, modifiers: [] }, { action: 'key', code: -1, modifiers: [] }, { action: 'key', code: 1.5, modifiers: [] }, { action: 'key', code: 3, modifiers: ['fn'] },
  { action: 'key', code: 3, modifiers: ['cmd', 'cmd', 'cmd', 'cmd', 'cmd'] }, { action: 'key', code: 3 }, { action: 'key', code: 3, modifiers: 'cmd' },
  { action: 'type', text: 'Hello 世界 👋' }, { action: 'type', text: '' }, { action: 'type', text: 'x'.repeat(4096) }, { action: 'type', text: 'x'.repeat(4097) },
  { action: 'type', text: '😀'.repeat(2048) }, { action: 'type', text: '😀'.repeat(2049) }, { action: 'type', text: 7 },
  { action: 'listApps', unexpected: 'drop me' }, { action: 'getBounds' }, { action: 'getPos' }, { action: 'releaseAll' }, { action: 'status' },
  { action: 'activateApp', pid: 124 }, { action: 'activateApp', pid: 0 }, { action: 'activateApp', pid: 2147483648 }, { action: 'activateApp', pid: 1.5 },
  { action: 'launchApp', bundleId: 'com.microsoft.VSCode' }, { action: 'launchApp', bundleId: 'unapproved.app' },
  { action: 'appIcon', bundleId: 'com.google.Chrome' }, { action: 'appIcon', bundleId: '../etc/passwd' }, { action: 'appIcon', bundleId: 'x'.repeat(200) }, { action: 'appIcon', bundleId: 'x'.repeat(201) },
  { action: 'shell', command: 'arbitrary command' }, { action: 'setDisplay', displayId: 1 }, { dx: 1 }, [], null, 'listApps',
  { action: 'listApps', requestId: 'r-1' }, { action: 'move', dx: 1, dy: 1, requestId: 'x'.repeat(80) }, { action: 'move', dx: 1, dy: 1, requestId: 'x'.repeat(81) },
  { action: 'listApps', requestId: 5 }, { action: 'click', button: 'left', requestId: '😀'.repeat(40) }, { action: 'click', button: 'left', requestId: '😀'.repeat(41) },
];
const vectors = cases.map(input => { try { return { input, output: validateCommand(input) }; } catch { return { input, output: null }; } });
writeFileSync(new URL('./fixtures/command-vectors.json', import.meta.url), JSON.stringify(vectors, null, 1) + '\n');
console.log(`wrote ${vectors.length} command vectors`);
