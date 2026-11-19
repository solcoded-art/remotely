const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDisplayCaptureHandler } = require('../desktop/display-capture.cjs');

test('capture accepts Electron serialized origins only for the approved main frame and selected display', async () => {
  const frame = {}; const source = { id: 'screen:1' }; let calls = 0;
  const state = { sessionId: 'approved-session', sourceId: source.id, frame };
  const handler = createDisplayCaptureHandler(() => state, async () => { calls++; return [source, { id: 'screen:2' }]; });
  const request = { frame, securityOrigin: 'app://macremote/', videoRequested: true, audioRequested: false };
  const invoke = (value = request) => new Promise(resolve => handler(value, resolve));
  assert.deepEqual(await invoke(), { video: source });
  assert.deepEqual(await invoke({ ...request, securityOrigin: 'app://macremote' }), { video: source });
  for (const origin of ['https://macremote/', 'app://macremote.evil/', 'app://other/', 'app://macremote:123/', 'app://macremote/other', 'null']) assert.deepEqual(await invoke({ ...request, securityOrigin: origin }), {});
  assert.deepEqual(await invoke({ ...request, frame: {} }), {});
  assert.deepEqual(await invoke({ ...request, frame: null }), {});
  assert.deepEqual(await invoke({ ...request, audioRequested: true }), {});
  state.sessionId = null; assert.deepEqual(await invoke(), {});
  assert.equal(calls, 2, 'unauthorized calls must not enumerate displays');
});

test('capture is denied when approval is revoked while display enumeration is pending', async () => {
  const frame = {}; let state = { sessionId: 'session-1', sourceId: 'screen:1', frame };
  const handler = createDisplayCaptureHandler(() => state, async () => { state = { ...state, sessionId: null }; return [{ id: 'screen:1' }]; });
  assert.deepEqual(await new Promise(resolve => handler({ frame, securityOrigin: 'app://macremote/', videoRequested: true, audioRequested: false }, resolve)), {});
});
