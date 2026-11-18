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
const InboundRequest = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const ManagedOutboundRequest = require('../dist/models/inventory-items/managed-outbound-request.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Capacity = require('../dist/models/reservations/managed-facility-capacity.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Audit = require('../dist/models/reservations/managed-reservation-audit.model').default;
const Policy = require('../dist/models/pricing-policy/policy.model').default;
const { InventoryItemService: service } = require('../dist/services/inventory-items/inventory-item.service');
const { parseRelocation } = require('../dist/services/inventory-items/inventory-item.validation');

const oid = value => new mongoose.Types.ObjectId(value);
const facilityId = '507f1f77bcf86cd799439011';
const reservationId = '507f1f77bcf86cd799439021';
const itemId = '507f1f77bcf86cd799439031';
const cellAId = '507f1f77bcf86cd799439041';
const cellBId = '507f1f77bcf86cd799439042';
const cellCId = '507f1f77bcf86cd799439043';
const zoneAId = '507f1f77bcf86cd799439051';
const zoneBId = '507f1f77bcf86cd799439052';
const rackAId = '507f1f77bcf86cd799439061';
const rackBId = '507f1f77bcf86cd799439062';
const rackCId = '507f1f77bcf86cd799439063';
const inboundId = '507f1f77bcf86cd799439101';
const customerId = oid('507f1f77bcf86cd799439071');
const staffId = oid('507f1f77bcf86cd799439081');
const otherCustomerId = oid('507f1f77bcf86cd799439091');

class Query {
  constructor(value) { this.value = value; }
  session() { return this; }
  select() { return this; }
  lean() { return this; }
  limit() { return this; }
  sort() { return this; }
  exec() { return Promise.resolve(this.value); }
}

const cell = (id, zone, rack, options = {}) => ({
  _id: oid(id), facilityId: oid(facilityId), zoneId: oid(zone), rackId: oid(rack),
  levelNumber: options.levelNumber ?? 1, cellNumber: options.cellNumber ?? 1,
  dimensions: options.dimensions ?? { widthM: .5, depthM: .5, usableHeightM: 1 },
  maxWeightKg: options.maxWeightKg ?? 100, usedWeightKg: options.usedWeightKg ?? 0,
  usedVolumeM3: options.usedVolumeM3 ?? 0, allocationVersion: 0,
  operationalStatus: options.operationalStatus ?? 'AVAILABLE', deletedAt: undefined,
});

function makeItem(overrides = {}) {
  return new Item({ _id: oid(itemId), facilityId: oid(facilityId), customerId,
    managedReservationId: oid(reservationId), itemCode: 'LOT-1', name: 'Cartons', category: 'DOCUMENTS',
    quantity: 2, quantityUnit: 'carton', unitWeightKg: 999, unitDimensionsM: { widthM: 9, depthM: 9, heightM: 9 },
    unitVolumeM3: 729, totalWeightKg: 1998, totalVolumeM3: 1458,
    currentCellId: oid(cellAId), status: 'IN_STORAGE', images: [], createdBy: customerId,
    inboundMovementId: oid(inboundId), currentPlacementMovementId: oid(inboundId), ...overrides });
}

function makeInbound(overrides = {}) {
  return { _id: oid(inboundId), itemId: oid(itemId), managedReservationId: oid(reservationId),
    facilityId: oid(facilityId), customerId, type: 'INBOUND', destinationCellId: oid(cellAId),
    quantity: 2, quantityUnit: 'carton', actualUnitWeightKg: 20, actualTotalWeightKg: 40,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, actualTotalVolumeM3: .03,
    performedBy: staffId, performedAt: new Date('2026-10-01T00:00:00Z'), inspectionNote: 'Received', idempotencyKey: 'inbound-01', ...overrides };
}

function makeRelocation(sourceCell, destinationCell, previousPlacementMovementId, overrides = {}) {
  return { _id: oid(overrides._id ?? '507f1f77bcf86cd799439111'), itemId: oid(itemId),
    managedReservationId: oid(reservationId), facilityId: oid(facilityId), customerId,
    type: 'RELOCATION', sourceCellId: oid(sourceCell), destinationCellId: oid(destinationCell),
    previousPlacementMovementId: oid(previousPlacementMovementId), quantity: 2, quantityUnit: 'carton',
    actualUnitWeightKg: 20, actualTotalWeightKg: 40,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, actualTotalVolumeM3: .03,
    physicalPackingConfirmed: true, performedBy: staffId, performedAt: new Date(),
    relocationNote: 'Move to assigned Cell', idempotencyKey: overrides.idempotencyKey ?? 'relocation-01', ...overrides };
}

function setup(t, options = {}) {
  const sharedRack = options.sharedRack ?? false;
  const sharedZone = options.sharedZone ?? sharedRack;
  const sourceCell = cell(cellAId, zoneAId, rackAId, {
    usedWeightKg: 40, usedVolumeM3: .03,
    operationalStatus: options.sourceStatus ?? 'AVAILABLE',
    levelNumber: options.sourceLevel ?? 1,
  });
  const destinationCell = cell(cellBId, sharedZone ? zoneAId : zoneBId, sharedRack ? rackAId : rackBId, {
    operationalStatus: options.destinationStatus ?? 'AVAILABLE',
    usedWeightKg: options.destinationUsedWeightKg ?? 0,
    usedVolumeM3: options.destinationUsedVolumeM3 ?? 0,
    maxWeightKg: options.destinationMaxWeightKg ?? 100,
    dimensions: options.destinationDimensions ?? { widthM: .5, depthM: .5, usableHeightM: 1 },
    levelNumber: options.destinationLevel ?? 1,
  });
  const thirdRackId = sharedRack || !sharedZone ? rackBId : rackCId;
  const thirdCell = cell(cellCId, zoneBId, thirdRackId, { cellNumber: 2, usedWeightKg: options.thirdUsedWeightKg ?? 0, usedVolumeM3: options.thirdUsedVolumeM3 ?? 0 });
  const item = makeItem({ status: options.itemStatus ?? 'IN_STORAGE',
    customerId: options.itemCustomerId ?? customerId,
    managedReservationId: oid(options.itemReservationId ?? reservationId),
    ...(options.currentCellId ? { currentCellId: oid(options.currentCellId) } : {}) });
  const inbound = makeInbound();
  const reservation = { _id: oid(reservationId), facilityId: oid(facilityId), customerId: options.reservationCustomerId ?? customerId,
    serviceType: options.serviceType ?? 'MANAGED_INVENTORY', bookingFlowVersion: options.bookingFlowVersion ?? 2,
    status: options.reservationStatus ?? 'ACTIVE', startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 86_400_000),
    allocatedCapacity: 1.5, usedCapacityM3: options.usedCapacityM3 ?? .03, inventoryVersion: 0,
    ...(options.closurePending ? { activeClosureRequestId: oid('507f1f77bcf86cd799439199') } : {}),
    save: async function () { return this; } };
  const cells = new Map([[cellAId, sourceCell], [cellBId, destinationCell], [cellCId, thirdCell]]);
  const zoneMap = new Map([[zoneAId, { _id: oid(zoneAId), facilityId: oid(facilityId), isActive: options.sourceZoneActive ?? true, structureVersion: 0 }],
    [zoneBId, { _id: oid(zoneBId), facilityId: oid(facilityId), isActive: options.destinationZoneActive ?? true, structureVersion: 0 }]]);
  const destinationZoneId = sharedZone ? zoneAId : zoneBId;
  const rackMap = new Map([[rackAId, { _id: oid(rackAId), facilityId: oid(facilityId), zoneId: oid(zoneAId),
    operationalStatus: options.sourceRackStatus ?? 'AVAILABLE', levelCount: 2, maxWeightKgPerLevel: options.sourceRackLevelKg ?? 500, layoutVersion: 0 }],
  [rackBId, { _id: oid(rackBId), facilityId: oid(facilityId), zoneId: oid(sharedRack ? zoneBId : destinationZoneId),
    operationalStatus: options.destinationRackStatus ?? 'AVAILABLE', levelCount: options.destinationRackLevels ?? 2,
    maxWeightKgPerLevel: options.destinationRackLevelKg ?? 500, layoutVersion: 0 }],
  [rackCId, { _id: oid(rackCId), facilityId: oid(facilityId), zoneId: oid(zoneBId),
    operationalStatus: 'AVAILABLE', levelCount: 2, maxWeightKgPerLevel: 500, layoutVersion: 0 }]]);
  const allocations = new Map([[cellAId, { _id: oid('507f1f77bcf86cd799439121'), facilityId: oid(facilityId),
    cellId: oid(cellAId), reservationId: oid(reservationId), customerId, status: 'OCCUPIED' }],
  [cellBId, { _id: oid('507f1f77bcf86cd799439122'), facilityId: oid(facilityId), cellId: oid(cellBId),
    reservationId: oid(reservationId), customerId: options.destinationCustomerId ?? customerId,
    status: options.destinationAllocationStatus ?? 'RESERVED' }],
  [cellCId, { _id: oid('507f1f77bcf86cd799439123'), facilityId: oid(facilityId), cellId: oid(cellCId),
    reservationId: oid(reservationId), customerId, status: 'RESERVED' }]]);
  const state = { item, items: [item], cells, zoneMap, rackMap, allocations, reservation,
    movements: [inbound], audits: [], movementFailure: options.movementFailure ?? false,
    itemLockFailure: options.itemLockFailure ?? false, extraItems: [] };
  if (options.canonicalHistory) {
    const canonicalMovement = { ...inbound, _id: oid('507f1f77bcf86cd799439199'),
      type: options.canonicalHistoryType ?? 'OUTBOUND', schemaVersion: 2,
      arithmeticPolicy: options.canonicalHistoryPolicy === false ? undefined : 'CANONICAL_V1',
      batchLines: [{ action: options.canonicalHistoryAction ?? 'REMOVE' }] };
    if (options.canonicalHistoryPolicy === false) delete canonicalMovement.arithmeticPolicy;
    state.movements.push(canonicalMovement);
  }
  let queue = Promise.resolve();
  const session = { withTransaction: async work => {
    const previous = queue; let release;
    queue = new Promise(resolve => { release = resolve; }); await previous;
    const itemBefore = { status: item.status, currentCellId: item.currentCellId, currentPlacementMovementId: item.currentPlacementMovementId, __v: item.__v };
    const cellBefore = [...cells].map(([key, row]) => [key, { usedWeightKg: row.usedWeightKg, usedVolumeM3: row.usedVolumeM3, allocationVersion: row.allocationVersion }]);
    const allocationBefore = [...allocations].map(([key, row]) => [key, row.status]);
    const reservationBefore = { usedCapacityM3: reservation.usedCapacityM3, status: reservation.status, inventoryVersion: reservation.inventoryVersion };
    const zoneBefore = [...zoneMap].map(([key, row]) => [key, row.structureVersion]);
    const rackBefore = [...rackMap].map(([key, row]) => [key, row.layoutVersion]);
    const movementCount = state.movements.length; const auditCount = state.audits.length;
    try { return await work(); }
    catch (error) {
      Object.assign(item, itemBefore);
      for (const [key, before] of cellBefore) Object.assign(cells.get(key), before);
      for (const [key, status] of allocationBefore) allocations.get(key).status = status;
      Object.assign(reservation, reservationBefore);
      for (const [key, version] of zoneBefore) zoneMap.get(key).structureVersion = version;
      for (const [key, version] of rackBefore) rackMap.get(key).layoutVersion = version;
      state.movements.length = movementCount; state.audits.length = auditCount; throw error;
    } finally { release(); }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);

  t.mock.method(Item, 'findOne', filter => {
    if (filter.status && typeof filter.status === 'string' && String(filter._id) === itemId && item.status !== filter.status) return new Query(null);
    if (filter._id?.$ne) return new Query(state.items.find(row => String(row._id) !== String(filter._id.$ne) &&
      row.currentCellId && String(row.currentCellId) === String(filter.currentCellId) && ['IN_STORAGE', 'PENDING_OUTBOUND'].includes(row.status)) ?? null);
    return new Query(state.items.find(row => String(row._id) === String(filter._id)) ?? null);
  });
  t.mock.method(InboundRequest, 'findOne', () => new Query(options.unresolvedReceipt ? { _id: oid('507f1f77bcf86cd799439199') } : null));
  t.mock.method(ManagedOutboundRequest, 'findOne', () => new Query(options.unresolvedCanonicalOutbound ? { _id: oid('507f1f77bcf86cd799439198') } : null));
  t.mock.method(Item, 'find', filter => new Query(state.items.filter(row =>
    (!filter.managedReservationId || String(row.managedReservationId) === String(filter.managedReservationId)) && row.currentCellId &&
    ['IN_STORAGE', 'PENDING_OUTBOUND'].includes(row.status))));
  t.mock.method(Item, 'findOneAndUpdate', filter => new Query(state.itemLockFailure ||
    String(filter._id) !== String(item._id) || (filter.currentCellId && !item.currentCellId?.equals(filter.currentCellId)) ||
    (filter.status && item.status !== filter.status) ? null : item));
  t.mock.method(Item.prototype, 'save', async function () { return this; });

  t.mock.method(Movement, 'findOne', filter => new Query(state.movements.find(row => {
    if (filter._id && String(row._id) !== String(filter._id)) return false;
    if (filter.type && row.type !== filter.type) return false;
    if (filter.itemId && String(row.itemId) !== String(filter.itemId)) return false;
    if (filter.idempotencyKey && row.idempotencyKey !== filter.idempotencyKey) return false;
    if (filter.managedReservationId && String(row.managedReservationId) !== String(filter.managedReservationId)) return false;
    if (filter.facilityId && String(row.facilityId) !== String(filter.facilityId)) return false;
    if (filter.customerId && String(row.customerId) !== String(filter.customerId)) return false;
    if (filter.schemaVersion && row.schemaVersion !== filter.schemaVersion) return false;
    if (filter['batchLines.receiptRequestId']?.$exists && !row.batchLines?.some(line => line.receiptRequestId)) return false;
    if (filter.$or && !filter.$or.some(condition =>
      (condition.arithmeticPolicy && row.arithmeticPolicy === condition.arithmeticPolicy) ||
      (condition['batchLines.action'] && row.batchLines?.some(line => condition['batchLines.action'].$in.includes(line.action))) ||
      (condition['batchLines.receiptRequestId']?.$exists && row.batchLines?.some(line => line.receiptRequestId)))) return false;
    return true;
  }) ?? null));
  t.mock.method(Movement.prototype, 'save', async function () {
    await this.validate();
    if (state.movementFailure) throw new Error('simulated movement persistence failure');
    state.movements.push(this);
    return this;
  });

  t.mock.method(Cell, 'findOne', filter => {
    const row = cells.get(String(filter._id));
    return new Query(row && (!filter.facilityId || row.facilityId.equals(filter.facilityId)) &&
      (!filter.rackId || row.rackId.equals(filter.rackId)) && (!filter.zoneId || row.zoneId.equals(filter.zoneId)) ? row : null);
  });
  t.mock.method(Cell, 'find', filter => new Query([...cells.values()].filter(row => String(row.rackId) === String(filter.rackId))));
  t.mock.method(Cell, 'findOneAndUpdate', (filter, update) => {
    const row = cells.get(String(filter._id));
    if (!row || (filter.facilityId && !row.facilityId.equals(filter.facilityId)) ||
        (filter.rackId && !row.rackId.equals(filter.rackId)) || (filter.zoneId && !row.zoneId.equals(filter.zoneId)) ||
        (filter.operationalStatus && row.operationalStatus !== filter.operationalStatus) ||
        (filter.usedWeightKg !== undefined && row.usedWeightKg !== filter.usedWeightKg) ||
        (filter.usedVolumeM3 !== undefined && row.usedVolumeM3 !== filter.usedVolumeM3)) return new Query(null);
    const incWeight = Number(update.$inc?.usedWeightKg ?? 0);
    const incVolume = Number(update.$inc?.usedVolumeM3 ?? 0);
    if (row.usedWeightKg + incWeight < 0 || row.usedVolumeM3 + incVolume < 0 ||
        row.usedWeightKg + incWeight > row.maxWeightKg ||
        row.usedVolumeM3 + incVolume > row.dimensions.widthM * row.dimensions.depthM * row.dimensions.usableHeightM) return new Query(null);
    for (const [key, value] of Object.entries(update.$inc ?? {})) row[key] = Number(row[key] ?? 0) + value;
    return new Query(row);
  });
  t.mock.method(Zone, 'findOneAndUpdate', (filter, update) => {
    const row = zoneMap.get(String(filter._id));
    if (!row || !row.facilityId.equals(filter.facilityId) || (filter.isActive === true && row.isActive !== true)) return new Query(null);
    row.structureVersion += update.$inc.structureVersion;
    return new Query(row);
  });
  t.mock.method(Rack, 'findOneAndUpdate', (filter, update) => {
    const row = [...rackMap.values()].find(value => String(value._id) === String(filter._id));
    if (!row || !row.facilityId.equals(filter.facilityId) || !row.zoneId.equals(filter.zoneId) ||
        (filter.operationalStatus && row.operationalStatus !== filter.operationalStatus)) return new Query(null);
    row.layoutVersion += update.$inc.layoutVersion;
    return new Query(row);
  });
  t.mock.method(Reservation, 'findOne', filter => new Query(options.reservationMissing || reservation.serviceType !== filter.serviceType ? null : reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    const requiredStatus = filter.status ?? filter.$and?.find(row => row.status)?.status;
    const closureBlocked = filter.activeClosureRequestId === null && reservation.activeClosureRequestId != null;
    return new Query(options.reservationMissing || closureBlocked || (requiredStatus && reservation.status !== requiredStatus) ? null : reservation);
  });
  t.mock.method(Capacity, 'findOneAndUpdate', () => new Query(options.capacityMissing ? null : { facilityId: oid(facilityId), bookingVersion: 1 }));
  t.mock.method(Facility, 'findOne', () => new Query(options.facilityMissing ? null : {
    _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'],
  }));
  t.mock.method(Allocation, 'findOne', filter => {
    const row = allocations.get(String(filter.cellId));
    if (!row || String(row.reservationId) !== String(filter.reservationId) ||
        String(row.facilityId) !== String(filter.facilityId) || String(row.customerId) !== String(filter.customerId)) return new Query(null);
    if (filter.status?.$in ? !filter.status.$in.includes(row.status) : filter.status !== row.status) return new Query(null);
    const document = new Allocation(row);
    document.status = row.status;
    return new Query(document);
  });
  t.mock.method(Allocation.prototype, 'save', async function () {
    allocations.set(String(this.cellId), this);
    return this;
  });
  t.mock.method(Policy, 'find', () => new Query([{ config: { allowedCategories: ['DOCUMENTS'], blockedCategories: [] } }]));
  t.mock.method(Audit, 'create', async rows => { state.audits.push(...rows); return rows; });

  const body = { sourceCellId: cellAId, destinationCellId: cellBId, verifiedQuantity: 2,
    physicalPackingConfirmed: true, relocationNote: 'Move cartons to the assigned Cell', idempotencyKey: 'relocation-001' };
  const staff = { _id: staffId, role: 'FACILITY_STAFF', assignedFacilityId: oid(options.assignedFacilityId ?? facilityId) };
  return { state, item, sourceCell, destinationCell, reservation, allocations, body, staff, session };
}

test('relocation parser strictly validates source, destination, whole quantity, packing, note and key', () => {
  const body = { sourceCellId: cellAId, destinationCellId: cellBId, verifiedQuantity: 2,
    physicalPackingConfirmed: true, relocationNote: 'Move the whole lot', idempotencyKey: 'relocation-01' };
  assert.equal(parseRelocation(body).destinationCellId, cellBId);
  for (const invalid of [
    { ...body, sourceCellId: cellBId }, { ...body, destinationCellId: cellAId },
    { ...body, destinationCellId: 'not-an-object-id' }, { ...body, verifiedQuantity: 1.5 },
    { ...body, physicalPackingConfirmed: 'true' }, { ...body, relocationNote: '' },
    { ...body, idempotencyKey: 'bad key' }, { ...body, unexpected: true },
  ]) assert.throws(() => parseRelocation(invalid), { status: 400 });
});

test('successful same-Rack relocation uses committed INBOUND measurements and preserves rental quota and status', async t => {
  const ctx = setup(t, { sharedRack: true });
  const result = await service.relocate(itemId, ctx.body, ctx.staff);
  assert.equal(result.item.status, 'IN_STORAGE');
  assert.equal(String(result.item.currentCellId), cellBId);
  assert.equal(result.movement.type, 'RELOCATION');
  assert.equal(String(result.movement.sourceCellId), cellAId);
  assert.equal(String(result.movement.destinationCellId), cellBId);
  assert.equal(result.movement.actualTotalWeightKg, 40);
  assert.equal(result.movement.actualTotalVolumeM3, .03);
  assert.equal(ctx.sourceCell.usedWeightKg, 0); assert.equal(ctx.sourceCell.usedVolumeM3, 0);
  assert.equal(ctx.destinationCell.usedWeightKg, 40); assert.equal(ctx.destinationCell.usedVolumeM3, .03);
  assert.equal(ctx.reservation.usedCapacityM3, .03); assert.equal(ctx.reservation.status, 'ACTIVE');
  assert.equal(ctx.allocations.get(cellAId).status, 'RESERVED');
  assert.equal(ctx.allocations.get(cellBId).status, 'OCCUPIED');
  assert.equal(ctx.state.movements.filter(row => row.type === 'RELOCATION').length, 1);
  assert.equal(ctx.state.audits[0].action, 'RELOCATION_CONFIRMED');
});

test('relocation is blocked by an unresolved repeated-inbound request after the Item token', async t => {
  const ctx = setup(t, { unresolvedReceipt: true });
  await assert.rejects(service.relocate(itemId, ctx.body, ctx.staff), { status: 409, message: /unresolved repeated-inbound request/ });
  assert.equal(ctx.item.status, 'IN_STORAGE');
  assert.equal(ctx.sourceCell.usedWeightKg, 40); assert.equal(ctx.destinationCell.usedWeightKg, 0);
  assert.equal(ctx.state.movements.filter(row => row.type === 'RELOCATION').length, 0);
});

test('legacy relocation is blocked by an active closure marker before counter or movement writes', async t => {
  const ctx = setup(t, { closurePending: true });
  await assert.rejects(service.relocate(itemId, ctx.body, ctx.staff), { status: 409, message: /closure is pending/ });
  assert.equal(ctx.state.movements.filter(row => row.type === 'RELOCATION').length, 0);
  assert.equal(ctx.sourceCell.usedWeightKg, 40); assert.equal(ctx.destinationCell.usedWeightKg, 0);
});

test('relocation is blocked while a canonical outbound request holds this Item', async t => {
  const ctx = setup(t, { unresolvedCanonicalOutbound: true });
  await assert.rejects(service.relocate(itemId, ctx.body, ctx.staff), { status: 409, message: /canonical outbound request holds stock/ });
  assert.equal(ctx.state.movements.length, 1); assert.equal(ctx.sourceCell.usedWeightKg, 40); assert.equal(ctx.destinationCell.usedWeightKg, 0);
});

test('legacy relocation is blocked by v2 MOVE history without arithmetic marker', async t => {
  const ctx = setup(t, { canonicalHistory: true, canonicalHistoryType: 'RELOCATION',
    canonicalHistoryAction: 'MOVE', canonicalHistoryPolicy: false });
  await assert.rejects(service.relocate(itemId, ctx.body, ctx.staff), {
    status: 409, message: /Canonical stock history requires the canonical partial-stock workflow/,
  });
  assert.equal(ctx.state.movements.filter(row => row.type === 'RELOCATION').length, 1, 'only the pre-existing canonical movement remains');
  assert.equal(ctx.sourceCell.usedWeightKg, 40); assert.equal(ctx.destinationCell.usedWeightKg, 0);
});

test('legacy relocation replay is also blocked after canonical stock history', async t => {
  const ctx = setup(t, { canonicalHistory: true });
  ctx.state.movements.push(makeRelocation(cellAId, cellBId, inboundId));
  await assert.rejects(service.relocate(itemId, ctx.body, ctx.staff), {
    status: 409, message: /Canonical stock history requires the canonical partial-stock workflow/,
  });
  assert.equal(ctx.sourceCell.usedWeightKg, 40); assert.equal(ctx.destinationCell.usedWeightKg, 0);
});

test('multiple relocations preserve placement lineage and support outbound from the latest Cell', async t => {
  const ctx = setup(t, { sharedRack: true, sharedZone: true, destinationLevel: 2, destinationRackLevelKg: 500 });
  await service.relocate(itemId, ctx.body, ctx.staff);
  const second = await service.relocate(itemId, { ...ctx.body, sourceCellId: cellBId, destinationCellId: cellCId,
    idempotencyKey: 'relocation-002', relocationNote: 'Move onward' }, ctx.staff);
  assert.equal(String(second.item.currentCellId), cellCId);
  assert.equal(ctx.destinationCell.usedWeightKg, 0);
  assert.equal(ctx.state.cells.get(cellCId).usedWeightKg, 40);
  assert.equal(String(second.movement.previousPlacementMovementId), String(ctx.state.movements[1]._id));
  ctx.item.status = 'PENDING_OUTBOUND';
  const outbound = await service.confirmOutbound(itemId, {
    verifiedQuantity: 2, handoverConfirmed: true, handoverNote: 'Handed over', idempotencyKey: 'outbound-after-relocation',
  }, ctx.staff);
  assert.equal(outbound.item.status, 'CHECKED_OUT');
  assert.equal(String(outbound.movement.sourceCellId), cellCId);
  assert.equal(ctx.state.cells.get(cellCId).usedWeightKg, 0);
  assert.equal(ctx.reservation.usedCapacityM3, 0);
});
test('relocation into a different Zone and Rack respects global lock scopes', async t => {
  const ctx = setup(t);
  const result = await service.relocate(itemId, ctx.body, ctx.staff);
  assert.equal(String(result.item.currentCellId), cellBId);
  assert.equal(ctx.sourceCell.usedWeightKg, 0);
  assert.equal(ctx.destinationCell.usedWeightKg, 40);
});

test('source may be blocked for inbound removal while destination must be available', async t => {
  const ctx = setup(t, { sharedRack: true, sourceStatus: 'MAINTENANCE' });
  await service.relocate(itemId, ctx.body, ctx.staff);
  assert.equal(String(ctx.item.currentCellId), cellBId);
  const blockedDestination = setup(t, { destinationStatus: 'BLOCKED' });
  await assert.rejects(service.relocate(itemId, blockedDestination.body, blockedDestination.staff), { status: 409 });
});

test('wrong Staff Facility, invalid state, location mismatch and Self-Storage are rejected', async t => {
  const wrongStaff = setup(t, { assignedFacilityId: '507f1f77bcf86cd799439099' });
  await assert.rejects(service.relocate(itemId, wrongStaff.body, wrongStaff.staff), { status: 403 });
  const nonStaff = setup(t);
  await assert.rejects(service.relocate(itemId, nonStaff.body, { ...nonStaff.staff, role: 'FACILITY_MANAGER' }), { status: 403 });
  const pending = setup(t, { itemStatus: 'PENDING_OUTBOUND' });
  await assert.rejects(service.relocate(itemId, pending.body, pending.staff), { status: 409 });
  const wrongSource = setup(t, { currentCellId: cellBId });
  await assert.rejects(service.relocate(itemId, wrongSource.body, wrongSource.staff), { status: 409 });
  const selfStorage = setup(t, { serviceType: 'SELF_STORAGE' });
  await assert.rejects(service.relocate(itemId, selfStorage.body, selfStorage.staff), { status: 409 });
});

test('wrong destination owner or reservation allocation is rejected without creating allocation', async t => {
  const otherCustomer = setup(t, { destinationCustomerId: otherCustomerId });
  await assert.rejects(service.relocate(itemId, otherCustomer.body, otherCustomer.staff), { status: 409 });
  const missingReservation = setup(t, { reservationMissing: true });
  await assert.rejects(service.relocate(itemId, missingReservation.body, missingReservation.staff), { status: 409 });
  assert.equal(missingReservation.state.movements.length, 1);
});

test('source equal to destination and destination parent or geometry failures are rejected', async t => {
  const ctx = setup(t);
  await assert.rejects(service.relocate(itemId, { ...ctx.body, destinationCellId: cellAId }, ctx.staff), { status: 400 });
  const inactiveZone = setup(t, { destinationZoneActive: false });
  await assert.rejects(service.relocate(itemId, inactiveZone.body, inactiveZone.staff), { status: 409 });
  const maintenanceRack = setup(t, { destinationRackStatus: 'MAINTENANCE' });
  await assert.rejects(service.relocate(itemId, maintenanceRack.body, maintenanceRack.staff), { status: 409 });
  const unknownHeight = setup(t, { destinationDimensions: { widthM: .5, depthM: .5 } });
  await assert.rejects(service.relocate(itemId, unknownHeight.body, unknownHeight.staff), { status: 409 });
  const tooNarrow = setup(t, { destinationDimensions: { widthM: .2, depthM: .2, usableHeightM: .3 } });
  await assert.rejects(service.relocate(itemId, tooNarrow.body, tooNarrow.staff), { status: 409 });
});

test('Cell, Rack level and Rack structural capacity limits are enforced', async t => {
  for (const options of [
    { destinationMaxWeightKg: 30 },
    { destinationUsedWeightKg: 70 },
    { destinationUsedVolumeM3: .23 },
    { sharedRack: true, destinationLevel: 1, destinationRackLevelKg: 30, sourceRackLevelKg: 0 },
    { destinationRackLevels: 1, destinationRackLevelKg: 30 },
  ]) await t.test(JSON.stringify(options), async t => {
    const ctx = setup(t, options);
    await assert.rejects(service.relocate(itemId, ctx.body, ctx.staff), { status: 409 });
    assert.equal(ctx.item.status, 'IN_STORAGE');
    assert.equal(String(ctx.item.currentCellId), cellAId);
    assert.equal(ctx.sourceCell.usedWeightKg, 40);
    assert.equal(ctx.destinationCell.usedWeightKg, options.destinationUsedWeightKg ?? 0);
    assert.equal(ctx.state.movements.length, 1);
  });
});

test('multi-unit relocation requires packing attestation and no client weight or volume is accepted', async t => {
  const ctx = setup(t);
  await assert.rejects(service.relocate(itemId, { ...ctx.body, physicalPackingConfirmed: false }, ctx.staff), { status: 409 });
  await assert.rejects(service.relocate(itemId, { ...ctx.body, actualTotalWeightKg: 1 }, ctx.staff), { status: 400 });
});

test('missing movement evidence, broken lineage and inconsistent counters fail closed', async t => {
  const missing = setup(t);
  missing.state.movements.length = 0;
  await assert.rejects(service.relocate(itemId, missing.body, missing.staff), { status: 409 });
  const badPointer = setup(t);
  badPointer.item.currentPlacementMovementId = oid('507f1f77bcf86cd799439199');
  await assert.rejects(service.relocate(itemId, badPointer.body, badPointer.staff), { status: 409 });
  const badCounter = setup(t, { usedCapacityM3: .02 });
  await assert.rejects(service.relocate(itemId, badCounter.body, badCounter.staff), { status: 409 });
  const cellCounter = setup(t, { destinationUsedWeightKg: 1 });
  await assert.rejects(service.relocate(itemId, cellCounter.body, cellCounter.staff), { status: 409 });
});

test('source allocation remains OCCUPIED when another stored Item remains in it', async t => {
  const ctx = setup(t, { sharedRack: true, sourceLevel: 2, destinationLevel: 1, sourceRackLevelKg: 60 });
  const otherInbound = { ...makeInbound({ _id: oid('507f1f77bcf86cd799439131'), itemId: oid('507f1f77bcf86cd799439132'),
    actualUnitWeightKg: 10, actualTotalWeightKg: 10, actualTotalVolumeM3: .001, quantity: 1, quantityUnit: 'box' }),
    itemId: oid('507f1f77bcf86cd799439132'), _id: oid('507f1f77bcf86cd799439131') };
  otherInbound.actualUnitDimensionsM = { widthM: .1, depthM: .1, heightM: .1 };
  const other = new Item({ _id: otherInbound.itemId, facilityId: oid(facilityId), customerId,
    managedReservationId: oid(reservationId), itemCode: 'LOT-2', name: 'Books', category: 'DOCUMENTS', quantity: 1,
    quantityUnit: 'box', unitWeightKg: 10, unitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 },
    unitVolumeM3: .001, totalWeightKg: 10, totalVolumeM3: .001, currentCellId: oid(cellAId), status: 'IN_STORAGE',
    images: [], createdBy: customerId, inboundMovementId: otherInbound._id, currentPlacementMovementId: otherInbound._id });
  ctx.state.items.push(other); ctx.state.movements.push(otherInbound);
  ctx.sourceCell.usedWeightKg = 50; ctx.sourceCell.usedVolumeM3 = .031; ctx.reservation.usedCapacityM3 = .031;
  await service.relocate(itemId, ctx.body, ctx.staff);
  assert.equal(ctx.allocations.get(cellAId).status, 'OCCUPIED');
  assert.equal(ctx.sourceCell.usedWeightKg, 10);
});

test('destination with another inbound lot remains reconciled for later relocation', async t => {
  const ctx = setup(t, { sharedRack: true });
  await service.relocate(itemId, ctx.body, ctx.staff);
  const secondId = oid('507f1f77bcf86cd799439132');
  const secondInboundId = oid('507f1f77bcf86cd799439131');
  const secondInbound = { ...makeInbound({ _id: secondInboundId, itemId: secondId, destinationCellId: oid(cellBId), quantity: 1,
    quantityUnit: 'box', actualUnitWeightKg: 10, actualTotalWeightKg: 10,
    actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: 1 }, actualTotalVolumeM3: .01 }),
    itemId: secondId, _id: secondInboundId };
  const other = new Item({ _id: secondId, facilityId: oid(facilityId), customerId, managedReservationId: oid(reservationId),
    itemCode: 'LOT-2', name: 'Books', category: 'DOCUMENTS', quantity: 1, quantityUnit: 'box', unitWeightKg: 10,
    unitDimensionsM: { widthM: .1, depthM: .1, heightM: 1 }, unitVolumeM3: .01, totalWeightKg: 10, totalVolumeM3: .01,
    currentCellId: oid(cellBId), status: 'IN_STORAGE', images: [], createdBy: customerId,
    inboundMovementId: secondInboundId, currentPlacementMovementId: secondInboundId });
  ctx.state.items.push(other); ctx.state.movements.push(secondInbound);
  ctx.destinationCell.usedWeightKg = 50; ctx.destinationCell.usedVolumeM3 = .04; ctx.reservation.usedCapacityM3 = .04;
  ctx.allocations.get(cellBId).status = 'OCCUPIED';
  await service.relocate(itemId, { ...ctx.body, sourceCellId: cellBId, destinationCellId: cellCId,
    idempotencyKey: 'relocation-002' }, ctx.staff);
  assert.equal(ctx.destinationCell.usedWeightKg, 10);
  assert.equal(ctx.allocations.get(cellBId).status, 'OCCUPIED');
  assert.equal(ctx.reservation.usedCapacityM3, .04);
});

test('same idempotency key and payload replays; changed payload conflicts', async t => {
  const ctx = setup(t, { sharedRack: true });
  const first = await service.relocate(itemId, ctx.body, ctx.staff);
  const replay = await service.relocate(itemId, ctx.body, ctx.staff);
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  await assert.rejects(service.relocate(itemId, { ...ctx.body, relocationNote: 'Different move' }, ctx.staff),
    { status: 409, message: /different relocation payload/ });
  assert.equal(ctx.state.movements.filter(row => row.type === 'RELOCATION').length, 1);
});

test('a different key cannot relocate again from a stale source and same source equals destination is rejected', async t => {
  const ctx = setup(t, { sharedRack: true });
  await service.relocate(itemId, ctx.body, ctx.staff);
  await assert.rejects(service.relocate(itemId, { ...ctx.body, idempotencyKey: 'relocation-new-key' }, ctx.staff), { status: 409 });
  await assert.rejects(service.relocate(itemId, { ...ctx.body, sourceCellId: cellBId, destinationCellId: cellBId,
    idempotencyKey: 'relocation-same-cell' }, ctx.staff), { status: 400 });
});

test('concurrent same-key relocation attempts write one movement and move counters once', async t => {
  const ctx = setup(t, { sharedRack: true });
  const results = await Promise.all([service.relocate(itemId, ctx.body, ctx.staff), service.relocate(itemId, ctx.body, ctx.staff)]);
  assert.equal(results.filter(row => !row.idempotentReplay).length, 1);
  assert.equal(results.filter(row => row.idempotentReplay).length, 1);
  assert.equal(ctx.sourceCell.usedWeightKg, 0); assert.equal(ctx.destinationCell.usedWeightKg, 40);
  assert.equal(ctx.state.movements.filter(row => row.type === 'RELOCATION').length, 1);
});

test('movement save failure rolls back Cells, Item placement, allocations and audit', async t => {
  const ctx = setup(t, { sharedRack: true, movementFailure: true });
  await assert.rejects(service.relocate(itemId, ctx.body, ctx.staff), { status: 500 });
  assert.equal(ctx.item.status, 'IN_STORAGE'); assert.equal(String(ctx.item.currentCellId), cellAId);
  assert.equal(ctx.sourceCell.usedWeightKg, 40); assert.equal(ctx.destinationCell.usedWeightKg, 0);
  assert.equal(ctx.allocations.get(cellAId).status, 'OCCUPIED');
  assert.equal(ctx.allocations.get(cellBId).status, 'RESERVED');
  assert.equal(ctx.reservation.usedCapacityM3, .03);
  assert.equal(ctx.state.movements.length, 1); assert.equal(ctx.state.audits.length, 0);
});

test('movement schema preserves INBOUND/OUTBOUND and enforces immutable placement lineage for RELOCATION', async () => {
  const inbound = new Movement(makeInbound());
  await inbound.validate();
  const relocation = new Movement({ ...makeRelocation(cellAId, cellBId, inboundId), _id: undefined });
  await relocation.validate();
  const invalid = new Movement({ ...makeRelocation(cellAId, cellAId, inboundId), _id: undefined });
  await assert.rejects(invalid.validate());
  const outbound = new Movement({ ...makeInbound(), _id: undefined, type: 'OUTBOUND', sourceCellId: oid(cellBId), destinationCellId: null,
    inspectionNote: undefined, handoverNote: 'Handed to customer', idempotencyKey: 'outbound-01' });
  await outbound.validate();
});



















