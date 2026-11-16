const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupMessage } = require('../signaling/startup-error.cjs');

test('startup diagnostics identify failures without printing credential-bearing error text', () => {
  const credential = 'postgresql://private-user:private-password@private-host/private-database';
  const cases = [
    [{ code: 'DATABASE_URL_MISSING', message: credential }, /DATABASE_URL is missing/],
    [{ code: 'DATABASE_URL_INVALID', message: credential }, /valid PostgreSQL/],
    [{ code: 'PUBLIC_URL_INVALID', message: credential }, /PUBLIC_URL/],
    [{ code: '28P01', message: credential }, /rejected the password/],
    [{ code: '42501', message: credential }, /lacks permission/],
    [{ errors: [{ code: 'ECONNREFUSED', message: credential }] }, /not accepting connections/],
    [{ code: 'EADDRINUSE', message: credential }, /port is already in use/],
    [{ message: credential, detail: credential, stack: credential, code: credential }, /initializing the account service/],
  ];
  for (const [error, expected] of cases) {
    const message = startupMessage(error);
    assert.match(message, expected);
    for (const secret of ['private-user', 'private-password', 'private-host', 'private-database']) assert.ok(!message.includes(secret));
  }
});
