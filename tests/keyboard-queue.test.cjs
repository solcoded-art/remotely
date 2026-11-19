const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../shared/keyboard-queue.mjs');

test('keyboard bursts retain order and stay below eight commands per 80ms window', async t => {
  const { KeyboardQueue } = await modulePromise; t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = []; const queue = new KeyboardQueue(command => { sent.push(command); return true; }, () => {}, message => assert.fail(message));
  t.after(() => queue.cancel());
  for (let i = 0; i < 24; i++) queue.enqueue([{ action: 'key', code: i, modifiers: [] }]);
  // Individually enqueued keys must also respect the cooldown, not just a single large batch.
  assert.ok(sent.length <= 8); t.mock.timers.tick(80); assert.ok(sent.length <= 16);
  t.mock.timers.tick(80); t.mock.timers.tick(80);
  assert.deepEqual(sent.map(command => command.code), Array.from({ length: 24 }, (_, i) => i));
});

test('cancelled or failed keyboard queues never replay pending input', async t => {
  const { KeyboardQueue } = await modulePromise; t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = []; let errors = 0;
  const queue = new KeyboardQueue(command => { sent.push(command); return true; }, () => {}, () => { errors++; });
  queue.enqueue(Array.from({ length: 24 }, () => ({ action: 'key', code: 51, modifiers: [] })));
  assert.equal(sent.length, 8); queue.cancel(); t.mock.timers.tick(1000); assert.equal(sent.length, 8);
  const failed = new KeyboardQueue(() => false, () => {}, () => { errors++; });
  failed.enqueue(Array.from({ length: 20 }, () => ({ action: 'key', code: 51, modifiers: [] })));
  t.mock.timers.tick(1000); assert.equal(failed.pending, 0); assert.equal(errors, 1);
});

test('keyboard input is bounded before sending and preserves multiline Unicode text', async t => {
  const { KeyboardQueue } = await modulePromise;
  const sent = []; const errors = [];
  const queue = new KeyboardQueue(command => { sent.push(command); return true; }, () => {}, message => errors.push(message)); t.after(() => queue.cancel());
  assert.equal(queue.enqueue([{ action: 'type', text: 'x'.repeat(4097) }]), false);
  assert.equal(queue.enqueue(Array.from({ length: 257 }, () => ({ action: 'key', code: 0, modifiers: ['cmd'] }))), false);
  assert.equal(sent.length, 0); assert.equal(errors.length, 2);
  const text = 'First line\n日本語 👋\nThird line';
  assert.equal(queue.enqueue([{ action: 'type', text }]), true); assert.equal(sent[0].text, text);
});
