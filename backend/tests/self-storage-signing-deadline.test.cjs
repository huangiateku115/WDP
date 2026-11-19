const { test } = require('node:test');
const assert = require('node:assert/strict');

let selfStorageSigningDeadline;
try {
  ({ selfStorageSigningDeadline } = require('../dist/utils/self-storage-signing-deadline'));
} catch {
  ({ selfStorageSigningDeadline } = require('../src/utils/self-storage-signing-deadline'));
}

test('Self Storage contract deadline is the existing three-day window from verified payment time', () => {
  const paidAt = new Date('2026-11-19T10:15:00.000Z');
  assert.equal(selfStorageSigningDeadline(paidAt).toISOString(), '2026-11-22T10:15:00.000Z');
});

test('Self Storage deadline helper rejects invalid payment timestamps', () => {
  assert.throws(() => selfStorageSigningDeadline(new Date(Number.NaN)), /valid payment confirmation time/);
});
