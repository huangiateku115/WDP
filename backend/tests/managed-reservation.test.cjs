const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test', MONGO_URL: 'mongodb+srv://cluster.example.invalid/test',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const Facility = require('../dist/models/facilities/facility.model').default;
const Capacity = require('../dist/models/reservations/managed-facility-capacity.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Profile = require('../dist/models/users/customer-profile.model').default;
const Price = require('../dist/models/pricing-policy/pricing-rule.model').default;
const Policy = require('../dist/models/pricing-policy/policy.model').default;
const Contract = require('../dist/models/contracts/contract.model').default;
const ManagedAudit = require('../dist/models/reservations/managed-reservation-audit.model').default;
const { ManagedReservationService: service, ManagedReservationError } = require('../dist/services/reservations/managed-reservation.service');
const { UserRole } = require('../dist/types/user.type');

const fid = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const cid = new mongoose.Types.ObjectId('507f1f77bcf86cd799439071');
const mid = new mongoose.Types.ObjectId('507f1f77bcf86cd799439081');
const oid = value => new mongoose.Types.ObjectId(value);
const future = '2030-01-01T00:00:00.000Z';
const request = extra => ({ facilityId: String(fid), allocatedCapacityM3: 1.5, startDate: future, term: { value: 1, unit: 'MONTH' }, ...extra });
const customer = { _id: cid, role: UserRole.CUSTOMER, assignedFacilityId: null };
const manager = { _id: mid, role: UserRole.FACILITY_MANAGER, assignedFacilityId: fid };

class Query {
  constructor(value) { this.value = value; }
  session() { return this; } select() { return this; } limit() { return this; } lean() { return this; }
  exec() { return Promise.resolve(this.value); }
}
function mockQuote(t, options = {}) {
  const cap = options.capacity ?? { _id: oid('507f1f77bcf86cd799439091'), facilityId: fid, sellableCapacityM3: 10, holdDurationMinutes: 30, bookingVersion: 1, isActive: true };
  const commitments = options.commitments ?? [];
  t.mock.method(Facility, 'findOne', filter => {
    assert.equal(String(filter._id), String(fid));
    assert.equal(filter.status, 'ACTIVE');
    assert.equal(filter.serviceTypes, 'MANAGED_INVENTORY');
    return new Query(options.facility === false ? null : { _id: fid, serviceTypes: ['MANAGED_INVENTORY'], status: 'ACTIVE' });
  });
  t.mock.method(Capacity, 'findOne', () => new Query(options.capacity === null ? null : cap));
  t.mock.method(Reservation, 'find', filter => {
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    assert.deepEqual(filter.startDate, { $lt: new Date('2030-02-01T00:00:00.000Z') });
    assert.ok(filter.$and.some(group => group.$or?.some(clause => clause.status === 'OVERDUE')),
      'overdue records remain queryable even after contractual endDate');
    assert.ok(filter.$and.some(group => group.$or?.some(clause => clause.expiresAt?.$gt instanceof Date)), 'unpaid holds require a future explicit expiration');
    return new Query(commitments);
  });
  t.mock.method(Price, 'find', filter => {
    assert.equal(filter.billingBasis, 'PER_M3');
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    assert.equal(filter['term.value'], 1);
    return new Query(options.prices ?? [{ _id: oid('507f1f77bcf86cd7994390a1'), price: 100, currency: 'VND', version: 3, billingBasis: 'PER_M3' }]);
  });
  t.mock.method(Policy, 'find', filter => {
    assert.equal(filter.type, 'DEPOSIT');
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    return new Query(options.deposits ?? [{ _id: oid('507f1f77bcf86cd7994390b1'), config: { calculation: 'PERCENT_OF_RENT', percentage: 20 }, version: 2 }]);
  });
  return { cap };
}

test('Managed capacity model has one configuration per Facility and lock version', () => {
  assert.ok(Capacity.schema.indexes().some(([keys, opts]) => keys.facilityId === 1 && opts.unique));
  assert.equal(Capacity.schema.path('bookingVersion').instance, 'Number');
});

test('quote uses explicit per-m3 rate, percentage deposit and calendar term; never selects a Cell', async t => {
  mockQuote(t);
  const result = await service.quote(request());
  assert.equal(result.allocatedCapacityM3, 1.5);
  assert.equal(result.endDate.toISOString(), '2030-02-01T00:00:00.000Z');
  assert.equal(result.pricing.ratePerM3, 100);
  assert.equal(result.pricing.estimatedRent, 150);
  assert.equal(result.deposit.percentage, 20);
  assert.equal(result.deposit.amount, 30);
  assert.equal(result.availableCapacityM3, 10);
  assert.equal(Object.hasOwn(result, 'storageUnitId'), false);
});

test('availability uses peak concurrent intervals rather than every overlapping row sum', async t => {
  mockQuote(t, { capacity: { sellableCapacityM3: 10, isActive: true }, commitments: [
    { startDate: new Date('2030-01-01T00:00:00Z'), endDate: new Date('2030-01-15T00:00:00Z'), allocatedCapacity: 8 },
    { startDate: new Date('2030-01-15T00:00:00Z'), endDate: new Date('2030-02-01T00:00:00Z'), allocatedCapacity: 8 },
  ] });
  const result = await service.quote(request({ allocatedCapacityM3: 2 }));
  assert.equal(result.committedPeakCapacityM3, 8);
  assert.equal(result.availableCapacityM3, 2);
});

test('OVERDUE commitment remains allocated across later intervals beyond contractual endDate', async t => {
  mockQuote(t, { capacity: { sellableCapacityM3: 10, isActive: true }, commitments: [
    { startDate: new Date('2029-01-01T00:00:00Z'), endDate: new Date('2029-02-01T00:00:00Z'), allocatedCapacity: 8, status: 'OVERDUE' },
  ] });
  await assert.rejects(service.quote(request({ allocatedCapacityM3: 3, startDate: '2030-01-01T00:00:00.000Z' })), { status: 409 });
});

test('quote rejects peak overbooking, missing capacity, missing price, and missing or ambiguous deposit', async t => {
  mockQuote(t, { commitments: [{ startDate: new Date('2030-01-01Z'), endDate: new Date('2030-02-01Z'), allocatedCapacity: 9 }] });
  await assert.rejects(service.quote(request({ allocatedCapacityM3: 2 })), { status: 409 });

  mockQuote(t, { capacity: null });
  await assert.rejects(service.quote(request()), { status: 409 });

  t.mock.restoreAll();
  mockQuote(t, { prices: [] });
  await assert.rejects(service.quote(request()), { status: 409 });

  t.mock.restoreAll();
  mockQuote(t, { deposits: [] });
  await assert.rejects(service.quote(request()), { status: 409 });

  t.mock.restoreAll();
  mockQuote(t, { deposits: [{ config: { note: 'generic unsupported JSON' } }] });
  await assert.rejects(service.quote(request()), { status: 409 });

  t.mock.restoreAll();
  mockQuote(t, { deposits: [{ config: { calculation: 'PERCENT_OF_RENT', percentage: 20 } }, { config: { calculation: 'PERCENT_OF_RENT', percentage: 20 } }] });
  await assert.rejects(service.quote(request()), { status: 409 });
});

test('request validation rejects unsafe fields, bad UTC dates, invalid terms and nonpositive quota', async t => {
  mockQuote(t);
  for (const input of [
    request({ storageUnitId: String(mid) }), request({ customerId: String(cid) }), request({ estimatedRent: 1 }),
    request({ allocatedCapacityM3: 0 }), request({ allocatedCapacityM3: Infinity }), request({ startDate: '2030-02-30T00:00:00.000Z' }),
    request({ term: { value: 1.5, unit: 'MONTH' } }), request({ term: { value: 1, unit: 'WEEK' } }), request({ $set: {} }),
  ]) await assert.rejects(service.quote(input), ManagedReservationError);
});

test('quote rejects inactive and non-Managed facilities', async t => {
  mockQuote(t, { facility: false });
  await assert.rejects(service.quote(request()), { status: 404 });
});

test('unverified customer cannot create a Managed quota reservation', async t => {
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'PENDING' }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  await assert.rejects(service.create(request(), customer), { status: 403 });
});

test('verified customer creates RESERVED quota with derived snapshot and no StorageUnit', async t => {
  const { cap } = mockQuote(t);
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  t.mock.method(Capacity, 'findOneAndUpdate', (filter, update) => {
    assert.equal(String(filter.facilityId), String(fid));
    assert.deepEqual(update, { $inc: { bookingVersion: 1 } });
    return new Query({ ...cap, bookingVersion: 2 });
  });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  let saved;
  t.mock.method(Reservation.prototype, 'save', async function () { saved = this; return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  const result = await service.create(request(), customer);
  assert.equal(result.reservation.serviceType, 'MANAGED_INVENTORY');
  assert.equal(result.reservation.status, 'RESERVED');
  assert.equal(result.reservation.allocatedCapacity, 1.5);
  assert.equal(result.reservation.storageUnitId, undefined);
  assert.equal(result.reservation.estimatedRent, 150);
  assert.equal(result.reservation.depositAmount, 30);
  assert.equal(saved.managedPricingSnapshot.pricingRule.billingBasis, 'PER_M3');
  assert.equal(saved.managedPricingSnapshot.capacityBookingVersion, 2);
  assert.ok(saved.expiresAt instanceof Date);
});

test('Facility booking-version lock prevents two concurrent requests from overbooking quota', async t => {
  const rows = [];
  let version = 1, queue = Promise.resolve();
  mockQuote(t, { commitments: rows });
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  t.mock.method(Capacity, 'findOneAndUpdate', (filter, update) => {
    assert.deepEqual(update, { $inc: { bookingVersion: 1 } });
    return new Query({ facilityId: fid, sellableCapacityM3: 10, holdDurationMinutes: 30, isActive: true, bookingVersion: ++version });
  });
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async fn => {
      const prior = queue; let release; queue = new Promise(resolve => { release = resolve; }); await prior;
      try { return await fn(); } finally { release(); }
    }, endSession: async () => {},
  }));
  t.mock.method(Reservation.prototype, 'save', async function () { rows.push(this); return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  const results = await Promise.allSettled([
    service.create(request({ allocatedCapacityM3: 6 }), customer),
    service.create(request({ allocatedCapacityM3: 6 }), customer),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(rows.length, 1);
});

test('only Admin, BOM or the assigned Facility Manager can configure quota', async t => {
  await assert.rejects(service.configureCapacity(String(fid), { sellableCapacityM3: 10, holdDurationMinutes: 30 }, customer), { status: 403 });
  await assert.rejects(service.configureCapacity(String(fid), { sellableCapacityM3: 10, holdDurationMinutes: 30 }, { ...manager, assignedFacilityId: oid('507f1f77bcf86cd799439099') }), { status: 403 });
  await assert.rejects(service.configureCapacity(String(fid), { sellableCapacityM3: 0, holdDurationMinutes: 0 }, manager), ManagedReservationError);
});

test('capacity reads are scoped to assigned Staff/Manager while Customer receives aggregates only', async t => {
  const facilityB = oid('507f1f77bcf86cd799439092');
  t.mock.method(Facility, 'findOne', filter => new Query({ _id: filter._id, status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Capacity, 'findOne', () => new Query({ sellableCapacityM3: 10, isActive: true }));
  t.mock.method(Reservation, 'find', () => new Query([
    { startDate: new Date('2030-01-01Z'), endDate: new Date('2030-02-01Z'), allocatedCapacity: 2, status: 'ACTIVE', customerId: cid },
  ]));
  const interval = { startDate: '2030-01-01T00:00:00.000Z', endDate: '2030-02-01T00:00:00.000Z' };
  const staff = { _id: mid, role: UserRole.FACILITY_STAFF, assignedFacilityId: fid };
  const result = await service.getCapacity(String(fid), interval, staff);
  assert.equal(result.committedPeakCapacityM3, 2);
  assert.equal(Object.hasOwn(result, 'reservations'), false);
  assert.equal(JSON.stringify(result).includes(String(cid)), false);
  await assert.rejects(service.getCapacity(String(facilityB), interval, staff), { status: 403 });
  await assert.rejects(service.getCapacity(String(facilityB), interval, { ...manager, assignedFacilityId: fid }), { status: 403 });
  const customerResult = await service.getCapacity(String(fid), interval, customer);
  assert.equal(Object.hasOwn(customerResult, 'reservations'), false);
  assert.equal(JSON.stringify(customerResult).includes('customerId'), false);
});

test('quota cannot be reduced below unresolved OVERDUE obligations', async t => {
  const cap = { _id: oid('507f1f77bcf86cd799439093'), facilityId: fid, sellableCapacityM3: 10, holdDurationMinutes: 30, bookingVersion: 1, isActive: true, save: async () => cap };
  t.mock.method(Facility, 'findOne', () => new Query({ _id: fid, serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Capacity, 'findOne', () => new Query(cap));
  t.mock.method(Capacity, 'updateOne', () => new Query({ modifiedCount: 1 }));
  t.mock.method(Capacity, 'findById', () => new Query(cap));
  t.mock.method(Reservation, 'find', filter => {
    assert.ok(filter.$and.some(group => group.$or?.some(clause => clause.status === 'OVERDUE')));
    return new Query([{ startDate: new Date('2029-01-01Z'), endDate: new Date('2029-02-01Z'), allocatedCapacity: 7, status: 'OVERDUE' }]);
  });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  await assert.rejects(service.configureCapacity(String(fid), { sellableCapacityM3: 6 }, manager), { status: 409 });
});

test('assigned Manager approval transitions once and atomically creates a single draft Contract snapshot', async t => {
  const reservation = new Reservation({
    _id: oid('507f1f77bcf86cd7994390c1'), reservationCode: 'MIR-TEST-01', customerId: cid, facilityId: fid,
    serviceType: 'MANAGED_INVENTORY', allocatedCapacity: 1.5, startDate: new Date('2030-01-01Z'), endDate: new Date('2030-02-01Z'),
    status: 'RESERVED', estimatedRent: 150, depositAmount: 30, expiresAt: new Date(Date.now() + 60000),
    managedPricingSnapshot: { quotaM3: 1.5, amountBreakdown: { estimatedRent: 150, depositAmount: 30 } }, statusHistory: [],
  });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: fid, status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED', identityCard: 'test-only' }));
  const User = require('../dist/models/users/user.model').default;
  t.mock.method(User, 'findById', () => new Query({ displayName: 'Test customer', email: 'test@example.invalid' }));
  t.mock.method(Contract, 'exists', () => new Query(null));
  let contractCount = 0;
  t.mock.method(Contract.prototype, 'save', async function () { contractCount++; return this; });
  t.mock.method(Reservation.prototype, 'save', async function () { return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  const result = await service.approve(String(reservation._id), manager);
  assert.equal(result.reservation.status, 'CONTRACTED');
  assert.equal(result.contract.status, 'DRAFT');
  assert.equal(result.contract.reservationId.toString(), reservation._id.toString());
  assert.deepEqual(result.contract.pricingSnapshot, reservation.managedPricingSnapshot);
  assert.equal(contractCount, 1);
});

test('cross-Facility Manager cannot approve a Managed reservation', async t => {
  const reservation = new Reservation({
    _id: oid('507f1f77bcf86cd7994390c2'), reservationCode: 'MIR-TEST-02', customerId: cid, facilityId: fid,
    serviceType: 'MANAGED_INVENTORY', allocatedCapacity: 1, startDate: new Date('2030-01-01Z'), endDate: new Date('2030-02-01Z'),
    status: 'RESERVED', estimatedRent: 100, depositAmount: 10, expiresAt: new Date(Date.now() + 60000), statusHistory: [],
  });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  const wrongManager = { ...manager, assignedFacilityId: oid('507f1f77bcf86cd799439099') };
  await assert.rejects(service.approve(String(reservation._id), wrongManager), { status: 403 });
});

test('paid, signed Managed reservation activates quota only and never assigns a physical Cell', async t => {
  const startDate = new Date(Date.now() - 60_000), endDate = new Date(Date.now() + 86_400_000);
  const reservation = new Reservation({
    _id: oid('507f1f77bcf86cd7994390c3'), reservationCode: 'MIR-TEST-03', customerId: cid, facilityId: fid,
    serviceType: 'MANAGED_INVENTORY', allocatedCapacity: 1.5, startDate, endDate,
    status: 'PAID', estimatedRent: 150, depositAmount: 30, statusHistory: [],
  });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Contract, 'findOne', () => new Query({ status: 'SIGNED', signedByCustomerAt: new Date() }));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: fid, status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Reservation.prototype, 'save', async function () { return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  const result = await service.activate(String(reservation._id), manager);
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.allocatedCapacity, 1.5);
  assert.equal(result.storageUnitId, undefined);
  assert.equal(result.currentCellId, undefined);
});

test('mock payment is disabled unless the explicit non-production feature flag is enabled', async t => {
  delete process.env.MI_MOCK_PAYMENT_ENABLED;
  await assert.rejects(service.mockPay('507f1f77bcf86cd7994390c4', customer), { status: 404 });
});

test('MI-02A eligibility guard accepts only an activated Managed reservation', async t => {
  const { requireActiveManagedInventoryReservation } = require('../dist/services/reservations/managed-inventory-reservation.guard');
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY'); assert.equal(filter.status, 'ACTIVE');
    return new Query({ _id: oid('507f1f77bcf86cd7994390c5'), customerId: cid, facilityId: fid, serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', allocatedCapacity: 1.5 });
  });
  t.mock.method(Facility, 'findOne', () => new Query({ status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  const active = await requireActiveManagedInventoryReservation('507f1f77bcf86cd7994390c5', cid);
  assert.equal(active.allocatedCapacity, 1.5);
  assert.equal(active.serviceType, 'MANAGED_INVENTORY');
});

test('generic Reservation APIs remain self-storage-only for transitions and detail reads', () => {
  const controller = require('../dist/controllers/reservations/reservation.controller');
  for (const handler of [controller.approveReservation, controller.rejectReservation, controller.mockPayReservation]) assert.equal(typeof handler, 'function');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/controllers/reservations/reservation.controller.ts'), 'utf8');
  assert.match(source, /serviceType: FacilityServiceType\.SELF_STORAGE, status: ReservationStatus\.RESERVED/);
  assert.match(source, /serviceType: FacilityServiceType\.SELF_STORAGE, status: ReservationStatus\.CONTRACTED/);
});

test('Self Storage mock payment requires owner role and applies customer ownership filter', async t => {
  process.env.NODE_ENV = 'development';
  const controller = require('../dist/controllers/reservations/reservation.controller');
  let filterSeen;
  t.mock.method(Reservation, 'findOneAndUpdate', async filter => { filterSeen = filter; return { _id: filter._id }; });
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.mockPayReservation({ params: { id: 'r1' }, user: { _id: cid, role: UserRole.CUSTOMER } }, response);
  assert.equal(String(filterSeen.customerId), String(cid));
  assert.equal(filterSeen.serviceType, 'SELF_STORAGE');
  const denied = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.mockPayReservation({ params: { id: 'r2' }, user: { _id: mid, role: UserRole.FACILITY_MANAGER } }, denied);
  assert.equal(denied.statusCode, 403);
});

test('dedicated Managed reservation routes are registered behind role gates', () => {
  const router = require('../dist/routes/reservation.routes').default;
  const routes = router.stack.filter(layer => layer.route).map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  for (const expected of [
    'POST /managed/quote', 'POST /managed', 'GET /managed/capacity/:facilityId', 'PUT /managed/capacity/:facilityId',
    'GET /managed/:id', 'PATCH /managed/:id/approve', 'PATCH /managed/:id/reject', 'PATCH /managed/:id/cancel',
    'POST /managed/:id/mock-pay', 'PATCH /managed/:id/activate',
  ]) assert.ok(routes.includes(expected), expected);
});

test('reservation schema has explicit Managed quote and simulated payment snapshots', () => {
  for (const field of ['allocatedCapacity', 'managedPricingSnapshot', 'paymentSimulation.simulated', 'expiresAt', 'statusHistory']) assert.ok(Reservation.schema.path(field), field);
  assert.ok(Contract.schema.indexes().some(([keys, opts]) => keys.reservationId === 1 && opts.unique));
  assert.ok(ManagedAudit.schema.indexes().some(([keys]) => keys.reservationId === 1 && keys.createdAt === 1));
});
