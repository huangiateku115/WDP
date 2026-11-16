const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { normalizeDirectOutbound, buildDirectOutboundPlan, ManagedInventoryV3OutboundService, ManagedV3OutboundError } = require('../dist/services/inventory-items/managed-inventory-v3-outbound.service');

const oid = n => new Types.ObjectId(String(n).padStart(24, '0'));
const sku = { _id: oid(1), customerId: oid(2), managedV3Revision: 4 };
const reservation = { _id: oid(3), allocatedCellIds: [oid(4), oid(5)] };
const spec = { _id: oid(6), skuId: sku._id, customerId: sku.customerId, reservationId: reservation._id, status: 'ACTIVE', revision: 2, name: 'Thùng hồ sơ', code: 'BOX' };
const candidate = (line = {}) => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4,
  lines: [{ lineId: 'line-1', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 3, ...line }] });
const lot = (receiptId, cellId, quantity, weight, at, held = 0) => ({ skuId: sku._id, itemSpecId: spec._id, reservationId: reservation._id, cellId, receiptId,
  quantityOnHand: quantity, quantityHeld: held, quantityAvailable: quantity - held, unitWeightKgSnapshot: weight, unitVolumeM3Snapshot: 0.01,
  unitDimensionsSnapshot: { widthM: 0.2, depthM: 0.25, heightM: 0.2 }, quantityUnitSnapshot: 'thùng' });
const stateFor = (lots, cells, movements = []) => ({ replay: { lots, instances: [] }, cells, movements });
const cell = (id, weight, volume = 1) => ({ _id: id, code: String(id).slice(-2), usedWeightKg: weight, usedVolumeM3: volume });
const plan = (lots, cells, movements = [], candidateValue = candidate()) => buildDirectOutboundPlan({ sku, reservation, candidate: candidateValue, state: stateFor(lots, cells, movements), specifications: [spec], now: new Date('2026-11-16T12:00:00Z') });

test('normalizer accepts valid direct outbound and rejects duplicate lines, unsafe quantities and malformed allocation sums', () => {
  assert.equal(candidate().lines[0].quantity, 3);
  assert.throws(() => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4, lines: [
    { lineId: 'a', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 1 }, { lineId: 'b', itemSpecId: spec._id.toHexString(), itemSpecRevision: 2, quantity: 1 },
  ] }), e => e.code === 'DUPLICATE_OUTBOUND_LINE');
  assert.throws(() => candidate({ quantity: Number.MAX_SAFE_INTEGER + 1 }), e => e.code === 'INVALID_OUTBOUND_LINE');
  assert.throws(() => candidate({ quantity: 2, cellAllocations: [{ cellId: oid(4).toHexString(), quantity: 1 }] }), e => e.code === 'INVALID_CELL_ALLOCATION');
});

test('A2 partial removal allocates FIFO across receipt Cells and conserves quantity, weight and volume', () => {
  const first = lot('receipt-1', oid(4), 2, 1.111, '2026-11-01T00:00:00Z');
  const second = lot('receipt-2', oid(5), 4, 2.222, '2026-11-02T00:00:00Z');
  const movements = [
    { _id: oid(12), itemId: sku._id, schemaVersion: 4, performedAt: new Date('2026-11-01T00:00:00Z'), stockEffect: { action: 'ADD', destination: [{ receiptId: 'receipt-1' }] } },
    { _id: oid(13), itemId: sku._id, schemaVersion: 4, performedAt: new Date('2026-11-02T00:00:00Z'), stockEffect: { action: 'ADD', destination: [{ receiptId: 'receipt-2' }] } },
  ];
  const selected = candidate();
  const result = plan([first, second], [cell(oid(4), 10), cell(oid(5), 10)], movements, selected);
  assert.deepEqual(result.effectLines.map(row => [row.receiptId, row.quantity]), [['receipt-1', 2], ['receipt-2', 1]]);
  assert.equal(result.quantity, 3);
  assert.equal(result.totalWeightKg, 4.444);
  assert.equal(result.totalVolumeM3, 0.03);
  assert.equal(result.capacity.find(row => String(row.cellId) === String(oid(4))).usedWeightAfterKg, 7.778);
});

test('A2 honors active holds and scoped Cell selections; insufficient or unknown source fails closed', () => {
  const held = lot('receipt-1', oid(4), 4, 1, '2026-11-01T00:00:00Z', 2);
  const one = candidate({ quantity: 3 });
  assert.throws(() => plan([held], [cell(oid(4), 4)], [], one), e => e.code === 'OUTBOUND_QUANTITY_UNAVAILABLE');
  const scoped = candidate({ quantity: 2, cellAllocations: [{ cellId: oid(5).toHexString(), quantity: 2 }] });
  assert.throws(() => plan([held], [cell(oid(4), 4)], [], scoped), e => e.code === 'OUTBOUND_QUANTITY_UNAVAILABLE');
  assert.throws(() => plan([held], [], [], candidate({ quantity: 1 })), e => e.code === 'CELL_CAPACITY_UNKNOWN');
});

test('A1 direct outbound selects complete quantity-one PhysicalUnits and releases the full multi-Cell footprint once', () => {
  const instance = { skuId: sku._id, itemSpecId: oid(8), reservationId: reservation._id, itemInstanceId: 'unit-1', sourceReceiptId: 'receipt-u', quantity: 1,
    status: 'PLACED', unitWeightKgSnapshot: 10, unitVolumeM3Snapshot: 0.08, unitDimensionsSnapshot: { widthM: 0.4, depthM: 0.4, heightM: 0.5 },
    allocations: [{ cellId: oid(4), weightKg: 6, volumeM3: 0.05 }, { cellId: oid(5), weightKg: 4, volumeM3: 0.03 }] };
  const oneSpec = { ...spec, _id: oid(8) };
  const input = normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4, lines: [
    { lineId: 'unit', itemSpecId: oneSpec._id.toHexString(), itemSpecRevision: 2, quantity: 1, itemInstanceIds: ['unit-1'] },
  ] });
  const result = buildDirectOutboundPlan({ sku, reservation, candidate: input, state: { ...stateFor([], [cell(oid(4), 6, .05), cell(oid(5), 4, .03)], []), replay: { lots: [], instances: [instance] } }, specifications: [oneSpec], now: new Date() });
  assert.equal(result.quantity, 1);
  assert.equal(result.totalWeightKg, 10);
  assert.equal(result.totalVolumeM3, 0.08);
  assert.equal(result.effectLines.length, 2);
  assert.equal(result.capacity.reduce((sum, row) => sum + row.usedWeightAfterKg, 0), 0);
  assert.throws(() => normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4, lines: [
    { lineId: 'unit', itemSpecId: oneSpec._id.toHexString(), itemSpecRevision: 2, quantity: 2, itemInstanceIds: ['unit-1'] },
  ] }), e => e.code === 'INVALID_ITEM_INSTANCE_SELECTION');
});

test('stale SKU/specification revisions and non-Customer writers are rejected', async () => {
  const stale = { ...candidate(), skuRevision: 3 };
  assert.throws(() => plan([], [], [], stale), e => e.code === 'STALE_SKU_REVISION');
  const staleSpec = normalizeDirectOutbound({ accessSessionId: oid(7).toHexString(), sessionRevision: 1, skuRevision: 4,
    lines: [{ lineId: 'line-1', itemSpecId: spec._id.toHexString(), itemSpecRevision: 1, quantity: 1 }] });
  assert.throws(() => plan([lot('r', oid(4), 1, 1, '2026-11-01')], [cell(oid(4), 1)], [], staleSpec), e => e.code === 'ITEM_SPECIFICATION_STALE');
  await assert.rejects(ManagedInventoryV3OutboundService.context(sku._id.toHexString(), { _id: sku.customerId, role: 'FACILITY_STAFF' }),
    e => e instanceof ManagedV3OutboundError && e.status === 403 && e.code === 'ROLE_DENIED');
});
