const test = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { assertUnifiedInboundCapacity, classifyLegacyStockImpact, ManagedUnifiedInboundDomainError, normalizeUnifiedInbound, measurementSnapshot, selectManagedSkuReplayScope } = require('../dist/services/inventory-items/managed-unified-inbound.domain');
const { ManagedUnifiedInboundService } = require('../dist/services/inventory-items/managed-unified-inbound.service');
const inboundController = require('../dist/controllers/inventory-items/managed-inventory-v3.controller');
const ItemMovement = require('../dist/models/inventory-items/item-movement.model').default;
const InventoryItem = require('../dist/models/inventory-items/inventory-item.model').default;
const stockDomain = require('../dist/services/inventory-items/managed-cell-stock.domain');

const oid = n => new Types.ObjectId(String(n).padStart(24, '0'));
const id = { sku: oid(1), customer: oid(2), reservation: oid(3), facility: oid(4), session: oid(5), specA: oid(6), specB: oid(7), specC: oid(8), c1: oid(9), c2: oid(10), c3: oid(11), c4: oid(12) };
const line = (lineId, itemSpecId, quantity, cellId, weight, dimensions, quantityUnitSnapshot = 'thùng') => ({
  lineId, itemSpecId, quantity, quantityUnitSnapshot, unitWeightKgSnapshot: weight,
  unitVolumeM3Snapshot: Math.round(dimensions.widthM * dimensions.depthM * dimensions.heightM * 1e6) / 1e6,
  unitDimensionsSnapshot: dimensions, allocatedWeightKg: weight * quantity,
  allocatedVolumeM3: Math.round(dimensions.widthM * dimensions.depthM * dimensions.heightM * quantity * 1e6) / 1e6, cellId, receiptId: `receipt-${lineId}`,
});

test('replay selection retains complete SKU history across Reservations and after projections are depleted', () => {
  const priorReservation = oid(40), otherSku = oid(41);
  const canonicalMovements = [
    { _id: oid(42), itemId: id.sku, managedReservationId: id.reservation, schemaVersion: 4,
      stockEffect: { ledgerRevision: 1, source: [], destination: [{ cellId: id.c1 }] } },
    { _id: oid(43), itemId: id.sku, managedReservationId: priorReservation, schemaVersion: 4,
      stockEffect: { ledgerRevision: 2, source: [{ cellId: id.c2, reservationId: priorReservation }], destination: [{ cellId: id.c3, reservationId: id.reservation }] } },
    { _id: oid(44), itemId: otherSku, managedReservationId: id.reservation, schemaVersion: 4,
      stockEffect: { ledgerRevision: 1, source: [], destination: [{ cellId: id.c1 }] } },
  ];
  const selected = selectManagedSkuReplayScope({ canonicalMovements, stockRows: [], instances: [],
    reservationId: id.reservation, cellIds: [id.c1], skuId: id.sku });
  assert.deepEqual(selected.replayMovements.map(row => `${row.itemId}:${row.stockEffect.ledgerRevision}`), [
    `${id.sku}:1`, `${id.sku}:2`, `${otherSku}:1`,
  ]);
  assert.equal(selected.stocks.length, 0);
  assert.equal(selected.instances.length, 0);
});

test('legacy stock isolation is scoped to Reservation and physical Rack/Level capacity', () => {
  const rackA = oid(30), rackB = oid(31), otherReservation = oid(32);
  const cells = [
    { _id: id.c1, rackId: rackA, levelNumber: 1 },
    { _id: id.c2, rackId: rackA, levelNumber: 1 },
    { _id: id.c3, rackId: rackA, levelNumber: 2 },
    { _id: id.c4, rackId: rackB, levelNumber: 1 },
  ];
  const scope = { reservationId: id.reservation, capacityCells: [cells[0]], allCells: cells };
  assert.equal(classifyLegacyStockImpact(scope).status, 'ISOLATED');

  const isolated = classifyLegacyStockImpact({ ...scope, movements: [
    { schemaVersion: 2, itemId: id.sku, managedReservationId: otherReservation, sourceCellId: id.c3 },
    { schemaVersion: 2, itemId: id.sku, managedReservationId: otherReservation, destinationCellId: id.c4 },
  ] });
  assert.equal(isolated.status, 'ISOLATED');

  const sameLevel = classifyLegacyStockImpact({ ...scope, movements: [
    { schemaVersion: 2, itemId: id.sku, managedReservationId: otherReservation, sourceCellId: id.c2 },
  ] });
  assert.equal(sameLevel.status, 'CONFLICT');
  assert.deepEqual(sameLevel.conflictSources, ['MOVEMENT']);

  const sameReservation = classifyLegacyStockImpact({ ...scope, movements: [
    { schemaVersion: 1, itemId: id.sku, managedReservationId: id.reservation, sourceCellId: id.c3 },
  ] });
  assert.equal(sameReservation.status, 'CONFLICT');
});

test('legacy stock without a provable Cell remains UNKNOWN, and legacy balance on target capacity blocks inbound', () => {
  const cells = [{ _id: id.c1, rackId: id.c1, levelNumber: 1 }, { _id: id.c2, rackId: id.c1, levelNumber: 1 }];
  const scope = { reservationId: id.reservation, capacityCells: [cells[0]], allCells: cells };
  assert.equal(classifyLegacyStockImpact({ ...scope, movements: [{ schemaVersion: 2, managedReservationId: oid(33) }] }).status, 'UNKNOWN');
  assert.equal(classifyLegacyStockImpact({ ...scope, movements: [{ schemaVersion: 2, managedReservationId: oid(33), sourceCellId: id.c2 }] }).status, 'CONFLICT');
  assert.equal(classifyLegacyStockImpact({ ...scope, stockBalances: [{ managedReservationId: oid(33), currentCellId: id.c2, onHandQuantity: 1, heldQuantity: 0 }] }).status, 'CONFLICT');
});

test('legacy V3 placements in a different Rack/Level are isolated; active footprint in target level conflicts', () => {
  const cells = [{ _id: id.c1, rackId: oid(40), levelNumber: 1 }, { _id: id.c2, rackId: oid(40), levelNumber: 2 }];
  const scope = { reservationId: id.reservation, capacityCells: [cells[0]], allCells: cells };
  const isolated = classifyLegacyStockImpact({ ...scope, v3BatchPlacements: [{ reservationId: oid(41), cellId: id.c2, state: 'ACTIVE', quantity: 3 }] });
  assert.equal(isolated.status, 'ISOLATED');
  const conflict = classifyLegacyStockImpact({ ...scope, v3Footprints: [{ reservationId: oid(41), state: 'ACTIVE', cells: [{ cellId: id.c1 }] }] });
  assert.equal(conflict.status, 'CONFLICT');
});

test('Inbound Preview domain validation errors retain their safe HTTP status and code', async t => {
  t.mock.method(ManagedUnifiedInboundService, 'preview', async () => { throw new ManagedUnifiedInboundDomainError('INVALID_INPUT', 'Payload không hợp lệ.', 422); });
  const response = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await inboundController.previewInbound({ params: { id: id.sku.toString() }, body: {}, user: { _id: id.customer } }, response);
  assert.equal(response.statusCode, 422);
  assert.equal(response.body.code, 'INVALID_INPUT');
});

test('Inbound Preview maps pure DTO failure to 422 instead of generic operation failure', () => {
  assert.throws(() => normalizeUnifiedInbound({}), error => error instanceof ManagedUnifiedInboundDomainError && error.status === 422 && error.code === 'INVALID_INPUT');
});

test('Inbound Confirm accepts its already-validated ObjectId when rechecking Customer SKU ownership', async t => {
  class Query {
    constructor(value, error) { this.value = value; this.error = error; }
    session() { return this; }
    lean() { return this; }
    exec() { return this.error ? Promise.reject(this.error) : Promise.resolve(this.value); }
  }
  const reachedIdempotencyLookup = new Error('IDEMPOTENCY_LOOKUP_REACHED');
  t.mock.method(InventoryItem, 'findOne', () => new Query({ _id: id.sku, customerId: id.customer, inventorySchemaVersion: 3, skuStatus: 'ACTIVE' }));
  t.mock.method(ItemMovement, 'findOne', () => new Query(null, reachedIdempotencyLookup));
  const body = { accessSessionId: id.session.toString(), sessionRevision: 0, skuRevision: 0, lines: [
    { lineId: 'line-1', itemSpecId: id.specA.toString(), itemSpecRevision: 0, quantity: 1, measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: id.c1.toString(), quantity: 1 }] },
  ] };
  await assert.rejects(ManagedUnifiedInboundService.confirm(id.sku.toString(), body, { _id: id.customer, role: 'CUSTOMER' }, 'confirm-regression-key'), error => error === reachedIdempotencyLookup);
});

test('unified inbound DTO accepts one SKU with three item specifications and exact multi-line allocation totals', () => {
  const input = { accessSessionId: id.session.toString(), sessionRevision: 1, skuRevision: 2, lines: [
    { lineId: 'a', itemSpecId: id.specA.toString(), itemSpecRevision: 3, quantity: 3, measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: id.c1.toString(), quantity: 3 }] },
    { lineId: 'b', itemSpecId: id.specB.toString(), itemSpecRevision: 2, quantity: 2, measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: id.c2.toString(), quantity: 2 }] },
    { lineId: 'c', itemSpecId: id.specC.toString(), itemSpecRevision: 4, quantity: 1, measurementMode: 'SPECIFICATION', cellAllocations: [{ cellId: id.c3.toString(), quantity: 1 }] },
  ] };
  const result = normalizeUnifiedInbound(input);
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines.reduce((sum, row) => sum + row.quantity, 0), 6);
  assert.throws(() => normalizeUnifiedInbound({ ...input, lines: [{ ...input.lines[0], cellAllocations: [{ cellId: id.c1.toString(), quantity: 2 }] }] }), { code: 'INVALID_PLACEMENT_TOTALS' });
  assert.throws(() => normalizeUnifiedInbound({ ...input, lines: [{ ...input.lines[0], quantity: '3' }] }), { code: 'INVALID_INPUT' });
});

test('measurement snapshot uses specification values and rejects stale revisions without changing the specification', () => {
  const spec = { status: 'ACTIVE', revision: 3, unitWeightKg: 5, dimensionsM: { widthM: .4, depthM: .3, heightM: .3 } };
  const snapshot = measurementSnapshot(spec, { itemSpecRevision: 3, measurementMode: 'SPECIFICATION', quantity: 3 });
  assert.deepEqual(snapshot, { unitWeightKg: 5, dimensionsM: spec.dimensionsM, unitVolumeM3: .036 });
  assert.equal(spec.unitWeightKg, 5);
  assert.throws(() => measurementSnapshot(spec, { itemSpecRevision: 2, measurementMode: 'SPECIFICATION', quantity: 3 }), { code: 'ITEM_SPECIFICATION_STALE' });
});

test('capacity validates aggregate Cell additions and Rack-level weight after all inbound lines', () => {
  const cells = [
    { _id: id.c1, rackId: id.c1, levelNumber: 1, code: 'C01', maxWeightKg: 30, usedWeightKg: 10, usedVolumeM3: .1, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } },
    { _id: id.c2, rackId: id.c1, levelNumber: 1, code: 'C02', maxWeightKg: 30, usedWeightKg: 10, usedVolumeM3: .1, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } },
  ];
  const racks = [{ _id: id.c1, maxWeightKgPerLevel: 50 }];
  assert.equal(assertUnifiedInboundCapacity(cells, new Map([[id.c1.toString(), { weightKg: 5, volumeM3: .2 }], [id.c2.toString(), { weightKg: 4, volumeM3: .3 }]]), new Map([[`${id.c1}:1`, 9]]), racks), true);
  assert.throws(() => assertUnifiedInboundCapacity(cells, new Map([[id.c1.toString(), { weightKg: 21, volumeM3: .2 }]]), new Map([[`${id.c1}:1`, 21]]), racks), { code: 'CAPACITY_EXCEEDED' });
  assert.throws(() => assertUnifiedInboundCapacity(cells, new Map([[id.c1.toString(), { weightKg: 1, volumeM3: .2 }]]), new Map([[`${id.c1}:1`, 1]]), [{ _id: id.c1, maxWeightKgPerLevel: 20 }]), { code: 'LEVEL_CAPACITY_EXCEEDED' });
  assert.throws(() => assertUnifiedInboundCapacity(cells, new Map([[id.c1.toString(), { weightKg: 1, volumeM3: 2 }]]), new Map(), racks), { code: 'CAPACITY_EXCEEDED' });
});

test('one versioned Movement accepts and replays three Item Specifications as three lines', async () => {
  const dimensionsA = { widthM: .4, depthM: .3, heightM: .3 };
  const dimensionsB = { widthM: .6, depthM: .4, heightM: .3 };
  const dimensionsC = { widthM: .8, depthM: .5, heightM: .4 };
  const lines = [line('a', id.specA, 3, id.c1, 5, dimensionsA), line('b', id.specB, 2, id.c2, 8, dimensionsB), line('c', id.specC, 1, id.c3, 15, dimensionsC)];
  const movement = new ItemMovement({ _id: oid(20), movementCode: 'MI-test-20', referenceCode: 'operation-20', itemId: id.sku, itemSpecId: id.specA, managedReservationId: id.reservation, facilityId: id.facility, customerId: id.customer,
    type: 'INBOUND', quantity: 6, quantityUnit: 'MIXED', actualUnitWeightKg: 5, actualTotalWeightKg: 46, actualUnitDimensionsM: dimensionsA, actualTotalVolumeM3: .412,
    performedBy: id.customer, performedAt: new Date('2026-11-15T10:00:00Z'), inspectionNote: 'Customer confirmed inbound', physicalPackingConfirmed: true,
    idempotencyKey: 'phase3-multi-line-key', schemaVersion: 4, operationId: 'phase3-multi-line-operation', stockEffect: { action: 'ADD', operationId: 'phase3-multi-line-operation', requestHash: 'a'.repeat(64), ledgerRevision: 1, contractVersion: 2, accessSessionId: id.session, source: [], destination: lines } });
  await movement.validate();
  const replay = stockDomain.replayManagedStockMovements([movement.toObject()]);
  assert.equal(replay.lots.length, 3);
  assert.deepEqual(replay.lots.map(row => row.quantityOnHand), [3, 2, 1]);
  assert.equal(replay.lots.reduce((sum, row) => sum + row.totalWeightKg, 0), 46);
  assert.equal(Math.round(replay.lots.reduce((sum, row) => sum + row.totalVolumeM3, 0) * 1e6) / 1e6, .412);
});

test('multi-Cell indivisible inbound creates one quantity-one instance in ledger semantics', async () => {
  const dimensions = { widthM: 1, depthM: .2, heightM: .8 };
  const instanceId = 'instance-whole-1';
  const lines = [
    { ...line('whole', id.specC, 1, id.c3, 15, dimensions), itemInstanceId: instanceId, allocatedWeightKg: 8, allocatedVolumeM3: .09 },
    { ...line('whole', id.specC, 1, id.c4, 15, dimensions), itemInstanceId: instanceId, allocatedWeightKg: 7, allocatedVolumeM3: .07 },
  ];
  const movement = new ItemMovement({ _id: oid(21), movementCode: 'MI-test-21', referenceCode: 'operation-21', itemId: id.sku, itemSpecId: id.specC, managedReservationId: id.reservation, facilityId: id.facility, customerId: id.customer,
    type: 'INBOUND', quantity: 1, quantityUnit: 'piece', actualUnitWeightKg: 15, actualTotalWeightKg: 15, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .16,
    performedBy: id.customer, performedAt: new Date('2026-11-15T11:00:00Z'), inspectionNote: 'Customer confirmed inbound', physicalPackingConfirmed: true,
    idempotencyKey: 'phase3-instance-key', schemaVersion: 4, operationId: 'phase3-instance-operation', stockEffect: { action: 'ADD', operationId: 'phase3-instance-operation', requestHash: 'b'.repeat(64), ledgerRevision: 1, contractVersion: 2, accessSessionId: id.session, source: [], destination: lines } });
  await movement.validate();
  const replay = stockDomain.replayManagedStockMovements([movement.toObject()]);
  assert.equal(replay.instances.length, 1);
  assert.equal(replay.instances[0].quantity, 1);
  assert.equal(replay.instances[0].allocations.length, 2);
});
