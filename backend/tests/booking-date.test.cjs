const { test } = require('node:test');
const assert = require('node:assert/strict');
const { vietnamDateKey, isBookingDateAllowed } = require('../dist/utils/booking-date');

const utc = value => new Date(value);

test('booking date policy uses Asia/Ho_Chi_Minh for yesterday, today and tomorrow at day boundaries', () => {
  const date = '2026-11-16';
  const startToday = utc(date + 'T00:00:00.000Z');
  for (const now of [
    utc('2026-11-15T17:05:00.000Z'), // 00:05 Vietnam
    utc('2026-11-16T05:00:00.000Z'), // 12:00 Vietnam
    utc('2026-11-16T16:55:00.000Z'), // 23:55 Vietnam
  ]) {
    assert.equal(vietnamDateKey(now), date);
    assert.equal(isBookingDateAllowed(utc('2026-11-15T00:00:00.000Z'), now), false);
    assert.equal(isBookingDateAllowed(startToday, now), true);
    assert.equal(isBookingDateAllowed(utc('2026-11-17T00:00:00.000Z'), now), true);
  }
});

test('booking date policy rejects invalid timestamps', () => {
  assert.equal(isBookingDateAllowed(new Date(Number.NaN), new Date()), false);
  assert.equal(isBookingDateAllowed(new Date(), new Date(Number.NaN)), false);
  assert.throws(() => vietnamDateKey(new Date(Number.NaN)), /valid date/i);
});
