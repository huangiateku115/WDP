const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Request = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const Event = require('../dist/models/inventory-items/inventory-inbound-request-event.model').default;
const Inspection = require('../dist/models/inventory-items/repeated-inbound-inspection.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const { RepeatedInboundOperationsService: service } = require('../dist/services/inventory-items/repeated-inbound-operations.service');

class Query {
  constructor(value) { this.value = value; }
  session() { return this; }
  select() { return this; }
  lean() { return this; }
  sort() { return this; }
  skip() { return this; }
  limit() { return this; }
  exec() { return Promise.resolve(this.value); }
}

test('accepted Staff inspection atomically snapshots evidence references and replays the committed event', async t => {
  const env = { nodeEnv: process.env.NODE_ENV, gate: process.env.MI06_REPEATED_INBOUND_ENABLED };
  process.env.NODE_ENV = 'test'; process.env.MI06_REPEATED_INBOUND_ENABLED = 'true';
  t.after(() => {
    if (env.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env.nodeEnv;
    if (env.gate === undefined) delete process.env.MI06_REPEATED_INBOUND_ENABLED; else process.env.MI06_REPEATED_INBOUND_ENABLED = env.gate;
  });
  const oid = () => new mongoose.Types.ObjectId();
  const ids = { request: oid(), item: oid(), reservation: oid(), facility: oid(), customer: oid(), staff: oid(), cell: oid() };
  const now = new Date();
  const request = { _id: ids.request, itemId: ids.item, reservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    requestedQuantity: 4, quantityUnit: 'box', declaredUnitWeightKg: 2, declaredUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 },
    state: 'PENDING_INSPECTION', custodyState: 'NOT_TAKEN', currentInspectionAttemptId: null, acceptedEvidenceSnapshotId: null,
    confirmedMovementId: null, version: 0, updatedAt: now, save: async function () { this.version += 1; return this; } };
  const item = { _id: ids.item, managedReservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    status: 'IN_STORAGE', currentCellId: ids.cell, __v: 0 };
  const reservation = { _id: ids.reservation, status: 'ACTIVE', startDate: new Date(now.getTime() - 60_000), endDate: new Date(now.getTime() + 60_000), inventoryVersion: 0, activeClosureRequestId: null };
  const events = [], snapshots = [];
  const session = { withTransaction: async work => work(session), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Request, 'findOne', () => new Query(request));
  t.mock.method(Request.prototype, 'save', async function () { this.version += 1; this.updatedAt = new Date(); return this; });
  t.mock.method(Event, 'findOne', filter => new Query(events.find(e => e.operation === filter.operation && e.idempotencyKey === filter.idempotencyKey && String(e.actorId) === String(filter.actorId)) ?? null));
  t.mock.method(Event.prototype, 'save', async function () { events.push(this); return this; });
  t.mock.method(Inspection, 'countDocuments', () => new Query(0));
  t.mock.method(Inspection.prototype, 'save', async function () { snapshots.push(this); return this; });
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => { assert.equal(filter.activeClosureRequestId, null, 'accepted inspection requires closure marker absent in CAS'); reservation.inventoryVersion += 1; return new Query(reservation); });
  t.mock.method(Allocation, 'countDocuments', () => new Query(1));
  t.mock.method(Cell, 'countDocuments', () => new Query(1));
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', (_filter, update) => { item.__v += update.$inc.__v; return new Query(item); });
  const actor = { _id: ids.staff, role: 'FACILITY_STAFF', assignedFacilityId: ids.facility };
  const input = { decision: 'ACCEPTED', receivedQuantity: 4, actualUnitWeightKg: 2.25,
    actualUnitDimensionsM: { widthM: .2, depthM: .2, heightM: .2 }, compatibleCellIds: [String(ids.cell)],
    packingLayoutVerified: true, custodyTaken: true, note: 'Goods checked and held', evidenceUploadIds: [], inspectionKey: 'inspection-key-001' };
  const first = await service.inspect(String(ids.request), input, '"0"', actor);
  const replay = await service.inspect(String(ids.request), input, '"0"', actor);
  assert.equal(first.request.state, 'ACCEPTED_PENDING_CONFIRMATION');
  assert.equal(first.request.version, 1);
  assert.equal(first.inspection.attempt, 1);
  assert.equal(String(request.acceptedEvidenceSnapshotId), String(snapshots[0]._id));
  assert.equal(snapshots.length, 1);
  assert.equal(events.length, 1);
  assert.deepEqual(replay, events[0].resultSnapshot);
});

test('ACCEPTED inspection fails closed while closure is pending and writes no request, evidence or event', async t => {
  const env = { nodeEnv: process.env.NODE_ENV, gate: process.env.MI06_REPEATED_INBOUND_ENABLED };
  process.env.NODE_ENV = 'test'; process.env.MI06_REPEATED_INBOUND_ENABLED = 'true';
  t.after(() => {
    if (env.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env.nodeEnv;
    if (env.gate === undefined) delete process.env.MI06_REPEATED_INBOUND_ENABLED; else process.env.MI06_REPEATED_INBOUND_ENABLED = env.gate;
  });
  const oid = () => new mongoose.Types.ObjectId();
  const ids = { request: oid(), item: oid(), reservation: oid(), facility: oid(), customer: oid(), staff: oid(), cell: oid() };
  let requestSaves = 0, inspectionSaves = 0, eventSaves = 0;
  const request = { _id: ids.request, itemId: ids.item, reservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    requestedQuantity: 2, state: 'PENDING_INSPECTION', custodyState: 'NOT_TAKEN', version: 0,
    save: async function () { requestSaves++; return this; } };
  const item = { _id: ids.item, managedReservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    status: 'IN_STORAGE', currentCellId: ids.cell, __v: 0 };
  const reservation = { _id: ids.reservation, status: 'ACTIVE', startDate: new Date(Date.now() - 60_000),
    endDate: new Date(Date.now() + 60_000), inventoryVersion: 5, activeClosureRequestId: oid() };
  const session = { withTransaction: async work => work(session), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Request, 'findOne', () => new Query(request));
  t.mock.method(Event, 'findOne', () => new Query(null));
  t.mock.method(Event.prototype, 'save', async function () { eventSaves++; return this; });
  t.mock.method(Inspection, 'countDocuments', () => new Query(0));
  t.mock.method(Inspection.prototype, 'save', async function () { inspectionSaves++; return this; });
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', (_filter, update) => { item.__v += update.$inc.__v; return new Query(item); });
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.activeClosureRequestId, null, 'marker absence and version CAS are one conditional write');
    return new Query(null);
  });
  const input = { decision: 'ACCEPTED', receivedQuantity: 2, actualUnitWeightKg: 1,
    actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, compatibleCellIds: [String(ids.cell)],
    packingLayoutVerified: true, custodyTaken: true, note: 'Accepted before closure check', evidenceUploadIds: [], inspectionKey: 'closure-accept-001' };
  await assert.rejects(service.inspect(String(ids.request), input, '"0"',
    { _id: ids.staff, role: 'FACILITY_STAFF', assignedFacilityId: ids.facility }),
  error => error.status === 409 && error.code === 'INBOUND_REQUEST_INELIGIBLE');
  assert.equal(request.state, 'PENDING_INSPECTION'); assert.equal(requestSaves, 0);
  assert.equal(inspectionSaves, 0); assert.equal(eventSaves, 0);
});

test('REJECTED inspection with newly taken custody still enters RETURN_PENDING during closure', async t => {
  const previous = { nodeEnv: process.env.NODE_ENV, gate: process.env.MI06_REPEATED_INBOUND_ENABLED };
  process.env.NODE_ENV = 'test'; process.env.MI06_REPEATED_INBOUND_ENABLED = 'true';
  t.after(() => {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.gate === undefined) delete process.env.MI06_REPEATED_INBOUND_ENABLED; else process.env.MI06_REPEATED_INBOUND_ENABLED = previous.gate;
  });
  const oid = () => new mongoose.Types.ObjectId();
  const ids = { request: oid(), item: oid(), reservation: oid(), facility: oid(), customer: oid(), staff: oid() };
  const request = { _id: ids.request, itemId: ids.item, reservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    requestedQuantity: 2, state: 'PENDING_INSPECTION', custodyState: 'NOT_TAKEN', version: 0, updatedAt: new Date(),
    save: async function () { this.version++; return this; } };
  const item = { _id: ids.item, managedReservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    status: 'IN_STORAGE', __v: 0 };
  const reservation = { _id: ids.reservation, customerId: ids.customer, facilityId: ids.facility, serviceType: 'MANAGED_INVENTORY',
    status: 'ACTIVE', inventoryVersion: 7, activeClosureRequestId: oid() };
  const events = [], inspections = [];
  const session = { withTransaction: async work => work(session), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Request, 'findOne', () => new Query(request));
  t.mock.method(Event, 'findOne', () => new Query(null));
  t.mock.method(Event.prototype, 'save', async function () { events.push(this); return this; });
  t.mock.method(Inspection, 'countDocuments', () => new Query(0));
  t.mock.method(Inspection.prototype, 'save', async function () { inspections.push(this); return this; });
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', (_filter, update) => { item.__v += update.$inc.__v; return new Query(item); });
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.activeClosureRequestId, undefined, 'existing rejection/return resolution remains allowed during closure');
    reservation.inventoryVersion++; return new Query(reservation);
  });
  const result = await service.inspect(String(ids.request), { decision: 'REJECTED', receivedQuantity: 2, actualUnitWeightKg: 1,
    actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, compatibleCellIds: [], packingLayoutVerified: true,
    custodyTaken: true, note: 'Rejected; returned to custody workflow', evidenceUploadIds: [], inspectionKey: 'closure-reject-001' }, '"0"',
  { _id: ids.staff, role: 'FACILITY_STAFF', assignedFacilityId: ids.facility });
  assert.equal(result.request.state, 'RETURN_PENDING'); assert.equal(result.request.custodyState, 'IN_CUSTODY');
  assert.equal(inspections.length, 1); assert.equal(events.length, 1);
});

test('inspection remains unavailable with gate OFF; the existing RETURN_COMPLETED path is the only Staff resolution path', async t => {
  const previous = process.env.MI06_REPEATED_INBOUND_ENABLED;
  process.env.NODE_ENV = 'test'; process.env.MI06_REPEATED_INBOUND_ENABLED = 'false';
  t.after(() => { if (previous === undefined) delete process.env.MI06_REPEATED_INBOUND_ENABLED; else process.env.MI06_REPEATED_INBOUND_ENABLED = previous; });
  await assert.rejects(service.inspect('507f1f77bcf86cd799439011', {}, '"0"',
    { _id: new mongoose.Types.ObjectId(), role: 'FACILITY_STAFF', assignedFacilityId: new mongoose.Types.ObjectId() }),
  error => error.status === 503 && error.code === 'INBOUND_REQUEST_FEATURE_DISABLED');
});

test('repeated confirmation cannot append ADD movement while the closure marker is active', async t => {
  const previous = { nodeEnv: process.env.NODE_ENV, repeated: process.env.MI06_REPEATED_INBOUND_ENABLED,
    ledger: process.env.MI06_STOCK_LEDGER_WRITES_ENABLED };
  process.env.NODE_ENV = 'test'; process.env.MI06_REPEATED_INBOUND_ENABLED = 'true'; process.env.MI06_STOCK_LEDGER_WRITES_ENABLED = 'true';
  t.after(() => {
    for (const [name, value] of Object.entries({ NODE_ENV: previous.nodeEnv, MI06_REPEATED_INBOUND_ENABLED: previous.repeated,
      MI06_STOCK_LEDGER_WRITES_ENABLED: previous.ledger })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const oid = () => new mongoose.Types.ObjectId();
  const ids = { request: oid(), item: oid(), reservation: oid(), facility: oid(), customer: oid(), staff: oid(), cell: oid(), zone: oid() };
  const now = new Date();
  const request = { _id: ids.request, itemId: ids.item, reservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    requestedQuantity: 1, state: 'ACCEPTED_PENDING_CONFIRMATION', custodyState: 'IN_CUSTODY', acceptedEvidenceSnapshotId: oid(), version: 1 };
  const item = { _id: ids.item, customerId: ids.customer, managedReservationId: ids.reservation, facilityId: ids.facility,
    status: 'IN_STORAGE', currentCellId: ids.cell, __v: 0 };
  const reservation = { _id: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', startDate: new Date(now.getTime() - 60_000),
    endDate: new Date(now.getTime() + 60_000), inventoryVersion: 2, activeClosureRequestId: oid() };
  const cell = { _id: ids.cell, facilityId: ids.facility, zoneId: ids.zone };
  const session = { withTransaction: async work => work(session), endSession: async () => {} };
  let movementWrites = 0, cellCounterWrites = 0;
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Request, 'findOne', () => new Query(request));
  t.mock.method(Event, 'findOne', () => new Query(null));
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', (_filter, update) => { item.__v += update.$inc.__v; return new Query(item); });
  t.mock.method(Cell, 'findOne', () => new Query(cell));
  t.mock.method(Zone, 'findOneAndUpdate', () => new Query({ _id: ids.zone }));
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.activeClosureRequestId, null, 'closure marker absence is part of the same Reservation CAS');
    return new Query(null);
  });
  t.mock.method(Movement.prototype, 'save', async function () { movementWrites++; return this; });
  t.mock.method(Cell, 'findOneAndUpdate', () => { cellCounterWrites++; return new Query(cell); });
  await assert.rejects(service.confirm(String(ids.request), { destinationCellId: String(ids.cell), inspectionNote: 'confirm',
    idempotencyKey: 'closure-confirm-001' }, '"1"',
  { _id: ids.staff, role: 'FACILITY_STAFF', assignedFacilityId: ids.facility }),
  error => error.status === 409 && error.code === 'INBOUND_REQUEST_INELIGIBLE');
  assert.equal(movementWrites, 0); assert.equal(cellCounterWrites, 0);
});

test('return completion remains available with gate OFF and an active closure marker, using Item then Reservation fencing', async t => {
  const priorGate = process.env.MI06_REPEATED_INBOUND_ENABLED;
  process.env.NODE_ENV = 'test'; process.env.MI06_REPEATED_INBOUND_ENABLED = 'false';
  t.after(() => { if (priorGate === undefined) delete process.env.MI06_REPEATED_INBOUND_ENABLED; else process.env.MI06_REPEATED_INBOUND_ENABLED = priorGate; });
  const oid = () => new mongoose.Types.ObjectId();
  const ids = { request: oid(), item: oid(), reservation: oid(), facility: oid(), customer: oid(), staff: oid() };
  const request = { _id: ids.request, itemId: ids.item, reservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    state: 'RETURN_PENDING', custodyState: 'IN_CUSTODY', version: 3, updatedAt: new Date(),
    save: async function () { this.version += 1; return this; } };
  const item = { _id: ids.item, managedReservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    status: 'IN_STORAGE', __v: 0 };
  const reservation = { _id: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', inventoryVersion: 4,
    activeClosureRequestId: oid(), startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 60_000) };
  const events = [], session = { withTransaction: async work => work(session), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Request, 'findOne', () => new Query(request));
  t.mock.method(Request.prototype, 'save', async function () { this.version += 1; return this; });
  t.mock.method(Event, 'findOne', () => new Query(null));
  t.mock.method(Event.prototype, 'save', async function () { events.push(this); return this; });
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', (_filter, update) => { item.__v += update.$inc.__v; return new Query(item); });
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => {
    assert.equal(filter.activeClosureRequestId, undefined, 'return completion is allowed while closure is pending');
    reservation.inventoryVersion += 1; return new Query(reservation);
  });
  const result = await service.completeReturn(String(ids.request), { returnNote: 'Returned to owner' }, '"3"', 'return-key-0001',
    { _id: ids.staff, role: 'FACILITY_STAFF', assignedFacilityId: ids.facility });
  assert.equal(result.state, 'REJECTED'); assert.equal(result.custodyState, 'RETURNED');
  assert.equal(events.length, 1);
});

test('Staff confirmation appends canonical receipt movement and updates stock/capacity from legacy history', async t => {
  const env = { nodeEnv: process.env.NODE_ENV, repeated: process.env.MI06_REPEATED_INBOUND_ENABLED, ledger: process.env.MI06_STOCK_LEDGER_WRITES_ENABLED };
  process.env.NODE_ENV = 'test'; process.env.MI06_REPEATED_INBOUND_ENABLED = 'true'; process.env.MI06_STOCK_LEDGER_WRITES_ENABLED = 'true';
  t.after(() => {
    for (const [name, value] of Object.entries({ NODE_ENV: env.nodeEnv, MI06_REPEATED_INBOUND_ENABLED: env.repeated, MI06_STOCK_LEDGER_WRITES_ENABLED: env.ledger })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const oid = () => new mongoose.Types.ObjectId(), ids = { request: oid(), item: oid(), reservation: oid(), facility: oid(), customer: oid(), staff: oid(), cell: oid(), rack: oid(), zone: oid(), inbound: oid(), evidence: oid() };
  const now = new Date(), cell = { _id: ids.cell, facilityId: ids.facility, zoneId: ids.zone, rackId: ids.rack, code: 'C-1',
    dimensions: { widthM: .5, depthM: .5, usableHeightM: 1 }, maxWeightKg: 100, usedWeightKg: 40, usedVolumeM3: .03,
    levelNumber: 1, operationalStatus: 'AVAILABLE' };
  const request = { _id: ids.request, itemId: ids.item, reservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    requestedQuantity: 1, quantityUnit: 'box', declaredUnitWeightKg: 5, declaredUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 },
    state: 'ACCEPTED_PENDING_CONFIRMATION', custodyState: 'IN_CUSTODY', acceptedEvidenceSnapshotId: ids.evidence, version: 2,
    save: async function () { this.version += 1; return this; } };
  const item = { _id: ids.item, facilityId: ids.facility, customerId: ids.customer, managedReservationId: ids.reservation, quantityUnit: 'box', status: 'IN_STORAGE',
    currentCellId: ids.cell, currentPlacementMovementId: ids.inbound, inboundMovementId: ids.inbound, __v: 0, toObject() { return { ...this }; },
    save: async function () { return this; } };
  const reservation = { _id: ids.reservation, facilityId: ids.facility, customerId: ids.customer, serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE',
    startDate: new Date(now.getTime() - 60_000), endDate: new Date(now.getTime() + 60_000), allocatedCapacity: 1, usedCapacityM3: .03,
    allocatedCellIds: [ids.cell], inventoryVersion: 0, save: async function () { return this; } };
  const inbound = { _id: ids.inbound, itemId: ids.item, managedReservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    type: 'INBOUND', destinationCellId: ids.cell, quantity: 2, quantityUnit: 'box', actualUnitWeightKg: 20, actualTotalWeightKg: 40,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, actualTotalVolumeM3: .03,
    performedBy: ids.staff, performedAt: new Date(now.getTime() - 10_000), inspectionNote: 'first receipt', idempotencyKey: 'legacy-in-01' };
  const inspection = { _id: ids.evidence, requestId: ids.request, itemId: ids.item, facilityId: ids.facility, decision: 'ACCEPTED',
    receivedQuantity: 1, actualUnitWeightKg: 5, actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 },
    compatibleCellIds: [ids.cell], packingLayoutVerified: true };
  const rack = { _id: ids.rack, facilityId: ids.facility, zoneId: ids.zone, operationalStatus: 'AVAILABLE', levelCount: 2, maxWeightKgPerLevel: 500 };
  const zone = { _id: ids.zone, facilityId: ids.facility, isActive: true };
  const allocation = { _id: oid(), cellId: ids.cell, reservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer, status: 'RESERVED' };
  const events = [], movements = [inbound]; let failEventWrite = true;
  const session = { withTransaction: async work => {
    const before = { item: { status: item.status, currentCellId: item.currentCellId, currentPlacementMovementId: item.currentPlacementMovementId,
      inboundMovementId: item.inboundMovementId, inboundConfirmedAt: item.inboundConfirmedAt, inboundConfirmedBy: item.inboundConfirmedBy, __v: item.__v },
      request: { state: request.state, version: request.version, confirmedMovementId: request.confirmedMovementId },
      reservation: { usedCapacityM3: reservation.usedCapacityM3, inventoryVersion: reservation.inventoryVersion },
      cell: { usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3 }, movements: movements.length, events: events.length };
    try { return await work(session); }
    catch (error) {
      Object.assign(item, before.item); Object.assign(request, before.request); Object.assign(reservation, before.reservation);
      Object.assign(cell, before.cell); movements.length = before.movements; events.length = before.events;
      throw error;
    }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Event, 'findOne', () => new Query(null));
  t.mock.method(Event.prototype, 'save', async function () { if (failEventWrite) throw new Error('simulated event append failure'); events.push(this); return this; });
  t.mock.method(Request, 'findOne', () => new Query(request));
  t.mock.method(Request.prototype, 'save', async function () { this.version += 1; return this; });
  t.mock.method(Item, 'findOne', () => new Query(item));
  t.mock.method(Item, 'findOneAndUpdate', (_filter, update) => { item.__v += update.$inc.__v; return new Query(item); });
  t.mock.method(Item, 'find', () => new Query([item]));
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', filter => { assert.equal(filter.activeClosureRequestId, null); reservation.inventoryVersion += 1; return new Query(reservation); });
  t.mock.method(Reservation.prototype, 'save', async function () { return this; });
  t.mock.method(Zone, 'findOneAndUpdate', () => new Query(zone));
  t.mock.method(Cell, 'findOne', () => new Query(cell));
  t.mock.method(Cell, 'findById', () => new Query(cell));
  t.mock.method(Cell, 'find', () => new Query([cell]));
  t.mock.method(Cell, 'findOneAndUpdate', (_filter, update) => { cell.usedWeightKg += update.$inc.usedWeightKg; cell.usedVolumeM3 += update.$inc.usedVolumeM3; return new Query(cell); });
  t.mock.method(Rack, 'findOneAndUpdate', () => new Query(rack));
  t.mock.method(Allocation, 'findOne', () => new Query(allocation));
  t.mock.method(Allocation, 'updateOne', () => new Query({ matchedCount: 1 }));
  t.mock.method(Facility, 'findOne', () => new Query({ _id: ids.facility, status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Inspection, 'findOne', () => new Query(inspection));
  t.mock.method(Movement, 'find', () => new Query(movements));
  t.mock.method(Movement.prototype, 'save', async function () { await this.validate(); movements.push(this); return this; });
  t.mock.method(Balance, 'findOne', () => new Query(null));
  t.mock.method(Balance.prototype, 'save', async function () { await this.validate(); return this; });
  const actor = { _id: ids.staff, role: 'FACILITY_STAFF', assignedFacilityId: ids.facility };
  const confirmInput = { destinationCellId: String(ids.cell), inspectionNote: 'Receipt checked', idempotencyKey: 'confirm-key-001' };
  await assert.rejects(service.confirm(String(ids.request), confirmInput, '"2"', actor), /simulated event append failure/);
  assert.equal(movements.length, 1, 'failed event append rolls movement back');
  assert.equal(cell.usedWeightKg, 40); assert.equal(cell.usedVolumeM3, .03); assert.equal(reservation.usedCapacityM3, .03);
  assert.equal(request.state, 'ACCEPTED_PENDING_CONFIRMATION'); assert.equal(item.status, 'IN_STORAGE');
  failEventWrite = false;
  const result = await service.confirm(String(ids.request), confirmInput, '"2"', actor);
  assert.equal(result.request.state, 'CONFIRMED');
  assert.equal(result.stockBalance.onHandQuantity, 3);
  assert.equal(result.stockBalance.batches.length, 2);
  assert.equal(result.stockBalance.batches[1].arithmeticPolicy, 'CANONICAL_V1');
  assert.equal(result.movement.schemaVersion, 2);
  assert.equal(result.movement.batchLines[0].receivingInspectionEvidenceId.toString(), String(ids.evidence));
  assert.equal(cell.usedWeightKg, 45);
  assert.equal(cell.usedVolumeM3, .031);
  assert.equal(reservation.usedCapacityM3, .031);
  assert.equal(events.length, 1);
  assert.equal(item.status, 'IN_STORAGE');
  assert.equal(String(item.currentCellId), String(ids.cell));
});
