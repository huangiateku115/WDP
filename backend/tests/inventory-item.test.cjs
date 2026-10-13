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
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const { InventoryItemService: service } = require('../dist/services/inventory-items/inventory-item.service');
const { parseCreate, parseUpdate, InventoryItemError } = require('../dist/services/inventory-items/inventory-item.validation');
const { requireActiveManagedInventoryReservation } = require('../dist/services/reservations/managed-inventory-reservation.guard');

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
  serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', allocatedCapacity: 1.5, ...overrides,
});
const itemBody = (overrides = {}) => ({
  managedReservationId: reservationId,
  itemCode: 'customer-lot-01', name: 'Archive cartons', category: 'DOCUMENTS',
  description: 'Identical cartons', quantity: 2, quantityUnit: 'carton', unitWeightKg: 20,
  unitDimensionsM: { widthM: 0.25, depthM: 0.3, heightM: 0.2 },
  images: ['https://example.test/carton.jpg'], ...overrides,
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
    assert.equal(filter.status, 'ACTIVE');
    return new Query(reservation);
  });
  t.mock.method(Facility, 'findOne', () => new Query(facility ? { _id: oid(facilityId), ...facility } : null));
}

test('model reserves stable itemCode per facility and supports derived registered-item fields', async () => {
  const indexes = Item.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.facilityId === 1 && keys.itemCode === 1 && options.unique));
  const item = itemDoc();
  assert.equal(item.status, 'REGISTERED');
  assert.equal(item.currentCellId, null);
  await item.validate();
});

test('registration derives lot totals, keeps currentCellId null, and writes no physical placement', async t => {
  mockEligibility(t);
  let saved;
  t.mock.method(Item.prototype, 'save', async function () { saved = this; return this; });
  t.mock.method(Cell, 'updateMany', () => { assert.fail('registration must not write physical stock or cell usage'); });
  t.mock.method(Rack, 'findOneAndUpdate', () => { assert.fail('registration must not reserve or lock a rack'); });
  const result = await service.create(itemBody(), actor());
  assert.equal(result.itemCode, 'CUSTOMER-LOT-01');
  assert.equal(result.unitVolumeM3, 0.015);
  assert.equal(result.totalVolumeM3, 0.03);
  assert.equal(result.totalWeightKg, 40, 'quantity 2 × 20kg = 40kg');
  assert.equal(result.currentCellId, null);
  assert.equal(result.status, 'REGISTERED');
  assert.equal(result.customerId, undefined, 'customer DTO omits internal owner field');
  assert.equal(saved.facilityId.toString(), facilityId);
  assert.equal(saved.createdBy.toString(), userId.toString());
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

test('registration rejects Self Storage, inactive MI rentals, and absent rentals', async t => {
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
  const other = oid('507f1f77bcf86cd799439099');
  t.mock.method(Item, 'findOne', () => new Query(itemDoc({ customerId: other })));
  await assert.rejects(service.get(itemId, actor()), { status: 404 });
  await assert.rejects(service.update(itemId, { name: 'Spoof' }, actor()), { status: 404 });
});

test('customer edits only REGISTERED metadata and totals are recalculated', async t => {
  mockEligibility(t);
  const item = itemDoc();
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  const updated = await service.update(itemId, { quantity: 3, unitWeightKg: 15 }, actor());
  assert.equal(updated.totalWeightKg, 45);
  assert.equal(updated.totalVolumeM3, 0.045);
  assert.equal(updated.currentCellId, null);
  assert.equal(updated.status, 'REGISTERED');
  await assert.rejects(service.update(itemId, { facilityId }, actor()), { status: 400 });
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
  t.mock.method(Reservation, 'findOne', filter => {
    assert.equal(filter.status, 'ACTIVE');
    return new Query(null);
  });
  await assert.rejects(service.create(itemBody(), actor()), { status: 404 });

  t.mock.method(Item, 'findOne', () => new Query(itemDoc()));
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
  assert.ok(routes.every(route => route.handlers.length === 2), 'each route has a role gate before its controller');
  for (const expected of [
    'POST /', 'GET /me', 'GET /', 'GET /:id', 'PATCH /:id', 'GET /:id/placement-preview',
    'POST /:id/inbound-request', 'POST /:id/confirm-inbound', 'POST /:id/reject-inbound', 'GET /:id/movements',
  ]) assert.ok(routes.some(route => `${route.method} ${route.path}` === expected), expected);
  assert.equal(routes.length, 10);
});
