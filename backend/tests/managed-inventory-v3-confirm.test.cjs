const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { Types } = mongoose;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Contract = require('../dist/models/contracts/contract.model').default;
const AccessSession = require('../dist/models/access/managed-access-session.model').default;
const ItemSpec = require('../dist/models/inventory-items/item-specification.model').default;
const CellStock = require('../dist/models/inventory-items/managed-cell-stock.model').default;
const ItemInstance = require('../dist/models/inventory-items/managed-item-instance.model').default;
const StockProjection = require('../dist/models/inventory-items/managed-v3-stock-projection.model').default;
const BatchPlacement = require('../dist/models/inventory-items/managed-v3-batch-placement.model').default;
const PhysicalUnit = require('../dist/models/inventory-items/managed-v3-physical-unit.model').default;
const Footprint = require('../dist/models/inventory-items/managed-v3-footprint.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const InventoryStockBalance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const { ManagedInventoryV3Service } = require('../dist/services/inventory-items/managed-inventory-v3.service');
const { ManagedUnifiedInboundService } = require('../dist/services/inventory-items/managed-unified-inbound.service');
const { ManagedUnifiedInboundDomainError, normalizeUnifiedInbound, measurementSnapshot, assertUnifiedInboundCapacity } = require('../dist/services/inventory-items/managed-unified-inbound.domain');

const oid = () => new Types.ObjectId();
const ids = { sku: oid(), customer: oid(), reservation: oid(), facility: oid(), session: oid(), spec: oid(), cellA: oid(), cellB: oid() };
const actor = { _id: ids.customer, role: 'CUSTOMER' };
class Query {
  constructor(value) { this.value = value; }
  session() { return this; } lean() { return this; } sort() { return this; } select() { return this; }
  populate() { return this; } limit() { return this; }
  exec() { return Promise.resolve(this.value); }
}
const body = (overrides = {}) => ({ accessSessionId: ids.session.toString(), sessionRevision: 4, skuRevision: 7,
  lines: [{ lineId: 'lot-10', itemSpecId: ids.spec.toString(), itemSpecRevision: 3, quantity: 10, measurementMode: 'SPECIFICATION',
    cellAllocations: [{ cellId: ids.cellA.toString(), quantity: 6 }, { cellId: ids.cellB.toString(), quantity: 4 }] }], ...overrides });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value instanceof Types.ObjectId ? value :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const requestHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function mockActiveReservation(t, { skuRevision = 7, reservationRow, accessSessionRow = null } = {}) {
  const now = Date.now();
  const sku = { _id: ids.sku, customerId: ids.customer, facilityId: ids.facility, reservationId: ids.reservation,
    inventorySchemaVersion: 3, skuStatus: 'ACTIVE', managedV3Revision: skuRevision };
  const reservation = reservationRow ?? { _id: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, status: 'ACTIVE', startDate: new Date(now - 60_000),
    endDate: new Date(now + 3_600_000), handoverAt: new Date(now - 30_000), handoverByStaffId: oid(),
    allocatedCellIds: [ids.cellA, ids.cellB], allocatedCapacity: 5, usedCapacityM3: 0, inventoryVersion: 2 };
  const contentHash = 'a'.repeat(64);
  const contract = { status: 'SIGNED', signedByCustomerAt: new Date(), signedByFMAt: new Date(), currentContentVersion: 1,
    contentVersions: [{ version: 1, contentHash }], signatures: [
      { version: 1, contentHash, signerRole: 'CUSTOMER' }, { version: 1, contentHash, signerRole: 'FACILITY_STAFF' },
    ] };
  t.mock.method(Item, 'findOne', () => new Query(sku));
  let reservationFilter;
  t.mock.method(Reservation, 'findOne', filter => { reservationFilter = filter; return new Query(reservation); });
  t.mock.method(Contract, 'findOne', () => new Query(contract));
  t.mock.method(AccessSession, 'findOne', () => new Query(accessSessionRow));
  return { sku, reservation, contract, get reservationFilter() { return reservationFilter; } };
}

function mockPreviewWorld(t, { skuRevision = 7, cellMaxWeightKg = 100, cellWidthM = 1, accessPurpose = 'INBOUND', sessionRevision = 4 } = {}) {
  const world = mockActiveReservation(t, { skuRevision, accessSessionRow: { _id: ids.session, customerId: ids.customer,
    reservationId: ids.reservation, facilityId: ids.facility, status: 'ACTIVE', allowedPurposes: [accessPurpose], revision: sessionRevision,
    startedAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000), allowedCellIds: [ids.cellA, ids.cellB] } });
  const spec = { _id: ids.spec, skuId: ids.sku, customerId: ids.customer, reservationId: ids.reservation, facilityId: ids.facility,
    status: 'ACTIVE', revision: 3, name: 'Test Spec', code: 'SPEC-TEST', quantityUnitId: { code: 'box', name: 'box' },
    unitWeightKg: 1, dimensionsM: { widthM: .1, depthM: .1, heightM: .1 } };
  const cells = [ids.cellA, ids.cellB].map((cellId, index) => ({ _id: cellId, facilityId: ids.facility, rackId: oid(), levelNumber: 1,
    code: `CELL-${index + 1}`, operationalStatus: 'AVAILABLE', maxWeightKg: cellMaxWeightKg, usedWeightKg: 0, usedVolumeM3: 0,
    managedInventoryRevision: 0, allocationVersion: 1, dimensions: { widthM: cellWidthM, depthM: 1, usableHeightM: 1 } }));
  const rackIds = [...new Map(cells.map(cell => [String(cell.rackId), cell.rackId])).values()];
  const allocations = cells.map(cell => ({ reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    cellId: cell._id, status: 'OCCUPIED', startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 60_000) }));
  t.mock.method(ItemSpec, 'find', () => new Query([spec]));
  t.mock.method(Cell, 'find', () => new Query(cells));
  t.mock.method(Rack, 'find', () => new Query(rackIds.map(_id => ({ _id, facilityId: ids.facility, operationalStatus: 'AVAILABLE', maxWeightKgPerLevel: 1000 }))));
  t.mock.method(Allocation, 'find', filter => new Query(filter.reservationId ? allocations : []));
  t.mock.method(Movement, 'find', () => new Query([]));
  t.mock.method(CellStock, 'find', () => new Query([]));
  t.mock.method(ItemInstance, 'find', () => new Query([]));
  t.mock.method(Reservation, 'find', () => new Query([world.reservation]));
  t.mock.method(Item, 'find', () => new Query([]));
  for (const model of [InventoryStockBalance, StockProjection, BatchPlacement, PhysicalUnit, Footprint]) {
    t.mock.method(model, 'find', () => new Query([]));
  }
  return { ...world, spec, cells, allocations };
}

test('legacy inbound preview and confirm remain explicitly fail-closed', async () => {
  await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), {}, actor, 'legacy-inbound-key-01'), error =>
    error.status === 410 && error.code === 'STOCK_WORKFLOW_NOT_AVAILABLE');
});

test('Unified Inbound A2 DTO accepts quantity 10 allocated across Cells without client totals', () => {
  const result = normalizeUnifiedInbound(body());
  assert.equal(result.lines[0].quantity, 10);
  assert.deepEqual(result.lines[0].cellAllocations.map(row => row.quantity), [6, 4]);
  assert.equal(result.skuRevision, 7);
  assert.equal(result.sessionRevision, 4);
  assert.throws(() => normalizeUnifiedInbound(body({ clientTotalWeightKg: 10 })), { code: 'INVALID_INPUT' });
});

test('Unified Inbound A2 preview produces server-priced spec snapshot and Cell allocation totals', async t => {
  mockPreviewWorld(t);
  const preview = await ManagedUnifiedInboundService.preview(ids.sku.toString(), body(), actor);
  assert.equal(preview.status, 'READY');
  assert.equal(preview.totalQuantity, 10);
  assert.equal(preview.totalWeightKg, 10);
  assert.equal(preview.totalVolumeM3, .01);
  assert.equal(preview.lines[0].itemName, 'Test Spec');
  assert.deepEqual(preview.lines[0].cellAllocations.map(row => row.addedWeightKg), [6, 4]);
  assert.equal(preview.previewRevision.skuRevision, 7);
  assert.equal(preview.previewRevision.sessionRevision, 4);
  assert.equal(preview.previewRevision.inventoryRevision, 2);
});

test('Unified Inbound A1 indivisible item requires quantity one and conserved multi-Cell load allocation', () => {
  const item = body({ lines: [{ lineId: 'instance-1', itemSpecId: ids.spec.toString(), itemSpecRevision: 3,
    quantity: 1, measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: ids.cellA.toString(), quantity: 1 }],
    instanceAllocations: [{ cellId: ids.cellA.toString(), weightKg: 4, volumeM3: 0.08 }, { cellId: ids.cellB.toString(), weightKg: 6, volumeM3: 0.12 }] }] });
  const result = normalizeUnifiedInbound(item);
  assert.equal(result.lines[0].quantity, 1);
  assert.equal(result.lines[0].instanceAllocations.length, 2);
  assert.equal(result.lines[0].instanceAllocations.reduce((sum, row) => sum + row.weightKg, 0), 10);
  assert.throws(() => normalizeUnifiedInbound({ ...item, lines: [{ ...item.lines[0], cellAllocations: [
    { cellId: ids.cellA.toString(), quantity: 1 }, { cellId: ids.cellB.toString(), quantity: 1 },
  ] }] }), error => error.code === 'INVALID_INSTANCE_ALLOCATION');
});

test('Unified Inbound A1 preview keeps one item across multiple Cell load allocations', async t => {
  mockPreviewWorld(t);
  const request = body({ lines: [{ lineId: 'instance-1', itemSpecId: ids.spec.toString(), itemSpecRevision: 3,
    quantity: 1, measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: ids.cellA.toString(), quantity: 1 }],
    instanceAllocations: [{ cellId: ids.cellA.toString(), weightKg: .4, volumeM3: .0004 }, { cellId: ids.cellB.toString(), weightKg: .6, volumeM3: .0006 }] }] });
  const preview = await ManagedUnifiedInboundService.preview(ids.sku.toString(), request, actor);
  assert.equal(preview.totalQuantity, 1);
  assert.equal(preview.totalWeightKg, 1);
  assert.equal(preview.lines[0].cellAllocations.length, 2);
  assert.equal(preview.warnings.length, 1);
});

test('Unified Inbound preview rejects dimensions that do not fit the selected Cell', async t => {
  mockPreviewWorld(t, { cellWidthM: .05 });
  await assert.rejects(ManagedUnifiedInboundService.preview(ids.sku.toString(), body(), actor), error => error.status === 409 && error.code === 'ITEM_DOES_NOT_FIT');
});

test('Unified Inbound preview enforces current capacity after aggregating all cell allocations', async t => {
  mockPreviewWorld(t, { cellMaxWeightKg: 5 });
  await assert.rejects(ManagedUnifiedInboundService.preview(ids.sku.toString(), body(), actor), error => error.status === 409 && error.code === 'CAPACITY_EXCEEDED');
});

test('Item Specification snapshot is authoritative and stale specification revision fails closed', () => {
  const specification = { status: 'ACTIVE', revision: 3, unitWeightKg: 5, dimensionsM: { widthM: .4, depthM: .3, heightM: .3 } };
  const snapshot = measurementSnapshot(specification, { measurementMode: 'SPECIFICATION', itemSpecRevision: 3, quantity: 1 });
  assert.deepEqual(snapshot, { unitWeightKg: 5, dimensionsM: specification.dimensionsM, unitVolumeM3: .036 });
  assert.throws(() => measurementSnapshot(specification, { measurementMode: 'SPECIFICATION', itemSpecRevision: 2, quantity: 1 }),
    error => error instanceof ManagedUnifiedInboundDomainError && error.code === 'ITEM_SPECIFICATION_STALE');
  assert.equal(specification.unitWeightKg, 5, 'snapshot calculation must not mutate Item Specification');
});

test('Unified Inbound aggregate Cell and Rack capacity validates total additions', () => {
  const cells = [
    { _id: ids.cellA, rackId: ids.facility, levelNumber: 1, code: 'A', maxWeightKg: 50, usedWeightKg: 10, usedVolumeM3: .1,
      dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } },
    { _id: ids.cellB, rackId: ids.facility, levelNumber: 1, code: 'B', maxWeightKg: 50, usedWeightKg: 10, usedVolumeM3: .1,
      dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } },
  ];
  const additions = new Map([[String(ids.cellA), { weightKg: 20, volumeM3: .2 }], [String(ids.cellB), { weightKg: 20, volumeM3: .2 }]]);
  assert.equal(assertUnifiedInboundCapacity(cells, additions, new Map([[`${ids.facility}:1`, 40]]), [{ _id: ids.facility, maxWeightKgPerLevel: 100 }]), true);
  assert.throws(() => assertUnifiedInboundCapacity(cells, new Map([[String(ids.cellA), { weightKg: 45, volumeM3: .2 }]]),
    new Map([[`${ids.facility}:1`, 45]]), [{ _id: ids.facility, maxWeightKgPerLevel: 100 }]), { code: 'CAPACITY_EXCEEDED' });
  assert.throws(() => assertUnifiedInboundCapacity(cells, additions, new Map([[`${ids.facility}:1`, 40]]),
    [{ _id: ids.facility, maxWeightKgPerLevel: 50 }]), { code: 'LEVEL_CAPACITY_EXCEEDED' });
});

test('preview rejects foreign/missing Reservation ownership before Session lookup', async t => {
  const world = mockActiveReservation(t, { reservationRow: false });
  let sessionLookups = 0;
  t.mock.method(AccessSession, 'findOne', () => { sessionLookups += 1; return new Query(null); });
  await assert.rejects(ManagedUnifiedInboundService.preview(ids.sku.toString(), body(), actor), error => error.code === 'RENTAL_NOT_ACTIVE');
  assert.equal(String(world.reservationFilter._id), String(ids.reservation));
  assert.equal(String(world.reservationFilter.customerId), String(ids.customer));
  assert.equal(String(world.reservationFilter.facilityId), String(ids.facility));
  assert.equal(sessionLookups, 0);
});

test('preview fences stale SKU revision before checking Access Session', async t => {
  mockActiveReservation(t, { skuRevision: 8 });
  let sessionLookups = 0;
  t.mock.method(AccessSession, 'findOne', () => { sessionLookups += 1; return new Query(null); });
  await assert.rejects(ManagedUnifiedInboundService.preview(ids.sku.toString(), body(), actor), error => error.status === 412 && error.code === 'STALE_SKU_REVISION');
  assert.equal(sessionLookups, 0);
});

test('preview requires active INBOUND Session with matching customer, reservation, facility and revision', async t => {
  mockActiveReservation(t);
  let filter;
  t.mock.method(AccessSession, 'findOne', query => { filter = query; return new Query(null); });
  await assert.rejects(ManagedUnifiedInboundService.preview(ids.sku.toString(), body(), actor), error => error.status === 409 && error.code === 'ACCESS_SESSION_SCOPE_INVALID');
  assert.equal(String(filter.customerId), String(ids.customer));
  assert.equal(String(filter.reservationId), String(ids.reservation));
  assert.equal(String(filter.facilityId), String(ids.facility));
  assert.equal(filter.allowedPurposes, 'INBOUND');
  assert.equal(filter.revision, 4);
  assert.equal(filter.status, 'ACTIVE');
});

test('confirm returns exact idempotent replay and rejects same key with changed payload', async t => {
  mockActiveReservation(t);
  const input = body(), normalized = normalizeUnifiedInbound(input), hash = requestHash(normalized);
  const prior = { _id: oid(), itemId: ids.sku, idempotencyKey: 'unified-replay-key-01', schemaVersion: 4,
    stockEffect: { action: 'ADD', requestHash: hash } };
  t.mock.method(Movement, 'findOne', () => new Query(prior));
  const replay = await ManagedUnifiedInboundService.confirm(ids.sku.toString(), input, actor, 'unified-replay-key-01');
  assert.equal(replay.status, 'COMMITTED');
  assert.equal(replay.replayed, true);
  assert.equal(replay.movement, prior);
  await assert.rejects(ManagedUnifiedInboundService.confirm(ids.sku.toString(), { ...input, lines: [
    { ...input.lines[0], quantity: 9, cellAllocations: [{ cellId: ids.cellA.toString(), quantity: 5 }, { cellId: ids.cellB.toString(), quantity: 4 }] },
  ] }, actor, 'unified-replay-key-01'), error => error.status === 409 && error.code === 'IDEMPOTENCY_CONFLICT');
});

test('confirm retains production guard after idempotency lookup and before transaction creation', async t => {
  mockActiveReservation(t);
  t.mock.method(Movement, 'findOne', () => new Query(null));
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(ManagedUnifiedInboundService.confirm(ids.sku.toString(), body(), actor, 'unified-prod-guard-key'),
      error => error.status === 503 && error.code === 'INBOUND_CONFIRM_ENVIRONMENT_BLOCKED');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
