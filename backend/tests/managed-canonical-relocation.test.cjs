const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test', MI06_CANONICAL_RELOCATIONS_ENABLED: 'true', MI06_STOCK_LEDGER_WRITES_ENABLED: 'true',
  MONGO_URL: 'mongodb://127.0.0.1:27018/unused_test_only', KEYCLOAK_BASE_URL: 'http://localhost:8081',
  KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm', KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const OutboundRequest = require('../dist/models/inventory-items/managed-outbound-request.model').default;
const InboundRequest = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Capacity = require('../dist/models/reservations/managed-facility-capacity.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Audit = require('../dist/models/reservations/managed-reservation-audit.model').default;
const StockError = require('../dist/types/managed-stock.type');
const { ManagedCanonicalRelocationService: service } = require('../dist/services/inventory-items/managed-canonical-relocation.service');
const { parseCanonicalRelocation } = require('../dist/services/inventory-items/inventory-item.validation');
const { resolveMi06CanonicalRelocationGate } = require('../dist/config/mi06-canonical-relocation-gate');

const id = {
  item: '507f1f77bcf86cd799439001', customer: '507f1f77bcf86cd799439002', reservation: '507f1f77bcf86cd799439003',
  facility: '507f1f77bcf86cd799439004', source: '507f1f77bcf86cd799439005', destination: '507f1f77bcf86cd799439006',
  receipt: '507f1f77bcf86cd799439007', remove: '507f1f77bcf86cd799439008', staff: '507f1f77bcf86cd799439009',
  zoneSource: '507f1f77bcf86cd799439010', zoneDestination: '507f1f77bcf86cd799439011',
  rackSource: '507f1f77bcf86cd799439012', rackDestination: '507f1f77bcf86cd799439013',
};
const oid = value => new mongoose.Types.ObjectId(value);
const close = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

class Query {
  constructor(value) { this.value = value; }
  session() { return this; } select() { return this; } lean() { return this; } sort() { return this; }
  skip() { return this; } limit() { return this; }
  exec() { return Promise.resolve(typeof this.value === 'function' ? this.value() : this.value); }
}

function makeFixture(t, options = {}) {
  const now = new Date();
  const receiptId = oid(id.receipt), removeId = oid(id.remove);
  const item = new Item({ _id: oid(id.item), facilityId: oid(id.facility), customerId: oid(id.customer),
    managedReservationId: oid(id.reservation), itemCode: 'LOT-1', name: 'Boxes', category: 'DOCUMENTS', quantity: 10,
    quantityUnit: 'box', unitWeightKg: 2, unitDimensionsM: { widthM: .1, depthM: .2, heightM: .3 },
    unitVolumeM3: .006, totalWeightKg: 20, totalVolumeM3: .06, currentCellId: oid(id.source),
    currentPlacementMovementId: receiptId, inboundMovementId: receiptId, status: options.itemStatus ?? 'IN_STORAGE',
    images: [], createdBy: oid(id.customer), __v: 3 });
  const receipt = { _id: receiptId, itemId: item._id, managedReservationId: item.managedReservationId,
    facilityId: item.facilityId, customerId: item.customerId, type: 'INBOUND', destinationCellId: oid(id.source),
    quantity: 10, quantityUnit: 'box', actualUnitWeightKg: 2, actualTotalWeightKg: 20,
    actualUnitDimensionsM: { widthM: .1, depthM: .2, heightM: .3 }, actualTotalVolumeM3: .06,
    performedBy: oid(id.staff), performedAt: now, inspectionNote: 'Original receipt', idempotencyKey: 'receipt-legacy-001' };
  const remove = { _id: removeId, itemId: item._id, managedReservationId: item.managedReservationId,
    facilityId: item.facilityId, customerId: item.customerId, type: 'OUTBOUND', sourceCellId: oid(id.source),
    destinationCellId: null, quantity: 3, quantityUnit: 'box', actualUnitWeightKg: 2, actualTotalWeightKg: 6,
    actualUnitDimensionsM: { widthM: .1, depthM: .2, heightM: .3 }, actualTotalVolumeM3: .018,
    performedBy: oid(id.staff), performedAt: new Date(now.getTime() + 1000), handoverNote: 'Partial withdrawal',
    idempotencyKey: 'partial-remove-001', schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', batchLines: [{
      batchId: `legacy:${receiptId}`, receiptMovementId: receiptId, action: 'REMOVE', quantity: 3, quantityUnit: 'box',
      actualUnitWeightKg: 2, actualUnitDimensionsM: { widthM: .1, depthM: .2, heightM: .3 },
      actualTotalWeightKg: 6, actualTotalVolumeM3: .018,
    }] };
  const secondReceiptId = oid('507f1f77bcf86cd799439014');
  const secondReceipt = options.multiBatch ? { _id: secondReceiptId, itemId: item._id,
    managedReservationId: item.managedReservationId, facilityId: item.facilityId, customerId: item.customerId,
    type: 'INBOUND', sourceCellId: null, destinationCellId: oid(id.source), quantity: 5, quantityUnit: 'box',
    actualUnitWeightKg: 1, actualTotalWeightKg: 5, actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 },
    actualTotalVolumeM3: .005, performedBy: oid(id.staff), performedAt: new Date(now.getTime() + 2000),
    inspectionNote: 'Second receipt', idempotencyKey: 'receipt-canonical-002', schemaVersion: 2,
    arithmeticPolicy: 'CANONICAL_V1', batchLines: [{ batchId: 'receipt-batch-002', receiptMovementId: secondReceiptId,
      action: 'ADD', quantity: 5, quantityUnit: 'box', actualUnitWeightKg: 1,
      actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, actualTotalWeightKg: 5, actualTotalVolumeM3: .005 }] } : null;
  if (secondReceipt) item.currentPlacementMovementId = secondReceiptId;
  const stock = new Balance({ itemId: item._id, facilityId: item.facilityId, customerId: item.customerId,
    managedReservationId: item.managedReservationId, currentCellId: oid(id.source), batches: [{
      batchId: `legacy:${receiptId}`, receiptMovementId: receiptId, quantity: 7, heldQuantity: 0, quantityUnit: 'box',
      actualUnitWeightKg: 2, actualUnitDimensionsM: { widthM: .1, depthM: .2, heightM: .3 },
      actualTotalWeightKg: 14, actualTotalVolumeM3: .042, receivedAt: now, arithmeticPolicy: 'COMPATIBILITY',
    }, ...(secondReceipt ? [{ batchId: 'receipt-batch-002', receiptMovementId: secondReceiptId, quantity: 5, heldQuantity: 0,
      quantityUnit: 'box', actualUnitWeightKg: 1, actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 },
      actualTotalWeightKg: 5, actualTotalVolumeM3: .005, receivedAt: secondReceipt.performedAt, arithmeticPolicy: 'CANONICAL_V1' }] : [])],
    onHandQuantity: secondReceipt ? 12 : 7, heldQuantity: 0,
    actualTotalWeightKg: secondReceipt ? 19 : 14, actualTotalVolumeM3: secondReceipt ? .047 : .042,
    schemaVersion: 1, source: 'LEDGER_V2', reconciledAt: now,
    reconciledThroughMovementId: secondReceipt ? secondReceiptId : removeId, version: 1 });
  const source = { _id: oid(id.source), facilityId: item.facilityId, zoneId: oid(id.zoneSource), rackId: oid(id.rackSource),
    levelNumber: 1, code: 'A-1', dimensions: { widthM: .5, depthM: .5, usableHeightM: .6 }, maxWeightKg: 100,
    usedWeightKg: (options.multiBatch ? 19 : 14) + (options.sourceOtherWeight ?? 0),
    usedVolumeM3: (options.multiBatch ? .047 : .042) + (options.sourceOtherVolume ?? 0),
    allocationVersion: 0, operationalStatus: 'AVAILABLE' };
  const destination = { _id: oid(id.destination), facilityId: item.facilityId, zoneId: oid(id.zoneDestination), rackId: oid(id.rackDestination),
    levelNumber: 1, code: 'B-1', dimensions: options.destinationDimensions ?? { widthM: .5, depthM: .5, usableHeightM: .6 },
    maxWeightKg: options.destinationMaxWeightKg ?? 100, usedWeightKg: options.destinationUsedWeightKg ?? 0,
    usedVolumeM3: options.destinationUsedVolumeM3 ?? 0, allocationVersion: 0,
    operationalStatus: options.destinationStatus ?? 'AVAILABLE' };
  const otherSource = options.sourceOtherWeight ? makeOtherItem('507f1f77bcf86cd799439101', id.source,
    '507f1f77bcf86cd799439102', item, options.sourceOtherWeight, options.sourceOtherVolume ?? .006, now) : null;
  const otherDestination = options.destinationUsedWeightKg ? makeOtherItem('507f1f77bcf86cd799439103', id.destination,
    '507f1f77bcf86cd799439104', item, options.destinationUsedWeightKg, options.destinationUsedVolumeM3 ?? .006, now) : null;
  const items = [item, ...[otherSource, otherDestination].filter(Boolean)];
  const itemMovements = new Map([[String(item._id), [receipt, remove, ...(secondReceipt ? [secondReceipt] : [])]]]);
  for (const other of [otherSource, otherDestination].filter(Boolean)) itemMovements.set(String(other._id), [other.receipt]);
  const cells = new Map([[String(source._id), source], [String(destination._id), destination]]);
  const zones = new Map([
    [id.zoneSource, { _id: oid(id.zoneSource), facilityId: item.facilityId, isActive: true, structureVersion: 0 }],
    [id.zoneDestination, { _id: oid(id.zoneDestination), facilityId: item.facilityId, isActive: true, structureVersion: 0 }],
  ]);
  const racks = new Map([
    [id.rackSource, { _id: oid(id.rackSource), facilityId: item.facilityId, zoneId: oid(id.zoneSource), operationalStatus: 'AVAILABLE',
      levelCount: 2, maxWeightKgPerLevel: options.rackLevelLimit ?? 500, layoutVersion: 0 }],
    [id.rackDestination, { _id: oid(id.rackDestination), facilityId: item.facilityId, zoneId: oid(id.zoneDestination),
      operationalStatus: 'AVAILABLE', levelCount: 2, maxWeightKgPerLevel: options.rackLevelLimit ?? 500, layoutVersion: 0 }],
  ]);
  const reservation = { _id: item.managedReservationId, facilityId: item.facilityId, customerId: item.customerId,
    serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 2, status: 'ACTIVE', startDate: new Date(now.getTime() - 86400000),
    endDate: new Date(now.getTime() + 86400000), allocatedCapacity: 2, usedCapacityM3: (options.multiBatch ? .047 : .042) +
      (options.sourceOtherVolume ?? 0) + (options.destinationUsedVolumeM3 ?? 0), allocatedCellIds: [source._id, destination._id],
    inventoryVersion: 0, async save() { return this; } };
  const allocations = new Map([
    [String(source._id), { _id: oid('507f1f77bcf86cd799439201'), facilityId: item.facilityId, cellId: source._id,
      reservationId: item.managedReservationId, customerId: item.customerId, status: 'OCCUPIED',
      startDate: new Date(now.getTime() - 86400000), endDate: new Date(now.getTime() + 86400000), async save() { return this; } }],
    [String(destination._id), { _id: oid('507f1f77bcf86cd799439202'), facilityId: item.facilityId, cellId: destination._id,
      reservationId: item.managedReservationId, customerId: item.customerId,
      status: otherDestination ? 'OCCUPIED' : 'RESERVED', startDate: new Date(now.getTime() - 86400000),
      endDate: new Date(now.getTime() + 86400000), async save() { return this; } }],
  ]);
  const state = { item, stock, source, destination, items, itemMovements, movements: [receipt, remove, ...(secondReceipt ? [secondReceipt] : [])], cells, zones,
    racks, reservation, allocations, audits: [], failMovement: options.failMovement ?? false,
    failAudit: options.failAudit ?? false, operationOrder: [] };
  const session = { withTransaction: async fn => {
    const itemBefore = { currentCellId: item.currentCellId, currentPlacementMovementId: item.currentPlacementMovementId, __v: item.__v };
    const stockBefore = stock.toObject();
    const cellBefore = [...cells].map(([key, row]) => [key, { usedWeightKg: row.usedWeightKg, usedVolumeM3: row.usedVolumeM3, allocationVersion: row.allocationVersion }]);
    const allocationBefore = [...allocations].map(([key, row]) => [key, row.status]);
    const reservationBefore = { inventoryVersion: reservation.inventoryVersion, usedCapacityM3: reservation.usedCapacityM3 };
    const movementLength = state.movements.length, auditLength = state.audits.length;
    const itemMovementLengths = new Map([...state.itemMovements].map(([key, rows]) => [key, rows.length]));
    try { return await fn(); }
    catch (error) {
      Object.assign(item, itemBefore); stock.set(stockBefore);
      for (const [key, before] of cellBefore) Object.assign(cells.get(key), before);
      for (const [key, before] of allocationBefore) allocations.get(key).status = before;
      Object.assign(reservation, reservationBefore); state.movements.length = movementLength; state.audits.length = auditLength;
      for (const [key, length] of itemMovementLengths) state.itemMovements.get(key).length = length;
      throw error;
    }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Item, 'findOne', filter => new Query(state.items.find(row => String(row._id) === String(filter._id)) ?? null));
  t.mock.method(Item, 'findOneAndUpdate', (filter, update) => {
    state.operationOrder.push('Item');
    const matched = String(filter._id) === String(item._id) && item.status === filter.status &&
      String(item.currentCellId) === String(filter.currentCellId) &&
      (filter.__v?.$exists === false ? item.__v == null : item.__v === filter.__v);
    if (!matched || options.itemTokenConflict) return new Query(null);
    if (update.$inc?.__v) item.__v = (item.__v ?? 0) + update.$inc.__v;
    return new Query(item);
  });
  t.mock.method(Item, 'find', filter => new Query(state.items.filter(row => {
    const inRackCells = filter.$or?.[0]?.currentCellId?.$in?.some(cellId => String(cellId) === String(row.currentCellId));
    const inReservation = filter.$or?.[1]?.managedReservationId && String(row.managedReservationId) === String(filter.$or[1].managedReservationId) &&
      ['IN_STORAGE', 'PENDING_OUTBOUND'].includes(row.status);
    return inRackCells || inReservation;
  })));
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  t.mock.method(Movement, 'findOne', filter => new Query(state.movements.find(row => String(row.itemId) === String(filter.itemId) &&
    row.idempotencyKey === filter.idempotencyKey) ?? null));
  t.mock.method(Movement, 'find', filter => new Query(filter.itemId?.$in
    ? filter.itemId.$in.flatMap(itemId => state.itemMovements.get(String(itemId)) ?? [])
    : state.itemMovements.get(String(filter.itemId)) ?? []));
  t.mock.method(Movement.prototype, 'save', async function () {
    await this.validate();
    if (state.failMovement) throw new Error('simulated MOVE persistence failure');
    state.movements.push(this); state.itemMovements.get(String(this.itemId)).push(this); return this;
  });
  t.mock.method(Balance, 'findOne', filter => new Query(String(filter.itemId) === String(item._id) ? stock : null));
  t.mock.method(Balance.prototype, 'save', async function () { await this.validate(); return this; });
  t.mock.method(OutboundRequest, 'findOne', () => new Query(options.pendingOutbound ? { _id: oid(id.remove) } : null));
  t.mock.method(OutboundRequest, 'find', () => new Query([]));
  t.mock.method(InboundRequest, 'findOne', () => new Query(options.pendingInbound ? { _id: oid(id.remove) } : null));
  t.mock.method(Reservation, 'findOne', () => new Query({ bookingFlowVersion: 2 }));
  t.mock.method(Reservation, 'findOneAndUpdate', (_filter, update) => {
    state.operationOrder.push('Reservation'); reservation.inventoryVersion += update.$inc.inventoryVersion; return new Query(reservation);
  });
  t.mock.method(Reservation.prototype, 'save', async function () { return this; });
  t.mock.method(Capacity, 'findOneAndUpdate', (_filter, update) => {
    state.operationOrder.push('Capacity'); state.capacityVersion = (state.capacityVersion ?? 0) + update.$inc.bookingVersion; return new Query({});
  });
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(id.facility) }));
  t.mock.method(Zone, 'findOneAndUpdate', filter => {
    state.operationOrder.push('Zone'); const row = zones.get(String(filter._id)); if (!row || (filter.isActive && !row.isActive)) return new Query(null);
    row.structureVersion += 1; return new Query(row);
  });
  t.mock.method(Rack, 'findOneAndUpdate', filter => {
    state.operationOrder.push('Rack'); const row = racks.get(String(filter._id));
    if (!row || (filter.operationalStatus && row.operationalStatus !== filter.operationalStatus)) return new Query(null);
    row.layoutVersion += 1; return new Query(row);
  });
  t.mock.method(Cell, 'findOne', filter => new Query(cells.get(String(filter._id)) ?? null));
  t.mock.method(Cell, 'find', filter => new Query([...cells.values()].filter(row => filter.rackId?.$in
    ? filter.rackId.$in.some(rackId => String(rackId) === String(row.rackId))
    : String(row.rackId) === String(filter.rackId))));
  t.mock.method(Cell, 'findOneAndUpdate', (filter, update) => {
    state.operationOrder.push('Cell'); const row = cells.get(String(filter._id));
    if (!row || (filter.operationalStatus && filter.operationalStatus !== row.operationalStatus) ||
        (filter.usedWeightKg !== undefined && filter.usedWeightKg !== row.usedWeightKg) ||
        (filter.usedVolumeM3 !== undefined && filter.usedVolumeM3 !== row.usedVolumeM3)) return new Query(null);
    if (update.$inc?.allocationVersion) row.allocationVersion += update.$inc.allocationVersion;
    if (update.$set) Object.assign(row, update.$set);
    return new Query(row);
  });
  t.mock.method(Allocation, 'findOne', filter => {
    const row = allocations.get(String(filter.cellId));
    const statusMatches = Array.isArray(filter.status?.$in) ? filter.status.$in.includes(row?.status) : row?.status === filter.status;
    const datesMatch = row && row.startDate <= filter.startDate.$lte && row.endDate > filter.endDate.$gt;
    return new Query(statusMatches && datesMatch ? row : null);
  });
  t.mock.method(Audit, 'create', async docs => {
    if (state.failAudit) throw new Error('simulated audit failure'); state.audits.push(...docs); return docs;
  });
  return state;
}

function makeOtherItem(itemId, cellId, receiptId, focus, weight, volume, receivedAt) {
  const unitWeight = weight, unitDimensionsM = { widthM: volume, depthM: 1, heightM: 1 };
  const item = new Item({ _id: oid(itemId), facilityId: focus.facilityId, customerId: focus.customerId,
    managedReservationId: focus.managedReservationId, itemCode: itemId, name: 'Shared stock', category: 'DOCUMENTS',
    quantity: 1, quantityUnit: 'box', unitWeightKg: unitWeight, unitDimensionsM, unitVolumeM3: volume,
    totalWeightKg: weight, totalVolumeM3: volume, currentCellId: oid(cellId), currentPlacementMovementId: oid(receiptId),
    inboundMovementId: oid(receiptId), status: 'IN_STORAGE', images: [], createdBy: focus.customerId });
  const receipt = { _id: oid(receiptId), itemId: item._id, managedReservationId: item.managedReservationId,
    facilityId: item.facilityId, customerId: item.customerId, type: 'INBOUND', destinationCellId: item.currentCellId,
    quantity: 1, quantityUnit: 'box', actualUnitWeightKg: unitWeight, actualTotalWeightKg: weight,
    actualUnitDimensionsM: unitDimensionsM, actualTotalVolumeM3: volume, performedBy: oid(id.staff), performedAt: receivedAt,
    inspectionNote: 'Shared stock receipt', idempotencyKey: `other-receipt-${itemId}` };
  return { ...item.toObject(), receipt };
}

const staff = { _id: oid(id.staff), role: 'FACILITY_STAFF', assignedFacilityId: oid(id.facility) };
const payload = (overrides = {}) => ({ sourceCellId: id.source, destinationCellId: id.destination,
  physicalPackingConfirmed: true, relocationNote: 'Move to allocated Cell', ...overrides });

test('canonical relocation payload strictly requires source, destination, packing and note; quantity is server-derived', () => {
  assert.deepEqual(parseCanonicalRelocation(payload(), 'relocation-key-0001'), { ...payload(), idempotencyKey: 'relocation-key-0001' });
  for (const invalid of [null, [], { ...payload(), verifiedQuantity: 7 }, { ...payload(), idempotencyKey: 'x' },
    { ...payload(), physicalPackingConfirmed: 'true' }, { ...payload(), destinationCellId: id.source },
    Object.assign(Object.create(null), payload()), { ...payload(), sourceCellId: undefined }]) {
    assert.throws(() => parseCanonicalRelocation(invalid, 'relocation-key-0001'));
  }
  assert.equal(resolveMi06CanonicalRelocationGate('test', undefined), false);
  assert.equal(resolveMi06CanonicalRelocationGate('test', 'true'), true);
  assert.equal(resolveMi06CanonicalRelocationGate('production', 'true'), false);
});

test('legacy inbound plus canonical partial REMOVE relocates all remaining stock and preserves batch provenance atomically', async t => {
  const state = makeFixture(t, { sourceOtherWeight: 3, sourceOtherVolume: .006, destinationUsedWeightKg: 4, destinationUsedVolumeM3: .006 });
  const result = await service.relocate(id.item, payload(), 'canonical-relocation-0001', staff);
  assert.equal(result.idempotentReplay, false); assert.equal(result.currentQuantity, 7);
  assert.equal(state.item.quantity, 10, 'registered metadata quantity remains unchanged');
  assert.equal(String(state.item.currentCellId), id.destination);
  assert.equal(String(state.item.currentPlacementMovementId), String(result.movement._id));
  assert.equal(state.stock.onHandQuantity, 7); assert.equal(state.stock.heldQuantity, 0);
  assert.equal(state.stock.batches[0].quantity, 7); assert.equal(state.stock.batches[0].arithmeticPolicy, 'COMPATIBILITY');
  assert.equal(String(state.stock.currentCellId), id.destination);
  assert.equal(state.stock.source, 'LEDGER_V2'); assert.equal(String(state.stock.reconciledThroughMovementId), String(result.movement._id));
  assert.equal(state.source.usedWeightKg, 3); assert.equal(state.source.usedVolumeM3, .006);
  assert.equal(state.destination.usedWeightKg, 18); assert.equal(state.destination.usedVolumeM3, .048);
  assert.equal(state.reservation.usedCapacityM3, .054, 'same-reservation physical capacity remains unchanged');
  assert.equal(state.allocations.get(id.source).status, 'OCCUPIED', 'other stored Item keeps source allocation occupied');
  assert.equal(state.allocations.get(id.destination).status, 'OCCUPIED');
  assert.equal(state.movements.length, 3);
  const move = state.movements[2];
  assert.equal(move.type, 'RELOCATION'); assert.equal(move.schemaVersion, 2); assert.equal(move.arithmeticPolicy, 'CANONICAL_V1');
  assert.equal(move.quantity, 7); assert.equal(String(move.previousPlacementMovementId), id.receipt);
  assert.equal(move.batchLines.length, 1); assert.equal(move.batchLines[0].action, 'MOVE');
  assert.equal(move.batchLines[0].quantity, 7); assert.equal(move.batchLines[0].batchId, `legacy:${id.receipt}`);
  assert.equal(String(move.batchLines[0].receiptMovementId), id.receipt);
  assert.deepEqual(state.operationOrder.slice(0, 5), ['Item', 'Capacity', 'Zone', 'Zone', 'Reservation']);
  assert.ok(state.operationOrder.indexOf('Rack') < state.operationOrder.indexOf('Cell'));
  const replay = await service.relocate(id.item, payload(), 'canonical-relocation-0001', staff);
  assert.equal(replay.idempotentReplay, true); assert.equal(String(replay.movement._id), String(move._id));
  assert.equal(state.movements.length, 3); assert.equal(state.stock.onHandQuantity, 7);
});

test('multiple receipt batches after repeated outbound are moved in full with each receipt lineage intact', async t => {
  const state = makeFixture(t, { multiBatch: true });
  const result = await service.relocate(id.item, payload(), 'canonical-relocation-multibatch-001', staff);
  assert.equal(result.currentQuantity, 12);
  assert.equal(result.movement.quantity, 12);
  assert.equal(String(result.movement.previousPlacementMovementId), '507f1f77bcf86cd799439014');
  assert.deepEqual(result.movement.batchLines.map(line => line.quantity), [7, 5]);
  assert.deepEqual(result.movement.batchLines.map(line => line.batchId), [`legacy:${id.receipt}`, 'receipt-batch-002']);
  assert.deepEqual(result.movement.batchLines.map(line => String(line.receiptMovementId)), [id.receipt, '507f1f77bcf86cd799439014']);
  assert.equal(state.stock.onHandQuantity, 12);
  assert.equal(state.stock.heldQuantity, 0);
  assert.equal(state.stock.actualTotalWeightKg, 19);
  assert.equal(state.stock.actualTotalVolumeM3, .047);
  assert.equal(state.source.usedWeightKg, 0);
  assert.equal(state.source.usedVolumeM3, 0);
  assert.equal(state.destination.usedWeightKg, 19);
  assert.equal(state.destination.usedVolumeM3, .047);
  assert.equal(state.reservation.usedCapacityM3, .047);
  assert.equal(state.allocations.get(id.source).status, 'RESERVED');
  assert.equal(state.allocations.get(id.destination).status, 'OCCUPIED');
});

test('different idempotency payload conflicts and a distinct replay key cannot repeat a stale source move', async t => {
  const state = makeFixture(t);
  await service.relocate(id.item, payload(), 'canonical-relocation-0002', staff);
  await assert.rejects(service.relocate(id.item, payload({ relocationNote: 'Changed note' }), 'canonical-relocation-0002', staff),
    { code: 'CANONICAL_RELOCATION_CONFLICT', status: 409 });
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0003', staff),
    { code: 'CANONICAL_RELOCATION_INVALID', status: 409 });
  assert.equal(state.movements.length, 3);
});

test('destination capacity, geometry and packing uncertainty fail closed without writes', async t => {
  const tooHeavy = makeFixture(t, { destinationMaxWeightKg: 10 });
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0004', staff), { code: 'CAPACITY_EXCEEDED' });
  assert.equal(tooHeavy.movements.length, 2); assert.equal(String(tooHeavy.item.currentCellId), id.source);
  const tooNarrow = makeFixture(t, { destinationDimensions: { widthM: .05, depthM: .05, usableHeightM: .1 } });
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0005', staff), { code: 'CAPACITY_EXCEEDED' });
  assert.equal(tooNarrow.movements.length, 2);
  const singleUnitNoPacking = makeFixture(t);
  await assert.rejects(service.relocate(id.item, payload({ physicalPackingConfirmed: false }), 'canonical-relocation-0006', staff),
    { code: 'CANONICAL_RELOCATION_INVALID', status: 409 });
  assert.equal(singleUnitNoPacking.movements.length, 2);
});

test('expired source or destination allocation fails closed without writes', async t => {
  const expiredSource = makeFixture(t);
  expiredSource.allocations.get(id.source).endDate = new Date(Date.now() - 1);
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-expired-source-001', staff),
    { code: 'CANONICAL_RELOCATION_INVALID', status: 409 });
  assert.equal(expiredSource.movements.length, 2);
  assert.equal(String(expiredSource.item.currentCellId), id.source);
  assert.equal(expiredSource.source.usedWeightKg, 14);

  const expiredDestination = makeFixture(t);
  expiredDestination.allocations.get(id.destination).endDate = new Date(Date.now() - 1);
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-expired-destination-001', staff),
    { code: 'CANONICAL_RELOCATION_INVALID', status: 409 });
  assert.equal(expiredDestination.movements.length, 2);
  assert.equal(String(expiredDestination.item.currentCellId), id.source);
  assert.equal(expiredDestination.destination.usedWeightKg, 0);
});

test('pending holds, unresolved requests and invalid placement/balance reject before stock writes', async t => {
  const pending = makeFixture(t, { pendingOutbound: true });
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0007', staff), { code: 'CANONICAL_RELOCATION_CONFLICT' });
  assert.equal(pending.movements.length, 2);
  const inboundPending = makeFixture(t, { pendingInbound: true });
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0008', staff), { code: 'CANONICAL_RELOCATION_CONFLICT' });
  assert.equal(inboundPending.movements.length, 2);
  const wrongStaff = makeFixture(t);
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0009', { ...staff, assignedFacilityId: oid(id.remove) }),
    { code: 'CANONICAL_RELOCATION_NOT_FOUND', status: 404 });
  assert.equal(wrongStaff.movements.length, 2);
  const nonStaff = makeFixture(t);
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0010', { ...staff, role: 'FACILITY_MANAGER' }),
    { code: 'CANONICAL_RELOCATION_FORBIDDEN', status: 403 });
  assert.equal(nonStaff.movements.length, 2);
});

test('movement write failure rolls back Item, StockBalance, counters, allocations and audit', async t => {
  const state = makeFixture(t, { failMovement: true });
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0011', staff), /simulated MOVE persistence failure/);
  assert.equal(String(state.item.currentCellId), id.source); assert.equal(String(state.item.currentPlacementMovementId), id.receipt);
  assert.equal(state.stock.onHandQuantity, 7); assert.equal(String(state.stock.currentCellId), id.source);
  assert.equal(state.source.usedWeightKg, 14); assert.equal(state.destination.usedWeightKg, 0);
  assert.equal(state.allocations.get(id.source).status, 'OCCUPIED'); assert.equal(state.allocations.get(id.destination).status, 'RESERVED');
  assert.equal(state.movements.length, 2); assert.equal(state.audits.length, 0);
});

test('late audit failure rolls back the already staged MOVE and every placement/counter write', async t => {
  const state = makeFixture(t, { failAudit: true });
  await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-late-failure-001', staff), /simulated audit failure/);
  assert.equal(String(state.item.currentCellId), id.source);
  assert.equal(String(state.stock.currentCellId), id.source);
  assert.equal(state.stock.onHandQuantity, 7);
  assert.equal(state.source.usedWeightKg, 14);
  assert.equal(state.destination.usedWeightKg, 0);
  assert.equal(state.allocations.get(id.source).status, 'OCCUPIED');
  assert.equal(state.allocations.get(id.destination).status, 'RESERVED');
  assert.equal(state.movements.length, 2);
  assert.equal(state.itemMovements.get(id.item).length, 2);
  assert.equal(state.audits.length, 0);
});

test('gate OFF blocks new canonical relocation but committed key replay remains available', async t => {
  const state = makeFixture(t);
  const oldGate = process.env.MI06_CANONICAL_RELOCATIONS_ENABLED;
  try {
    process.env.MI06_CANONICAL_RELOCATIONS_ENABLED = 'false';
    await assert.rejects(service.relocate(id.item, payload(), 'canonical-relocation-0012', staff),
      { code: 'CANONICAL_RELOCATION_FEATURE_DISABLED', status: 503 });
    assert.equal(state.movements.length, 2);
    process.env.MI06_CANONICAL_RELOCATIONS_ENABLED = 'true';
    const done = await service.relocate(id.item, payload(), 'canonical-relocation-0012', staff);
    process.env.MI06_CANONICAL_RELOCATIONS_ENABLED = 'false';
    const replay = await service.relocate(id.item, payload(), 'canonical-relocation-0012', staff);
    assert.equal(done.idempotentReplay, false); assert.equal(replay.idempotentReplay, true);
  } finally { process.env.MI06_CANONICAL_RELOCATIONS_ENABLED = oldGate; }
});
