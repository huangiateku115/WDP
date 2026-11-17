'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { parseStatisticsQuery, StatisticsQueryError } = require('../dist/services/statistics/statistics.validation');
const { StatisticsService, StatisticsServiceError } = require('../dist/services/statistics/statistics.service');
const Facility = require('../dist/models/facilities/facility.model').default;
const { PaymentStatus } = require('../dist/types/payment.type');
const { MaintenanceStatus } = require('../dist/types/maintenance-ticket.type');

const facilityA = '507f1f77bcf86cd799439011';
const facilityB = '507f1f77bcf86cd799439012';
const actor = (role, assignedFacilityId = null) => ({ _id: new Types.ObjectId(), role, assignedFacilityId: assignedFacilityId ? new Types.ObjectId(assignedFacilityId) : null });

test('statistics dates default to the last 30 Vietnam calendar days and use an exclusive next-day boundary', () => {
  const query = parseStatisticsQuery({}, new Date('2026-11-16T03:00:00.000Z'));
  assert.equal(query.from.toISOString(), '2026-10-17T17:00:00.000Z');
  assert.equal(query.toExclusive.toISOString(), '2026-11-16T17:00:00.000Z');
  const custom = parseStatisticsQuery({ fromDate: '2026-11-01', toDate: '2026-11-02' });
  assert.equal(custom.from.toISOString(), '2026-10-31T17:00:00.000Z');
  assert.equal(custom.toExclusive.toISOString(), '2026-11-02T17:00:00.000Z');
});

test('statistics query validation rejects invalid dates, excessive ranges, unknown params and invalid pagination', () => {
  assert.throws(() => parseStatisticsQuery({ fromDate: '2026-02-30' }), StatisticsQueryError);
  assert.throws(() => parseStatisticsQuery({ fromDate: '2025-01-01', toDate: '2026-11-16' }), error => error.code === 'DATE_RANGE_TOO_LARGE');
  assert.throws(() => parseStatisticsQuery({ anything: 'no' }), error => error.code === 'INVALID_QUERY');
  assert.throws(() => parseStatisticsQuery({ page: '0' }), error => error.code === 'INVALID_PAGINATION');
  assert.throws(() => parseStatisticsQuery({ facilityId: 'nope' }), error => error.code === 'INVALID_FACILITY_ID');
  assert.throws(() => parseStatisticsQuery({ granularity: 'year' }), error => error.code === 'INVALID_GRANULARITY');
});

test('paymentStatus validates all current PaymentStatus values independently of Phase 1-2 status', () => {
  for (const status of Object.values(PaymentStatus)) assert.equal(parseStatisticsQuery({ paymentStatus: status }).paymentStatus, status);
  assert.throws(() => parseStatisticsQuery({ paymentStatus: 'NOT_A_PAYMENT_STATUS' }), error => error instanceof StatisticsQueryError && error.code === 'INVALID_PAYMENT_STATUS');
  assert.equal(parseStatisticsQuery({ status: 'ACTIVE' }).status, 'ACTIVE');
  assert.throws(() => parseStatisticsQuery({ status: 'SUCCEEDED' }), error => error instanceof StatisticsQueryError && error.code === 'INVALID_STATUS');
});

test('shared status validation accepts MaintenanceStatus without changing other status enums', () => {
  for (const status of Object.values(MaintenanceStatus)) assert.equal(parseStatisticsQuery({ status }).status, status);
  assert.equal(parseStatisticsQuery({ status: 'ACTIVE' }).status, 'ACTIVE');
  assert.throws(() => parseStatisticsQuery({ status: 'SUCCEEDED' }), error => error instanceof StatisticsQueryError && error.code === 'INVALID_STATUS');
});

test('ADMIN and BOM may request global scope or an explicit Facility scope', async () => {
  const admin = await StatisticsService.resolveScope(actor('ADMIN'), {});
  assert.equal(admin.scope.type, 'ALL');
  const bom = await StatisticsService.resolveScope(actor('BOM'), { facilityId: facilityA });
  assert.equal(bom.scope.type, 'FACILITY');
  assert.equal(bom.scope.facilityId.toString(), facilityA);
});

test('CUSTOMER and FACILITY_STAFF are denied even if service is called outside the route middleware', async () => {
  await assert.rejects(StatisticsService.resolveScope(actor('CUSTOMER'), {}), error => error.status === 403 && error.code === 'STATISTICS_FORBIDDEN');
  await assert.rejects(StatisticsService.resolveScope(actor('FACILITY_STAFF', facilityA), {}), error => error.status === 403 && error.code === 'STATISTICS_FORBIDDEN');
});

test('Facility Manager cannot override assignment and must have an active assigned Facility', async t => {
  await assert.rejects(StatisticsService.resolveScope(actor('FACILITY_MANAGER', facilityA), { facilityId: facilityB }), error => error instanceof StatisticsServiceError && error.status === 403);
  await assert.rejects(StatisticsService.resolveScope(actor('FACILITY_MANAGER'), {}), error => error instanceof StatisticsServiceError && error.code === 'FACILITY_ASSIGNMENT_REQUIRED');
  const chain = { select() { return this; }, lean() { return this; }, exec: async () => ({ _id: new Types.ObjectId(facilityA) }) };
  t.mock.method(Facility, 'findOne', filter => { assert.equal(String(filter._id), facilityA); assert.deepEqual(filter.deletedAt, { $exists: false }); return chain; });
  const resolved = await StatisticsService.resolveScope(actor('FACILITY_MANAGER', facilityA), {});
  assert.equal(resolved.scope.facilityId.toString(), facilityA);
});
