const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'production', MONGO_URL: 'mongodb+srv://cluster.example.invalid/test',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Contract = require('../dist/models/contracts/contract.model').default;
const Payment = require('../dist/models/payments/reservation-payment.model').default;
const ManagedAudit = require('../dist/models/reservations/managed-reservation-audit.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const ManagedCapacity = require('../dist/models/reservations/managed-facility-capacity.model').default;
const CellAllocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Policy = require('../dist/models/pricing-policy/policy.model').default;
const { InventoryItemService: service } = require('../dist/services/inventory-items/inventory-item.service');
const { WarehouseMapService } = require('../dist/services/warehouse-map/warehouse-map.service');
const oid = value => new mongoose.Types.ObjectId(value);
const facilityId = '507f1f77bcf86cd799439011';
const reservationId = '507f1f77bcf86cd799439021';
const itemId = '507f1f77bcf86cd799439031';
const cellId = '507f1f77bcf86cd799439041';
const zoneId = '507f1f77bcf86cd799439051';
const rackId = '507f1f77bcf86cd799439061';
const customerId = oid('507f1f77bcf86cd799439071');
const staffId = oid('507f1f77bcf86cd799439081');

class Query {
  constructor(value, expectedSession) { this.value = value; this.expectedSession = expectedSession; }
  session(session) { if (this.expectedSession) assert.equal(session, this.expectedSession); return this; }
  select() { return this; }
  sort() { return this; }
  skip() { return this; }
  limit() { return this; }
  lean() { return this; }
  exec() { return Promise.resolve(this.value); }
}
function mockTransaction(t) {
  const session = {
    withTransaction: async work => work(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  return session;
}
function makeItem(overrides = {}) {
  return new Item({
    _id: oid(itemId), facilityId: oid(facilityId), customerId,
    managedReservationId: oid(reservationId), itemCode: 'LOT-1', name: 'Cartons', category: 'DOCUMENTS',
    quantity: 2, quantityUnit: 'carton', unitWeightKg: 20,
    unitDimensionsM: { widthM: 0.25, depthM: 0.3, heightM: 0.2 }, unitVolumeM3: 0.015,
    totalWeightKg: 40, totalVolumeM3: 0.03, currentCellId: null, status: 'REGISTERED',
    images: [], createdBy: customerId, ...overrides,
  });
}
function mockRequest(t, overrides = {}) {
  const session = mockTransaction(t);
  const registered = makeItem();
  t.mock.method(Item, 'findOne', () => new Query(registered));
  const reservation = {
    _id: oid(reservationId), facilityId: oid(facilityId), customerId,
    serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', allocatedCapacity: 1.5,
    ...overrides.reservation,
  };
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.$or[0].status, 'ACTIVE');
    assert.equal(filter.$or[1].status, 'DEPOSIT_PAID'); assert.equal(filter.$or[1].bookingFlowVersion, 2); assert.ok(filter.$or[1].endDate.$gt instanceof Date);
    assert.ok(filter.$or[0].startDate.$lte instanceof Date);
    assert.ok(filter.$or[0].endDate.$gt instanceof Date);
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    assert.deepEqual(update.$inc, { inventoryVersion: 1 });
    assert.equal(options.session, session);
    return new Query(overrides.reservationMismatch ? null : reservation);
  });
  t.mock.method(Reservation, 'exists', () => new Query(null));
  t.mock.method(Facility, 'findOne', filter => {
    assert.equal(filter.status, 'ACTIVE');
    assert.ok(filter.serviceTypes === 'MANAGED_INVENTORY' || filter.serviceTypes?.includes('MANAGED_INVENTORY'));
    return new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] });
  });
  t.mock.method(Item, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.status, 'REGISTERED');
    assert.equal(update.$set.status, 'PENDING_INBOUND');
    assert.equal(options.session, session);
    return new Query(makeItem({ status: 'PENDING_INBOUND', inboundRequestedAt: new Date(), inboundRequestedBy: customerId }));
  });
}
function mockConfirmation(t, options = {}) {
  const session = mockTransaction(t);
  const pending = makeItem({ status: 'PENDING_INBOUND', ...(options.item || {}) });
  t.mock.method(Item, 'findOne', () => new Query(pending));
  t.mock.method(Reservation, 'findOne', () => new Query({ _id: oid(reservationId), facilityId: oid(facilityId), customerId, serviceType: 'MANAGED_INVENTORY' }));
  t.mock.method(Item, 'findOneAndUpdate', (_filter, _update, opts) => {
    assert.equal(opts.session, session);
    return new Query(pending);
  });
  const cell = {
    _id: oid(cellId), facilityId: oid(options.cellFacilityId || facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
    levelNumber: 1, cellNumber: 1, operationalStatus: options.cellStatus || 'AVAILABLE', maxWeightKg: options.cellMaxWeightKg ?? 100,
    usedWeightKg: options.cellUsedWeightKg ?? 0, usedVolumeM3: options.usedVolumeM3 ?? 0,
    dimensions: { widthM: options.cellWidthM ?? .5, depthM: options.cellDepthM ?? .6, ...(options.usableHeightM === null ? {} : { usableHeightM: options.usableHeightM ?? .5 }) },
  };
  t.mock.method(CellAllocation, 'findOne', () => new Query(options.allocationMissing ? null : {
    _id: oid('507f1f77bcf86cd799439091'), cellId: oid(cellId), reservationId: oid(reservationId), customerId, status: 'RESERVED', save: async function () { return this; },
  }));
  t.mock.method(Cell, 'findOne', () => new Query(cell));
  const otherCells = [];
  if (options.levelUsage?.[0]?.usedWeightKg > 0) otherCells.push({ rackId: oid(rackId), levelNumber: 1, usedWeightKg: options.levelUsage[0].usedWeightKg, usedVolumeM3: 0 });
  if (options.rackUsage?.[0]?.usedWeightKg > 0) otherCells.push({ rackId: oid(rackId), levelNumber: 2, usedWeightKg: options.rackUsage[0].usedWeightKg, usedVolumeM3: 0 });
  t.mock.method(Cell, 'find', () => new Query([cell, ...otherCells]));
  t.mock.method(Zone, 'findOneAndUpdate', (_filter, _update, opts) => {
    assert.equal(opts.session, session);
    return new Query(options.zoneInactive ? null : { _id: oid(zoneId) });
  });
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, _update, opts) => {
    assert.ok(filter.$or[0].startDate.$lte instanceof Date);
    assert.ok(filter.$or[0].endDate.$gt instanceof Date);
    assert.equal(opts.session, session);
    if (options.reservationInactive) return new Query(null);
    return new Query({
      _id: oid(reservationId), facilityId: oid(facilityId), customerId, allocatedCapacity: options.allocatedCapacity ?? 1.5,
      usedCapacityM3: options.usedCapacityM3 ?? 0,
    });
  });
  t.mock.method(ManagedCapacity, 'findOneAndUpdate', () => new Query({ bookingVersion: 2 }));
  t.mock.method(Reservation, 'exists', () => new Query(options.overdue ? { _id: oid('507f1f77bcf86cd799439099') } : null));
  t.mock.method(Facility, 'findOne', () => new Query(options.facilityInactive ? null : { status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Rack, 'findOneAndUpdate', () => new Query(options.rackUnavailable ? null : {
    _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), operationalStatus: 'AVAILABLE', levelCount: 4, maxWeightKgPerLevel: 500,
  }));
  let aggregation = 0;
  t.mock.method(Cell, 'aggregate', () => new Query(aggregation++ === 0 ? (options.levelUsage || []) : (options.rackUsage || [])));
  t.mock.method(Policy, 'find', filter => {
    assert.equal(String(filter.facilityId), facilityId);
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    assert.equal(filter.type, 'CATEGORY');
    return new Query(options.policies === undefined ? [{ config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } }] : options.policies, session);
  });
  const body = {
    cellId, verifiedQuantity: 2, actualUnitWeightKg: 20,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 },
    physicalPackingConfirmed: true, inspectionNote: 'Two cartons physically checked', idempotencyKey: 'inbound-validation',
    ...(options.body || {}),
  };
  return { body, actor: { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: oid(facilityId) } };
}

function mockSuccessfulConfirmation(t, { movementFailure = false, concurrentItem = false, cellMaxWeightKg = 100,
  maxWeightKgPerLevel = 500, rackLevelCount = 4, allocatedCapacity = 1.5, otherLevelWeightKg = 0,
  otherRackWeightKg = 0, initialCellWeightKg = 0, initialCellVolumeM3 = 0 } = {}) {
  const secondItemId = '507f1f77bcf86cd799439032';
  const secondItem = concurrentItem ? makeItem({ _id: oid(secondItemId), itemCode: 'LOT-2', status: 'PENDING_INBOUND' }) : null;
  const state = {
    item: makeItem({ status: 'PENDING_INBOUND' }), items: new Map([[itemId, makeItem({ status: 'PENDING_INBOUND' })], ...(secondItem ? [[secondItemId, secondItem]] : [])]),
    movement: null, movements: new Map(), otherLevelWeightKg, otherRackWeightKg,
    cell: { _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId), levelNumber: 1, cellNumber: 1,
      code: 'R1-L1-C1', operationalStatus: 'AVAILABLE', maxWeightKg: cellMaxWeightKg, usedWeightKg: initialCellWeightKg, usedVolumeM3: initialCellVolumeM3,
      dimensions: { widthM: .5, depthM: .6, usableHeightM: .5 } },
    reservation: { _id: oid(reservationId), facilityId: oid(facilityId), customerId, allocatedCapacity, usedCapacityM3: initialCellVolumeM3,
      save: async function () { return this; } },
  };
  state.allocation = { _id: oid('507f1f77bcf86cd799439091'), cellId: oid(cellId), reservationId: oid(reservationId), customerId, status: 'RESERVED', save: async function () { return this; } };
  state.otherAllocation = { _id: oid('507f1f77bcf86cd799439092'), cellId: oid('507f1f77bcf86cd799439042'), reservationId: oid(reservationId), customerId, status: 'RESERVED' };
  state.item = state.items.get(itemId);
  let transactionQueue = Promise.resolve();
  const session = {
    withTransaction: async work => {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise(resolve => { release = resolve; });
      await previous;
      const itemSnapshots = [...state.items].map(([key, item]) => [key, { status: item.status, currentCellId: item.currentCellId,
        inboundConfirmedAt: item.inboundConfirmedAt, inboundMovementId: item.inboundMovementId, inboundIdempotencyKey: item.inboundIdempotencyKey }]);
      const snapshot = { usedWeightKg: state.cell.usedWeightKg,
        usedVolumeM3: state.cell.usedVolumeM3, usedCapacityM3: state.reservation.usedCapacityM3, movement: state.movement,
        reservationStatus: state.reservation.status, reservationHistory: [...(state.reservation.statusHistory ?? [])], allocationStatus: state.allocation.status };
      try { return await work(); }
      catch (error) {
        for (const [key, itemSnapshot] of itemSnapshots) Object.assign(state.items.get(key), itemSnapshot);
        state.cell.usedWeightKg = snapshot.usedWeightKg; state.cell.usedVolumeM3 = snapshot.usedVolumeM3;
        state.reservation.usedCapacityM3 = snapshot.usedCapacityM3; state.movement = snapshot.movement;
        state.reservation.status = snapshot.reservationStatus; state.reservation.statusHistory = snapshot.reservationHistory;
        state.allocation.status = snapshot.allocationStatus;
        throw error;
      } finally { release(); }
    }, endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Item, 'findOne', filter => new Query(state.items.get(String(filter._id)) || null));
  t.mock.method(Item, 'findOneAndUpdate', (filter, _update, options) => {
    assert.equal(options.session, session); return new Query(state.items.get(String(filter._id)) || null);
  });
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  t.mock.method(Cell, 'findOne', () => new Query(state.cell));
  const otherCells = [];
  if (otherLevelWeightKg > 0) otherCells.push({ rackId: oid(rackId), levelNumber: 1, usedWeightKg: otherLevelWeightKg, usedVolumeM3: 0 });
  if (otherRackWeightKg > 0) otherCells.push({ rackId: oid(rackId), levelNumber: 2, usedWeightKg: otherRackWeightKg, usedVolumeM3: 0 });
  t.mock.method(Cell, 'find', () => new Query([state.cell, ...otherCells]));
  t.mock.method(CellAllocation, 'findOne', () => new Query(state.allocation));
  t.mock.method(CellAllocation.prototype, 'save', async function () { state.allocation.status = this.status; return this; });
  t.mock.method(Cell, 'findOneAndUpdate', (_filter, update, options) => {
    assert.equal(options.session, session);
    state.cell.usedWeightKg += update.$inc.usedWeightKg; state.cell.usedVolumeM3 += update.$inc.usedVolumeM3;
    return new Query(state.cell);
  });
  t.mock.method(Zone, 'findOneAndUpdate', (_filter, _update, options) => {
    assert.equal(options.session, session); return new Query({ _id: oid(zoneId) });
  });
  t.mock.method(Rack, 'findOneAndUpdate', (_filter, _update, options) => {
    assert.equal(options.session, session); return new Query({ _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId),
      operationalStatus: 'AVAILABLE', levelCount: rackLevelCount, maxWeightKgPerLevel });
  });
  t.mock.method(Reservation, 'findOneAndUpdate', (_filter, _update, options) => {
    assert.equal(options.session, session); return new Query(state.reservation);
  });
  t.mock.method(Reservation, 'findOne', () => new Query(state.reservation));
  t.mock.method(ManagedCapacity, 'findOneAndUpdate', () => new Query({ bookingVersion: 2 }));
  t.mock.method(Reservation, 'exists', () => new Query(null));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Cell, 'aggregate', () => new Query([]));
  t.mock.method(Policy, 'find', () => new Query([{ config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } }], session));
  t.mock.method(Movement, 'findOne', filter => {
    const movement = state.movements.get(String(filter.itemId));
    return new Query(movement?.idempotencyKey === filter.idempotencyKey ? movement : null);
  });
  t.mock.method(Movement.prototype, 'save', async function () {
    if (movementFailure) throw new Error('simulated movement persistence failure');
    state.movement = this; state.movements.set(String(this.itemId), this); return this;
  });
  return { state, session, body: {
    cellId, verifiedQuantity: 2, actualUnitWeightKg: 20,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, physicalPackingConfirmed: true,
    inspectionNote: 'Two cartons physically checked', idempotencyKey: 'inbound-success-01',
  }, actor: { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: oid(facilityId) } };
}

function mockV2FirstInbound(t, { status = 'CHECKIN_READY', itemStatus = status === 'CHECKIN_READY' ? 'RECEIVED_PENDING_ACCEPTANCE' : 'PENDING_INBOUND',
  custodyStatus = status === 'CHECKIN_READY' ? 'IN_CUSTODY' : 'NONE', startDate = new Date(Date.now() - 60_000), endDate = new Date(Date.now() + 86_400_000),
  signatures = ['CUSTOMER', 'FACILITY_STAFF'], balanceSettled = true, contractSnapshot = true, inspectionDecision = 'ACCEPTED',
  depositPaid = true, signedHashMatches = true, initialCellWeightKg = 0, initialCellVolumeM3 = 0 } = {}) {
  const setup = mockSuccessfulConfirmation(t, { initialCellWeightKg, initialCellVolumeM3 });
  const { state } = setup;
  state.item.status = itemStatus;
  state.item.receivingCustodyStatus = custodyStatus;
  Object.assign(state.reservation, { bookingFlowVersion: 2, status, serviceType: 'MANAGED_INVENTORY', startDate, endDate,
    allocatedCellIds: [oid(cellId), oid('507f1f77bcf86cd799439042')], estimatedRent: 1000, depositAmount: 200,
    taxAmount: 0, discountAmount: 0, statusHistory: [], ...(balanceSettled ? { balanceSettledAt: new Date() } : {}) });
  state.item.receivingInspection = { decision: inspectionDecision, observedQuantity: 2, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, compatibleWithCellIds: [oid(cellId)], packingLayoutVerified: true };
  const contentHash = 'valid-contract-content-hash';
  const handover = [{ itemId, itemCode: 'LOT-1', name: 'Cartons', category: 'DOCUMENTS', decision: 'ACCEPTED', quantity: 2,
    weightKg: 20, dimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, compatibleCellIds: [cellId], packingLayoutVerified: true }];
  const contract = { status: signatures.length === 2 && signedHashMatches ? 'SIGNED' : 'DRAFT', currentContentVersion: 1,
    contentVersions: [{ version: 1, contentHash, content: { handover: contractSnapshot ? handover : [] } }],
    signatures: signatures.map(signerRole => ({ version: 1, contentHash: signedHashMatches ? contentHash : 'superseded-hash', signerRole, signerId: signerRole === 'CUSTOMER' ? customerId : staffId, signedAt: new Date() })) };
  const deposit = depositPaid ? { reservationId: state.reservation._id, customerId, serviceType: 'MANAGED_INVENTORY', purpose: 'DEPOSIT', status: 'SUCCEEDED', amount: 200, currency: 'VND' } : null;
  const balance = balanceSettled ? { reservationId: state.reservation._id, customerId, serviceType: 'MANAGED_INVENTORY', purpose: 'BALANCE', status: 'SUCCEEDED', amount: 800, currency: 'VND' } : null;
  t.mock.method(Contract, 'findOne', () => new Query(contract));
  t.mock.method(Payment, 'findOne', filter => new Query(filter.purpose === 'DEPOSIT' ? deposit : balance));
  t.mock.method(ManagedAudit, 'create', async (records) => { state.auditEvents ??= []; state.auditEvents.push(...records); return records; });
  return { ...setup, contract, deposit, balance };
}

function mockPlacementPreview(t, { usedWeightKg = 40, usedVolumeM3 = .03, allocatedCapacity = .12, usedCapacityM3 = .1,
  levelUsedWeightKg = 40, rackUsedWeightKg = 40 } = {}) {
  t.mock.method(Item, 'findOne', () => new Query(makeItem({ status: 'REGISTERED', preferredCellId: oid(cellId) })));
  t.mock.method(Reservation, 'findOne', () => new Query({ _id: oid(reservationId), customerId, facilityId: oid(facilityId),
    serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', allocatedCapacity, usedCapacityM3 }));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Cell, 'findOne', () => new Query({ _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
    maxWeightKg: 100, usedWeightKg, usedVolumeM3, operationalStatus: 'AVAILABLE',
    dimensions: { widthM: .5, depthM: .6, usableHeightM: .5 } }));
  t.mock.method(Zone, 'findOne', () => new Query({ _id: oid(zoneId), facilityId: oid(facilityId), isActive: true }));
  t.mock.method(Rack, 'findOne', () => new Query({ _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId),
    levelCount: 4, maxWeightKgPerLevel: 500, operationalStatus: 'AVAILABLE' }));
  let aggregateCall = 0;
  t.mock.method(Cell, 'aggregate', () => new Query([{ usedWeightKg: aggregateCall++ === 0 ? levelUsedWeightKg : rackUsedWeightKg }]));
  return { _id: customerId, role: 'CUSTOMER' };
}

test('model supports the inventory lifecycle, transactional occupancy counters and immutable movement indexes', async () => {
  assert.deepEqual(Item.schema.path('status').enumValues, ['REGISTERED', 'PENDING_INBOUND', 'RECEIVED_PENDING_ACCEPTANCE', 'IN_STORAGE', 'PENDING_OUTBOUND', 'CHECKED_OUT']);
  assert.equal(Cell.schema.path('usedWeightKg').defaultValue, 0);
  assert.equal(Cell.schema.path('usedVolumeM3').defaultValue, 0);
  assert.equal(Reservation.schema.path('usedCapacityM3').defaultValue, 0);
  const indexes = Movement.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.itemId === 1 && keys.idempotencyKey === 1 && options.unique));
  assert.ok(indexes.some(([keys]) => keys.facilityId === 1));
  assert.ok(indexes.some(([keys]) => keys.managedReservationId === 1));
  assert.equal(Movement.schema.path('actualTotalVolumeM3').options.immutable, true);
  const doc = new Movement({
    itemId: oid(itemId), managedReservationId: oid(reservationId), facilityId: oid(facilityId), customerId,
    type: 'INBOUND', destinationCellId: oid(cellId), quantity: 2, quantityUnit: 'carton',
    actualUnitWeightKg: 20, actualTotalWeightKg: 40, actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 },
    actualTotalVolumeM3: .03, performedBy: staffId, performedAt: new Date(), inspectionNote: 'checked', idempotencyKey: 'in-1',
  });
  await doc.validate();
  doc.isNew = false;
  await assert.rejects(doc.save(), /append-only/);
  await assert.rejects(doc.deleteOne(), /append-only/);
  await assert.rejects(Movement.updateOne({ _id: doc._id }, { $set: { inspectionNote: 'rewritten' } }).exec(), /append-only/);
});

test('customer inbound request transitions REGISTERED to PENDING_INBOUND without physical writes', async t => {
  mockRequest(t);
  t.mock.method(Cell, 'findOneAndUpdate', () => assert.fail('request must not allocate or update a Cell'));
  t.mock.method(Movement, 'create', () => assert.fail('request must not create a movement'));
  const result = await service.requestInbound(itemId, { _id: customerId, role: 'CUSTOMER' });
  assert.equal(result.status, 'PENDING_INBOUND');
  assert.equal(result.currentCellId, null);
});

test('inbound request rejects Self Storage, expired or non-active reservations and another customer', async t => {
  mockRequest(t, { reservationMismatch: true });
  await assert.rejects(service.requestInbound(itemId, { _id: customerId, role: 'CUSTOMER' }), { status: 409 });
  t.mock.method(Item, 'findOne', () => new Query(null));
  await assert.rejects(service.requestInbound(itemId, { _id: oid('507f1f77bcf86cd799439099'), role: 'CUSTOMER' }), { status: 404 });
});

test('staff only may confirm; Manager and Admin cannot mutate inbound', async () => {
  for (const role of ['CUSTOMER', 'FACILITY_MANAGER', 'ADMIN', 'BOM']) {
    await assert.rejects(service.confirmInbound(itemId, {}, { _id: staffId, role, assignedFacilityId: oid(facilityId) }), { status: 403 });
  }
});

test('confirmation fails closed when the effective CATEGORY policy is missing before occupancy writes', async t => {
  const session = mockTransaction(t);
  t.mock.method(Item, 'findOne', () => new Query(makeItem({ status: 'PENDING_INBOUND' })));
  t.mock.method(Item, 'findOneAndUpdate', (filter, _update, options) => {
    assert.equal(filter.status, 'PENDING_INBOUND');
    assert.equal(options.session, session);
    return new Query(makeItem({ status: 'PENDING_INBOUND' }));
  });
  const cell = {
    _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
    levelNumber: 1, cellNumber: 1, operationalStatus: 'AVAILABLE', maxWeightKg: 100,
    usedWeightKg: 0, usedVolumeM3: 0, dimensions: { widthM: .5, depthM: .6, usableHeightM: .5 },
  };
  t.mock.method(CellAllocation, 'findOne', () => new Query({ _id: oid('507f1f77bcf86cd799439091'),
    cellId: oid(cellId), reservationId: oid(reservationId), customerId, status: 'RESERVED' }));
  t.mock.method(Cell, 'findOne', () => new Query(cell));
  t.mock.method(Zone, 'findOneAndUpdate', (_filter, _update, options) => { assert.equal(options.session, session); return new Query({ _id: oid(zoneId) }); });
  t.mock.method(Reservation, 'findOneAndUpdate', (_filter, _update, options) => { assert.equal(options.session, session); return new Query({
    _id: oid(reservationId), facilityId: oid(facilityId), customerId, allocatedCapacity: 1.5, usedCapacityM3: 0,
    save: async () => {},
  }); });
  t.mock.method(Reservation, 'findOne', () => new Query({ _id: oid(reservationId), facilityId: oid(facilityId), customerId, serviceType: 'MANAGED_INVENTORY' }));
  t.mock.method(Reservation, 'exists', () => new Query(null));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Rack, 'findOneAndUpdate', (_filter, _update, options) => { assert.equal(options.session, session); return new Query({
    _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), operationalStatus: 'AVAILABLE',
    levelCount: 4, maxWeightKgPerLevel: 500,
  }); });
  t.mock.method(Cell, 'find', () => new Query([cell]));
  t.mock.method(Cell, 'aggregate', () => new Query([]));
  t.mock.method(Policy, 'find', () => new Query([]));
  t.mock.method(Cell, 'findOneAndUpdate', () => assert.fail('undefined category policy must stop before occupancy write'));
  t.mock.method(Movement.prototype, 'save', () => assert.fail('undefined category policy must stop before movement write'));
  const body = {
    cellId, verifiedQuantity: 2, actualUnitWeightKg: 20,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 },
    physicalPackingConfirmed: true, inspectionNote: 'Two cartons physically checked', idempotencyKey: 'inbound-001',
  };
  await assert.rejects(service.confirmInbound(itemId, body, {
    _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: oid(facilityId),
  }), { status: 409, message: /No effective Managed Inventory CATEGORY policy/ });
});

test('confirmation rejects ambiguous, invalid, blocked and unlisted CATEGORY policy outcomes', async t => {
  for (const options of [
    { policies: [{ config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } }, { config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } }] },
    { policies: [{ config: { allowedCategories: ['DOCUMENTS'] } }] },
    { policies: [{ config: { allowedCategories: ['DOCUMENTS'], blockedCategories: ['DOCUMENTS'] } }] },
    { policies: [{ config: { allowedCategories: ['FURNITURE'], blockedCategories: [] } }] },
  ]) {
    await t.test(JSON.stringify(options), async t => {
      const setup = mockConfirmation(t, options);
      await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), { status: 409 });
    });
  }
});

test('successful inbound atomically records 40kg/0.03m3, reports map usage and replays idempotently', async t => {
  const setup = mockSuccessfulConfirmation(t);
  const first = await service.confirmInbound(itemId, setup.body, setup.actor);
  assert.equal(first.item.status, 'IN_STORAGE');
  assert.equal(String(first.item.currentCellId), cellId);
  assert.equal(first.movement.type, 'INBOUND');
  assert.equal(setup.state.cell.usedWeightKg, 40);
  assert.equal(setup.state.cell.usedVolumeM3, .03);
  assert.equal(setup.state.reservation.usedCapacityM3, .03);
  assert.equal(setup.state.movement.type, 'INBOUND');
  assert.equal(setup.state.allocation.status, 'OCCUPIED');

  t.mock.method(Rack, 'findOne', () => new Query({ _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId),
    aisleCode: 'A1', rackCode: 'R1', dimensions: { widthM: 2, depthM: .6, heightM: 2 }, levelCount: 1,
    cellsPerLevel: 4, maxWeightKgPerLevel: 500, mapX: 0, mapY: 0, orientation: 0, operationalStatus: 'AVAILABLE' }));
  t.mock.method(Zone, 'findOne', () => new Query({ _id: oid(zoneId), code: 'Z1', isActive: true }));
  t.mock.method(Cell, 'find', () => new Query([setup.state.cell]));
  t.mock.method(CellAllocation, 'find', () => new Query([setup.state.allocation]));
  t.mock.method(Item, 'find', () => new Query([]));
  const map = await WarehouseMapService.rackDetailMap(rackId, { _id: customerId, role: 'CUSTOMER' });
  assert.equal(map.capacity.usedWeightKg, 40);
  assert.equal(map.levels[0].cells[0].remainingWeightKg, 60);

  const replay = await service.confirmInbound(itemId, setup.body, setup.actor);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(setup.state.cell.usedWeightKg, 40);
  assert.equal(setup.state.cell.usedVolumeM3, .03);
  assert.equal(setup.state.reservation.usedCapacityM3, .03);
  assert.equal(setup.state.movement.type, 'INBOUND', 'exactly one movement remains');
  await assert.rejects(service.confirmInbound(itemId, { ...setup.body, inspectionNote: 'different payload' }, setup.actor), { status: 409 });
  assert.equal(setup.state.cell.usedWeightKg, 40);
});

test('first version 2 inbound requires signed contract and settled payments, then atomically activates only its destination Cell', async t => {
  const setup = mockV2FirstInbound(t);
  const result = await service.confirmInbound(itemId, setup.body, setup.actor);
  assert.equal(result.item.status, 'IN_STORAGE');
  assert.equal(result.item.currentCellId.toString(), cellId);
  assert.equal(setup.state.reservation.status, 'ACTIVE');
  assert.equal(setup.state.reservation.usedCapacityM3, .03);
  assert.equal(setup.state.allocation.status, 'OCCUPIED');
  assert.equal(setup.state.otherAllocation.status, 'RESERVED');
  assert.equal(setup.state.cell.usedWeightKg, 40);
  assert.equal(setup.state.cell.usedVolumeM3, .03);
  assert.equal(setup.state.movements.size, 1);
  assert.equal(setup.state.item.receivingCustodyStatus, 'IN_CUSTODY');
  assert.deepEqual(setup.state.auditEvents.map(event => event.action), ['ACTIVATED', 'INBOUND_CONFIRMED']);
});

test('first inbound requires accepted inspection and custody; an uninspected or rejected item cannot bypass check-in', async t => {
  const uninspected = mockV2FirstInbound(t, { itemStatus: 'PENDING_INBOUND', custodyStatus: 'NONE' });
  uninspected.state.item.receivingInspection = undefined;
  await assert.rejects(service.confirmInbound(itemId, uninspected.body, uninspected.actor), { status: 409 });
  assert.equal(uninspected.state.cell.usedWeightKg, 0);
  assert.equal(uninspected.state.movements.size, 0);

  const custodyMissing = mockV2FirstInbound(t, { itemStatus: 'PENDING_INBOUND', custodyStatus: 'NONE' });
  await assert.rejects(service.confirmInbound(itemId, custodyMissing.body, custodyMissing.actor), { status: 409, message: /custody taken/ });
  assert.equal(custodyMissing.state.cell.usedWeightKg, 0);
  assert.equal(custodyMissing.state.movements.size, 0);

  const rejected = mockV2FirstInbound(t, { itemStatus: 'REGISTERED', custodyStatus: 'RETURNED', inspectionDecision: 'REJECTED' });
  await assert.rejects(service.confirmInbound(itemId, rejected.body, rejected.actor), { status: 409 });
  assert.equal(rejected.state.cell.usedWeightKg, 0);
  assert.equal(rejected.state.movements.size, 0);
});

test('version 2 first inbound fails closed on missing signature, changed contract hash, unpaid balance, stale inspection, or invalid dates', async t => {
  for (const options of [
    { signatures: ['FACILITY_STAFF'] },
    { signedHashMatches: false },
    { balanceSettled: false },
    { contractSnapshot: false },
    { inspectionDecision: 'DISCREPANCY' },
    { startDate: new Date(Date.now() + 60_000) },
    { endDate: new Date(Date.now() - 60_000) },
    { depositPaid: false },
  ]) await t.test(JSON.stringify(options), async t => {
    const setup = mockV2FirstInbound(t, options);
    await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), { status: 409 });
    assert.equal(setup.state.reservation.status, 'CHECKIN_READY');
    assert.equal(setup.state.item.status, 'RECEIVED_PENDING_ACCEPTANCE');
    assert.equal(setup.state.cell.usedWeightKg, 0);
    assert.equal(setup.state.movements.size, 0);
  });
});

test('version 2 first inbound rejects unknown legacy Cell counters and unallocated destination', async t => {
  const unknown = mockV2FirstInbound(t);
  unknown.state.cell.usedVolumeM3 = undefined;
  await assert.rejects(service.confirmInbound(itemId, unknown.body, unknown.actor), { status: 409, message: /counters are unknown/ });
  assert.equal(unknown.state.reservation.status, 'CHECKIN_READY');
  assert.equal(unknown.state.movements.size, 0);
  const unallocated = mockV2FirstInbound(t);
  unallocated.state.reservation.allocatedCellIds = [oid('507f1f77bcf86cd799439042')];
  await assert.rejects(service.confirmInbound(itemId, unallocated.body, unallocated.actor), { status: 409, message: /not selected/ });
});

test('version 2 subsequent inbound stays ACTIVE without another contract or balance payment', async t => {
  const setup = mockV2FirstInbound(t, { status: 'ACTIVE', itemStatus: 'PENDING_INBOUND', initialCellWeightKg: 40, initialCellVolumeM3: .03 });
  setup.state.allocation.status = 'OCCUPIED';
  const result = await service.confirmInbound(itemId, setup.body, setup.actor);
  assert.equal(result.item.status, 'IN_STORAGE');
  assert.equal(setup.state.reservation.status, 'ACTIVE');
  assert.equal(setup.state.reservation.usedCapacityM3, .06);
  assert.equal(setup.state.cell.usedWeightKg, 80);
  assert.equal(setup.state.cell.usedVolumeM3, .06);
  assert.equal(setup.state.movements.size, 1);
  assert.equal(setup.state.auditEvents.length, 1);
  assert.equal(setup.state.auditEvents[0].action, 'INBOUND_CONFIRMED');
});

test('version 2 movement failure rolls back activation, counters, allocation and item writes', async t => {
  const setup = mockSuccessfulConfirmation(t, { movementFailure: true });
  setup.state.reservation.bookingFlowVersion = 2;
  setup.state.reservation.status = 'CHECKIN_READY';
  setup.state.reservation.startDate = new Date(Date.now() - 60_000);
  setup.state.reservation.endDate = new Date(Date.now() + 86_400_000);
  setup.state.reservation.allocatedCellIds = [oid(cellId)];
  setup.state.reservation.estimatedRent = 1000;
  setup.state.reservation.depositAmount = 200;
  setup.state.reservation.balanceSettledAt = new Date();
  setup.state.reservation.statusHistory = [];
  setup.state.item.receivingInspection = { decision: 'ACCEPTED', observedQuantity: 2, observedUnitWeightKg: 20,
    observedUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, compatibleWithCellIds: [oid(cellId)], packingLayoutVerified: true };
  setup.state.item.status = 'RECEIVED_PENDING_ACCEPTANCE';
  setup.state.item.receivingCustodyStatus = 'IN_CUSTODY';
  const contentHash = 'valid-contract-content-hash';
  t.mock.method(Contract, 'findOne', () => new Query({ status: 'SIGNED', currentContentVersion: 1,
    contentVersions: [{ version: 1, contentHash, content: { handover: [{ itemId, itemCode: 'LOT-1', name: 'Cartons', category: 'DOCUMENTS',
      decision: 'ACCEPTED', quantity: 2, weightKg: 20, dimensionsM: { widthM: .25, depthM: .3, heightM: .2 },
      compatibleCellIds: [cellId], packingLayoutVerified: true }] } }],
    signatures: [{ version: 1, contentHash, signerRole: 'CUSTOMER' }, { version: 1, contentHash, signerRole: 'FACILITY_STAFF' }] }));
  t.mock.method(Payment, 'findOne', filter => new Query(filter.purpose === 'DEPOSIT'
    ? { customerId, serviceType: 'MANAGED_INVENTORY', amount: 200, currency: 'VND' }
    : { customerId, serviceType: 'MANAGED_INVENTORY', amount: 800, currency: 'VND' }));
  await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), /Internal Server Error/);
  assert.equal(setup.state.reservation.status, 'CHECKIN_READY');
  assert.equal(setup.state.item.status, 'RECEIVED_PENDING_ACCEPTANCE');
  assert.equal(setup.state.cell.usedWeightKg, 0);
  assert.equal(setup.state.cell.usedVolumeM3, 0);
  assert.equal(setup.state.allocation.status, 'RESERVED');
  assert.equal(setup.state.movements.size, 0);
});

test('concurrent duplicate version 2 first-inbound confirmations activate and count once', async t => {
  const setup = mockV2FirstInbound(t);
  const results = await Promise.all([
    service.confirmInbound(itemId, setup.body, setup.actor),
    service.confirmInbound(itemId, setup.body, setup.actor),
  ]);
  assert.equal(results.filter(result => result.idempotentReplay === false).length, 1);
  assert.equal(results.filter(result => result.idempotentReplay === true).length, 1);
  assert.equal(setup.state.cell.usedWeightKg, 40);
  assert.equal(setup.state.cell.usedVolumeM3, .03);
  assert.equal(setup.state.reservation.usedCapacityM3, .03);
  assert.equal(setup.state.reservation.status, 'ACTIVE');
  assert.equal(setup.state.movements.size, 1);
  assert.equal(setup.state.auditEvents.filter(event => event.action === 'ACTIVATED').length, 1);
});

test('concurrent distinct inbound lots cannot exceed shared Cell, tier, Rack or quota limits', async t => {
  const cases = [
    { name: 'Cell kg', options: { cellMaxWeightKg: 40 } },
    { name: 'tier kg', options: { maxWeightKgPerLevel: 40 } },
    { name: 'Rack kg', options: { otherRackWeightKg: 1960 } },
    { name: 'Managed quota', options: { allocatedCapacity: .03 } },
  ];
  for (const entry of cases) await t.test(entry.name, async t => {
    const setup = mockSuccessfulConfirmation(t, { concurrentItem: true, ...entry.options });
    const outcomes = await Promise.allSettled([
      service.confirmInbound(itemId, setup.body, setup.actor),
      service.confirmInbound('507f1f77bcf86cd799439032', setup.body, setup.actor),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    const rejection = outcomes.find(result => result.status === 'rejected');
    assert.equal(rejection.reason.status, 409);
    assert.equal(setup.state.cell.usedWeightKg, 40);
    assert.equal(setup.state.reservation.usedCapacityM3, .03);
    assert.equal(setup.state.movements.size, 1);
  });
});

test('placement preview subtracts actual Cell and rental usage, remains advisory, and flags multi-unit packing as unchecked', async t => {
  const actor = mockPlacementPreview(t);
  const preview = await service.placementPreview(itemId, { cellId }, actor);
  assert.equal(preview.actualUsageKnown, true);
  assert.equal(preview.cellCapacity.usedWeightKg, 40);
  assert.equal(preview.cellCapacity.remainingWeightKg, 60);
  assert.equal(preview.cellCapacity.usedVolumeM3, .03);
  assert.equal(preview.cellCapacity.remainingVolumeM3, .12);
  assert.equal(preview.rentalQuota.usedCapacityM3, .1);
  assert.equal(preview.rentalQuota.remainingCapacityM3, .02);
  assert.equal(preview.structuralCapacity.levelRemainingWeightKg, 460);
  assert.equal(preview.checks.totalLotVolumeWithinAllocatedRentalQuota, false);
  assert.equal(preview.checks.multiUnitPackingLayoutValidated, null);
  assert.ok(preview.uncertainty.includes('MULTI_UNIT_PACKING_LAYOUT_NOT_CHECKED'));
  assert.ok(!preview.uncertainty.includes('ACTUAL_CELL_USAGE_NOT_AVAILABLE_IN_MI_01'));
  assert.equal(preview.allocationConfirmed, false);
});

test('placement preview rejects invalid persisted usage counters instead of assuming empty capacity', async t => {
  const actor = mockPlacementPreview(t, { usedWeightKg: -1 });
  await assert.rejects(service.placementPreview(itemId, { cellId }, actor), { status: 409, message: /usage counters are invalid/ });
});

test('placement preview checks remaining Rack level and Rack weight after existing usage', async t => {
  const actor = mockPlacementPreview(t, { levelUsedWeightKg: 490, rackUsedWeightKg: 1980 });
  const preview = await service.placementPreview(itemId, { cellId }, actor);
  assert.equal(preview.structuralCapacity.levelRemainingWeightKg, 10);
  assert.equal(preview.structuralCapacity.rackRemainingWeightKg, 20);
  assert.equal(preview.checks.totalLotWeightWithinLevelRatedCapacity, false);
  assert.equal(preview.checks.totalLotWeightWithinRackRatedCapacity, false);
  assert.equal(preview.estimatedFit, false);
});

test('movement save failure rolls back item, Cell and reservation state in transaction mock', async t => {
  const setup = mockSuccessfulConfirmation(t, { movementFailure: true });
  await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), { status: 500 });
  assert.equal(setup.state.item.status, 'PENDING_INBOUND');
  assert.equal(setup.state.item.currentCellId, null);
  assert.equal(setup.state.cell.usedWeightKg, 0);
  assert.equal(setup.state.cell.usedVolumeM3, 0);
  assert.equal(setup.state.reservation.usedCapacityM3, 0);
  assert.equal(setup.state.movement, null);
  assert.equal(setup.state.allocation.status, 'RESERVED');
});

test('Staff inbound is limited to the Cell allocated to that Managed reservation', async t => {
  const setup = mockSuccessfulConfirmation(t);
  t.mock.method(CellAllocation, 'findOne', () => new Query(null));
  await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), { status: 409, message: /allocated to this Managed reservation/ });
  assert.equal(setup.state.cell.usedWeightKg, 0);
  assert.equal(setup.state.item.status, 'PENDING_INBOUND');
});

test('accepted received goods are committed as first IN_STORAGE inbound and activate the rental atomically', async t => {
  const setup = mockV2FirstInbound(t);
  const result = await service.confirmInbound(itemId, setup.body, setup.actor);
  assert.equal(result.item.status, 'IN_STORAGE');
  assert.equal(setup.state.reservation.status, 'ACTIVE');
  assert.equal(setup.state.item.currentCellId.toString(), cellId);
  assert.equal(setup.state.cell.usedWeightKg, 40);
  assert.equal(setup.state.cell.usedVolumeM3, .03);
  assert.equal(setup.state.reservation.usedCapacityM3, .03);
  assert.equal(setup.state.movements.size, 1);
});

test('quantity greater than one requires physical packing attestation and mismatched measurements stay pending', () => {
  const { parseInboundConfirmation } = require('../dist/services/inventory-items/inventory-item.validation');
  const base = {
    cellId, verifiedQuantity: 2, actualUnitWeightKg: 20,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 },
    physicalPackingConfirmed: false, inspectionNote: 'checked', idempotencyKey: 'inbound-002',
  };
  assert.equal(parseInboundConfirmation(base).physicalPackingConfirmed, false);
  assert.throws(() => parseInboundConfirmation({ ...base, verifiedQuantity: 0 }), { status: 400 });
  assert.throws(() => parseInboundConfirmation({ ...base, actualUnitWeightKg: Infinity }), { status: 400 });
});

test('confirmation rejects missing clearance, packing gaps, discrepancies and invalid geometry', async t => {
  for (const options of [
    { usableHeightM: null, expected: /usableHeightM/ },
    { body: { physicalPackingConfirmed: false }, expected: /packing layout/ },
    { body: { actualUnitWeightKg: 19 }, expected: /measurements differ/ },
    { cellWidthM: .2, cellDepthM: .2, expected: /does not fit/ },
  ]) {
    await t.test(String(options.expected), async t => {
      const setup = mockConfirmation(t, options);
      await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), { status: 409, message: options.expected });
    });
  }
});

test('confirmation rejects unavailable parents, Cells, overdue/expired rentals and cross-Facility destinations', async t => {
  for (const options of [
    { zoneInactive: true }, { rackUnavailable: true }, { cellStatus: 'MAINTENANCE' },
    { facilityInactive: true }, { reservationInactive: true }, { overdue: true },
    { cellFacilityId: '507f1f77bcf86cd799439099' },
  ]) {
    await t.test(JSON.stringify(options), async t => {
      const setup = mockConfirmation(t, options);
      await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), { status: 409 });
    });
  }
});

test('confirmation rejects Cell, tier, Rack and contracted quota over-capacity', async t => {
  const cases = [
    { body: { verifiedQuantity: 3 }, expected: /quantity\/measurements/ },
    { allocatedCapacity: .02, expected: /contracted quota/ },
    { usedVolumeM3: .14, expected: /Cell kg or m3/ },
    { cellMaxWeightKg: 30, expected: /Cell kg or m3/ },
    { levelUsage: [{ usedWeightKg: 490 }], expected: /level weight/ },
    { rackUsage: [{ usedWeightKg: 1980 }], expected: /structural weight/ },
  ];
  for (const options of cases) {
    await t.test(String(options.expected), async t => {
      const setup = mockConfirmation(t, options);
      await assert.rejects(service.confirmInbound(itemId, setup.body, setup.actor), { status: 409, message: options.expected });
    });
  }
});

test('rejected inbound returns to REGISTERED with a reason and does not touch usage', async t => {
  mockTransaction(t);
  t.mock.method(Item, 'findOne', () => new Query(makeItem({ status: 'PENDING_INBOUND' })));
  t.mock.method(Item, 'findOneAndUpdate', () => new Query(makeItem({ status: 'PENDING_INBOUND' })));
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  t.mock.method(Cell, 'findOneAndUpdate', () => assert.fail('rejection cannot change Cell usage'));
  const result = await service.rejectInbound(itemId, { reason: 'Dimensions differ' }, {
    _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: oid(facilityId),
  });
  assert.equal(result.status, 'REGISTERED');
  assert.match(result.inboundRejection.reason, /Dimensions differ/);
});

test('same warehouse map detail reports real 40/100kg Cell utilization and remaining capacity', async t => {
  const actualCell = new Cell({
    _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
    levelNumber: 1, cellNumber: 1, code: 'R1-L1-C1', dimensions: { widthM: .5, depthM: .6, usableHeightM: .5 },
    maxWeightKg: 100, usedWeightKg: 40, usedVolumeM3: .03, operationalStatus: 'AVAILABLE',
  });
  t.mock.method(Rack, 'findOne', () => new Query(new Rack({
    _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), aisleCode: 'A1', rackCode: 'R1',
    dimensions: { widthM: 2, depthM: .6, heightM: 2 }, levelCount: 1, cellsPerLevel: 1, maxWeightKgPerLevel: 500,
    mapX: 0, mapY: 0, orientation: 0, operationalStatus: 'AVAILABLE',
  })));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Zone, 'findOne', () => new Query({ _id: oid(zoneId), code: 'Z1', isActive: true }));
  t.mock.method(Cell, 'find', () => new Query([actualCell]));
  t.mock.method(CellAllocation, 'find', () => new Query([]));
  t.mock.method(Item, 'find', () => new Query([]));
  const map = await WarehouseMapService.rackDetailMap(rackId, { _id: customerId, role: 'CUSTOMER' });
  assert.equal(map.capacity.usedWeightKg, 40);
  assert.equal(map.capacity.source, 'WAREHOUSE_CELL_COUNTERS');
  assert.equal(map.levels[0].cells[0].remainingWeightKg, 60);
  assert.equal(map.levels[0].cells[0].usedVolumeM3, .03);
  assert.equal(map.capacity.customerId, undefined);
});

test('customer movement history is item-owner scoped and omits customer identity fields', async t => {
  t.mock.method(Item, 'findOne', () => new Query(makeItem({ status: 'IN_STORAGE', currentCellId: oid(cellId) })));
  t.mock.method(Movement, 'find', filter => {
    assert.equal(String(filter.itemId), itemId);
    return new Query([{
      _id: oid('507f1f77bcf86cd799439091'), itemId: oid(itemId), managedReservationId: oid(reservationId),
      facilityId: oid(facilityId), customerId, type: 'INBOUND', destinationCellId: oid(cellId), quantity: 2,
      quantityUnit: 'carton', actualUnitWeightKg: 20, actualTotalWeightKg: 40,
      actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, actualTotalVolumeM3: .03,
      performedBy: staffId, performedAt: new Date(), inspectionNote: 'checked', idempotencyKey: 'secret-operation-key',
    }]);
  });
  const rows = await service.movements(itemId, { _id: customerId, role: 'CUSTOMER' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customerId, undefined);
  assert.equal(rows[0].idempotencyKey, undefined);
  await assert.rejects(service.movements(itemId, { _id: oid('507f1f77bcf86cd799439099'), role: 'CUSTOMER' }), { status: 404 });
});
