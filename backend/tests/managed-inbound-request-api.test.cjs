const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test', MI06_REPEATED_INBOUND_ENABLED: 'true', MONGO_URL: 'mongodb://localhost/test',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-only', KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Request = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const Event = require('../dist/models/inventory-items/inventory-inbound-request-event.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const { ManagedInboundRequestService: service } = require('../dist/services/inventory-items/managed-inbound-request.service');

const oid = value => new mongoose.Types.ObjectId(value);
const ids = {
  item: '507f1f77bcf86cd799439001', customer: '507f1f77bcf86cd799439002', reservation: '507f1f77bcf86cd799439003',
  facility: '507f1f77bcf86cd799439004', cell: '507f1f77bcf86cd799439005', inbound: '507f1f77bcf86cd799439006',
  movementOut: '507f1f77bcf86cd799439007', request: '507f1f77bcf86cd799439008',
};
const payload = () => ({ requestedQuantity: 3, quantityUnit: 'box', declaredUnitWeightKg: 2.5,
  declaredUnitDimensionsM: { widthM: .2, depthM: .3, heightM: .4 } });

class Query {
  constructor(value, onSession) { this.value = value; this.onSession = onSession; }
  session(session) { this.sessionValue = session; this.onSession?.(session); return this; }
  select() { return this; }
  lean() { return this; }
  sort() { return this; }
  skip() { return this; }
  limit() { return this; }
  exec() { return Promise.resolve(typeof this.value === 'function' ? this.value() : this.value); }
}

function movement(type = 'INBOUND', overrides = {}) {
  return { _id: oid(ids.inbound), itemId: oid(ids.item), managedReservationId: oid(ids.reservation),
    facilityId: oid(ids.facility), customerId: oid(ids.customer), type, sourceCellId: null, destinationCellId: oid(ids.cell),
    quantity: 2, quantityUnit: 'box', actualUnitWeightKg: 2.5, actualTotalWeightKg: 5,
    actualUnitDimensionsM: { widthM: .2, depthM: .3, heightM: .4 }, actualTotalVolumeM3: .048,
    performedAt: new Date('2026-10-01T00:00:00Z'), inspectionNote: 'Received', idempotencyKey: 'legacy-inbound-001', ...overrides };
}

function setup(t, options = {}) {
  const session = { withTransaction: async work => {
    const before = { requests: state.requests.map(row => ({ ...row })), events: state.events.map(row => ({ ...row })), inventoryVersion: state.reservation.inventoryVersion };
    state.transactionOps = [];
    try {
      const result = await work(session);
      if (options.unknownCommitAfterPersist || options.unknownCommitWithoutPersist || options.transientNoPersist || options.duplicateRaceAfterPersist) {
        const error = options.transientNoPersist ? new Error('simulated transient transaction failure') :
          options.duplicateRaceAfterPersist ? Object.assign(new Error('simulated duplicate request key'), { code: 11000 }) :
            new Error('simulated unknown transaction commit result');
        if (!options.duplicateRaceAfterPersist) error.errorLabels = [options.transientNoPersist ? 'TransientTransactionError' : 'UnknownTransactionCommitResult'];
        if (options.unknownCommitWithoutPersist) {
          state.requests = before.requests; state.events = before.events; state.reservation.inventoryVersion = before.inventoryVersion;
        }
        throw error;
      }
      return result;
    }
    catch (error) {
      if (!options.unknownCommitAfterPersist && !options.duplicateRaceAfterPersist) {
        state.requests = before.requests; state.events = before.events; state.reservation.inventoryVersion = before.inventoryVersion;
        if (options.duplicateOtherKeyOnSave && state.concurrentRequest) state.requests.push(state.concurrentRequest);
      }
      throw error;
    }
  }, endSession: async () => {} };
  const item = {
    _id: oid(ids.item), customerId: oid(ids.customer), managedReservationId: oid(ids.reservation), facilityId: oid(ids.facility),
    quantity: 900, quantityUnit: 'box', unitWeightKg: 999, unitDimensionsM: { widthM: 9, depthM: 9, heightM: 9 },
    status: options.status ?? 'IN_STORAGE', currentCellId: options.currentCellId === null ? null : oid(ids.cell),
    currentPlacementMovementId: null, outboundMovementId: options.outboundMovementId ? oid(ids.movementOut) : null,
  };
  const inbound = movement();
  const outbound = movement('OUTBOUND', { _id: oid(ids.movementOut), sourceCellId: oid(ids.cell), destinationCellId: null,
    actualTotalWeightKg: 5, actualTotalVolumeM3: .048, performedAt: new Date('2026-10-02T00:00:00Z'), handoverNote: 'Handed over' });
  const state = {
    requests: [], events: [], transactionOps: [], reservationCalls: 0,
    reservation: { _id: oid(ids.reservation), customerId: oid(ids.customer), facilityId: oid(ids.facility),
      serviceType: 'MANAGED_INVENTORY', status: options.reservationStatus ?? 'ACTIVE',
      startDate: new Date('2026-10-01T00:00:00Z'), endDate: new Date('2026-12-01T00:00:00Z'), inventoryVersion: 0 },
    item, movements: options.movements ?? (options.status === 'CHECKED_OUT' ? [inbound, outbound] : [inbound]),
  };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Item, 'findOne', filter => {
    state.transactionOps.push(filter && filter.managedReservationId ? 'Item.read' : 'Item.preflight');
    const plain = { _id: item._id, customerId: item.customerId, facilityId: item.facilityId,
      managedReservationId: item.managedReservationId, quantityUnit: item.quantityUnit };
    return new Query(options.wrongOwner || (filter.customerId && !oid(filter.customerId).equals(item.customerId)) ? null :
      (filter.managedReservationId ? item : plain));
  });
  t.mock.method(Item, 'findOneAndUpdate', (filter, update, config) => {
    state.transactionOps.push('Item.token');
    assert.equal(String(filter._id), ids.item); assert.equal(String(filter.customerId), ids.customer);
    assert.equal(String(filter.managedReservationId), ids.reservation); assert.equal(String(filter.facilityId), ids.facility);
    assert.deepEqual(filter.status.$in, ['IN_STORAGE', 'CHECKED_OUT']);
    assert.equal(update.$inc.__v, 1); assert.equal(config.session, session);
    return new Query(options.status && !filter.status.$in.includes(options.status) ? null : item);
  });
  t.mock.method(Reservation, 'findOneAndUpdate', (filter, update, config) => {
    state.reservationCalls += 1;
    state.transactionOps.push('Reservation.token');
    assert.equal(filter.serviceType, 'MANAGED_INVENTORY');
    assert.equal(filter.status, 'ACTIVE');
    assert.ok(filter.startDate.$lte instanceof Date); assert.ok(filter.endDate.$gt instanceof Date);
    assert.equal(update.$inc.inventoryVersion, 1); assert.equal(config.session, session);
    if (options.reservationStatus !== undefined && options.reservationStatus !== 'ACTIVE') return new Query(null);
    state.reservation.inventoryVersion += 1;
    return new Query(state.reservation);
  });
  t.mock.method(Facility, 'findOne', () => new Query({ _id: oid(ids.facility), status: 'ACTIVE', serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Movement, 'find', () => new Query(state.movements));
  t.mock.method(Cell, 'findOne', () => new Query({ _id: oid(ids.cell), facilityId: oid(ids.facility) }));
  t.mock.method(Allocation, 'findOne', () => new Query({ status: 'OCCUPIED', cellId: oid(ids.cell), reservationId: oid(ids.reservation) }));
  t.mock.method(Request, 'findOne', filter => new Query(() => {
    if (filter.requestIdempotencyKey) return state.requests.find(row => String(row.itemId) === String(filter.itemId) && row.requestIdempotencyKey === filter.requestIdempotencyKey) ?? null;
    if (filter.itemId) return state.requests.find(row => String(row.itemId) === String(filter.itemId) &&
      (row.state === 'PENDING_INSPECTION' || row.state === 'DISCREPANCY' || row.state === 'ACCEPTED_PENDING_CONFIRMATION' || row.state === 'RETURN_PENDING')) ?? null;
    const row = state.requests.find(candidate => String(candidate._id) === String(filter._id) && String(candidate.customerId) === String(filter.customerId));
    return row ? new Request(row) : null;
  }));
  t.mock.method(Request, 'find', filter => new Query(state.requests.filter(row => String(row.itemId) === String(filter.itemId) && String(row.customerId) === String(filter.customerId))));
  t.mock.method(Request, 'countDocuments', filter => new Query(state.requests.filter(row => String(row.itemId) === String(filter.itemId) && String(row.customerId) === String(filter.customerId)).length));
  t.mock.method(Request.prototype, 'save', async function () {
    if (options.duplicateOtherKeyOnSave && this.isNew) {
      state.concurrentRequest = { _id: oid('507f1f77bcf86cd799439010'), itemId: oid(ids.item), customerId: oid(ids.customer),
        requestIdempotencyKey: 'receipt-create-otherkey', creationPayloadHash: 'a'.repeat(64), state: 'PENDING_INSPECTION' };
      const error = new Error('simulated partial unique unresolved request index'); error.code = 11000; throw error;
    }
    const index = state.requests.findIndex(row => String(row._id) === String(this._id));
    if (index >= 0) this.version = state.requests[index].version + 1;
    else { this._id ??= oid(ids.request); this.version = 0; }
    this.updatedAt = new Date('2026-10-25T00:00:00Z');
    const row = this.toObject();
    if (index >= 0) state.requests[index] = row; else state.requests.push(row);
    this.isNew = false;
    return this;
  });
  let eventReads = 0;
  t.mock.method(Event, 'findOne', filter => new Query(() => {
    eventReads += 1;
    if (options.hideEventForReads && eventReads <= options.hideEventForReads) return null;
    return state.events.find(row =>
    String(row.customerId) === String(filter.customerId) && row.scopeType === filter.scopeType &&
    String(row.scopeId) === String(filter.scopeId) && row.operation === filter.operation && row.idempotencyKey === filter.idempotencyKey) ?? null;
  }));
  t.mock.method(Event.prototype, 'save', async function () {
    if (options.failEventSave) throw new Error('simulated event write failure');
    const row = this.toObject(); state.events.push(row); this.isNew = false; return this;
  });
  return { state, session, customer: { _id: oid(ids.customer), role: 'CUSTOMER' }, otherCustomer: { _id: oid('507f1f77bcf86cd799439009'), role: 'CUSTOMER' } };
}

test('CREATE acquires the conditional Item token before Reservation, then persists request and event atomically', async t => {
  const ctx = setup(t);
  const result = await service.create(ids.item, payload(), 'receipt-create-0001', ctx.customer);
  assert.equal(result.replayed, false);
  const dto = result.data;
  assert.equal(dto.state, 'PENDING_INSPECTION'); assert.equal(dto.version, 0);
  assert.equal(ctx.state.requests.length, 1); assert.equal(ctx.state.events.length, 1);
  assert.equal(ctx.state.events[0].resultingVersion, dto.version);
  assert.deepEqual(ctx.state.transactionOps.slice(0, 3), ['Item.token', 'Reservation.token', 'Item.read']);
  assert.equal(ctx.state.reservation.inventoryVersion, 1);
});

test('CREATE replays the original response after later request state changes and rejects key payload conflicts', async t => {
  const ctx = setup(t);
  const first = await service.create(ids.item, payload(), 'receipt-create-0002', ctx.customer);
  ctx.state.requests[0].state = 'CANCELLED'; ctx.state.requests[0].version = 1;
  const replay = await service.create(ids.item, payload(), 'receipt-create-0002', ctx.customer);
  assert.equal(replay.replayed, true);
  assert.equal(replay.data.state, 'PENDING_INSPECTION'); assert.equal(replay.data.version, 0);
  assert.equal(ctx.state.events.length, 1);
  await assert.rejects(service.create(ids.item, { ...payload(), requestedQuantity: 8 }, 'receipt-create-0002', ctx.customer), { code: 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT' });
  assert.equal(first.data.state, 'PENDING_INSPECTION');
});

test('CREATE rejects a different idempotency key while an unresolved request exists', async t => {
  const ctx = setup(t);
  await service.create(ids.item, payload(), 'receipt-create-0003', ctx.customer);
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-0004', ctx.customer), { code: 'INBOUND_REQUEST_UNRESOLVED_EXISTS' });
  assert.equal(ctx.state.requests.length, 1); assert.equal(ctx.state.events.length, 1);
});

test('CREATE enforces ownership, ACTIVE in-term Managed scope, and Item quantity unit', async t => {
  const owner = setup(t, { wrongOwner: true });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-0005', owner.otherCustomer), { status: 404 });
  const expired = setup(t, { reservationStatus: 'CLOSED' });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-0006', expired.customer), { code: 'INBOUND_REQUEST_INELIGIBLE' });
  const wrongUnit = setup(t);
  await assert.rejects(service.create(ids.item, { ...payload(), quantityUnit: 'pallet' }, 'receipt-create-0007', wrongUnit.customer), { code: 'INBOUND_REQUEST_INELIGIBLE' });
});

test('CREATE accepts positive reconciled IN_STORAGE stock and rejects CHECKED_OUT without matching terminal OUTBOUND', async t => {
  const stored = setup(t);
  assert.equal((await service.create(ids.item, payload(), 'receipt-create-0008', stored.customer)).data.state, 'PENDING_INSPECTION');
  const checkedOut = setup(t, { status: 'CHECKED_OUT', currentCellId: null, outboundMovementId: true });
  assert.equal((await service.create(ids.item, payload(), 'receipt-create-0009', checkedOut.customer)).data.state, 'PENDING_INSPECTION');
  const malformed = setup(t, { status: 'CHECKED_OUT', currentCellId: null, outboundMovementId: false, movements: [] });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-0010', malformed.customer), { code: 'ITEM_PROJECTION_MISMATCH' });
});

test('CREATE refuses PENDING_OUTBOUND and other ineligible Item states before Reservation token', async t => {
  const pending = setup(t, { status: 'PENDING_OUTBOUND' });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-pending-outbound', pending.customer), { code: 'INBOUND_REQUEST_INELIGIBLE' });
  assert.deepEqual(pending.state.transactionOps.slice(0, 1), ['Item.token']);
  assert.equal(pending.state.reservationCalls, 0);
});

test('CREATE and PATCH reject malformed nested dimensions without stripping fields', async t => {
  const invalid = [
    null,
    [],
    { widthM: 1, depthM: 2 },
    { widthM: 1, depthM: 2, heightM: 3, lengthM: 4 },
    { widthM: '1', depthM: 2, heightM: 3 },
    { widthM: 1, depthM: Number.POSITIVE_INFINITY, heightM: 3 },
    Object.create(null),
    JSON.parse('{"widthM":1,"depthM":2,"heightM":3,"__proto__":{"polluted":true}}'),
  ];
  const ctx = setup(t);
  for (let index = 0; index < invalid.length; index += 1) {
    await assert.rejects(service.create(ids.item, { ...payload(), declaredUnitDimensionsM: invalid[index] }, `receipt-dim-${String(index).padStart(8, '0')}`, ctx.customer), { code: 'INBOUND_REQUEST_INVALID' });
  }
  const created = await service.create(ids.item, payload(), 'receipt-create-dimensions', ctx.customer);
  await assert.rejects(service.amend(created.data._id, { declaredUnitDimensionsM: { widthM: 1, depthM: 2, heightM: 3, extra: 4 } },
    '"0"', 'receipt-amend-dims-0001', ctx.customer), { code: 'INBOUND_REQUEST_INVALID' });
});

test('CREATE service discriminator and controller return 201 for new and 200 for replay while preserving DTO and ETag', async t => {
  const { create } = require('../dist/controllers/inventory-items/inventory-inbound-request.controller');
  const dto = { _id: ids.request, version: 0, state: 'PENDING_INSPECTION' };
  let replayed = false;
  t.mock.method(service, 'create', async () => ({ data: dto, replayed }));
  async function invoke() {
    const response = { statusCode: 200, headers: {}, body: null,
      status(code) { this.statusCode = code; return this; },
      set(name, value) { this.headers[name] = value; return this; },
      json(body) { this.body = body; return this; },
    };
    await create({ params: { itemId: ids.item }, body: payload(), user: { _id: oid(ids.customer), role: 'CUSTOMER' }, get: () => 'receipt-http-0001' }, response, error => { throw error; });
    return response;
  }
  const created = await invoke();
  assert.equal(created.statusCode, 201);
  assert.equal(created.headers.ETag, '"0"');
  assert.deepEqual(created.body, { success: true, data: dto });
  replayed = true;
  const replay = await invoke();
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.headers.ETag, '"0"');
  assert.deepEqual(replay.body, { success: true, data: dto });
});

test('unknown commit returns the visible original snapshot after bounded replay lookup; absent outcome is 503', async t => {
  const committed = setup(t, { unknownCommitAfterPersist: true, hideEventForReads: 3 });
  const replay = await service.create(ids.item, payload(), 'receipt-create-unknown1', committed.customer);
  assert.equal(replay.replayed, true);
  assert.equal(replay.data.state, 'PENDING_INSPECTION');
  assert.equal(committed.state.requests.length, 1); assert.equal(committed.state.events.length, 1);

  const uncertain = setup(t, { unknownCommitWithoutPersist: true });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-unknown2', uncertain.customer),
    { status: 503, code: 'INBOUND_REQUEST_OUTCOME_UNKNOWN' });
  assert.equal(uncertain.state.requests.length, 0); assert.equal(uncertain.state.events.length, 0);
});

test('transient transaction recovery is bounded and maps an uncommitted race to a retryable conflict', async t => {
  const ctx = setup(t, { transientNoPersist: true });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-transient', ctx.customer),
    { status: 409, code: 'INBOUND_REQUEST_VERSION_CONFLICT' });
  assert.equal(ctx.state.requests.length, 0); assert.equal(ctx.state.events.length, 0);
});

test('duplicate-key recovery returns the committed same-key snapshot and maps another unresolved key to stable 409', async t => {
  const winner = setup(t, { duplicateRaceAfterPersist: true, hideEventForReads: 1 });
  const replay = await service.create(ids.item, payload(), 'receipt-create-duplicate1', winner.customer);
  assert.equal(replay.replayed, true);
  assert.equal(winner.state.requests.length, 1); assert.equal(winner.state.events.length, 1);

  const other = setup(t, { duplicateOtherKeyOnSave: true });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-duplicate2', other.customer),
    { status: 409, code: 'INBOUND_REQUEST_UNRESOLVED_EXISTS' });
});

test('AMEND uses partial payload, If-Match CAS and operation-scoped replay event', async t => {
  const ctx = setup(t);
  const created = await service.create(ids.item, payload(), 'receipt-create-0011', ctx.customer);
  const amended = await service.amend(created.data._id, { requestedQuantity: 5 }, '"0"', 'receipt-amend-0001', ctx.customer);
  assert.equal(amended.requestedQuantity, 5); assert.equal(amended.version, 1);
  assert.equal(ctx.state.events[1].resultingVersion, 1);
  assert.equal((await service.amend(created.data._id, { requestedQuantity: 5 }, '"0"', 'receipt-amend-0001', ctx.customer)).version, 1);
  await assert.rejects(service.amend(created.data._id, { requestedQuantity: 6 }, '"0"', 'receipt-amend-0001', ctx.customer), { code: 'INBOUND_REQUEST_IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.amend(created.data._id, { requestedQuantity: 6 }, '"0"', 'receipt-amend-0002', ctx.customer), { code: 'INBOUND_REQUEST_VERSION_CONFLICT' });
});

test('AMEND refuses inspection history, custody, wrong owner, and inactive rental', async t => {
  const ctx = setup(t);
  const created = await service.create(ids.item, payload(), 'receipt-create-0012', ctx.customer);
  const row = ctx.state.requests[0]; row.currentInspectionAttemptId = oid(ids.movementOut);
  await assert.rejects(service.amend(created.data._id, { requestedQuantity: 4 }, '"0"', 'receipt-amend-0003', ctx.customer), { code: 'INBOUND_REQUEST_INELIGIBLE' });
  await assert.rejects(service.get(created.data._id, ctx.otherCustomer), { status: 404 });
});

test('CANCEL is owner/version scoped and remains available after rental expiry without Reservation lock', async t => {
  const ctx = setup(t);
  const created = await service.create(ids.item, payload(), 'receipt-create-0013', ctx.customer);
  ctx.state.reservation.status = 'CLOSED';
  const cancelled = await service.cancel(created.data._id, '"0"', 'receipt-cancel-0001', ctx.customer);
  assert.equal(cancelled.state, 'CANCELLED'); assert.equal(cancelled.version, 1);
  assert.equal(ctx.state.reservationCalls, 1, 'only CREATE acquired the reservation token');
  assert.equal(ctx.state.events.at(-1).resultingVersion, 1);
});

test('CANCEL rejects a stale version and a request with inspection/custody history', async t => {
  const ctx = setup(t);
  const created = await service.create(ids.item, payload(), 'receipt-create-0014', ctx.customer);
  await assert.rejects(service.cancel(created.data._id, '"2"', 'receipt-cancel-0002', ctx.customer), { code: 'INBOUND_REQUEST_VERSION_CONFLICT' });
  ctx.state.requests[0].custodyState = 'IN_CUSTODY';
  await assert.rejects(service.cancel(created.data._id, '"0"', 'receipt-cancel-0003', ctx.customer), { code: 'INBOUND_REQUEST_INELIGIBLE' });
});

test('GET preserves owner history after Reservation closure and pagination is stable', async t => {
  const ctx = setup(t);
  const created = await service.create(ids.item, payload(), 'receipt-create-0015', ctx.customer);
  ctx.state.reservation.status = 'CLOSED';
  assert.equal((await service.get(created.data._id, ctx.customer))._id, created.data._id);
  const list = await service.listForItem(ids.item, { page: '1', limit: '10' }, ctx.customer);
  assert.equal(list.pagination.total, 1); assert.equal(list.data[0]._id, created.data._id);
});

test('gate OFF blocks CREATE and AMEND, but permits owner GET/history and lifecycle-safe CANCEL', async t => {
  const ctx = setup(t);
  const created = await service.create(ids.item, payload(), 'receipt-gate-create', ctx.customer);
  process.env.MI06_REPEATED_INBOUND_ENABLED = 'false';
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-0016', { _id: oid(ids.customer), role: 'CUSTOMER' }), { code: 'INBOUND_REQUEST_FEATURE_DISABLED' });
  await assert.rejects(service.amend(created.data._id, { requestedQuantity: 4 }, '"0"', 'receipt-gate-amend', ctx.customer), { code: 'INBOUND_REQUEST_FEATURE_DISABLED' });
  assert.equal((await service.get(created.data._id, ctx.customer))._id, created.data._id);
  assert.equal((await service.listForItem(ids.item, { page: 1, limit: 10 }, ctx.customer)).pagination.total, 1);
  const cancelled = await service.cancel(created.data._id, '"0"', 'receipt-gate-cancel', ctx.customer);
  assert.equal(cancelled.state, 'CANCELLED');
  process.env.MI06_REPEATED_INBOUND_ENABLED = 'true';
  const inspected = await service.create(ids.item, payload(), 'receipt-gate-inspected', ctx.customer);
  process.env.MI06_REPEATED_INBOUND_ENABLED = 'false';
  ctx.state.requests[1].currentInspectionAttemptId = oid(ids.movementOut);
  await assert.rejects(service.cancel(inspected.data._id, '"0"', 'receipt-gate-unsafe', ctx.customer), { code: 'INBOUND_REQUEST_INELIGIBLE' });
  process.env.MI06_REPEATED_INBOUND_ENABLED = 'true'; process.env.NODE_ENV = 'production';
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-0017', { _id: oid(ids.customer), role: 'CUSTOMER' }), { code: 'INBOUND_REQUEST_FEATURE_DISABLED' });
  process.env.NODE_ENV = 'test';
  process.env.MI06_REPEATED_INBOUND_ENABLED = 'true';
});

test('request and event writes roll back together when event append fails', async t => {
  const ctx = setup(t, { failEventSave: true });
  await assert.rejects(service.create(ids.item, payload(), 'receipt-create-0018', ctx.customer), /simulated event write failure/);
  assert.equal(ctx.state.requests.length, 0); assert.equal(ctx.state.events.length, 0);
});

test('event model declares operation-scoped idempotency and committed-version uniqueness', () => {
  const indexes = Event.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.scopeType === 1 && keys.scopeId === 1 && keys.operation === 1 && keys.idempotencyKey === 1 && options.unique));
  assert.ok(indexes.some(([keys, options]) => keys.requestId === 1 && keys.resultingVersion === 1 && options.unique));
});
