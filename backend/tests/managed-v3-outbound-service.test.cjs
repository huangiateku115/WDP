const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Types } = mongoose;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Projection = require('../dist/models/inventory-items/managed-v3-stock-projection.model').default;
const BatchPlacement = require('../dist/models/inventory-items/managed-v3-batch-placement.model').default;
const PhysicalUnit = require('../dist/models/inventory-items/managed-v3-physical-unit.model').default;
const Footprint = require('../dist/models/inventory-items/managed-v3-footprint.model').default;
const Request = require('../dist/models/inventory-items/managed-v3-outbound-request.model').default;
const Event = require('../dist/models/inventory-items/managed-v3-outbound-event.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Topology = require('../dist/models/warehouse-map/managed-v3-topology-certification.model').default;
const AccessSession = require('../dist/models/access/managed-access-session.model').default;
const Visit = require('../dist/models/access/managed-access-visit.model').default;
const accessService = require('../dist/services/access/managed-access.service');
const { replayManagedInventoryV3 } = require('../dist/services/inventory-items/managed-inventory-v3-ledger.service');
const { ManagedInventoryV3OutboundService, ManagedV3OutboundError } = require('../dist/services/inventory-items/managed-inventory-v3-outbound.service');

const query = value => ({ session() { return this; }, select() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return this; }, exec: async () => typeof value === 'function' ? value() : value });

function registeredFixture() {
  const itemId = new Types.ObjectId(), reservationId = new Types.ObjectId(), customerId = new Types.ObjectId(), facilityId = new Types.ObjectId();
  const item = { _id: itemId, customerId, facilityId, managedReservationId: reservationId, inventorySchemaVersion: 3, managedV3Revision: 0,
    status: 'REGISTERED', currentCellId: null, unitDimensionsM: { widthM: 0.2, depthM: 0.2, heightM: 0.2 }, quantityUnit: 'box' };
  const reservation = { _id: reservationId, customerId, facilityId, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3,
    status: 'ACTIVE', startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 60_000), allocatedCellIds: [] };
  const facility = { _id: facilityId, status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] };
  return { item, reservation, facility, actor: { _id: customerId, role: 'CUSTOMER' } };
}

function mockEmptyReads(t, fixture) {
  t.mock.method(Item, 'findOne', () => query(fixture.item));
  t.mock.method(Reservation, 'findOne', () => query(fixture.reservation));
  t.mock.method(Facility, 'findOne', () => query(fixture.facility));
  t.mock.method(Movement, 'find', () => query([]));
  t.mock.method(Projection, 'findOne', () => query(null));
  t.mock.method(BatchPlacement, 'find', () => query([]));
  t.mock.method(PhysicalUnit, 'find', () => query([]));
  t.mock.method(Footprint, 'find', () => query([]));
  t.mock.method(Request, 'find', () => query([]));
  t.mock.method(Event, 'find', () => query([]));
}

test('Customer V3 context returns explicit zero stock for a REGISTERED SKU without inventing a Projection or placement', async t => {
  const fixture = registeredFixture(); mockEmptyReads(t, fixture);
  const result = await ManagedInventoryV3OutboundService.context(String(fixture.item._id), fixture.actor);
  assert.deepEqual({ onHand: result.stock.onHandQuantity, held: result.stock.heldQuantity, available: result.stock.availableQuantity }, { onHand: 0, held: 0, available: 0 });
  assert.deepEqual(result.stock.byBatch, []); assert.deepEqual(result.stock.byPhysicalUnit, []); assert.equal(result.reconciliation, 'NO_PHYSICAL_INBOUND');
});

test('Customer V3 context reconciles a one-Cell A1 PhysicalUnit through identity, receipt and Footprint records without reading cellIds from the Unit model', async t => {
  const f = registeredFixture(), cellId = new Types.ObjectId(), unitId = new Types.ObjectId(), topologyId = new Types.ObjectId(), movementId = new Types.ObjectId();
  f.item.status = 'IN_STORAGE';
  const pose = { xStartM: 0.1, yStartM: 0.2, rotationDeg: 0 };
  const dimensionsM = { widthM: 0.4, depthM: 0.3, heightM: 0.2 };
  const movement = { _id: movementId, itemId: f.item._id, managedReservationId: f.reservation._id, customerId: f.actor._id, facilityId: f.item.facilityId,
    schemaVersion: 3, performedAt: new Date(), quantity: 1, actualUnitWeightKg: 5, actualTotalWeightKg: 5, actualUnitDimensionsM: dimensionsM, actualTotalVolumeM3: 0.024,
    v3Effect: { action: 'ADD', itemKind: 'A1_PHYSICAL_UNIT', operationId: 'a1-inbound', ledgerRevision: 1, topologyCertificationId: topologyId, topologyRevision: 1,
      destination: [{ physicalUnitId: unitId, cellId, quantity: 1, quantityUnit: 'unit', weightKg: 5, volumeM3: 0.024, supportReactionKg: 5, occupiedVolumeM3: 0.024,
        topologyCertificationId: topologyId, topologyRevision: 1, pose }] } };
  const replay = replayManagedInventoryV3(f.item, [movement]);
  const unit = { _id: unitId, skuId: f.item._id, reservationId: f.reservation._id, customerId: f.actor._id, facilityId: f.item.facilityId,
    serial: 'A1-01', state: 'PLACED', sourceMovementId: movementId, weightKg: 5, dimensionsM, volumeM3: 0.024, currentPose: pose };
  const footprint = { physicalUnitId: unitId, reservationId: f.reservation._id, customerId: f.actor._id, facilityId: f.item.facilityId,
    cells: [{ cellId, topologyCertificationId: topologyId, supportReactionKg: 5, occupiedVolumeM3: 0.024, topologyRevision: 1 }], pose,
    topologyCertificationId: topologyId, topologyRevision: 1, sourceMovementId: movementId, state: 'ACTIVE' };
  let footprints = [footprint];
  t.mock.method(Item, 'findOne', () => query(f.item));
  t.mock.method(Reservation, 'findOne', () => query(f.reservation));
  t.mock.method(Facility, 'findOne', () => query(f.facility));
  t.mock.method(BatchPlacement, 'find', () => query([]));
  t.mock.method(Request, 'find', () => query([]));
  t.mock.method(Event, 'find', () => query([]));
  t.mock.method(Movement, 'find', () => query([movement]));
  t.mock.method(Projection, 'findOne', () => query(replay));
  t.mock.method(PhysicalUnit, 'find', () => query([unit]));
  t.mock.method(Footprint, 'find', () => query(() => footprints));
  const result = await ManagedInventoryV3OutboundService.context(String(f.item._id), f.actor);
  assert.equal(result.stock.onHandQuantity, 1); assert.equal(result.stock.byPhysicalUnit[0].quantity, 1);
  footprints = [];
  await assert.rejects(ManagedInventoryV3OutboundService.context(String(f.item._id), f.actor),
    error => error instanceof ManagedV3OutboundError && error.code === 'V3_FOOTPRINT_RECONCILIATION_UNKNOWN');
});

test('Customer V3 Create rejects zero stock before writing an Outbound Request or Event', async t => {
  const fixture = registeredFixture(); mockEmptyReads(t, fixture);
  let requestWrites = 0, eventWrites = 0;
  t.mock.method(Event, 'findOne', () => query(null));
  t.mock.method(Item, 'findOneAndUpdate', () => query({ ...fixture.item, managedV3Revision: 1 }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async callback => callback({}), endSession: async () => {} }));
  t.mock.method(Request.prototype, 'save', async () => { requestWrites++; });
  t.mock.method(Event.prototype, 'save', async () => { eventWrites++; });
  await assert.rejects(ManagedInventoryV3OutboundService.create(String(fixture.item._id), { itemKind: 'A2_BATCH', requestedQuantity: 1 }, 'zero-stock-key-01', fixture.actor),
    error => error instanceof ManagedV3OutboundError && error.code === 'OUTBOUND_NO_PHYSICAL_STOCK' && error.status === 409);
  assert.equal(requestWrites, 0); assert.equal(eventWrites, 0);
});

test('Movement history without its required Stock Projection is a reconciliation conflict, never zero stock', async t => {
  const fixture = registeredFixture();
  const cellId = new Types.ObjectId(), topologyCertificationId = new Types.ObjectId();
  t.mock.method(Item, 'findOne', () => query(fixture.item));
  t.mock.method(Reservation, 'findOne', () => query(fixture.reservation));
  t.mock.method(Facility, 'findOne', () => query(fixture.facility));
  t.mock.method(Movement, 'find', () => query([{ _id: new Types.ObjectId(), schemaVersion: 3, itemId: fixture.item._id, customerId: fixture.item.customerId,
    managedReservationId: fixture.item.managedReservationId, facilityId: fixture.item.facilityId, performedAt: new Date(), quantity: 1, actualTotalWeightKg: 1, actualTotalVolumeM3: 0.001,
    v3Effect: { action: 'ADD', itemKind: 'A2_BATCH', operationId: 'receipt-1', ledgerRevision: 1, destination: [{ batchId: 'B1', cellId, quantity: 1, quantityUnit: 'box',
      weightKg: 1, volumeM3: 0.001, receiptMovementId: undefined, topologyCertificationId, topologyRevision: 1 }] } } ]));
  t.mock.method(Projection, 'findOne', () => query(null));
  t.mock.method(BatchPlacement, 'find', () => query([]));
  t.mock.method(PhysicalUnit, 'find', () => query([]));
  t.mock.method(Footprint, 'find', () => query([]));
  t.mock.method(Request, 'find', () => query([]));
  t.mock.method(Event, 'find', () => query([]));
  await assert.rejects(ManagedInventoryV3OutboundService.context(String(fixture.item._id), fixture.actor),
    error => error instanceof ManagedV3OutboundError && error.code === 'V3_PROJECTION_MISMATCH');
});

function a2ServiceFixture(t) {
  const skuId = new Types.ObjectId(), reservationId = new Types.ObjectId(), customerId = new Types.ObjectId(), facilityId = new Types.ObjectId();
  const cellId = new Types.ObjectId(), rackId = new Types.ObjectId(), topologyId = new Types.ObjectId(), receiptId = new Types.ObjectId();
  const sessionId = new Types.ObjectId(), visitId = new Types.ObjectId();
  const now = new Date();
  const item = { _id: skuId, customerId, facilityId, managedReservationId: reservationId, inventorySchemaVersion: 3, managedV3Revision: 0,
    status: 'IN_STORAGE', currentCellId: null, currentPlacementMovementId: null, quantityUnit: 'box', unitDimensionsM: { widthM: 0.2, depthM: 0.2, heightM: 0.2 } };
  const reservation = { _id: reservationId, customerId, facilityId, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, status: 'ACTIVE',
    startDate: new Date(now.getTime() - 86_400_000), endDate: new Date(now.getTime() + 86_400_000), handoverAt: now,
    allocatedCellIds: [cellId], inventoryVersion: 0, usedCapacityM3: 1 };
  const facility = { _id: facilityId, status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] };
  const receipt = { _id: receiptId, itemId: skuId, managedReservationId: reservationId, customerId, facilityId, schemaVersion: 3,
    performedAt: new Date(now.getTime() - 60_000), quantity: 10, quantityUnit: 'box', actualUnitWeightKg: 1, actualTotalWeightKg: 10,
    actualUnitDimensionsM: item.unitDimensionsM, actualTotalVolumeM3: 1,
    v3Effect: { action: 'ADD', itemKind: 'A2_BATCH', operationId: 'inbound-1', ledgerRevision: 1, topologyCertificationId: topologyId,
      topologyRevision: 1, destination: [{ itemKind: 'A2_BATCH', batchId: 'B1', cellId, quantity: 10, quantityUnit: 'box', weightKg: 10, volumeM3: 1,
        topologyCertificationId: topologyId, topologyRevision: 1 }] } };
  const movements = [receipt];
  const projection = replayManagedInventoryV3(item, movements);
  const placement = { skuId, reservationId, customerId, facilityId, batchId: 'B1', cellId, quantity: 10, quantityUnit: 'box', weightKg: 10, volumeM3: 1,
    topologyCertificationId: topologyId, topologyRevision: 1, sourceMovementId: receiptId, receiptMovementId: receiptId, state: 'ACTIVE', revision: 0,
    async save() { state.placements[0] = { ...this }; return this; } };
  const cell = { _id: cellId, facilityId, rackId, levelNumber: 1, maxWeightKg: 100, usedWeightKg: 10, usedVolumeM3: 1, managedInventoryRevision: 0 };
  const rack = { _id: rackId, facilityId, maxWeightKgPerLevel: 100 };
  const allocation = { cellId, reservationId, customerId, facilityId, status: 'OCCUPIED' };
  const topology = { _id: topologyId, facilityId, rackId, levelNumber: 1, revision: 1, certificationState: 'CERTIFIED', provenance: 'FACILITY_SURVEY',
    supportSurfaceId: 'surface-1', certifiedAt: new Date(now.getTime() - 86_400_000), expiresAt: new Date(now.getTime() + 86_400_000), cells: [{ cellId }] };
  const accessSession = { _id: sessionId, customerId, reservationId, facilityId, visitId, status: 'ACTIVE', startedAt: new Date(now.getTime() - 60_000),
    expiresAt: new Date(now.getTime() + 30 * 60_000), revision: 0, allowedPurposes: ['OUTBOUND'], allowedCellIds: [cellId] };
  const visit = { _id: visitId, customerId, reservationId, facilityId, purpose: 'OUTBOUND', status: 'CHECKED_IN' };
  const state = { item, reservation, facility, cell, rack, topology, accessSession, visit, movements, projection, placements: [placement], requests: [], events: [] };
  const snapshot = () => ({ itemRevision: state.item.managedV3Revision,
    cell: { usedWeightKg: state.cell.usedWeightKg, usedVolumeM3: state.cell.usedVolumeM3, managedInventoryRevision: state.cell.managedInventoryRevision },
    reservation: { usedCapacityM3: state.reservation.usedCapacityM3, inventoryVersion: state.reservation.inventoryVersion },
    movements: [...state.movements], projection: state.projection, placement: { quantity: state.placements[0].quantity, weightKg: state.placements[0].weightKg,
      volumeM3: state.placements[0].volumeM3, state: state.placements[0].state, revision: state.placements[0].revision, sourceMovementId: state.placements[0].sourceMovementId },
    requests: [...state.requests], events: [...state.events] });
  const restore = before => { state.item.managedV3Revision = before.itemRevision; Object.assign(state.cell, before.cell); Object.assign(state.reservation, before.reservation);
    state.movements = before.movements; state.projection = before.projection; Object.assign(state.placements[0], before.placement); state.requests = before.requests; state.events = before.events; };
  const get = (v) => query(() => v);
  t.mock.method(Item, 'findOne', () => get(state.item));
  t.mock.method(Item, 'findOneAndUpdate', () => query(() => { state.item.managedV3Revision += 1; return state.item; }));
  t.mock.method(Item, 'find', () => get([state.item]));
  t.mock.method(Reservation, 'findOne', () => get(state.reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, update) => query(() => { state.reservation.usedCapacityM3 += update.$inc?.usedCapacityM3 ?? 0; state.reservation.inventoryVersion += update.$inc?.inventoryVersion ?? 0; return state.reservation; }));
  t.mock.method(Facility, 'findOne', () => get(state.facility));
  t.mock.method(Movement, 'find', () => get(state.movements));
  t.mock.method(Movement, 'countDocuments', () => get(state.movements.length));
  t.mock.method(Movement, 'create', async docs => { state.movements.push(...docs); return docs; });
  t.mock.method(Projection, 'findOne', () => get(state.projection));
  t.mock.method(Projection, 'updateOne', (filter, update) => query(() => { if (state.failProjectionUpdate) return { matchedCount: 0 }; state.projection = update.$set; return { matchedCount: 1 }; }));
  t.mock.method(BatchPlacement, 'find', () => get(state.placements));
  t.mock.method(BatchPlacement, 'findOne', () => get(state.placements[0]));
  t.mock.method(PhysicalUnit, 'find', () => get([]));
  t.mock.method(Footprint, 'find', () => get([]));
  t.mock.method(Request, 'find', () => get(state.requests.map(row => row.toObject())));
  t.mock.method(Request, 'findOne', filter => get(state.requests.find(row => String(row._id) === String(filter._id ?? row._id) && String(row.customerId) === String(filter.customerId ?? row.customerId)) ?? null));
  t.mock.method(Request, 'findOneAndUpdate', (filter, update) => query(() => { const row = state.requests.find(candidate => String(candidate._id) === String(filter._id) && candidate.version === filter.version && candidate.state === filter.state); if (!row) return null; Object.assign(row, update.$set); row.version += update.$inc.version; return row; }));
  t.mock.method(Request.prototype, 'save', async function () { await this.validate(); state.requests.push(this); return this; });
  t.mock.method(Event, 'find', () => get(state.events.map(row => row.toObject())));
  t.mock.method(Event, 'findOne', filter => get(state.events.find(row => row.operation === filter.operation && row.idempotencyKey === filter.idempotencyKey &&
    (!filter.actorId || String(row.actorId) === String(filter.actorId))) ?? null));
  t.mock.method(Event.prototype, 'save', async function () { await this.validate(); state.events.push(this); return this; });
  t.mock.method(Cell, 'find', () => get([state.cell]));
  t.mock.method(Cell, 'findOneAndUpdate', (filter, update) => query(() => { state.cell.usedWeightKg += update.$inc.usedWeightKg; state.cell.usedVolumeM3 += update.$inc.usedVolumeM3; return state.cell; }));
  t.mock.method(Rack, 'find', () => get([state.rack]));
  t.mock.method(Allocation, 'findOne', () => get(allocation));
  t.mock.method(Allocation, 'find', () => get([allocation]));
  t.mock.method(Topology, 'findOne', () => get(state.topology));
  t.mock.method(AccessSession, 'findOne', () => get(state.accessSession));
  t.mock.method(AccessSession, 'findById', () => get(state.accessSession));
  t.mock.method(Visit, 'findOne', () => get(state.visit));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: async callback => { const before = snapshot(); try { return await callback({}); } catch (error) { restore(before); throw error; } }, endSession: async () => {} }));
  t.mock.method(accessService, 'assertManagedAccessSessionScope', async input => { assert.equal(input.purpose, 'OUTBOUND'); assert.deepEqual(input.cellIds.map(String), [String(cellId)]); });
  return { state, actor: { _id: customerId, role: 'CUSTOMER' }, ids: { skuId, reservationId, customerId, facilityId, cellId, topologyId, receiptId, sessionId } };
}

test('direct service flow creates a hold, previews and confirms one A2 partial REMOVE transactionally; exact replay does not duplicate it', async t => {
  const { state, actor, ids } = a2ServiceFixture(t);
  const created = await ManagedInventoryV3OutboundService.create(String(ids.skuId), { itemKind: 'A2_BATCH', requestedQuantity: 3 }, 'outbound-create-0001', actor);
  assert.equal(created.data.state, 'PENDING');
  let stock = await ManagedInventoryV3OutboundService.stock(String(ids.skuId), actor);
  assert.deepEqual([stock.onHandQuantity, stock.heldQuantity, stock.availableQuantity], [10, 3, 7]);
  const request = state.requests[0], preview = await ManagedInventoryV3OutboundService.preview(String(request._id), { accessSessionId: String(ids.sessionId), sessionRevision: 0 }, actor);
  assert.equal(preview.outboundPlan.quantity, 3); assert.equal(preview.ledgerRevision, 1);
  const payload = { accessSessionId: String(ids.sessionId), sessionRevision: 0, physicalRemovalConfirmed: true, attestation: 'Customer confirms physical removal of the allocated items.' };
  const confirmed = await ManagedInventoryV3OutboundService.confirm(String(request._id), payload, 'outbound-confirm-0001', '"0"', actor);
  assert.equal(confirmed.data.state, 'CONFIRMED'); assert.equal(state.movements.filter(row => row.v3Effect?.action === 'REMOVE').length, 1);
  assert.equal(state.movements.at(-1).v3Effect.source[0].receiptMovementId.toString(), ids.receiptId.toString());
  assert.deepEqual([state.placements[0].quantity, state.placements[0].weightKg, state.placements[0].volumeM3], [7, 7, 0.7]);
  assert.deepEqual([state.cell.usedWeightKg, state.cell.usedVolumeM3, state.reservation.usedCapacityM3], [7, 0.7, 0.7]);
  stock = await ManagedInventoryV3OutboundService.stock(String(ids.skuId), actor);
  assert.deepEqual([stock.onHandQuantity, stock.heldQuantity, stock.availableQuantity], [7, 0, 7]);
  assert.equal(state.projection.onHandQuantity, 7); assert.equal(state.projection.byBatch[0].quantity, 7);
  assert.deepEqual(state.events.map(row => row.operation), ['CREATE', 'CONFIRM']);
  const replay = await ManagedInventoryV3OutboundService.confirm(String(request._id), payload, 'outbound-confirm-0001', '"0"', actor);
  assert.equal(replay.replayed, true); assert.equal(state.movements.filter(row => row.v3Effect?.action === 'REMOVE').length, 1);
});

test('direct service Cancel releases its hold without creating a REMOVE Movement', async t => {
  const { state, actor, ids } = a2ServiceFixture(t);
  const created = await ManagedInventoryV3OutboundService.create(String(ids.skuId), { itemKind: 'A2_BATCH', requestedQuantity: 3 }, 'outbound-create-0002', actor);
  const requestId = created.data.requestId;
  const cancelled = await ManagedInventoryV3OutboundService.cancel(requestId, '"0"', 'outbound-cancel-0001', actor);
  assert.equal(cancelled.data.state, 'CANCELLED'); assert.equal(state.movements.filter(row => row.v3Effect?.action === 'REMOVE').length, 0);
  const stock = await ManagedInventoryV3OutboundService.stock(String(ids.skuId), actor);
  assert.deepEqual([stock.onHandQuantity, stock.heldQuantity, stock.availableQuantity], [10, 0, 10]);
  assert.deepEqual(state.events.map(row => row.operation), ['CREATE', 'CANCEL']);
});

test('direct service failure after REMOVE append rolls back simulated movement, placement, Cell, Reservation, projection and request state', async t => {
  const { state, actor, ids } = a2ServiceFixture(t);
  const created = await ManagedInventoryV3OutboundService.create(String(ids.skuId), { itemKind: 'A2_BATCH', requestedQuantity: 3 }, 'outbound-create-rollback', actor);
  const request = state.requests[0]; state.failProjectionUpdate = true;
  await assert.rejects(ManagedInventoryV3OutboundService.confirm(created.data.requestId,
    { accessSessionId: String(ids.sessionId), sessionRevision: 0, physicalRemovalConfirmed: true, attestation: 'Customer confirms physical removal of the allocated items.' },
    'outbound-confirm-rollback', '"0"', actor), error => error instanceof ManagedV3OutboundError && error.code === 'STALE_V3_PROJECTION');
  assert.equal(state.movements.filter(row => row.v3Effect?.action === 'REMOVE').length, 0);
  assert.deepEqual([state.placements[0].quantity, state.placements[0].weightKg, state.placements[0].volumeM3], [10, 10, 1]);
  assert.deepEqual([state.cell.usedWeightKg, state.cell.usedVolumeM3, state.reservation.usedCapacityM3], [10, 1, 1]);
  assert.equal(state.projection.onHandQuantity, 10); assert.equal(request.state, 'PENDING');
  assert.deepEqual(state.events.map(row => row.operation), ['CREATE']);
});
