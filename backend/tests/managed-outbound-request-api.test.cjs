const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test', MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED: 'true', MI06_STOCK_LEDGER_WRITES_ENABLED: 'true',
  MONGO_URL: 'mongodb://127.0.0.1:27018/unused_test_only', KEYCLOAK_BASE_URL: 'http://localhost:8081',
  KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm', KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const Request = require('../dist/models/inventory-items/managed-outbound-request.model').default;
const Event = require('../dist/models/inventory-items/managed-outbound-request-event.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const InboundRequest = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const { ManagedOutboundRequestService: service } = require('../dist/services/inventory-items/managed-outbound-request.service');
const controller = require('../dist/controllers/inventory-items/managed-outbound-request.controller');
const { resolveMi06CanonicalOutboundGate, resolveMi06CanonicalOutboundConfirmationGate } = require('../dist/config/mi06-canonical-outbound-gate');

const ids = { item: '507f1f77bcf86cd799439001', customer: '507f1f77bcf86cd799439002', reservation: '507f1f77bcf86cd799439003',
  facility: '507f1f77bcf86cd799439004', cell: '507f1f77bcf86cd799439005', receipt: '507f1f77bcf86cd799439006', staff: '507f1f77bcf86cd799439007' };
const oid = value => new mongoose.Types.ObjectId(value);
class Query {
  constructor(value, onSession) { this.value = value; this.onSession = onSession; }
  session(session) { this.sessionValue = session; this.onSession?.(session); return this; }
  select() { return this; } lean() { return this; } sort() { return this; } skip() { return this; } limit() { return this; }
  exec() { return Promise.resolve(typeof this.value === 'function' ? this.value() : this.value); }
}

function setup(t, options = {}) {
  const ops = []; const savedRequests = []; const savedEvents = []; const balanceSaves = [];
  const item = { _id: oid(ids.item), customerId: oid(ids.customer), managedReservationId: oid(ids.reservation), facilityId: oid(ids.facility),
    currentCellId: oid(ids.cell), currentPlacementMovementId: null, quantity: 5, quantityUnit: 'box', status: 'IN_STORAGE', __v: 0,
    async save() { return this; },
    toObject() { return { ...this, toObject: undefined }; } };
  const receipt = { _id: oid(ids.receipt), itemId: item._id, managedReservationId: item.managedReservationId, facilityId: item.facilityId,
    customerId: item.customerId, type: 'INBOUND', schemaVersion: 1, quantity: 5, quantityUnit: 'box', actualUnitWeightKg: 2,
    actualTotalWeightKg: 10, actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: 1 }, actualTotalVolumeM3: .05,
    sourceCellId: null, destinationCellId: item.currentCellId, performedAt: new Date('2026-10-01T00:00:00Z'), inspectionNote: 'Received',
    idempotencyKey: 'old-inbound-001' };
  const stock = new Balance({ itemId: item._id, facilityId: item.facilityId, customerId: item.customerId,
    managedReservationId: item.managedReservationId, currentCellId: item.currentCellId,
    batches: [{ batchId: `legacy:${ids.receipt}`, receiptMovementId: receipt._id, quantity: 5, heldQuantity: 0,
      quantityUnit: 'box', actualUnitWeightKg: 2, actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: 1 },
      actualTotalWeightKg: 10, actualTotalVolumeM3: .05, arithmeticPolicy: 'COMPATIBILITY', receivedAt: receipt.performedAt }],
    onHandQuantity: 5, heldQuantity: 0, actualTotalWeightKg: 10, actualTotalVolumeM3: .05,
    schemaVersion: 1, source: 'LEGACY_RECONCILED', version: 0 });
  const reservation = { _id: item.managedReservationId, customerId: item.customerId, facilityId: item.facilityId,
    serviceType: 'MANAGED_INVENTORY', status: 'ACTIVE', startDate: new Date('2026-10-01'), endDate: new Date('2026-12-01'),
    allocatedCellIds: [item.currentCellId], inventoryVersion: 0, usedCapacityM3: .05,
    async save() { return this; },
    toObject() { return { ...this, toObject: undefined }; } };
  const cell = { _id: oid(ids.cell), facilityId: item.facilityId, rackId: oid('507f1f77bcf86cd799439008'),
    zoneId: oid('507f1f77bcf86cd799439009'), usedWeightKg: 10, usedVolumeM3: .05, allocationVersion: 0,
    toObject() { return { ...this, toObject: undefined }; } };
  const rack = { _id: cell.rackId, facilityId: item.facilityId, zoneId: cell.zoneId, layoutVersion: 0 };
  const zone = { _id: cell.zoneId, facilityId: item.facilityId, structureVersion: 0 };
  const allocation = { _id: oid(ids.staff), status: 'OCCUPIED', async save() { return this; } };
  let requestDoc;
  const session = { withTransaction: async work => {
    const before = { requests: savedRequests.length, events: savedEvents.length, balances: balanceSaves.length };
    try { return await work(session); }
    catch (error) { savedRequests.length = before.requests; savedEvents.length = before.events; balanceSaves.length = before.balances; throw error; }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Item, 'findOne', filter => {
    ops.push(filter._id?.$ne ? 'Item.otherStored' : 'Item.preflight');
    return new Query(filter._id?.$ne ? (options.otherStored ? { _id: oid('507f1f77bcf86cd799439177') } : null) : item);
  });
  t.mock.method(Item, 'findOneAndUpdate', (filter, update, opts) => {
    ops.push('Item.token'); assert.equal(update.$inc.__v, 1); assert.equal(opts.session, session);
    assert.equal(String(filter.customerId), ids.customer); assert.equal(String(filter.managedReservationId), ids.reservation);
    assert.equal(String(filter.facilityId), ids.facility); assert.equal(String(filter.currentCellId), ids.cell);
    assert.equal(filter.__v, item.__v, 'Item serialization token must compare-and-set the preflight version');
    if (options.itemTokenConflict) return new Query(null);
    item.__v += 1; return new Query(item);
  });
  t.mock.method(Item, 'find', () => new Query([item]));
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, update, opts) => {
    ops.push('Reservation.token'); assert.equal(filter.status, 'ACTIVE'); assert.equal(update.$inc.inventoryVersion, 1); assert.equal(opts.session, session);
    reservation.inventoryVersion += 1; return new Query(reservation);
  });
  t.mock.method(Facility, 'findOne', () => new Query({ _id: item.facilityId }));
  t.mock.method(Allocation, 'findOne', () => new Query(allocation));
  t.mock.method(Cell, 'findOne', () => new Query(cell));
  t.mock.method(Cell, 'findOneAndUpdate', (filter, update) => {
    if (filter.allocationVersion === undefined) { cell.allocationVersion += 1; return new Query(cell); }
    if (filter.allocationVersion !== cell.allocationVersion || filter.usedWeightKg !== cell.usedWeightKg || filter.usedVolumeM3 !== cell.usedVolumeM3) return new Query(null);
    Object.assign(cell, update.$set); return new Query(cell);
  });
  t.mock.method(Zone, 'findOneAndUpdate', () => { zone.structureVersion += 1; return new Query(zone); });
  t.mock.method(Rack, 'findOneAndUpdate', () => { rack.layoutVersion += 1; return new Query(rack); });
  t.mock.method(InboundRequest, 'findOne', () => new Query(null));
  const savedMovements = [];
  t.mock.method(Movement, 'find', () => new Query([receipt, ...savedMovements]));
  t.mock.method(Balance, 'findOne', () => new Query(stock));
  t.mock.method(Balance.prototype, 'save', async function () { await this.validate(); balanceSaves.push(this.toObject()); return this; });
  t.mock.method(Request, 'find', () => new Query(requestDoc ? [requestDoc.toObject()] : []));
  t.mock.method(Request, 'findOne', filter => new Query(filter._id ? requestDoc : null));
  t.mock.method(Request.prototype, 'save', async function () {
    await this.validate();
    if (this.isNew) { requestDoc = this; savedRequests.push(this.toObject()); this.$isNew = false; }
    else { this.version += 1; this.updatedAt = new Date(); savedRequests[0] = this.toObject(); }
    return this;
  });
  t.mock.method(Event, 'findOne', filter => new Query(savedEvents.find(row => row.itemId?.equals?.(filter.itemId) &&
    row.operation === filter.operation && row.idempotencyKey === filter.idempotencyKey &&
    (!filter.customerId || row.customerId?.equals?.(filter.customerId))) ?? null));
  t.mock.method(Event.prototype, 'save', async function () { await this.validate(); savedEvents.push(this.toObject()); if (options.failEventWrite) throw new Error('event write failed'); return this; });
  t.mock.method(Movement.prototype, 'save', async function () { await this.validate(); savedMovements.push(this.toObject()); return this; });
  return { ops, item, stock, reservation, cell, allocation, savedRequests, savedEvents, savedMovements, balanceSaves, session };
}

test('canonical outbound gate defaults OFF and is forced OFF in production', () => {
  assert.equal(resolveMi06CanonicalOutboundGate('development', undefined), false);
  assert.equal(resolveMi06CanonicalOutboundGate('development', 'true'), true);
  assert.equal(resolveMi06CanonicalOutboundGate('production', 'true'), false);
  assert.equal(resolveMi06CanonicalOutboundConfirmationGate('development', undefined), false);
  assert.equal(resolveMi06CanonicalOutboundConfirmationGate('development', 'true'), true);
  assert.equal(resolveMi06CanonicalOutboundConfirmationGate('production', 'true'), false);
});

test('confirmation validates strict payload before reading or writing request state', async () => {
  const actor = { _id: oid(ids.staff), role: 'FACILITY_STAFF', assignedFacilityId: oid(ids.facility) };
  await assert.rejects(service.confirm(ids.item, { actualDeliveredQty: 1, handoverConfirmed: true, handoverNote: 'ok', extra: true },
    'outbound-confirm-0001', '"0"', actor), { code: 'OUTBOUND_REQUEST_INVALID', status: 400 });
  await assert.rejects(service.confirm(ids.item, { actualDeliveredQty: 0, handoverConfirmed: true, handoverNote: 'ok' },
    'outbound-confirm-0001', '"0"', actor), { code: 'OUTBOUND_REQUEST_INVALID', status: 400 });
  await assert.rejects(service.confirm(ids.item, { actualDeliveredQty: 1, handoverConfirmed: false, handoverNote: 'ok' },
    'outbound-confirm-0001', '"0"', actor), { code: 'OUTBOUND_REQUEST_INVALID', status: 400 });
});

test('confirmation controller returns HTTP 200, request ETag and forwards Staff headers', async t => {
  const old = service.confirm;
  t.after(() => { service.confirm = old; });
  let received;
  service.confirm = async (...args) => { received = args; return { replayed: false, data: { version: 2, movementId: ids.receipt } }; };
  const response = await new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
      set(key, value) { this.headers[key] = value; return this; }, json(body) { resolve({ statusCode: this.statusCode, headers: this.headers, body }); } };
    controller.confirm({ params: { requestId: ids.item }, body: { actualDeliveredQty: 1, handoverConfirmed: true, handoverNote: 'Staff handover' },
      get: key => ({ 'Idempotency-Key': 'outbound-confirm-0001', 'If-Match': '"1"' })[key],
      user: { _id: oid(ids.staff), role: 'FACILITY_STAFF', assignedFacilityId: oid(ids.facility) } }, res, reject);
  });
  assert.equal(response.statusCode, 200); assert.equal(response.headers.ETag, '"2"');
  assert.equal(received[0], ids.item); assert.equal(received[2], 'outbound-confirm-0001'); assert.equal(received[3], '"1"');
});

test('CREATE serializes Item before Reservation and atomically places FIFO holds without changing on-hand stock', async t => {
  const ctx = setup(t); const actor = { _id: oid(ids.customer), role: 'CUSTOMER' };
  const result = await service.create(ids.item, { requestedQuantity: 3 }, 'outbound-create-0001', actor);
  assert.equal(result.replayed, false); assert.equal(result.data.state, 'PENDING'); assert.equal(result.data.heldQuantity, 3);
  assert.ok(ctx.ops.indexOf('Item.token') < ctx.ops.indexOf('Reservation.token'));
  assert.equal(ctx.stock.onHandQuantity, 5); assert.equal(ctx.stock.heldQuantity, 3);
  assert.equal(ctx.stock.batches[0].heldQuantity, 3); assert.equal(ctx.savedRequests.length, 1); assert.equal(ctx.savedEvents.length, 1);
  assert.equal(ctx.savedEvents[0].resultingVersion, result.data.version);
  const replay = await service.create(ids.item, { requestedQuantity: 3 }, 'outbound-create-0001', actor);
  assert.equal(replay.replayed, true); assert.deepEqual(JSON.parse(JSON.stringify(replay.data)), JSON.parse(JSON.stringify(result.data)));
  assert.equal(ctx.stock.heldQuantity, 3); assert.equal(ctx.savedRequests.length, 1); assert.equal(ctx.savedEvents.length, 1);
  await assert.rejects(service.create(ids.item, { requestedQuantity: 4 }, 'outbound-create-0001', actor), { code: 'OUTBOUND_REQUEST_CONFLICT' });
});

test('CREATE rejects quantity beyond available stock and malformed payloads', async t => {
  const ctx = setup(t); const actor = { _id: oid(ids.customer), role: 'CUSTOMER' };
  await assert.rejects(service.create(ids.item, { requestedQuantity: 6 }, 'outbound-create-0002', actor), { code: 'NEGATIVE_STOCK' });
  assert.equal(ctx.stock.heldQuantity, 0); assert.equal(ctx.savedRequests.length, 0);
  await assert.rejects(service.create(ids.item, { requestedQuantity: 1, extra: true }, 'outbound-create-0003', actor), { code: 'OUTBOUND_REQUEST_INVALID' });
});

test('safe CANCEL releases exactly the held quantity and preserves on-hand stock', async t => {
  const ctx = setup(t); const actor = { _id: oid(ids.customer), role: 'CUSTOMER' };
  const created = await service.create(ids.item, { requestedQuantity: 3 }, 'outbound-create-0010', actor);
  ctx.stock.batches[0].heldQuantity = 3; ctx.stock.heldQuantity = 3;
  ctx.savedRequests[0].batchAllocations[0].quantity = 3;
  const oldGate = process.env.MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED; const oldLedgerGate = process.env.MI06_STOCK_LEDGER_WRITES_ENABLED;
  process.env.MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED = 'false'; process.env.MI06_STOCK_LEDGER_WRITES_ENABLED = 'false';
  let cancelled;
  try { cancelled = await service.cancel(created.data._id, '"0"', 'outbound-cancel-0010', actor); }
  finally { process.env.MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED = oldGate; process.env.MI06_STOCK_LEDGER_WRITES_ENABLED = oldLedgerGate; }
  assert.equal(cancelled.replayed, false); assert.equal(cancelled.data.state, 'CANCELLED'); assert.equal(cancelled.data.heldQuantity, 0);
  assert.equal(ctx.stock.onHandQuantity, 5); assert.equal(ctx.stock.heldQuantity, 0); assert.equal(ctx.stock.batches[0].heldQuantity, 0);
  assert.equal(ctx.savedEvents.filter(row => row.operation === 'CANCEL').length, 1);
});

test('Staff confirmation consumes actual FIFO delivery, releases unused hold and commits one REMOVE event link', async t => {
  const ctx = setup(t); const customer = { _id: oid(ids.customer), role: 'CUSTOMER' };
  const oldConfirmationGate = process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED;
  t.after(() => { process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED = oldConfirmationGate; });
  const created = await service.create(ids.item, { requestedQuantity: 3 }, 'outbound-create-confirm-0001', customer);
  const staff = { _id: oid(ids.staff), role: 'FACILITY_STAFF', assignedFacilityId: oid(ids.facility) };
  process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED = 'true';
  const result = await service.confirm(created.data._id, { actualDeliveredQty: 2, handoverConfirmed: true, handoverNote: 'Delivered two boxes' },
    'outbound-confirm-phase-c-0001', '"0"', staff);
  assert.equal(result.replayed, false); assert.equal(result.data.state, 'PARTIALLY_FULFILLED');
  assert.equal(result.data.confirmedQuantity, 2); assert.equal(result.data.currentQuantity, 3); assert.equal(result.data.heldQuantity, 0);
  assert.equal(ctx.item.quantity, 5, 'legacy registration quantity remains unchanged');
  assert.equal(ctx.stock.onHandQuantity, 3); assert.equal(ctx.stock.heldQuantity, 0);
  assert.equal(ctx.stock.batches[0].quantity, 3); assert.equal(ctx.stock.batches[0].heldQuantity, 0);
  assert.equal(String(ctx.item.currentPlacementMovementId), ids.receipt, 'partial REMOVE preserves the original committed placement');
  assert.equal(ctx.stock.source, 'LEDGER_V2');
  assert.equal(String(ctx.stock.reconciledThroughMovementId), String(ctx.savedMovements[0]._id));
  assert.equal(ctx.cell.usedWeightKg, 6); assert.equal(ctx.cell.usedVolumeM3, .03); assert.equal(ctx.reservation.usedCapacityM3, .03);
  assert.equal(ctx.savedMovements.length, 1); assert.equal(ctx.savedMovements[0].schemaVersion, 2);
  assert.equal(ctx.savedMovements[0].arithmeticPolicy, 'CANONICAL_V1'); assert.equal(ctx.savedMovements[0].batchLines[0].action, 'REMOVE');
  assert.equal(ctx.savedMovements[0].batchLines[0].quantity, 2);
  assert.equal(String(ctx.savedMovements[0].batchLines[0].receiptMovementId), ids.receipt);
  const event = ctx.savedEvents.find(row => row.operation === 'CONFIRM');
  assert.ok(event); assert.equal(String(event.movementId), String(result.data.confirmedMovementId));
  assert.equal(event.resultingVersion, result.data.version); assert.equal(event.resultSnapshot.currentQuantity, 3);
  const replay = await service.confirm(created.data._id, { actualDeliveredQty: 2, handoverConfirmed: true, handoverNote: 'Delivered two boxes' },
    'outbound-confirm-phase-c-0001', '"0"', staff);
  assert.equal(replay.replayed, true); assert.deepEqual(JSON.parse(JSON.stringify(replay.data)), JSON.parse(JSON.stringify(result.data)));
  assert.equal(ctx.savedMovements.length, 1); assert.equal(ctx.stock.onHandQuantity, 3);
  await assert.rejects(service.confirm(created.data._id, { actualDeliveredQty: 2, handoverConfirmed: true, handoverNote: 'changed' },
    'outbound-confirm-phase-c-0001', '"0"', staff), { code: 'OUTBOUND_REQUEST_CONFLICT', status: 409 });
  const next = await service.create(ids.item, { requestedQuantity: 2 }, 'outbound-create-after-remove-0001', customer);
  assert.equal(next.replayed, false);
  assert.equal(next.data.state, 'PENDING');
  assert.equal(ctx.item.quantity, 5, 'legacy registration quantity is not decremented or accumulated');
  assert.equal(ctx.stock.onHandQuantity, 3); assert.equal(ctx.stock.heldQuantity, 2);
});

test('full canonical REMOVE clears placement, advances StockBalance lineage, and replay is read-only', async t => {
  const ctx = setup(t); const customer = { _id: oid(ids.customer), role: 'CUSTOMER' };
  const oldGate = process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED;
  t.after(() => { process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED = oldGate; });
  const created = await service.create(ids.item, { requestedQuantity: 5 }, 'outbound-create-zero-0001', customer);
  const staff = { _id: oid(ids.staff), role: 'FACILITY_STAFF', assignedFacilityId: oid(ids.facility) };
  process.env.MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED = 'true';
  const payload = { actualDeliveredQty: 5, handoverConfirmed: true, handoverNote: 'All goods handed over' };
  const first = await service.confirm(created.data._id, payload, 'outbound-confirm-zero-0001', '"0"', staff);
  assert.equal(first.replayed, false); assert.equal(first.data.currentQuantity, 0);
  assert.equal(ctx.item.status, 'CHECKED_OUT'); assert.equal(ctx.item.currentCellId, null);
  assert.equal(ctx.item.currentPlacementMovementId, null);
  assert.equal(ctx.stock.currentCellId, null); assert.equal(ctx.stock.onHandQuantity, 0);
  assert.equal(ctx.stock.source, 'LEDGER_V2');
  assert.equal(String(ctx.stock.reconciledThroughMovementId), String(ctx.savedMovements[0]._id));
  assert.equal(ctx.allocation.status, 'RESERVED');

  const replay = await service.confirm(created.data._id, payload, 'outbound-confirm-zero-0001', '"0"', staff);
  assert.equal(replay.replayed, true);
  assert.equal(ctx.savedMovements.length, 1); assert.equal(ctx.item.currentPlacementMovementId, null);
  assert.equal(ctx.stock.onHandQuantity, 0);
});

test('request/event write failure does not persist a request, event or balance update in transaction mock', async t => {
  const ctx = setup(t, { failEventWrite: true }); const actor = { _id: oid(ids.customer), role: 'CUSTOMER' };
  await assert.rejects(service.create(ids.item, { requestedQuantity: 2 }, 'outbound-create-0004', actor), /event write failed/);
  assert.equal(ctx.savedRequests.length, 0); assert.equal(ctx.savedEvents.length, 0); assert.equal(ctx.balanceSaves.length, 0);
});

test('failed Item CAS uses bounded event recovery and never reports a false success', async t => {
  const ctx = setup(t, { itemTokenConflict: true }); const actor = { _id: oid(ids.customer), role: 'CUSTOMER' };
  let eventReads = 0;
  t.mock.method(Event, 'findOne', () => { eventReads += 1; return new Query(null); });
  await assert.rejects(service.create(ids.item, { requestedQuantity: 1 }, 'outbound-create-cas01', actor), {
    code: 'OUTBOUND_REQUEST_CONFLICT', status: 409,
  });
  assert.equal(ctx.ops.filter(operation => operation === 'Item.token').length, 1);
  assert.equal(eventReads, 5, 'one initial idempotency lookup plus at most four recovery reads');
  assert.equal(ctx.savedRequests.length, 0); assert.equal(ctx.savedEvents.length, 0); assert.equal(ctx.balanceSaves.length, 0);
});

test('CREATE controller returns 201 for create and 200 for replay', async t => {
  const old = service.create;
  t.after(() => { service.create = old; });
  let replayed = false;
  service.create = async () => ({ data: { version: 0, _id: ids.item }, replayed });
  const invoke = () => new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
      set(key, value) { this.headers[key] = value; return this; }, json(body) { resolve({ statusCode: this.statusCode, headers: this.headers, body }); } };
    controller.create({ params: { itemId: ids.item }, body: { requestedQuantity: 1 }, get: () => 'outbound-create-0005', user: { _id: oid(ids.customer), role: 'CUSTOMER' } }, res, reject);
  });
  assert.equal((await invoke()).statusCode, 201); replayed = true; assert.equal((await invoke()).statusCode, 200);
});
