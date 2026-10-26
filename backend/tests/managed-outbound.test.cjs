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
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Audit = require('../dist/models/reservations/managed-reservation-audit.model').default;
const { InventoryItemService: service } = require('../dist/services/inventory-items/inventory-item.service');
const { parseOutboundConfirmation } = require('../dist/services/inventory-items/inventory-item.validation');

const oid = value => new mongoose.Types.ObjectId(value);
const facilityId = '507f1f77bcf86cd799439011';
const reservationId = '507f1f77bcf86cd799439021';
const itemId = '507f1f77bcf86cd799439031';
const cellId = '507f1f77bcf86cd799439041';
const zoneId = '507f1f77bcf86cd799439051';
const rackId = '507f1f77bcf86cd799439061';
const customerId = oid('507f1f77bcf86cd799439071');
const staffId = oid('507f1f77bcf86cd799439081');
const otherCustomerId = oid('507f1f77bcf86cd799439091');

class Query {
  constructor(value, executionTracker) { this.value = value; this.executionTracker = executionTracker; }
  session(session) {
    if (this.executionTracker) this.executionTracker.sessions.push(session);
    return this;
  }
  select() { return this; }
  lean() { return this; }
  async exec() {
    if (!this.executionTracker) return this.value;
    this.executionTracker.active += 1;
    this.executionTracker.maxActive = Math.max(this.executionTracker.maxActive, this.executionTracker.active);
    try {
      await new Promise(resolve => setImmediate(resolve));
      return this.value;
    } finally {
      this.executionTracker.active -= 1;
    }
  }
}

function makeItem(overrides = {}) {
  return new Item({ _id: oid(itemId), facilityId: oid(facilityId), customerId,
    managedReservationId: oid(reservationId), itemCode: 'LOT-1', name: 'Cartons', category: 'DOCUMENTS',
    quantity: 2, quantityUnit: 'carton', unitWeightKg: 999, unitDimensionsM: { widthM: 9, depthM: 9, heightM: 9 },
    unitVolumeM3: 729, totalWeightKg: 1998, totalVolumeM3: 1458,
    currentCellId: oid(cellId), status: 'IN_STORAGE', images: [], createdBy: customerId,
    inboundMovementId: oid('507f1f77bcf86cd799439101'), ...overrides });
}

function makeInbound() {
  return { _id: oid('507f1f77bcf86cd799439101'), itemId: oid(itemId), managedReservationId: oid(reservationId),
    facilityId: oid(facilityId), customerId, type: 'INBOUND', destinationCellId: oid(cellId),
    quantity: 2, quantityUnit: 'carton', actualUnitWeightKg: 20, actualTotalWeightKg: 40,
    actualUnitDimensionsM: { widthM: .25, depthM: .3, heightM: .2 }, actualTotalVolumeM3: .03,
    performedBy: staffId, performedAt: new Date(), inspectionNote: 'Received', idempotencyKey: 'inbound-01' };
}
function makeOtherInbound() {
  return { ...makeInbound(), _id: oid('507f1f77bcf86cd799439131'), itemId: oid('507f1f77bcf86cd799439132'),
    idempotencyKey: 'inbound-other' };
}

function setup(t, options = {}) {
  const inbound = makeInbound();
  const item = makeItem({ status: options.status ?? 'IN_STORAGE', customerId: options.itemCustomerId ?? customerId,
    ...(options.currentCellId === null ? { currentCellId: null } : {}) });
  const cell = { _id: oid(cellId), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
    usedWeightKg: options.usedWeightKg ?? (options.otherStored ? 80 : 40),
    usedVolumeM3: options.usedVolumeM3 ?? (options.otherStored ? .06 : .03) };
  const reservation = { _id: oid(reservationId), facilityId: oid(facilityId), customerId: options.reservationCustomerId ?? customerId,
    serviceType: options.serviceType ?? 'MANAGED_INVENTORY', status: options.reservationStatus ?? 'ACTIVE',
    startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 86_400_000),
    usedCapacityM3: options.usedCapacityM3 ?? (options.otherStored ? .06 : .03), allocatedCapacity: 1.5, inventoryVersion: 0,
    save: async function () { return this; } };
  const allocation = { _id: oid('507f1f77bcf86cd799439111'), facilityId: oid(facilityId), cellId: oid(cellId),
    reservationId: oid(reservationId), customerId, status: 'OCCUPIED', save: async function () { state.allocation.status = this.status; return this; } };
  const otherInbound = makeOtherInbound();
  const otherItem = makeItem({ _id: otherInbound.itemId, itemCode: 'LOT-2', currentCellId: oid(cellId), status: 'IN_STORAGE',
    inboundMovementId: otherInbound._id });
  const state = { item, cell, reservation, allocation, inbound, otherInbound, otherItem, movements: [inbound, otherInbound], outbound: null, audits: [], otherStored: options.otherStored ?? false,
    itemFindExecution: { active: 0, maxActive: 0, sessions: [] },
    otherAllocation: { status: 'RESERVED', cellId: oid('507f1f77bcf86cd799439042') } };
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
    const before = { status: item.status, currentCellId: item.currentCellId, outboundRequestedAt: item.outboundRequestedAt,
      outboundConfirmedAt: item.outboundConfirmedAt, outboundMovementId: item.outboundMovementId,
      outboundHandoverNote: item.outboundHandoverNote, outboundVerifiedQuantity: item.outboundVerifiedQuantity,
      outboundIdempotencyKey: item.outboundIdempotencyKey, outboundRejection: item.outboundRejection,
      usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3, usedCapacityM3: reservation.usedCapacityM3,
      allocationStatus: allocation.status, outbound: state.outbound, auditsLength: state.audits.length };
    try { return await work(); } catch (error) {
      Object.assign(item, { status: before.status, currentCellId: before.currentCellId,
        outboundRequestedAt: before.outboundRequestedAt, outboundConfirmedAt: before.outboundConfirmedAt,
        outboundMovementId: before.outboundMovementId, outboundHandoverNote: before.outboundHandoverNote,
        outboundVerifiedQuantity: before.outboundVerifiedQuantity, outboundIdempotencyKey: before.outboundIdempotencyKey,
        outboundRejection: before.outboundRejection });
      cell.usedWeightKg = before.usedWeightKg; cell.usedVolumeM3 = before.usedVolumeM3;
      reservation.usedCapacityM3 = before.usedCapacityM3; allocation.status = before.allocationStatus;
      state.outbound = before.outbound; state.audits.length = before.auditsLength; throw error;
    } finally { release(); }
  }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Item, 'findOne', filter => {
    if (filter._id?.$ne) return new Query(state.otherStored ? { _id: oid('507f1f77bcf86cd799439121') } : null);
    if (filter.customerId && !item.customerId.equals(filter.customerId)) return new Query(null);
    return new Query(item);
  });
  t.mock.method(InboundRequest, 'findOne', () => new Query(options.unresolvedReceipt ? { _id: oid('507f1f77bcf86cd799439199') } : null));
  t.mock.method(ManagedOutboundRequest, 'findOne', () => new Query(options.unresolvedCanonicalOutbound ? { _id: oid('507f1f77bcf86cd799439198') } : null));
  t.mock.method(Item, 'find', () => new Query(state.otherStored ? [item, otherItem] : [item], state.itemFindExecution));
  t.mock.method(Item, 'findOneAndUpdate', () => new Query(item));
  t.mock.method(Item.prototype, 'save', async function () { return this; });
  t.mock.method(Cell, 'findOne', () => new Query(cell));
  t.mock.method(Cell, 'findOneAndUpdate', (_filter, update) => {
    cell.usedWeightKg += update.$inc.usedWeightKg; cell.usedVolumeM3 += update.$inc.usedVolumeM3;
    return new Query(cell);
  });
  t.mock.method(Zone, 'findOneAndUpdate', () => new Query({ _id: oid(zoneId) }));
  t.mock.method(Rack, 'findOneAndUpdate', () => new Query({ _id: oid(rackId) }));
  t.mock.method(Reservation, 'findOneAndUpdate', (filter) => {
    if (options.reservationStatus === 'OVERDUE' || options.reservationMissing ||
        filter.serviceType !== reservation.serviceType || !reservation.customerId.equals(filter.customerId)) return new Query(null);
    return new Query(reservation);
  });
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Facility, 'findOne', () => new Query(options.facilityMissing ? null : { _id: oid(facilityId), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Allocation, 'findOne', () => new Query(options.allocationMissing ? null : allocation));
  t.mock.method(Allocation.prototype, 'save', async function () { state.allocation.status = this.status; return this; });
  t.mock.method(Movement, 'findOne', filter => {
    if (filter.schemaVersion) return new Query(state.movements.find(row => row.schemaVersion === filter.schemaVersion &&
      (!filter.itemId || String(row.itemId) === String(filter.itemId)) &&
      (!filter.$or || filter.$or.some(condition =>
        (condition.arithmeticPolicy && row.arithmeticPolicy === condition.arithmeticPolicy) ||
        (condition['batchLines.action'] && row.batchLines?.some(line => condition['batchLines.action'].$in.includes(line.action))) ||
        (condition['batchLines.receiptRequestId']?.$exists && row.batchLines?.some(line => line.receiptRequestId))
      )) && (!filter['batchLines.receiptRequestId']?.$exists || row.batchLines?.some(line => line.receiptRequestId)) ) ?? null);
    if (filter.type === 'INBOUND') return new Query(options.inboundMissing ? null :
      String(filter.itemId) === String(otherItem._id) ? otherInbound : inbound);
    if (filter.idempotencyKey) return new Query(state.outbound?.idempotencyKey === filter.idempotencyKey ? state.outbound : null);
    return new Query(null);
  });
  t.mock.method(Movement.prototype, 'save', async function () {
    if (options.movementFailure) throw new Error('simulated movement persistence failure');
    if (this.type === 'OUTBOUND') state.outbound = this;
    return this;
  });
  t.mock.method(Audit, 'create', async records => { state.audits.push(...records); return records; });
  return { state, item, cell, reservation, allocation, session,
    customer: { _id: options.actorId ?? customerId, role: options.actorRole ?? 'CUSTOMER' },
    staff: { _id: options.staffId ?? staffId, role: options.staffRole ?? 'FACILITY_STAFF', assignedFacilityId: oid(options.assignedFacilityId ?? facilityId) },
    body: { verifiedQuantity: 2, handoverConfirmed: true, handoverNote: 'Customer received all cartons', idempotencyKey: 'outbound-001' } };
}

test('outbound confirmation parser requires whole-lot quantity, confirmed handover, note, and stable key', () => {
  const body = { verifiedQuantity: 2, handoverConfirmed: true, handoverNote: 'Handed to customer', idempotencyKey: 'out-001' };
  assert.equal(parseOutboundConfirmation(body).handoverConfirmed, true);
  assert.throws(() => parseOutboundConfirmation({ ...body, handoverConfirmed: false }), { status: 400 });
  assert.throws(() => parseOutboundConfirmation({ ...body, verifiedQuantity: 0 }), { status: 400 });
  assert.throws(() => parseOutboundConfirmation({ ...body, unsupported: true }), { status: 400 });
});

test('customer requests outbound while retaining its Cell and all physical counters', async t => {
  const ctx = setup(t);
  const result = await service.requestOutbound(itemId, ctx.customer);
  assert.equal(result.status, 'PENDING_OUTBOUND');
  assert.equal(String(result.currentCellId), cellId);
  assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.cell.usedVolumeM3, .03);
  assert.equal(ctx.reservation.usedCapacityM3, .03);
  assert.equal(ctx.allocation.status, 'OCCUPIED');
  assert.equal(ctx.state.audits[0].action, 'OUTBOUND_REQUESTED');
});

test('outbound request is blocked by an unresolved repeated-inbound request after the Item token', async t => {
  const ctx = setup(t, { unresolvedReceipt: true });
  await assert.rejects(service.requestOutbound(itemId, ctx.customer), { status: 409, message: /unresolved repeated-inbound request/ });
  assert.equal(ctx.item.status, 'IN_STORAGE');
  assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.reservation.usedCapacityM3, .03);
});

test('legacy outbound request is blocked by a canonical hold after the Item token', async t => {
  const ctx = setup(t, { unresolvedCanonicalOutbound: true });
  await assert.rejects(service.requestOutbound(itemId, ctx.customer), { status: 409, message: /canonical outbound request holds stock/ });
  assert.equal(ctx.item.status, 'IN_STORAGE');
});

test('legacy outbound request fails closed after any canonical v2 stock movement even with gates off', async t => {
  const ctx = setup(t, { canonicalHistory: true });
  await assert.rejects(service.requestOutbound(itemId, ctx.customer), {
    status: 409, message: /Canonical stock history requires the canonical partial-stock workflow/,
  });
  assert.equal(ctx.item.status, 'IN_STORAGE');
  assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.reservation.usedCapacityM3, .03);
});

test('wrong customer and Self-Storage reservation cannot request Managed outbound', async t => {
  const wrong = setup(t, { actorId: otherCustomerId });
  await assert.rejects(service.requestOutbound(itemId, wrong.customer), { status: 404 });
  const selfStorage = setup(t, { serviceType: 'SELF_STORAGE' });
  await assert.rejects(service.requestOutbound(itemId, selfStorage.customer), { status: 409 });
});

test('duplicate request is rejected and overdue rentals require controlled outbound authorization', async t => {
  const pending = setup(t, { status: 'PENDING_OUTBOUND' });
  await assert.rejects(service.requestOutbound(itemId, pending.customer), { status: 409 });
  const overdue = setup(t, { reservationStatus: 'OVERDUE' });
  await assert.rejects(service.requestOutbound(itemId, overdue.customer), { status: 409, message: /controlled-outbound policy/ });
});

test('Staff from another Facility cannot confirm outbound', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND', assignedFacilityId: '507f1f77bcf86cd799439099' });
  await assert.rejects(service.confirmOutbound(itemId, ctx.body, ctx.staff), { status: 403 });
});

test('whole-lot quantity mismatch and invalid handover do not change physical accounting', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND' });
  await assert.rejects(service.confirmOutbound(itemId, { ...ctx.body, verifiedQuantity: 1 }, ctx.staff), { status: 409 });
  await assert.rejects(service.confirmOutbound(itemId, { ...ctx.body, handoverConfirmed: false }, ctx.staff), { status: 400 });
  assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.cell.usedVolumeM3, .03);
  assert.equal(ctx.reservation.usedCapacityM3, .03);
});

test('outbound confirmation is blocked by an unresolved repeated-inbound request before accounting writes', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND', unresolvedReceipt: true });
  await assert.rejects(service.confirmOutbound(itemId, ctx.body, ctx.staff), { status: 409, message: /unresolved repeated-inbound request/ });
  assert.equal(ctx.item.status, 'PENDING_OUTBOUND');
  assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.reservation.usedCapacityM3, .03);
  assert.equal(ctx.state.outbound, null);
});

test('legacy outbound confirmation is blocked by a canonical hold before accounting writes', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND', unresolvedCanonicalOutbound: true });
  await assert.rejects(service.confirmOutbound(itemId, ctx.body, ctx.staff), { status: 409, message: /canonical outbound request holds stock/ });
  assert.equal(ctx.state.outbound, null); assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.reservation.usedCapacityM3, .03);
});

test('legacy confirmation and rejection cannot mutate canonical-history Items', async t => {
  const confirm = setup(t, { status: 'PENDING_OUTBOUND', canonicalHistory: true });
  await assert.rejects(service.confirmOutbound(itemId, confirm.body, confirm.staff), {
    status: 409, message: /Canonical stock history requires the canonical partial-stock workflow/,
  });
  assert.equal(confirm.state.outbound, null); assert.equal(confirm.cell.usedWeightKg, 40);

  const reject = setup(t, { status: 'PENDING_OUTBOUND', canonicalHistory: true });
  await assert.rejects(service.rejectOutbound(itemId, { reason: 'not accepted' }, reject.staff), {
    status: 409, message: /Canonical stock history requires the canonical partial-stock workflow/,
  });
  assert.equal(reject.item.status, 'PENDING_OUTBOUND');
});

test('legacy whole-lot confirmation replay is blocked for canonical movement history', async t => {
  const ctx = setup(t, { status: 'CHECKED_OUT', currentCellId: null, canonicalHistory: true });
  const canonical = ctx.state.movements.find(row => row.schemaVersion === 2);
  canonical.idempotencyKey = ctx.body.idempotencyKey;
  canonical.handoverNote = ctx.body.handoverNote;
  canonical.quantity = ctx.body.verifiedQuantity;
  ctx.state.outbound = canonical;
  ctx.item.outboundMovementId = canonical._id;
  await assert.rejects(service.confirmOutbound(itemId, ctx.body, ctx.staff), {
    status: 409, message: /Canonical stock history requires the canonical partial-stock workflow/,
  });
});

test('successful outbound creates one immutable movement from the original Cell to outside and releases only physical usage', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND' });
  const result = await service.confirmOutbound(itemId, ctx.body, ctx.staff);
  assert.equal(result.item.status, 'CHECKED_OUT'); assert.equal(result.item.currentCellId, null);
  assert.equal(result.movement.type, 'OUTBOUND');
  assert.equal(String(result.movement.sourceCellId), cellId); assert.equal(result.movement.destinationCellId, null);
  assert.equal(result.movement.actualTotalWeightKg, 40); assert.equal(result.movement.actualTotalVolumeM3, .03);
  assert.equal(ctx.cell.usedWeightKg, 0); assert.equal(ctx.cell.usedVolumeM3, 0);
  assert.equal(ctx.reservation.usedCapacityM3, 0); assert.equal(ctx.reservation.status, 'ACTIVE');
  assert.equal(ctx.state.outbound.type, 'OUTBOUND'); assert.equal(ctx.state.audits[0].action, 'OUTBOUND_CONFIRMED');
  assert.equal(ctx.allocation.status, 'RESERVED'); assert.equal(ctx.state.otherAllocation.status, 'RESERVED');
});

test('outbound accounting reads run sequentially on their shared transaction session', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND' });
  await service.confirmOutbound(itemId, ctx.body, ctx.staff);
  assert.equal(ctx.state.itemFindExecution.maxActive, 1);
  assert.equal(ctx.state.itemFindExecution.sessions.length, 2);
  assert.strictEqual(ctx.state.itemFindExecution.sessions[0], ctx.session);
  assert.strictEqual(ctx.state.itemFindExecution.sessions[1], ctx.session);
});

test('Cell allocation stays OCCUPIED when another stored lot remains in that Cell', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND', otherStored: true });
  await service.confirmOutbound(itemId, ctx.body, ctx.staff);
  assert.equal(ctx.allocation.status, 'OCCUPIED');
});

test('missing inbound evidence and inconsistent or negative counters fail closed', async t => {
  for (const options of [{ inboundMissing: true }, { usedWeightKg: 39 }, { usedVolumeM3: .02 }, { usedCapacityM3: 0 }, { usedWeightKg: -1 }]) {
    await t.test(JSON.stringify(options), async t => {
      const ctx = setup(t, { status: 'PENDING_OUTBOUND', ...options });
      await assert.rejects(service.confirmOutbound(itemId, ctx.body, ctx.staff), { status: 409 });
      assert.equal(ctx.item.status, 'PENDING_OUTBOUND'); assert.equal(ctx.cell.usedVolumeM3, options.usedVolumeM3 ?? .03);
      assert.equal(ctx.state.outbound, null);
    });
  }
});

test('same idempotency key and payload replays; changed payload conflicts', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND' });
  const first = await service.confirmOutbound(itemId, ctx.body, ctx.staff);
  const replay = await service.confirmOutbound(itemId, ctx.body, ctx.staff);
  assert.equal(first.idempotentReplay, false); assert.equal(replay.idempotentReplay, true);
  await assert.rejects(service.confirmOutbound(itemId, { ...ctx.body, handoverNote: 'Different payload' }, ctx.staff),
    { status: 409, message: /different outbound payload/ });
  assert.equal(ctx.cell.usedWeightKg, 0); assert.equal(ctx.reservation.usedCapacityM3, 0);
});

test('concurrent outbound confirmations decrement counters and create a movement once', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND' });
  const results = await Promise.all([service.confirmOutbound(itemId, ctx.body, ctx.staff), service.confirmOutbound(itemId, ctx.body, ctx.staff)]);
  assert.equal(results.filter(row => !row.idempotentReplay).length, 1);
  assert.equal(results.filter(row => row.idempotentReplay).length, 1);
  assert.equal(ctx.cell.usedWeightKg, 0); assert.equal(ctx.cell.usedVolumeM3, 0);
  assert.equal(ctx.reservation.usedCapacityM3, 0);
});

test('movement failure rolls back outbound item, counters, allocation and audit', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND', movementFailure: true });
  await assert.rejects(service.confirmOutbound(itemId, ctx.body, ctx.staff), { status: 500 });
  assert.equal(ctx.item.status, 'PENDING_OUTBOUND'); assert.equal(String(ctx.item.currentCellId), cellId);
  assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.cell.usedVolumeM3, .03);
  assert.equal(ctx.reservation.usedCapacityM3, .03); assert.equal(ctx.allocation.status, 'OCCUPIED');
  assert.equal(ctx.state.outbound, null); assert.equal(ctx.state.audits.length, 0);
});

test('Staff rejection returns item to IN_STORAGE without changing location or counters', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND' });
  const result = await service.rejectOutbound(itemId, { reason: 'Customer identity could not be verified' }, ctx.staff);
  assert.equal(result.status, 'IN_STORAGE'); assert.equal(String(result.currentCellId), cellId);
  assert.equal(result.outboundRejection.reason, 'Customer identity could not be verified');
  assert.equal(ctx.cell.usedWeightKg, 40); assert.equal(ctx.cell.usedVolumeM3, .03);
  assert.equal(ctx.reservation.usedCapacityM3, .03); assert.equal(ctx.allocation.status, 'OCCUPIED');
  assert.equal(ctx.state.audits[0].action, 'OUTBOUND_REJECTED');
});

test('legacy outbound rejection cannot change an Item while canonical holds exist', async t => {
  const ctx = setup(t, { status: 'PENDING_OUTBOUND', unresolvedCanonicalOutbound: true });
  await assert.rejects(service.rejectOutbound(itemId, { reason: 'test rejection' }, ctx.staff), { status: 409, message: /canonical outbound request holds stock/ });
  assert.equal(ctx.item.status, 'PENDING_OUTBOUND'); assert.equal(ctx.cell.usedWeightKg, 40);
});

test('legacy version 1 Managed reservation remains eligible during its active term', async t => {
  const ctx = setup(t, { status: 'IN_STORAGE' });
  const result = await service.requestOutbound(itemId, ctx.customer);
  assert.equal(result.status, 'PENDING_OUTBOUND');
});

test('movement schema accepts legacy INBOUND shape and the OUTBOUND source-to-outside shape', async () => {
  const inbound = new Movement(makeInbound());
  await inbound.validate();
  const outbound = new Movement({ ...makeInbound(), _id: undefined, type: 'OUTBOUND', sourceCellId: oid(cellId), destinationCellId: null,
    inspectionNote: undefined, handoverNote: 'Handed to customer', idempotencyKey: 'outbound-001' });
  await outbound.validate();
});
