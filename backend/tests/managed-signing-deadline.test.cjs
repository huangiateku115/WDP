const { test } = require('node:test');
const assert = require('node:assert/strict');
const { managedSigningDeadline } = require('../dist/utils/managed-signing-deadline');

test('Managed V3 signing deadline is exclusive midnight after third Ho Chi Minh calendar day', () => {
  const deadline = managedSigningDeadline(new Date('2026-11-11T17:00:00.000Z'));
  assert.equal(deadline.toISOString(), '2026-11-15T17:00:00.000Z');
  assert.equal(deadline.getTime() - 1, Date.parse('2026-11-15T16:59:59.999Z'));
  assert.throws(() => managedSigningDeadline(new Date('invalid')), /valid rental start date/);
});

test('Managed V3 deadline uses the local rental-start date near UTC date boundary', () => {
  const deadline = managedSigningDeadline(new Date('2026-11-12T16:59:00.000Z'));
  assert.equal(deadline.toISOString(), '2026-11-15T17:00:00.000Z');
});
