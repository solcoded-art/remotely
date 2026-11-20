const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCommand } = require('../shared/commands.cjs');

test('only bounded native input and approved app commands can reach the driver', () => {
  const commands = [
    { action: 'move', dx: 2, dy: -3 }, { action: 'moveTo', normX: .1, normY: .9 },
    { action: 'click', button: 'right' }, { action: 'key', code: 49, modifiers: ['cmd'] },
    { action: 'type', text: 'Hello 世界 👋' }, { action: 'launchApp', bundleId: 'com.microsoft.VSCode' },
    { action: 'appIcon', bundleId: 'com.google.Chrome' },
  ];
  for (const command of commands) assert.deepEqual(validateCommand(command), command);
  for (const command of [
    { action: 'shell', command: 'arbitrary command' }, { action: 'setDisplay', displayId: 1 },
    { action: 'move', dx: Infinity, dy: 0 }, { action: 'scroll', dx: 2 ** 32, dy: 0 },
    { action: 'moveTo', normX: -1, normY: .5 }, { action: 'key', code: -1, modifiers: [] },
    { action: 'type', text: 'x'.repeat(4097) }, { action: 'launchApp', bundleId: 'unapproved.app' },
    { action: 'appIcon', bundleId: '../etc/passwd' }, { action: 'appIcon', bundleId: 'x'.repeat(201) },
  ]) assert.throws(() => validateCommand(command));
  assert.deepEqual(validateCommand({ action: 'listApps', unexpected: 'drop me' }), { action: 'listApps' });
});
