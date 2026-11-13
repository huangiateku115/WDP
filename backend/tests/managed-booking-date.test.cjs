const { test } = require('node:test');
const assert = require('node:assert/strict');
const { managedVietnamDateKey, isManagedBookingDateAllowed } = require('../dist/utils/managed-booking-date');
const { managedSigningDeadline } = require('../dist/utils/managed-signing-deadline');

const instant = (date, time) => new Date(`${date}T${time}:00.000Z`);

test('Managed V3 booking date uses Asia/Ho_Chi_Minh calendar date across UTC midnight and rollover', () => {
  const startToday = new Date('2026-11-12T00:00:00.000Z');
  for (const now of [
    instant('2026-11-11', '17:15'), // 00:15 Vietnam
    instant('2026-11-11', '23:59'), // 06:59 Vietnam
    instant('2026-11-12', '00:01'), // 07:01 Vietnam
    instant('2026-11-12', '05:00'), // 12:00 Vietnam
    instant('2026-11-12', '16:59'), // 23:59 Vietnam
  ]) {
    assert.equal(managedVietnamDateKey(now), '2026-11-12');
    assert.equal(isManagedBookingDateAllowed(startToday, now), true);
  }
  const afterRollover = instant('2026-11-12', '17:00'); // 00:00 Vietnam on Nov 13
  assert.equal(managedVietnamDateKey(afterRollover), '2026-11-13');
  assert.equal(isManagedBookingDateAllowed(startToday, afterRollover), false);
  assert.equal(isManagedBookingDateAllowed(new Date('2026-11-13T00:00:00.000Z'), afterRollover), true);
});

test('invalid date inputs fail closed', () => {
  assert.equal(isManagedBookingDateAllowed(new Date(Number.NaN), new Date()), false);
  assert.equal(isManagedBookingDateAllowed(new Date(), new Date(Number.NaN)), false);
  assert.throws(() => managedVietnamDateKey(new Date(Number.NaN)), /valid date/i);
});

test('same-day signing deadline remains in the future for a Vietnam-local start date', () => {
  const startDate = new Date('2030-01-01T00:00:00.000Z');
  const deadline = managedSigningDeadline(startDate);
  assert.ok(deadline > new Date('2030-01-01T01:00:00.000Z'));
  assert.equal(managedVietnamDateKey(startDate), '2030-01-01');
});
