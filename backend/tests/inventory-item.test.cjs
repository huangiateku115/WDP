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
const Facility = require('../dist/models/facilities/facility.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const ImageUpload = require('../dist/models/inventory-items/inventory-image-upload.model').default;
const ManagedInventoryImageService = require('../dist/services/upload/managed-inventory-image.service').ManagedInventoryImageService;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const { InventoryItemService: service } = require('../dist/services/inventory-items/inventory-item.service');
const { parseCreate, parseUpdate, InventoryItemError } = require('../dist/services/inventory-items/inventory-item.validation');
const { requireActiveManagedInventoryReservation, requireManagedInventoryReservationForRegistration } = require('../dist/services/reservations/managed-inventory-reservation.guard');

const facilityId = '507f1f77bcf86cd799439011';
const reservationId = '507f1f77bcf86cd799439021';
const itemId = '507f1f77bcf86cd799439031';
const cellId = '507f1f77bcf86cd799439041';
const zoneId = '507f1f77bcf86cd799439051';
const rackId = '507f1f77bcf86cd799439061';
const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439071');
const oid = value => new mongoose.Types.ObjectId(value);
const actor = (role = 'CUSTOMER', assigned = facilityId, id = userId) => ({ _id: id, role, assignedFacilityId: assigned ? oid(assigned) : null });

class Query {
  constructor(value) { this.value = value; }
  session() { return this; }
  select() { return this; }
  sort() { return this; }
  skip() { return this; }
  limit() { return this; }
  lean() { return this; }
  exec() { return Promise.resolve(this.value); }
}

const managedReservation = (overrides = {}) => ({
  _id: oid(reservationId), customerId: userId, facilityId: oid(facilityId),
  serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, status: 'ACTIVE', startDate: new Date(Date.now() - 3600000), endDate: new Date(Date.now() + 86400000), allocatedCapacity: 1.5, ...overrides,
});
const itemBody = (overrides = {}) => ({
  managedReservationId: reservationId,
  itemCode: 'customer-lot-01', name: 'Archive cartons', category: 'DOCUMENTS',
  description: 'Identical cartons', quantity: 2, quantityUnit: 'carton', unitWeightKg: 20,
  unitDimensionsM: { widthM: 0.25, depthM: 0.3, heightM: 0.2 },
  images: [], ...overrides,
});
const itemDoc = (overrides = {}) => new Item({
  _id: oid(itemId), facilityId: oid(facilityId), customerId: userId,
  managedReservationId: oid(reservationId), itemCode: 'CUSTOMER-LOT-01',
  name: 'Archive cartons', category: 'DOCUMENTS', quantity: 2, quantityUnit: 'carton',
  unitWeightKg: 20, unitDimensionsM: { widthM: 0.25, depthM: 0.3, heightM: 0.2 },
  unitVolumeM3: 0.015, totalWeightKg: 40, totalVolumeM3: 0.03,
  currentCellId: null, status: 'REGISTERED', images: [], createdBy: userId,
  ...overrides,
});
function mockEligibility(t, reservation = managedReservation(), facility = { status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }) {
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(String(filter.customerId), userId.toString());
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    if (filter.$or) { assert.equal(filter.bookingFlowVersion, 3); assert.equal(filter.$or[0].status, 'CHECKIN_READY'); assert.ok(filter.$or[0].endDate.$gt instanceof Date); assert.equal(filter.$or[1].status, 'ACTIVE'); assert.ok(filter.$or[1].startDate.$lte instanceof Date); assert.ok(filter.$or[1].endDate.$gt instanceof Date); }
    else assert.equal(filter.status, 'ACTIVE');
    return new Query(reservation);
  });
  t.mock.method(Facility, 'findOne', () => new Query(facility ? { _id: oid(facilityId), ...facility } : null));
}
function mockTransaction(t, onTransactionOptions = () => {}, onAbort = () => {}) {
  const session = {
    withTransaction: async (work, options) => {
      onTransactionOptions(options);
      try { return await work(); } catch (error) { onAbort(error); throw error; }
    },
    endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  return session;
}
function mockMetadataItemToken(t, item, session) {
  t.mock.method(Item, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(String(filter._id), itemId);
    assert.equal(filter.status, 'REGISTERED'); assert.equal(filter.currentCellId, null);
    assert.strictEqual(options.session, session);
    item.__v = (item.__v ?? 0) + update.$inc.__v;
    return new Query(item);
  });
}
function mockMetadataFence(t, item, reservation, session) {
  mockMetadataItemToken(t, item, session);
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.activeClosureRequestId, null);
    assert.ok(filter.$and?.length);
    assert.equal(update.$inc.inventoryVersion, 1);
    assert.strictEqual(options.session, session);
    reservation.inventoryVersion = (reservation.inventoryVersion ?? 0) + 1;
    return new Query(reservation);
  });
}
function mockRegistrationFence(t, reservation = managedReservation(), onAcquire = () => {}) {
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(String(filter._id), reservationId);
    assert.equal(String(filter.customerId), userId.toString());
    assert.equal(String(filter.facilityId), facilityId);
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    assert.equal(filter.activeClosureRequestId, null);
    assert.ok(filter.$or.some(row => row.inventoryVersion === 0));
    assert.ok(filter.$or.some(row => row.inventoryVersion.$exists === false));
    onAcquire();
    return new Query(reservation);
  });
}
function observedQuery(value, name, tracker, expectedSession) {
  let boundSession;
  return {
    session(session) { boundSession = session; return this; },
    exec() {
      assert.strictEqual(boundSession, expectedSession, `${name} uses the expected transaction session`);
      tracker.active += 1;
      tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
      return Promise.resolve(value).then(result => {
        tracker.order.push(name);
        tracker.active -= 1;
        return result;
      }, error => { tracker.active -= 1; throw error; });
    },
  };
}

test('model reserves stable itemCode per facility and supports derived registered-item fields', async () => {
  const indexes = Item.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.facilityId === 1 && keys.itemCode === 1 && options.unique));
  const item = itemDoc();
  assert.equal(item.status, 'REGISTERED');
  assert.equal(item.currentCellId, null);
  await item.validate();
});

test('Reservation lifecycle marker is an optional ObjectId reference and leaves existing reservations unmarked', async () => {
  const markerPath = Reservation.schema.path('activeClosureRequestId');
  assert.ok(markerPath);
  assert.equal(markerPath.instance, 'ObjectId');
  const reservation = new Reservation({
    reservationCode: 'WDP-TEST-RES', customerId: userId, facilityId: oid(facilityId),
    serviceType: 'MANAGED_INVENTORY', startDate: new Date(), endDate: new Date(Date.now() + 86400000),
    status: 'ACTIVE', pricingPolicyId: oid('507f1f77bcf86cd799439081'), estimatedRent: 100,
    depositAmount: 0,
  });
  assert.equal(reservation.activeClosureRequestId, undefined);
});

test('registration derives lot totals, keeps currentCellId null, and writes no physical placement', async t => {
  mockEligibility(t);
  mockTransaction(t, options => {
    assert.equal(options.timeoutMS, 15_000);
    assert.deepEqual(options.readConcern, { level: 'snapshot' });
    assert.deepEqual(options.writeConcern, { w: 'majority' });
  });
  let reservationFenceAcquired = false;
  mockRegistrationFence(t, managedReservation(), () => { reservationFenceAcquired = true; });
  let saved;
  t.mock.method(Item.prototype, 'save', async function (options) { assert.ok(reservationFenceAcquired, 'Reservation token precedes Item insertion'); assert.ok(options.session); saved = this; return this; });
  t.mock.method(Cell, 'updateMany', () => { assert.fail('registration must not write physical stock or cell usage'); });
  t.mock.method(Rack, 'findOneAndUpdate', () => { assert.fail('registration must not reserve or lock a rack'); });
  const result = await service.create(itemBody(), actor());
  assert.equal(result.itemCode, 'CUSTOMER-LOT-01');
  assert.equal(result.unitVolumeM3, 0.015);
  assert.equal(result.totalVolumeM3, 0.03);
  assert.equal(result.totalWeightKg, 40, 'quantity 2 × 20kg = 40kg');
  assert.equal(result.currentCellId, null);
  assert.equal(saved.inventorySchemaVersion, 3);
  assert.equal(result.status, 'REGISTERED');
  assert.equal(result.customerId, undefined, 'customer DTO omits internal owner field');
  assert.equal(saved.facilityId.toString(), facilityId);
  assert.equal(saved.createdBy.toString(), userId.toString());
});

test('V3 CHECKIN_READY owner may prepare a SKU before activation without writing physical stock', async t => {
  const reservation = managedReservation({ status: 'CHECKIN_READY', startDate: new Date(Date.now() + 86400000) });
  mockTransaction(t);
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.bookingFlowVersion, 3); assert.equal(filter.$or[0].status, 'CHECKIN_READY'); assert.ok(filter.$or[0].endDate.$gt instanceof Date);
    return new Query(reservation);
  });
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  mockRegistrationFence(t, reservation);
  let saved;
  t.mock.method(Item.prototype, 'save', async function () { saved = this; return this; });
  const created = await service.create(itemBody(), actor());
  assert.equal(created.status, 'REGISTERED'); assert.equal(created.currentCellId, null);
  assert.equal(saved.inventorySchemaVersion, 3);
  assert.equal(saved.managedReservationId.toString(), reservationId);
});

test('new Item registration cannot attach an arbitrary HTTP URL without upload ownership metadata', async t => {
  mockEligibility(t);
  mockRegistrationFence(t);
  const session = { withTransaction: async work => work(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(ImageUpload, 'findOne', () => new Query(null));
  t.mock.method(Item.prototype, 'save', async () => { assert.fail('unowned URL must fail before saving Item'); });
  await assert.rejects(service.create(itemBody({ images: ['https://res.cloudinary.com/other-customer/item.jpg'] }), actor()), { status: 403 });
});

test('registration with images attaches uploads and inserts Item in the same fenced transaction', async t => {
  mockEligibility(t);
  const session = { withTransaction: async work => work(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  let fence = false, attached = false;
  mockRegistrationFence(t, managedReservation(), () => { fence = true; });
  t.mock.method(ManagedInventoryImageService, 'attachNewImages', async (_urls, _current, _itemId, _customerId, _reservationId, usedSession) => {
    assert.ok(fence, 'Reservation fence precedes image attachment');
    assert.strictEqual(usedSession, session);
    attached = true;
  });
  t.mock.method(Item.prototype, 'save', async function (options) {
    assert.ok(attached, 'image attachment occurs before Item save');
    assert.strictEqual(options.session, session);
    return this;
  });
  const result = await service.create(itemBody({ images: ['https://res.cloudinary.com/wdp-dev/image/upload/v1/item.jpg'] }), actor());
  assert.equal(result.images.length, 1);
});

test('preferred Cell, Zone and Rack reads are sequential on the registration transaction session', async t => {
  const reservation = managedReservation({ allocatedCellIds: [oid(cellId)] });
  mockEligibility(t, reservation);
  const tracker = { active: 0, maxActive: 0, order: [] };
  const session = { withTransaction: async work => work(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  mockRegistrationFence(t, reservation);
  t.mock.method(Cell, 'findOne', filter => {
    assert.equal(String(filter.facilityId), facilityId);
    return observedQuery({ _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId), operationalStatus: 'AVAILABLE' }, 'cell', tracker, session);
  });
  t.mock.method(Zone, 'findOne', filter => {
    assert.equal(String(filter.facilityId), facilityId);
    assert.equal(filter.isActive, true);
    return observedQuery({ _id: oid(zoneId), facilityId: oid(facilityId), isActive: true }, 'zone', tracker, session);
  });
  t.mock.method(Rack, 'findOne', filter => {
    assert.equal(String(filter.facilityId), facilityId);
    assert.equal(String(filter.zoneId), zoneId);
    assert.equal(filter.operationalStatus, 'AVAILABLE');
    return observedQuery({ _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), operationalStatus: 'AVAILABLE' }, 'rack', tracker, session);
  });
  t.mock.method(Allocation, 'findOne', filter => {
    assert.equal(String(filter.reservationId), reservationId);
    assert.equal(String(filter.customerId), userId.toString());
    assert.equal(String(filter.facilityId), facilityId);
    assert.deepEqual(filter.status.$in, ['RESERVED', 'OCCUPIED']);
    return observedQuery({ _id: oid(cellId) }, 'allocation', tracker, session);
  });
  t.mock.method(Item.prototype, 'save', async function (options) { assert.strictEqual(options.session, session); return this; });

  await service.create(itemBody({ preferredCellId: cellId }), actor());
  assert.deepEqual(tracker.order, ['cell', 'zone', 'rack', 'allocation']);
  assert.equal(tracker.maxActive, 1, 'no concurrent operations share the transaction session');
});

test('preferred Cell validation failure aborts registration before Item insertion', async t => {
  mockEligibility(t);
  let aborted = false;
  mockTransaction(t, undefined, () => { aborted = true; });
  mockRegistrationFence(t);
  t.mock.method(Cell, 'findOne', () => new Query(null));
  t.mock.method(Item.prototype, 'save', async () => { assert.fail('invalid preferred Cell must not insert an Item'); });
  await assert.rejects(service.create(itemBody({ preferredCellId: cellId }), actor()), { status: 404 });
  assert.equal(aborted, true, 'failed validation propagates out of the transaction callback');
});

test('same-Facility preferred Cell is rejected without the exact reservation allocation', async t => {
  const reservation = managedReservation({ allocatedCellIds: [oid(cellId)] });
  mockEligibility(t, reservation);
  mockTransaction(t);
  mockRegistrationFence(t, reservation);
  t.mock.method(Cell, 'findOne', () => new Query({ _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId), operationalStatus: 'AVAILABLE' }));
  t.mock.method(Zone, 'findOne', () => new Query({ _id: oid(zoneId), facilityId: oid(facilityId), isActive: true }));
  t.mock.method(Rack, 'findOne', () => new Query({ _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), operationalStatus: 'AVAILABLE' }));
  t.mock.method(Allocation, 'findOne', filter => {
    assert.equal(String(filter.reservationId), reservationId);
    assert.equal(String(filter.customerId), userId.toString());
    assert.equal(String(filter.facilityId), facilityId);
    return new Query(null);
  });
  t.mock.method(Item.prototype, 'save', async () => { assert.fail('Cell without an active scoped allocation must not create an Item'); });
  await assert.rejects(service.create(itemBody({ preferredCellId: cellId }), actor()), { status: 409, message: /no active allocation matching this reservation scope/ });
});

test('preferred Cell metadata validation shares the Item/Reservation transaction session and reads Zone/Rack sequentially', async t => {
  mockEligibility(t);
  const session = mockTransaction(t);
  const tracker = { active: 0, maxActive: 0, order: [] };
  const item = itemDoc({ inventorySchemaVersion: 3 });
  const reservation = managedReservation({ allocatedCellIds: [oid(cellId)] });
  t.mock.method(Item, 'findOne', () => new Query(item));
  mockMetadataFence(t, item, reservation, session);
  t.mock.method(Cell, 'findOne', () => observedQuery({
    _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId), operationalStatus: 'AVAILABLE',
  }, 'cell', tracker, session));
  t.mock.method(Zone, 'findOne', () => observedQuery({ _id: oid(zoneId), facilityId: oid(facilityId), isActive: true }, 'zone', tracker, session));
  t.mock.method(Rack, 'findOne', () => observedQuery({
    _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), operationalStatus: 'AVAILABLE',
  }, 'rack', tracker, session));
  t.mock.method(Allocation, 'findOne', filter => {
    assert.equal(String(filter.reservationId), reservationId);
    return observedQuery({ _id: oid(cellId) }, 'allocation', tracker, session);
  });
  t.mock.method(Item.prototype, 'save', async function () { return this; });

  const result = await service.update(itemId, { preferredCellId: cellId }, actor());
  assert.equal(String(result.preferredCellId), cellId);
  assert.deepEqual(tracker.order, ['cell', 'zone', 'rack', 'allocation']);
  assert.equal(tracker.maxActive, 1, 'transaction session reads are sequential');
});

test('registration without images aborts its transaction when Item insertion fails', async t => {
  mockEligibility(t);
  let aborted = false;
  mockTransaction(t, undefined, () => { aborted = true; });
  mockRegistrationFence(t);
  t.mock.method(Item.prototype, 'save', async function (options) {
    assert.ok(options.session);
    throw new Error('simulated Item insert failure');
  });
  await assert.rejects(service.create(itemBody(), actor()), { status: 500 });
  assert.equal(aborted, true);
});

test('image registration aborts attachment and Item writes together when Item insertion fails', async t => {
  mockEligibility(t);
  let aborted = false, attachmentStaged = false;
  const session = {
    withTransaction: async work => {
      try { return await work(); } catch (error) { aborted = true; throw error; }
    },
    endSession: async () => {},
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  mockRegistrationFence(t);
  t.mock.method(ManagedInventoryImageService, 'attachNewImages', async (_urls, _current, _itemId, _customerId, _reservationId, usedSession) => {
    assert.strictEqual(usedSession, session);
    attachmentStaged = true;
  });
  t.mock.method(Item.prototype, 'save', async function (options) {
    assert.ok(attachmentStaged);
    assert.strictEqual(options.session, session);
    throw new Error('simulated Item insert failure after image attachment');
  });
  await assert.rejects(service.create(itemBody({ images: ['https://res.cloudinary.com/wdp-dev/image/upload/v1/item.jpg'] }), actor()), { status: 500 });
  assert.equal(attachmentStaged, true);
  assert.equal(aborted, true, 'both writes share the transaction that aborts');
});

test('registration fails closed when an active Closure marker prevents Reservation CAS', async t => {
  mockEligibility(t);
  mockTransaction(t);
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.activeClosureRequestId, null);
    assert.ok(filter.$or.some(row => row.inventoryVersion === 0));
    return new Query(null);
  });
  t.mock.method(Item.prototype, 'save', async () => { assert.fail('Item must not be inserted after failed Reservation CAS'); });
  await assert.rejects(service.create(itemBody(), actor()), { status: 409 });
});

test('registration fails closed when Reservation inventoryVersion changed after eligibility read', async t => {
  const reservation = managedReservation({ inventoryVersion: 9 });
  mockTransaction(t);
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.inventoryVersion, 9, 'CAS is bound to the eligibility snapshot');
    assert.equal(filter.activeClosureRequestId, null);
    return new Query(null);
  });
  t.mock.method(Item.prototype, 'save', async () => { assert.fail('stale Reservation must not insert an Item'); });
  await assert.rejects(service.create(itemBody(), actor()), { status: 409 });
});

test('unknown commit result is propagated as an error, never returned as a successful registration', async t => {
  mockEligibility(t);
  const unknownCommit = Object.assign(new Error('unknown commit result'), { hasErrorLabel: label => label === 'UnknownTransactionCommitResult' });
  const session = { withTransaction: async work => { await work(); throw unknownCommit; }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  mockRegistrationFence(t);
  let stagedItem = false;
  t.mock.method(Item.prototype, 'save', async function (options) { assert.strictEqual(options.session, session); stagedItem = true; return this; });
  await assert.rejects(service.create(itemBody(), actor()), { status: 500 });
  assert.equal(stagedItem, true, 'write callback ran, but uncertain commit is not reported as success');
});

test('RESERVED Managed V3 cannot register a SKU before verified payment and contract', async t => {
  mockTransaction(t);
  t.mock.method(Reservation, 'findOne', filter => { assert.deepEqual(filter.$or.map(row => row.status), ['CHECKIN_READY', 'ACTIVE']); return new Query(null); });
  await assert.rejects(service.create(itemBody(), actor()), { status: 404 });
});

test('expired Managed V3 reservation cannot register a new SKU', async t => {
  mockTransaction(t);
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.$or[1].status, 'ACTIVE');
    assert.ok(filter.$or[1].endDate.$gt instanceof Date);
    return new Query(null);
  });
  t.mock.method(Item.prototype, 'save', async () => { assert.fail('expired Reservation cannot insert an Item'); });
  await assert.rejects(service.create(itemBody(), actor()), { status: 404 });
});

test('version 2 DEPOSIT_PAID owner may request inbound before activation without confirming physical occupancy', async t => {
  const item = itemDoc();
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', filter => {
    assert.equal(filter.status, 'REGISTERED');
    return new Query(itemDoc({ status: 'PENDING_INBOUND' }));
  });
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.activeClosureRequestId, null);
    const eligibility = filter.$and[0].$or;
    assert.equal(eligibility[0].status, 'ACTIVE'); assert.ok(eligibility[0].startDate.$lte instanceof Date); assert.ok(eligibility[0].endDate.$gt instanceof Date);
    assert.equal(eligibility[1].status, 'DEPOSIT_PAID'); assert.equal(eligibility[1].bookingFlowVersion, 2); assert.ok(eligibility[1].endDate.$gt instanceof Date);
    return new Query(managedReservation({ status: 'DEPOSIT_PAID', bookingFlowVersion: 2 }));
  });
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.$or[1].status, 'DEPOSIT_PAID');
    return new Query(managedReservation({ status: 'DEPOSIT_PAID', bookingFlowVersion: 2 }));
  });
  t.mock.method(Reservation, 'exists', () => new Query(null));
  t.mock.method(Facility, 'findOne', () => new Query({ status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async fn => fn(), endSession: async () => {} }));
  const result = await service.requestInbound(itemId, actor());
  assert.equal(result.status, 'PENDING_INBOUND');
  assert.equal(result.currentCellId, null);
});

test('legacy first-inbound path fails closed for V3 before Reservation CAS', async t => {
  mockTransaction(t);
  const item = itemDoc({ inventorySchemaVersion: 3, status: 'REGISTERED', currentCellId: null });
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', () => new Query(itemDoc({ status: 'PENDING_INBOUND', currentCellId: null })));
  t.mock.method(Reservation, 'findOne', () => new Query(managedReservation({
    status: 'ACTIVE', activeClosureRequestId: oid('507f1f77bcf86cd799439099'),
  })));
  let reservationCasCalled = false;
  t.mock.method(Reservation, 'findOneAndUpdate', () => { reservationCasCalled = true; return new Query(null); });
  await assert.rejects(service.requestInbound(itemId, actor()), { status: 409, message: /V3 physical inbound is unavailable/ });
  assert.equal(reservationCasCalled, false);
});

test('request cannot spoof customer/facility, derived totals, status, or Mongo operators', () => {
  for (const body of [
    { ...itemBody(), customerId: '507f1f77bcf86cd799439099' },
    { ...itemBody(), facilityId: '507f1f77bcf86cd799439099' },
    { ...itemBody(), totalWeightKg: 0 },
    { ...itemBody(), unitVolumeM3: 100 },
    { ...itemBody(), status: 'IN_STORAGE' },
    { ...itemBody(), $set: { currentCellId: cellId } },
  ]) assert.throws(() => parseCreate(body), { status: 400 });
  for (const body of [
    { quantity: 0 }, { quantity: 1.5 }, { unitWeightKg: Infinity }, { unitWeightKg: 0 },
    { unitDimensionsM: { widthM: 1, depthM: -1, heightM: 1 } },
    { unitDimensionsM: { widthM: 1, depthM: 1, heightM: NaN } },
  ]) assert.throws(() => parseCreate(itemBody(body)), { status: 400 });
  assert.throws(() => parseUpdate({ status: 'IN_STORAGE' }), { status: 400 });
});

test('duplicate facility itemCode becomes a safe conflict', async t => {
  mockEligibility(t);
  mockTransaction(t);
  mockRegistrationFence(t);
  t.mock.method(Item.prototype, 'save', async () => { throw Object.assign(new Error('duplicate details'), { code: 11000 }); });
  await assert.rejects(service.create(itemBody(), actor()), { status: 409 });
});

test('Managed rental guard accepts only owned active MI rental with valid m3 allocation', async t => {
  mockEligibility(t);
  const eligible = await requireActiveManagedInventoryReservation(reservationId, userId);
  assert.equal(eligible.allocatedCapacity, 1.5);
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    return new Query(managedReservation({ allocatedCapacity: 0 }));
  });
  await assert.rejects(requireActiveManagedInventoryReservation(reservationId, userId), { status: 409 });
});

test('item metadata and placement preview remain ACTIVE-only after a deposit', async t => {
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.status, 'ACTIVE');
    return new Query(null);
  });
  await assert.rejects(requireActiveManagedInventoryReservation(reservationId, userId), { status: 404 });
});

test('registration rejects Self Storage, inactive MI rentals, and absent rentals', async t => {
  mockTransaction(t);
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    return new Query(null); // Self Storage is excluded by the reusable guard query.
  });
  await assert.rejects(service.create(itemBody(), actor()), { status: 404 });

  t.mock.method(Reservation, 'findOne', () => new Query(managedReservation()));
  t.mock.method(Facility, 'findOne', () => new Query(null));
  await assert.rejects(service.create(itemBody(), actor()), { status: 409 });
});

test('customer cannot read or update another customer item', async t => {
  mockTransaction(t);
  const other = oid('507f1f77bcf86cd799439099');
  t.mock.method(Item, 'findOne', () => new Query(itemDoc({ customerId: other })));
  await assert.rejects(service.get(itemId, actor()), { status: 404 });
  await assert.rejects(service.update(itemId, { name: 'Spoof' }, actor()), { status: 404 });
});

test('customer edits only REGISTERED metadata and totals are recalculated', async t => {
  mockEligibility(t);
  const session = mockTransaction(t);
  const item = itemDoc({ inventorySchemaVersion: 3 });
  t.mock.method(Item, 'findOne', () => new Query(item));
  mockMetadataFence(t, item, managedReservation(), session);
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  const updated = await service.update(itemId, { quantity: 3, unitWeightKg: 15 }, actor());
  assert.equal(updated.totalWeightKg, 45);
  assert.equal(updated.totalVolumeM3, 0.045);
  assert.equal(updated.currentCellId, null);
  assert.equal(updated.status, 'REGISTERED');
  await assert.rejects(service.update(itemId, { facilityId }, actor()), { status: 400 });
});

test('V3 CHECKIN_READY owner may edit an unplaced SKU without recording stock', async t => {
  const session = mockTransaction(t);
  const ready = managedReservation({ status: 'CHECKIN_READY', startDate: new Date(Date.now() + 3600000), allocatedCellIds: [oid(cellId)] });
  t.mock.method(Reservation, 'findOne', filter => filter.status === 'ACTIVE' && !filter.$or ? new Query(null) : new Query(ready));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  const item = itemDoc({ inventorySchemaVersion: 3 });
  t.mock.method(Item, 'findOne', () => new Query(item));
  mockMetadataFence(t, item, ready, session);
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  const updated = await service.update(itemId, { name: 'Prepared SKU' }, actor());
  assert.equal(updated.name, 'Prepared SKU');
  assert.equal(updated.status, 'REGISTERED');
  assert.equal(updated.currentCellId, null);
});

test('editing keeps a legacy HTTP image already owned by that Item', async t => {
  mockEligibility(t);
  const session = mockTransaction(t);
  const legacy = 'https://legacy.example.test/old-item-photo.jpg';
  const item = itemDoc({ inventorySchemaVersion: 3, images: [legacy] });
  t.mock.method(Item, 'findOne', () => new Query(item));
  mockMetadataFence(t, item, managedReservation(), session);
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  const updated = await service.update(itemId, { name: 'Archive cartons updated', images: [legacy] }, actor());
  assert.deepEqual(updated.images, [legacy]);
});

test('active closure marker blocks metadata and image attachment after Item CAS', async t => {
  const session = mockTransaction(t);
  const item = itemDoc({ inventorySchemaVersion: 3 });
  const reservation = managedReservation({ activeClosureRequestId: oid('507f1f77bcf86cd799439098'), inventoryVersion: 4 });
  mockEligibility(t, reservation);
  t.mock.method(Item, 'findOne', () => new Query(item));
  mockMetadataItemToken(t, item, session);
  let imageAttachCalls = 0;
  t.mock.method(ManagedInventoryImageService, 'attachNewImages', async () => { imageAttachCalls += 1; });
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.activeClosureRequestId, null);
    return new Query(null);
  });
  await assert.rejects(service.update(itemId, { name: 'Changed' }, actor()), { status: 409, message: /closure is pending/ });
  await assert.rejects(service.update(itemId, { images: ['https://res.cloudinary.com/wdp-dev/image/upload/v1/new.jpg'] }, actor()), { status: 409, message: /closure is pending/ });
  assert.equal(imageAttachCalls, 0);
});

test('owner can read historical item after its Managed reservation closes', async t => {
  const closedReservation = managedReservation({ status: 'CLOSED' });
  t.mock.method(Item, 'findOne', () => new Query(itemDoc()));
  t.mock.method(Reservation, 'findOne', () => new Query(closedReservation));
  const result = await service.get(itemId, actor());
  assert.equal(result.itemCode, 'CUSTOMER-LOT-01');
  assert.equal(result.customerId, undefined);
});

test('GET /me lists owner history regardless of current reservation status', async t => {
  let itemFilter;
  t.mock.method(Item, 'find', filter => { itemFilter = filter; return new Query([]); });
  t.mock.method(Item, 'countDocuments', () => new Query(0));
  const result = await service.listMine({}, actor());
  assert.deepEqual(itemFilter.customerId, userId);
  assert.equal(itemFilter.managedReservationId, undefined);
  assert.deepEqual(itemFilter.deletedAt, { $exists: false });
  assert.equal(result.pagination.total, 0);
});

test('closed Managed reservation cannot authorize new registration or metadata edits', async t => {
  const session = mockTransaction(t);
  t.mock.method(Reservation, 'findOne', filter => {
    if (filter.$or) { assert.equal(filter.bookingFlowVersion, 3); assert.equal(filter.$or[0].status, 'CHECKIN_READY'); assert.equal(filter.$or[1].status, 'ACTIVE'); assert.ok(filter.$or[1].endDate.$gt instanceof Date); }
    else assert.equal(filter.status, 'ACTIVE');
    return new Query(null);
  });
  await assert.rejects(service.create(itemBody(), actor()), { status: 404 });

  const editItem = itemDoc({ inventorySchemaVersion: 3 });
  t.mock.method(Item, 'findOne', () => new Query(editItem));
  mockMetadataItemToken(t, editItem, session);
  await assert.rejects(service.update(itemId, { name: 'Changed name' }, actor()), { status: 404 });
});

test('manager and staff list scope is restricted to the assigned Facility', async t => {
  for (const role of ['FACILITY_MANAGER', 'FACILITY_STAFF']) {
    await assert.rejects(service.list({ facilityId: '507f1f77bcf86cd799439099' }, actor(role)), { status: 403 });
  }
  let filter;
  t.mock.method(Item, 'find', value => { filter = value; return new Query([]); });
  t.mock.method(Item, 'countDocuments', () => new Query(0));
  await service.list({}, actor('FACILITY_STAFF'));
  assert.equal(String(filter.facilityId), facilityId);
  assert.deepEqual(filter.deletedAt, { $exists: false });
});

function mockPreview(t, options = {}) {
  mockEligibility(t);
  t.mock.method(Item, 'findOne', () => new Query(itemDoc()));
  const selectedCell = {
    _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
    operationalStatus: options.cellStatus ?? 'AVAILABLE', maxWeightKg: options.maxWeightKg ?? 100,
    usedWeightKg: options.usedWeightKg ?? 0, usedVolumeM3: options.usedVolumeM3 ?? 0,
    dimensions: { widthM: 0.5, depthM: 0.6, ...(options.usableHeightM === undefined ? {} : { usableHeightM: options.usableHeightM }) },
  };
  t.mock.method(Cell, 'findOne', filter => {
    assert.equal(String(filter.facilityId), facilityId);
    return new Query(options.crossFacility ? null : selectedCell);
  });
  t.mock.method(Zone, 'findOne', () => new Query({ _id: oid(zoneId), isActive: true }));
  t.mock.method(Rack, 'findOne', () => new Query({
    _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), operationalStatus: 'AVAILABLE',
    maxWeightKgPerLevel: 500, levelCount: 4,
  }));
  t.mock.method(Cell, 'aggregate', () => new Query([{ usedWeightKg: 0 }]));
}

test('placement preview for a 100kg Cell is advisory and writes no reservation, stock, or usage', async t => {
  mockPreview(t, { maxWeightKg: 100, usableHeightM: 0.5 });
  t.mock.method(Cell, 'updateMany', () => { assert.fail('preview must not write stock or cell usage'); });
  t.mock.method(Reservation, 'create', () => { assert.fail('preview must not create a reservation'); });
  const result = await service.placementPreview(itemId, { cellId }, actor());
  assert.equal(result.advisory, true);
  assert.equal(result.advisoryStatus, 'NEEDS_MEASUREMENT');
  assert.equal(result.estimatedFit, null, 'aggregate volume is not proof that multiple units physically pack');
  assert.equal(result.quantityPackingLayoutChecked, false);
  assert.ok(result.uncertainty.includes('MULTI_UNIT_PACKING_LAYOUT_NOT_CHECKED'));
  assert.equal(result.checks.totalLotWeightWithinCellCapacity, true);
  assert.equal(result.cellCapacity.maxWeightKg, 100);
  assert.equal(result.actualUsageKnown, true);
  assert.equal(result.allocationConfirmed, false);
  assert.equal(result.reservationCreated, false);
  assert.equal(result.stockWritten, false);
  assert.equal(result.staffConfirmationRequired, true);
});

test('placement preview rejects blocked or maintenance Cells and cross-Facility Cells', async t => {
  mockPreview(t, { cellStatus: 'BLOCKED' });
  await assert.rejects(service.placementPreview(itemId, { cellId }, actor()), { status: 409 });
  t.mock.method(Cell, 'findOne', filter => new Query({
    _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
    operationalStatus: 'MAINTENANCE', maxWeightKg: 100, dimensions: { widthM: 0.5, depthM: 0.6, usableHeightM: 0.5 },
  }));
  await assert.rejects(service.placementPreview(itemId, { cellId }, actor()), { status: 409 });
  t.mock.method(Cell, 'findOne', () => new Query(null));
  await assert.rejects(service.placementPreview(itemId, { cellId }, actor()), { status: 404 });
});

test('placement preview reports missing usable height as uncertainty, not measured fit', async t => {
  mockPreview(t, { maxWeightKg: 100 });
  const result = await service.placementPreview(itemId, { cellId }, actor());
  assert.equal(result.estimatedFit, null);
  assert.equal(result.advisoryStatus, 'NEEDS_MEASUREMENT');
  assert.ok(result.uncertainty.includes('USABLE_CELL_HEIGHT_NOT_MEASURED'));
  assert.equal(result.actualUsageKnown, true);
  assert.ok(!result.uncertainty.includes('ACTUAL_CELL_USAGE_NOT_AVAILABLE_IN_MI_01'));
  assert.equal(result.cellCapacity.maxVolumeM3, undefined);
});

test('single-unit preview does not flag multi-unit packing uncertainty', async t => {
  mockPreview(t, { maxWeightKg: 100, usableHeightM: 0.5 });
  t.mock.method(Item, 'findOne', () => new Query(itemDoc({ quantity: 1, totalWeightKg: 20, totalVolumeM3: 0.015 })));
  const result = await service.placementPreview(itemId, { cellId }, actor());
  assert.equal(result.quantityPackingLayoutChecked, true);
  assert.equal(result.checks.multiUnitPackingLayoutValidated, true);
  assert.ok(!result.uncertainty.includes('MULTI_UNIT_PACKING_LAYOUT_NOT_CHECKED'));
});

test('all inventory-item routes require authentication and role gates match the API contract', () => {
  const router = require('../dist/routes/inventory-item.routes').default;
  const routes = router.stack.filter(layer => layer.route).map(layer => ({
    path: layer.route.path,
    method: Object.keys(layer.route.methods).find(method => layer.route.methods[method]).toUpperCase(),
    handlers: layer.route.stack.map(entry => entry.handle.name),
  }));
  assert.equal(router.stack[0].handle.name, 'requireAuth', 'router-level authentication runs before every endpoint');
  assert.ok(routes.every(route => route.handlers.length >= 2), 'each route has a role gate before its controller; upload routes may add rate-limit and multipart middleware');
  for (const expected of [
    'POST /image-uploads', 'DELETE /image-uploads/:uploadId',
    'POST /', 'GET /me', 'GET /', 'GET /:id', 'PATCH /:id', 'GET /:id/placement-preview',
    'POST /:itemId/inbound-requests', 'GET /:itemId/inbound-requests', 'GET /:itemId/stock-balance',
    'POST /:itemId/outbound-requests', 'GET /:itemId/outbound-requests',
    'GET /:id/relocate-canonical/context',
    'POST /:id/inbound-request', 'POST /:id/outbound-request', 'POST /:id/confirm-inbound',
    'POST /:id/confirm-outbound', 'POST /:id/reject-inbound', 'POST /:id/reject-outbound', 'GET /:id/movements',
    'POST /:id/relocate', 'POST /:id/relocate-canonical',
    'GET /:itemId/receiving-inspection/context', 'POST /:itemId/receiving-inspection/image-uploads',
    'POST /:itemId/receiving-inspection',
    'GET /managed-v3/facility/outbound-requests', 'GET /managed-v3/facility/outbound-requests/:requestId',
    'GET /:id/v3/outbound/context', 'GET /:id/v3/outbound/operations',
    'POST /:id/v3/outbound-requests', 'GET /:id/v3/outbound-requests', 'GET /:id/v3/outbound-requests/:requestId',
    'POST /:id/v3/outbound-requests/:requestId/cancel', 'POST /:id/v3/outbound-requests/:requestId/preview',
    'POST /:id/v3/outbound-requests/:requestId/confirm',
  ]) assert.ok(routes.some(route => `${route.method} ${route.path}` === expected), expected);
  assert.equal(routes.length, 44);
});
