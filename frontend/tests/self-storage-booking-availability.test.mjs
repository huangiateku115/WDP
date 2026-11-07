import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { availabilityMatches, buildAvailabilityDays, monthKey, rangeContainsDay, shiftMonth } from '../src/lib/selfStorageAvailability.js';
import { selfStorageCreation, selfStorageRequest } from '../src/lib/selfStorageReservation.js';
import { rentalEndDate } from '../src/lib/rentalPeriod.js';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';
import { transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';

const facilityId = '507f1f77bcf86cd799439011';
const unitId = '507f1f77bcf86cd799439012';
const reservationId = '507f1f77bcf86cd799439013';
const pricingId = '507f1f77bcf86cd799439014';

test('monthly availability calendar uses bounded UTC intervals and range-safe matching', () => {
  assert.equal(monthKey('2026-11-03'), '2026-11');
  assert.equal(shiftMonth('2026-11', 1), '2026-12');
  const days = buildAvailabilityDays('2026-11', [{ startDate: '2026-11-10T00:00:00.000Z', endDate: '2026-11-12T00:00:00.000Z' }], '2026-11-01');
  const tenth = days.find(day => day?.date === '2026-11-10');
  const twelfth = days.find(day => day?.date === '2026-11-12');
  assert.equal(tenth.booked, true);
  assert.equal(twelfth.booked, false, 'half-open checkout boundary is free on the 12th');
  assert.equal(rangeContainsDay('2026-11-09', '2026-11-15', '2026-11-12'), true);
  assert.equal(rangeContainsDay('2026-11-12', '2026-11-15', '2026-11-10'), false);
  const response = { storageUnitId: unitId, month: '2026-11', availabilityState: 'VERIFIED', intervals: [], rangeAvailability: 'AVAILABLE', requestedRange: { startDate: '2026-11-09T00:00:00.000Z', endDate: '2026-11-15T00:00:00.000Z' } };
  assert.equal(availabilityMatches(response, { unitId, month: '2026-11', startDate: '2026-11-09', endDate: '2026-11-15' }), true);
  assert.equal(availabilityMatches(response, { unitId: '507f1f77bcf86cd799439099', month: '2026-11', startDate: '2026-11-09', endDate: '2026-11-15' }), false);
  assert.equal(availabilityMatches({ ...response, availabilityState: 'UNKNOWN' }, { unitId, month: '2026-11' }), true);
});

test('Self-Storage booking may choose a future date for a HELD/OCCUPIED unit, but rejects maintenance', () => {
  const startDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const rule = { _id: pricingId, facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', isActive: true, term: { value: 1, unit: 'MONTH' }, price: 1000, currency: 'VND', effectiveFrom: '2020-01-01T00:00:00.000Z' };
  const draft = { facility: { _id: facilityId, serviceTypes: ['SELF_STORAGE'], status: 'ACTIVE' }, unit: { _id: unitId, facilityId, size: 'SMALL', status: 'OCCUPIED' }, term: rule.term, startDate, endDate: rentalEndDate(startDate, rule.term), quote: { price: rule } };
  assert.equal(selfStorageRequest(draft).storageUnitId, unitId);
  assert.throws(() => selfStorageRequest({ ...draft, unit: { ...draft.unit, status: 'MAINTENANCE' } }), /Select an available Self Storage unit/);
});

test('booking creation accepts only a fresh CONTRACTED Self-Storage response without approval identity', () => {
  const payload = { facilityId, storageUnitId: unitId, startDate: '2026-12-01T00:00:00.000Z', endDate: '2027-01-01T00:00:00.000Z' };
  const reservation = { _id: reservationId, serviceType: 'SELF_STORAGE', status: 'CONTRACTED', facilityId, storageUnitId: unitId, startDate: payload.startDate, endDate: payload.endDate, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(selfStorageCreation({ data: { success: true, data: reservation } }, payload), reservation);
  assert.throws(() => selfStorageCreation({ data: { success: true, data: { ...reservation, status: 'RESERVED' } } }, payload), /did not confirm/);
  assert.throws(() => selfStorageCreation({ data: { success: true, data: { ...reservation, approvedBy: reservationId } } }, payload), /did not confirm/);
});

test('Customer booking routes to PayOS summary and Step 2 exposes accessible monthly availability UI', async () => {
  const [review, period, checkout, lifecycle] = await Promise.all([
    readFile(new URL('../src/components/customer/SelfStorageReservationReview.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/customer/RentalPeriodIntegration.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/customer/SelfStoragePayosCheckout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/customer/RentalLifecycleIntegration.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(review, /paymentApi\.createPayosCheckout\(createdReservationId, "DEPOSIT", attempt\.idempotencyKey\)/);
  assert.match(review, /nav\("\/portal\/payments\/" \+ createdReservationId/);
  assert.match(period, /aria-label=\{`Availability calendar for \$\{visibleMonth\}`\}/);
  assert.match(period, /Previous month/);
  assert.match(period, /lg:grid-cols/);
  assert.match(period, /rangeState === "CONFLICT"/);
  assert.match(checkout, /Hosted Checkout chính thức của PayOS/);
  assert.doesNotMatch(checkout, /Rental overview|Reservation reference|Contract status|Payment reference/);
  assert.match(lifecycle, /Self Storage booking confirmed/);
  assert.doesNotMatch(lifecycle, /selfStorageCreated && \(\s*<Message success=" Waiting for management approval/);
});

test('availability GET is allowlisted with Axios params while invalid IDs, methods and unrelated paths stay blocked', async () => {
  const path = `/storage-units/${unitId}/availability`;
  const params = { month: '2026-11', startDate: '2026-11-10', endDate: '2026-12-10' };
  assert.doesNotThrow(() => assertConfirmedRequest({ method: 'get', url: path, params }));
  for (const request of [
    { method: 'GET', url: '/storage-units/not-an-object-id/availability', params },
    ...['POST', 'PATCH', 'DELETE'].map(method => ({ method, url: path, params })),
    { method: 'GET', url: `/storage-units/${unitId}/restore`, params },
  ]) assert.throws(() => assertConfirmedRequest(request));

  const calls = [];
  const source = readFileSync(new URL('../src/api/storageApi.js', import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'js', format: 'cjs', define: { 'import.meta.env': JSON.stringify({ VITE_USE_MOCK: 'false' }) } }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => name === './axiosClient'
    ? { __esModule: true, default: { get: (...args) => { calls.push(args); return Promise.resolve({}); } } }
    : { mockStorageUnits: [] }, module, module.exports);
  await module.exports.default.availability(unitId, params);
  assert.equal(calls[0][0], path);
  assert.deepEqual(calls[0][1].params, params);
  assert.doesNotThrow(() => assertConfirmedRequest({ method: 'GET', url: calls[0][0], params: calls[0][1].params }));
});
