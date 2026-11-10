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
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const CellAllocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const ReservationPayment = require('../dist/models/payments/reservation-payment.model').default;
const { ManagedReservationService: service, ManagedReservationError } = require('../dist/services/reservations/managed-reservation.service');
const { UserRole } = require('../dist/types/user.type');

const fid = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const cid = new mongoose.Types.ObjectId('507f1f77bcf86cd799439071');
const mid = new mongoose.Types.ObjectId('507f1f77bcf86cd799439081');
const oid = value => new mongoose.Types.ObjectId(value);
const cellA = oid('507f1f77bcf86cd7994390d1');
const cellB = oid('507f1f77bcf86cd7994390d2');
const future = '2030-01-01T00:00:00.000Z';
let sessionReadOverlaps = 0;
const activeSessionReads = new WeakMap();
const request = extra => ({ facilityId: String(fid), allocatedCapacityM3: 1.5, startDate: future, term: { value: 1, unit: 'MONTH' }, ...extra });
const customer = { _id: cid, role: UserRole.CUSTOMER, assignedFacilityId: null };
const manager = { _id: mid, role: UserRole.FACILITY_MANAGER, assignedFacilityId: fid };

class Query {
  constructor(value) { this.value = value; }
  session(session) { this.sessionRef = session; return this; } select() { return this; } limit() { return this; } lean() { return this; }
  async exec() {
    if (this.sessionRef) {
      if (activeSessionReads.get(this.sessionRef)) sessionReadOverlaps += 1;
      activeSessionReads.set(this.sessionRef, true);
      await new Promise(resolve => setImmediate(resolve));
      activeSessionReads.set(this.sessionRef, false);
    }
    return this.value;
  }
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

test('exhausted MongoDB WriteConflict maps to 409 while unexpected transaction errors remain 500-class errors', async t => {
  const conflict = Object.assign(new Error('write conflict'), { code: 112, codeName: 'WriteConflict' });
  let transactionError = conflict;
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async () => { throw transactionError; }, endSession: async () => {} }));
  await assert.rejects(service.create(request({ allocatedCapacityM3: 0.12, cellIds: [String(cellA)] }), customer), { status: 409 });

  const unexpected = Object.assign(new Error('database unavailable'), { code: 91, codeName: 'ShutdownInProgress' });
  transactionError = unexpected;
  await assert.rejects(service.create(request({ allocatedCapacityM3: 0.12, cellIds: [String(cellA)] }), customer), error => error === unexpected);
});
function mockCellLocks(t, ids = [cellA], volume = 1.5, conflict = null) {
  const cells = ids.map((cellId, index) => ({ _id: cellId, facilityId: fid, zoneId: oid('507f1f77bcf86cd7994390e1'),
    rackId: oid('507f1f77bcf86cd7994390e2'), code: `CELL-${index + 1}`, operationalStatus: 'AVAILABLE', usedWeightKg: 0, usedVolumeM3: 0,
    dimensions: { widthM: volume, depthM: 1, usableHeightM: 1 } }));
  t.mock.method(Cell, 'find', () => new Query(cells));
  t.mock.method(Cell, 'findOne', filter => new Query(cells.find(cell => String(cell._id) === String(filter._id))));
  t.mock.method(Zone, 'findOneAndUpdate', () => new Query({ isActive: true }));
  t.mock.method(Rack, 'findOneAndUpdate', () => new Query({ operationalStatus: 'AVAILABLE' }));
  t.mock.method(Cell, 'findOneAndUpdate', filter => {
    assert.deepEqual(filter.usedWeightKg, { $eq: 0, $exists: true });
    assert.deepEqual(filter.usedVolumeM3, { $eq: 0, $exists: true });
    const cell = cells.find(cell => String(cell._id) === String(filter._id));
    const physicallyEmpty = typeof cell?.usedWeightKg === 'number' && cell.usedWeightKg === 0 &&
      typeof cell?.usedVolumeM3 === 'number' && cell.usedVolumeM3 === 0;
    return new Query(physicallyEmpty ? cell : null);
  });
  t.mock.method(CellAllocation, 'findOne', filter => {
    if (filter.$or) {
      assert.equal(filter.$or[1].startDate.$lt.toISOString(), '2030-02-01T00:00:00.000Z');
      assert.equal(filter.$or[1].endDate.$gt.toISOString(), '2030-01-01T00:00:00.000Z');
      assert.ok(filter.$or[2].holdExpiresAt.$gt instanceof Date, 'expired temporary holds do not conflict');
    }
    return new Query(typeof conflict === 'function' ? conflict(filter) : conflict);
  });
  let allocations = [];
  t.mock.method(CellAllocation, 'insertMany', async rows => { allocations = rows; return rows; });
  return { cells, allocations: () => allocations };
}

test('Managed capacity model has one configuration per Facility and lock version', () => {
  assert.ok(Capacity.schema.indexes().some(([keys, opts]) => keys.facilityId === 1 && opts.unique));
  assert.equal(Capacity.schema.path('bookingVersion').instance, 'Number');
  assert.ok(CellAllocation.schema.indexes().some(([keys, opts]) => keys.reservationId === 1 && keys.cellId === 1 && opts.unique));
  assert.equal(CellAllocation.schema.path('status').enumValues.includes('HOLD'), true);
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
  await assert.rejects(service.create(request({ cellIds: [String(cellA)] }), customer), { status: 403 });
});

test('verified customer creates RESERVED quota with derived snapshot and no StorageUnit', async t => {
  const { cap } = mockQuote(t);
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  const allocationState = mockCellLocks(t);
  t.mock.method(Capacity, 'findOneAndUpdate', (filter, update) => {
    assert.equal(String(filter.facilityId), String(fid));
    assert.deepEqual(update, { $inc: { bookingVersion: 1 } });
    return new Query({ ...cap, bookingVersion: 2 });
  });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  let saved;
  t.mock.method(Reservation.prototype, 'save', async function () { saved = this; return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  const result = await service.create(request({ cellIds: [String(cellA)] }), customer);
  assert.equal(result.reservation.serviceType, 'MANAGED_INVENTORY');
  assert.equal(result.reservation.status, 'RESERVED');
  assert.equal(result.reservation.bookingFlowVersion, undefined, 'default-off booking remains legacy');
  assert.equal(result.reservation.allocatedCapacity, 1.5);
  assert.equal(result.reservation.storageUnitId, undefined);
  assert.equal(result.reservation.estimatedRent, 150);
  assert.equal(result.reservation.depositAmount, 30);
  assert.deepEqual(result.quote.paymentBreakdown, { totalDue: 150, depositCredit: 30, balanceDue: 120 });
  assert.deepEqual(saved.managedPricingSnapshot.amountBreakdown, {
    estimatedRent: 150, depositAmount: 30, taxAmount: 0, discountAmount: 0,
    totalDue: 150, depositCredit: 30, balanceDue: 120,
  });
  assert.equal(saved.managedPricingSnapshot.pricingRule.billingBasis, 'PER_M3');
  assert.equal(saved.managedPricingSnapshot.capacityBookingVersion, 2);
  assert.ok(saved.expiresAt instanceof Date);
  assert.deepEqual(saved.allocatedCellIds.map(String), [String(cellA)]);
  assert.equal(allocationState.allocations().length, 1);
  assert.equal(allocationState.allocations()[0].status, 'HOLD');
  assert.equal(allocationState.allocations()[0].holdExpiresAt.getTime(), saved.expiresAt.getTime());
});

test('versioned Managed booking creates only a RESERVED reservation and HOLD allocations without contract or manager approval', async t => {
  const previous = process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED, previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED = 'true';
  t.after(() => { process.env.NODE_ENV = previousNodeEnv; if (previous === undefined) delete process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED; else process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED = previous; });
  const { cap } = mockQuote(t);
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  const allocationState = mockCellLocks(t);
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ ...cap, bookingVersion: 2 }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  let saved;
  t.mock.method(Reservation.prototype, 'save', async function () { saved = this; return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  t.mock.method(Contract, 'exists', () => { throw Error('booking must not create a Contract'); });
  const result = await service.create(request({ cellIds: [String(cellA)] }), customer);
  assert.equal(result.reservation.status, 'RESERVED');
  assert.equal(result.reservation.bookingFlowVersion, 2);
  assert.equal(result.reservation.estimatedRent, 150);
  assert.equal(result.reservation.depositAmount, 30);
  assert.equal(result.reservation.managedPricingSnapshot.amountBreakdown.balanceDue, 120);
  assert.equal(saved.bookingFlowVersion, 2);
  assert.equal(allocationState.allocations()[0].status, 'HOLD');
  assert.equal(allocationState.allocations()[0].holdExpiresAt.getTime(), saved.expiresAt.getTime());
});

test('Managed V3 booking retry with the same Idempotency-Key replays one reservation', async t => {
  const { cap } = mockQuote(t);
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  mockCellLocks(t);
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ ...cap, bookingVersion: 2 }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  let saved, saveCount = 0;
  t.mock.method(Reservation, 'findOne', () => new Query(saved ?? null));
  t.mock.method(Reservation.prototype, 'save', async function () { saveCount += 1; saved = this; return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });

  const key = 'customer-cell-booking-retry-0001';
  const first = await service.create(request({ cellIds: [String(cellA)] }), customer, key);
  const replay = await service.create(request({ cellIds: [String(cellA)] }), customer, key);
  assert.equal(first.reservation.bookingFlowVersion, 3);
  assert.equal(replay.idempotent, true);
  assert.equal(String(replay.reservation._id), String(first.reservation._id));
  assert.equal(saveCount, 1, 'a replay must not create another Reservation');
});

function enableManagedDeposit(t) {
  const oldNodeEnv = process.env.NODE_ENV, oldGate = process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED;
  process.env.NODE_ENV = 'development'; process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED = 'true';
  t.after(() => { process.env.NODE_ENV = oldNodeEnv; if (oldGate === undefined) delete process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED; else process.env.MI_MANAGED_DEPOSIT_FLOW_ENABLED = oldGate; });
}
function mockDepositContext(t, options = {}) {
  const reservation = new Reservation({ _id: oid('507f1f77bcf86cd7994390e9'), reservationCode: 'MIR-P2-01', customerId: cid, facilityId: fid,
    serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 2, status: options.reservationStatus || 'RESERVED',
    allocatedCellIds: [cellA, cellB], expiresAt: options.expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 60000),
    estimatedRent: 150, depositAmount: 30, taxAmount: 0, discountAmount: 0, statusHistory: [],
    managedPricingSnapshot: { pricingRule: { currency: 'VND' }, amountBreakdown: { totalDue: 150, depositCredit: 30, balanceDue: 120 } } });
  const payment = new ReservationPayment({ _id: oid('507f1f77bcf86cd7994390ea'), reservationId: reservation._id, customerId: cid, facilityId: fid,
    serviceType: 'MANAGED_INVENTORY', purpose: options.purpose || 'DEPOSIT', amount: options.amount ?? 30, currency: 'VND',
    idempotencyKey: 'managed-deposit-p2-test', provider: options.provider || 'MOCK', status: options.paymentStatus || 'PENDING' });
  const allocations = [cellA, cellB].map(cellId => ({ cellId, reservationId: reservation._id, customerId: cid, status: 'HOLD', holdExpiresAt: reservation.expiresAt }));
  let writes = [];
  t.mock.method(Reservation, 'findOne', filter => new Query(String(filter.customerId) === String(cid) ? reservation : null));
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ facilityId: fid, isActive: true }));
  t.mock.method(ReservationPayment, 'findOne', () => new Query(payment));
  t.mock.method(ReservationPayment.prototype, 'save', async function () { writes.push(`payment:${this.status}`); return this; });
  t.mock.method(Reservation.prototype, 'save', async function () { writes.push(`reservation:${this.status}`); return this; });
  t.mock.method(CellAllocation, 'countDocuments', () => new Query(allocations.filter(row => row.status === 'HOLD' && row.holdExpiresAt > new Date()).length));
  t.mock.method(CellAllocation, 'updateMany', (filter, update) => {
    const matchedCount = allocations.filter(row => row.status === filter.status && row.holdExpiresAt > filter.holdExpiresAt.$gt).length;
    for (const row of allocations) if (row.status === filter.status && row.holdExpiresAt > filter.holdExpiresAt.$gt) { row.status = update.$set.status; delete row.holdExpiresAt; }
    writes.push(`allocations:${matchedCount}`); return new Query({ matchedCount, modifiedCount: matchedCount });
  });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { writes.push(`audit:${this.action}`); if (options.auditFailure) throw options.auditFailure; return this; });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => {
    const snapshot = options.rollback ? { reservationStatus: reservation.status, reservationExpiresAt: reservation.expiresAt,
      history: [...reservation.statusHistory], paymentStatus: payment.status, paymentSucceededAt: payment.succeededAt,
      allocationRows: allocations.map(row => ({ ...row })) } : null;
    try { return await fn(); } catch (error) {
      if (snapshot) {
        reservation.status = snapshot.reservationStatus; reservation.expiresAt = snapshot.reservationExpiresAt; reservation.statusHistory = snapshot.history;
        payment.status = snapshot.paymentStatus; payment.succeededAt = snapshot.paymentSucceededAt;
        allocations.forEach((row, index) => Object.assign(row, snapshot.allocationRows[index]));
      }
      throw error;
    }
  }, endSession: async () => {} }));
  return { reservation, payment, allocations, writes };
}

test('deposit initiation is owner-bound, purpose-specific and idempotent without changing reservation state', async t => {
  enableManagedDeposit(t);
  const reservation = new Reservation({ _id: oid('507f1f77bcf86cd7994390e9'), customerId: cid, facilityId: fid, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 2, status: 'RESERVED', expiresAt: new Date(Date.now() + 60000), estimatedRent: 150, depositAmount: 30, managedPricingSnapshot: { pricingRule: { currency: 'VND' } } });
  t.mock.method(Reservation, 'findOne', filter => new Query(String(filter.customerId) === String(cid) ? reservation : null));
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ facilityId: fid }));
  let payment;
  t.mock.method(ReservationPayment, 'findOne', () => new Query(payment || null));
  t.mock.method(ReservationPayment.prototype, 'save', async function () { payment = this; return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  const first = await service.initiateDeposit(String(reservation._id), { idempotencyKey: 'init-p2' }, customer);
  const replay = await service.initiateDeposit(String(reservation._id), { idempotencyKey: 'init-p2' }, customer);
  assert.equal(first.payment.purpose, 'DEPOSIT'); assert.equal(first.payment.amount, 30); assert.equal(first.payment.currency, 'VND');
  assert.equal(replay.idempotent, true); assert.equal(payment.status, 'PENDING'); assert.equal(reservation.status, 'RESERVED');
  await assert.rejects(service.initiateDeposit(String(reservation._id), { idempotencyKey: 'different' }, { ...customer, _id: mid }), { status: 404 });
});

test('successful deposit confirmation atomically moves HOLD to RESERVED and is safe to replay', async t => {
  enableManagedDeposit(t);
  const state = mockDepositContext(t);
  const first = await service.confirmMockDeposit(String(state.reservation._id), { idempotencyKey: state.payment.idempotencyKey }, customer);
  assert.equal(first.reservation.status, 'DEPOSIT_PAID'); assert.equal(first.payment.status, 'SUCCEEDED');
  assert.ok(state.allocations.every(row => row.status === 'RESERVED' && row.holdExpiresAt === undefined));
  assert.equal(state.reservation.expiresAt, undefined);
  assert.equal(state.reservation.paymentSimulation?.simulated, undefined);
  assert.ok(state.writes.some(write => write === 'audit:DEPOSIT_CONFIRMED'));
  t.mock.restoreAll();
  // A replay after commit returns the terminal result without mutating allocations or recording a second settlement.
  t.mock.method(Reservation, 'findOne', () => new Query(state.reservation));
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ facilityId: fid }));
  t.mock.method(ReservationPayment, 'findOne', () => new Query(state.payment));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  const replay = await service.confirmMockDeposit(String(state.reservation._id), { idempotencyKey: state.payment.idempotencyKey }, customer);
  assert.equal(replay.idempotent, true); assert.equal(state.allocations.filter(row => row.status === 'RESERVED').length, 2);
});

test('concurrent duplicate deposit confirmations serialize and record one settlement', async t => {
  enableManagedDeposit(t);
  const state = mockDepositContext(t);
  let queue = Promise.resolve();
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => {
    const prior = queue; let release; queue = new Promise(resolve => { release = resolve; }); await prior;
    try { return await fn(); } finally { release(); }
  }, endSession: async () => {} }));
  const key = state.payment.idempotencyKey, rid = String(state.reservation._id);
  const results = await Promise.all([service.confirmMockDeposit(rid, { idempotencyKey: key }, customer), service.confirmMockDeposit(rid, { idempotencyKey: key }, customer)]);
  assert.ok(results.every(result => result.reservation.status === 'DEPOSIT_PAID' && result.payment.status === 'SUCCEEDED'));
  assert.equal(state.writes.filter(write => write === 'payment:SUCCEEDED').length, 1);
  assert.equal(state.writes.filter(write => write === 'allocations:2').length, 1);
});

test('audit persistence failure aborts deposit confirmation before the service reports success', async t => {
  enableManagedDeposit(t);
  const dbFailure = Object.assign(new Error('audit database unavailable'), { code: 91 });
  const state = mockDepositContext(t, { auditFailure: dbFailure, rollback: true });
  await assert.rejects(service.confirmMockDeposit(String(state.reservation._id), { idempotencyKey: state.payment.idempotencyKey }, customer), error => error === dbFailure);
  assert.ok(state.writes.includes('allocations:2'));
  assert.ok(state.writes.includes('reservation:DEPOSIT_PAID'));
  assert.ok(state.writes.includes('payment:SUCCEEDED'));
  assert.equal(state.payment.status, 'PENDING'); assert.equal(state.reservation.status, 'RESERVED');
  assert.ok(state.allocations.every(row => row.status === 'HOLD' && row.holdExpiresAt));
  // The mock models abort/restore behavior; MongoDB rollback semantics require replica-set integration testing.
});

test('quote fails closed when a legacy Cell has unknown physical counters', async t => {
  mockQuote(t);
  t.mock.method(Cell, 'find', () => new Query([{ _id: cellA, facilityId: fid, zoneId: mid, rackId: oid('507f1f77bcf86cd7994390e2'), operationalStatus: 'AVAILABLE', dimensions: { widthM: 0.4, depthM: 0.3, usableHeightM: 1 } }]));
  await assert.rejects(service.quote(request({ allocatedCapacityM3: 0.12, cellIds: [String(cellA)] })), { status: 409 });
});

test('expired hold records reconciliation-required payment and never reclaims or promotes Cells', async t => {
  enableManagedDeposit(t);
  const state = mockDepositContext(t, { expired: true });
  const result = await service.confirmMockDeposit(String(state.reservation._id), { idempotencyKey: state.payment.idempotencyKey }, customer);
  assert.equal(result.reconciliationRequired, true); assert.equal(state.payment.status, 'RECONCILIATION_REQUIRED');
  assert.equal(state.reservation.status, 'RESERVED'); assert.ok(state.allocations.every(row => row.status === 'HOLD'));
  assert.ok(state.writes.some(write => write === 'audit:PAYMENT_RECONCILIATION_REQUIRED'));
});

test('wrong deposit purpose or amount is rejected without transitioning resources', async t => {
  for (const paymentOptions of [{ purpose: 'BALANCE' }, { amount: 151 }]) await t.test(JSON.stringify(paymentOptions), async t => {
    enableManagedDeposit(t); const state = mockDepositContext(t, paymentOptions);
    await assert.rejects(service.confirmMockDeposit(String(state.reservation._id), { idempotencyKey: state.payment.idempotencyKey }, customer), { status: 409 });
    assert.equal(state.reservation.status, 'RESERVED'); assert.ok(state.allocations.every(row => row.status === 'HOLD'));
  });
});

test('deposit confirmation is owner-only and version 2 gate is disabled outside development', async t => {
  enableManagedDeposit(t);
  const state = mockDepositContext(t);
  await assert.rejects(service.confirmMockDeposit(String(state.reservation._id), { idempotencyKey: state.payment.idempotencyKey }, { ...customer, _id: mid }), { status: 404 });
  process.env.NODE_ENV = 'production';
  await assert.rejects(service.confirmMockDeposit(String(state.reservation._id), { idempotencyKey: state.payment.idempotencyKey }, customer), { status: 404 });
});

test('version 2 quote rejects deposit policy values that exceed total rent', async t => {
  enableManagedDeposit(t);
  mockQuote(t, { deposits: [{ _id: oid('507f1f77bcf86cd7994390b1'), config: { calculation: 'PERCENT_OF_RENT', percentage: 101 }, version: 2 }] });
  await assert.rejects(service.quote(request()), { status: 409 });
});

test('VND rounding is explicit and deposit above total is rejected', () => {
  const { roundVndAmount, calculateRentalPaymentBreakdown } = require('../dist/services/payments/payment-accounting');
  assert.equal(roundVndAmount(1.49), 1); assert.equal(roundVndAmount(1.5), 2);
  assert.throws(() => calculateRentalPaymentBreakdown({ rentAmount: 100, depositAmount: 101 }), { status: 409 });
});

test('Managed v2 routes are customer-only and the schema keeps flow version optional for legacy records', () => {
  const router = require('../dist/routes/reservation.routes').default;
  const rows = router.stack.filter(layer => layer.route).map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.ok(rows.includes('POST /managed/:id/deposit'));
  assert.ok(rows.includes('POST /managed/:id/deposit/mock-confirm'));
  assert.equal(Reservation.schema.path('bookingFlowVersion').options.default, undefined);
  assert.deepEqual(Reservation.schema.path('bookingFlowVersion').enumValues, [2, 3]);
  assert.ok(Reservation.schema.path('status').enumValues.includes('DEPOSIT_PAID'));
  assert.ok(ReservationPayment.schema.path('status').enumValues.includes('RECONCILIATION_REQUIRED'));
});

test('legacy Cell with absent physical counters is rejected by the transactional emptiness lock', async t => {
  const { cap } = mockQuote(t);
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  const state = mockCellLocks(t);
  delete state.cells[0].usedWeightKg;
  delete state.cells[0].usedVolumeM3;
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ ...cap, bookingVersion: 2 }));
  let aborted = false, savedReservations = 0;
  t.mock.method(mongoose, 'startSession', async () => ({
    withTransaction: async fn => { try { return await fn(); } catch (error) { aborted = true; throw error; } },
    endSession: async () => {},
  }));
  t.mock.method(Reservation.prototype, 'save', async function () { savedReservations++; return this; });
  await assert.rejects(service.create(request({ allocatedCapacityM3: 1.5, cellIds: [String(cellA)] }), customer), {
    status: 409, message: 'Selected Cell is not physically available for a new reservation',
  });
  assert.equal(aborted, true);
  assert.equal(savedReservations, 0);
  assert.equal(state.allocations().length, 0);
});

test('transactional emptiness lock does not overwrite a Cell with existing stock counters', async t => {
  const { cap } = mockQuote(t);
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  const state = mockCellLocks(t);
  state.cells[0].usedWeightKg = 40;
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ ...cap, bookingVersion: 2 }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  await assert.rejects(service.create(request({ allocatedCapacityM3: 1.5, cellIds: [String(cellA)] }), customer), { status: 409 });
  assert.equal(state.cells[0].usedWeightKg, 40);
  assert.equal(state.allocations().length, 0);
});

test('multi-cell hold derives commercial m3 from configured dimensions and rejects interval conflicts', async t => {
  mockQuote(t);
  const state = mockCellLocks(t, [cellA, cellB], 0.12);
  // Request total is validated against the two selected 0.12m3 Cells before price/booking.
  await assert.rejects(service.quote(request({ allocatedCapacityM3: 0.23, cellIds: [String(cellA), String(cellB)] })), { status: 400 });
  t.mock.restoreAll();
  mockQuote(t);
  mockCellLocks(t, [cellA, cellB], 0.12, { _id: oid('507f1f77bcf86cd7994390d9') });
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ sellableCapacityM3: 10, holdDurationMinutes: 30, bookingVersion: 2, isActive: true }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  t.mock.method(Reservation.prototype, 'save', async function () { return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  await assert.rejects(service.create(request({ allocatedCapacityM3: 0.24, cellIds: [String(cellA), String(cellB)] }), customer), { status: 409 });
  assert.equal(state.cells.length, 2);
});

test('quote applies half-open selected-Cell availability checks and accepts adjacent periods', async t => {
  const { cells } = mockCellLocks(t, [cellA], 0.12);
  t.mock.method(Cell, 'find', () => new Query(cells));
  t.mock.method(Zone, 'find', () => new Query([{ _id: cells[0].zoneId }]));
  t.mock.method(Rack, 'find', () => new Query([{ _id: cells[0].rackId }]));
  const prior = { _id: oid('507f1f77bcf86cd7994390d9') };
  t.mock.method(CellAllocation, 'exists', filter => {
    assert.equal(filter.$or[1].startDate.$lt.toISOString(), '2030-02-01T00:00:00.000Z');
    assert.equal(filter.$or[1].endDate.$gt.toISOString(), '2030-01-01T00:00:00.000Z');
    assert.equal(filter.$or[2].holdExpiresAt.$gt instanceof Date, true);
    return new Query(prior);
  });
  await assert.rejects(service.quote(request({ allocatedCapacityM3: 0.12, cellIds: [String(cellA)] })), { status: 409 });
  t.mock.restoreAll();
  mockQuote(t);
  const { cells: adjacentCells } = mockCellLocks(t, [cellA], 0.12);
  t.mock.method(Cell, 'find', () => new Query(adjacentCells));
  t.mock.method(Zone, 'find', () => new Query([{ _id: adjacentCells[0].zoneId }]));
  t.mock.method(Rack, 'find', () => new Query([{ _id: adjacentCells[0].rackId }]));
  t.mock.method(CellAllocation, 'exists', filter => {
    assert.deepEqual(filter.$or[1].startDate, { $lt: new Date('2030-02-01T00:00:00.000Z') });
    assert.deepEqual(filter.$or[1].endDate, { $gt: new Date('2030-01-31T00:00:00.000Z') });
    return new Query(null);
  });
  const quoted = await service.quote(request({ allocatedCapacityM3: undefined, cellIds: [String(cellA)], startDate: '2030-01-31T00:00:00.000Z', term: { value: 1, unit: 'DAY' } }));
  assert.equal(quoted.allocatedCapacityM3, 0.12, 'quote capacity is derived from the selected Cell');
  assert.equal(quoted.startDate.toISOString(), '2030-01-31T00:00:00.000Z');
  assert.deepEqual(quoted.cellIds, [String(cellA)], 'V3 quote echoes the exact server-validated Cell ID set');
});

test('concurrent intersecting multi-Cell selections commit only one complete hold set', async t => {
  const rows = [], ids = [cellA, cellB, oid('507f1f77bcf86cd7994390d3')];
  mockQuote(t, { commitments: rows });
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  let cellState;
  cellState = mockCellLocks(t, ids, 0.12, filter => {
    const selectedId = String(filter.$or?.[0]?.cellId);
    return cellState.allocations().find(row => String(row.cellId) === selectedId && row.status === 'HOLD') || null;
  });
  let version = 1, queue = Promise.resolve();
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ facilityId: fid, sellableCapacityM3: 10, holdDurationMinutes: 30, isActive: true, bookingVersion: ++version }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => {
    const prior = queue; let release; queue = new Promise(resolve => { release = resolve; }); await prior;
    try { return await fn(); } finally { release(); }
  }, endSession: async () => {} }));
  t.mock.method(Reservation.prototype, 'save', async function () { rows.push(this); return this; });
  t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
  const results = await Promise.allSettled([
    service.create(request({ allocatedCapacityM3: 0.24, cellIds: [String(cellA), String(cellB)] }), customer),
    service.create(request({ allocatedCapacityM3: 0.24, cellIds: [String(cellB), String(ids[2])] }), customer),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal(rows.length, 1);
  assert.equal(cellState.allocations().length, 2);
  assert.equal(new Set(cellState.allocations().map(row => String(row.reservationId))).size, 1);
});

test('Manager rejection and owner cancellation release empty temporary Cell holds', async t => {
  for (const mode of ['manager reject', 'customer cancel']) await t.test(mode, async t => {
    const reservation = new Reservation({ _id: oid('507f1f77bcf86cd7994390f1'), facilityId: fid, customerId: cid,
      serviceType: 'MANAGED_INVENTORY', status: 'RESERVED', startDate: new Date('2030-01-01Z'), endDate: new Date('2030-02-01Z'),
      allocatedCapacity: 1.5, statusHistory: [], estimatedRent: 150, depositAmount: 30 });
    const allocation = { status: 'HOLD', save: async function () { return this; } };
    const cell = { usedWeightKg: 0, usedVolumeM3: 0 };
    t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
    t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({ _id: oid('507f1f77bcf86cd799439092') }));
    t.mock.method(Reservation, 'findOne', () => new Query(reservation));
    t.mock.method(Reservation.prototype, 'save', async function () { return this; });
    t.mock.method(CellAllocation, 'find', () => new Query([allocation]));
    t.mock.method(Cell, 'findOne', () => new Query(cell));
    t.mock.method(CellAllocation.prototype, 'save', async function () { allocation.status = this.status; return this; });
    t.mock.method(ManagedAudit.prototype, 'save', async function () { return this; });
    if (mode === 'manager reject') await service.reject(String(reservation._id), { reason: 'No longer available' }, manager);
    else await service.cancel(String(reservation._id), customer);
    assert.equal(allocation.status, 'RELEASED');
  });
});

test('Facility booking-version lock prevents two concurrent requests from overbooking quota', async t => {
  const rows = [];
  let version = 1, queue = Promise.resolve();
  mockQuote(t, { commitments: rows });
  t.mock.method(Profile, 'findOne', () => new Query({ verificationStatus: 'VERIFIED' }));
  mockCellLocks(t, [cellA, cellB], 6);
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
    service.create(request({ allocatedCapacityM3: 6, cellIds: [String(cellA)] }), customer),
    service.create(request({ allocatedCapacityM3: 6, cellIds: [String(cellB)] }), customer),
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
  sessionReadOverlaps = 0;
  const result = await service.approve(String(reservation._id), manager);
  assert.equal(result.reservation.status, 'CONTRACTED');
  assert.equal(result.contract.status, 'DRAFT');
  assert.equal(result.contract.reservationId.toString(), reservation._id.toString());
  assert.deepEqual(result.contract.pricingSnapshot, reservation.managedPricingSnapshot);
  assert.equal(contractCount, 1);
  assert.equal(sessionReadOverlaps, 0, 'approval DB reads sharing one session must run sequentially');
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

test('legacy approve, reject, mock-pay and activate filters exclude Managed V3', async t => {
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  const reservationId = oid('507f1f77bcf86cd7994390c3');
  const versions = [];
  t.mock.method(Reservation, 'findOne', filter => {
    if (filter.status) {
      versions.push(filter.bookingFlowVersion);
      return new Query(null);
    }
    return new Query({ facilityId: fid });
  });
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query({}));
  t.mock.method(Contract, 'findOne', () => new Query({ status: 'SIGNED', signedByCustomerAt: new Date(), customerId: cid }));
  const oldGate = process.env.MI_MOCK_PAYMENT_ENABLED;
  try {
    process.env.MI_MOCK_PAYMENT_ENABLED = 'true';
    await assert.rejects(service.approve(String(reservationId), manager), { status: 409 });
    await assert.rejects(service.reject(String(reservationId), { reason: 'fixture' }, manager), { status: 409 });
    await assert.rejects(service.mockPay(String(reservationId), customer), { status: 409 });
    await assert.rejects(service.activate(String(reservationId), manager), { status: 409 });
  } finally {
    if (oldGate === undefined) delete process.env.MI_MOCK_PAYMENT_ENABLED;
    else process.env.MI_MOCK_PAYMENT_ENABLED = oldGate;
  }
  assert.deepEqual(versions, [{ $nin: [2, 3] }, { $nin: [2, 3] }, { $nin: [2, 3] }, { $ne: 3 }]);
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
  const oldEnv = process.env.NODE_ENV;
  t.after(() => { if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv; });
  const controller = require('../dist/controllers/reservations/reservation.controller');
  const filtersSeen = [];
  t.mock.method(Reservation, 'findOneAndUpdate', async filter => { filtersSeen.push(filter); return { _id: filter._id }; });
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  for (const env of ['development', 'test']) {
    process.env.NODE_ENV = env;
    const allowedResponse = { ...response };
    await controller.mockPayReservation({ params: { id: `r-${env}` }, user: { _id: cid, role: UserRole.CUSTOMER } }, allowedResponse);
    assert.equal(allowedResponse.statusCode, 200, `NODE_ENV=${env}`);
  }
  assert.equal(filtersSeen.length, 2);
  for (const filterSeen of filtersSeen) {
    assert.equal(String(filterSeen.customerId), String(cid));
    assert.equal(filterSeen.serviceType, 'SELF_STORAGE');
    assert.equal(filterSeen.status, 'CONTRACTED');
  }
  process.env.NODE_ENV = 'development';
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
