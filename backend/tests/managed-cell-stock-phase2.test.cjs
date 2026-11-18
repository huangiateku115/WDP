const test = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const domain = require('../dist/services/inventory-items/managed-cell-stock.domain');
const CellStock = require('../dist/models/inventory-items/managed-cell-stock.model').default;
const ItemInstance = require('../dist/models/inventory-items/managed-item-instance.model').default;
const ItemMovement = require('../dist/models/inventory-items/item-movement.model').default;
const { customerSafeStockDto, reconcileManagedV4SkuEvidence } = require('../dist/services/inventory-items/managed-cell-stock-read.service');
const oid = n => new Types.ObjectId(String(n).padStart(24, '0'));
const ids = { skuId: oid(1), specA: oid(2), specB: oid(3), reservationId: oid(4), facilityId: oid(5), customerId: oid(6), c1: oid(7), c2: oid(8), c3: oid(9) };
function lot(overrides = {}) {
  return { skuId: ids.skuId, itemSpecId: ids.specA, reservationId: ids.reservationId, facilityId: ids.facilityId, customerId: ids.customerId, receiptId: 'receipt-1', cellId: ids.c1, quantityOnHand: 2, quantityHeld: 1, quantityAvailable: 1,
    unitWeightKgSnapshot: 1.25, unitVolumeM3Snapshot: 0.0125, unitDimensionsSnapshot: { widthM: .25, depthM: .2, heightM: .25 }, totalWeightKg: 2.5, totalVolumeM3: .025,
    ledgerRevision: 1, revision: 0, ...overrides };
}
test('receipt snapshots are immutable to specification edits; SKU aggregate sums specifications without physical double count', () => {
  const rows = [lot({ itemSpecId: ids.specA, receiptId: 'r1', quantityOnHand: 3, quantityHeld: 0, quantityAvailable: 3, totalWeightKg: 3.75, totalVolumeM3: .0375 }),
    lot({ itemSpecId: ids.specA, receiptId: 'r2', cellId: ids.c2, quantityOnHand: 2, quantityHeld: 0, quantityAvailable: 2, unitWeightKgSnapshot: 2, unitVolumeM3Snapshot: .02, unitDimensionsSnapshot: { widthM: .2, depthM: .2, heightM: .5 }, totalWeightKg: 4, totalVolumeM3: .04 }),
    lot({ itemSpecId: ids.specB, receiptId: 'r3', cellId: ids.c3, quantityOnHand: 1, quantityHeld: 0, quantityAvailable: 1, unitWeightKgSnapshot: 4, unitVolumeM3Snapshot: .1, unitDimensionsSnapshot: { widthM: .5, depthM: .5, heightM: .4 }, totalWeightKg: 4, totalVolumeM3: .1 })];
  const cells = domain.aggregateCellStock(rows);
  assert.equal([...cells.values()].reduce((n, c) => n + c.quantity, 0), 6);
  assert.equal([...cells.values()].reduce((n, c) => n + c.weightKg, 0), 11.75);
  assert.equal([...cells.values()].reduce((n, c) => n + c.volumeM3, 0), .1775);
  assert.deepEqual(domain.physicalTotals(rows[0].unitWeightKgSnapshot, rows[0].unitVolumeM3Snapshot, 3), { totalWeightKg: 3.75, totalVolumeM3: .0375 });
});
test('one item instance spread over Cells counts as one item and apportions physical load exactly once', () => {
  const instance = { itemInstanceId: 'instance-1', skuId: ids.skuId, itemSpecId: ids.specB, reservationId: ids.reservationId, facilityId: ids.facilityId, customerId: ids.customerId, sourceReceiptId: 'r-instance', quantity: 1, unitWeightKgSnapshot: 10, unitVolumeM3Snapshot: .06,
    allocations: [{ cellId: ids.c1, weightKg: 6, volumeM3: .036 }, { cellId: ids.c2, weightKg: 4, volumeM3: .024 }], status: 'PLACED' };
  const cells = domain.aggregateCellStock([], [instance]);
  assert.equal([...cells.values()].reduce((n, c) => n + c.quantity, 0), 1);
  assert.equal([...cells.values()].reduce((n, c) => n + c.weightKg, 0), 10);
  assert.equal([...cells.values()].reduce((n, c) => n + c.volumeM3, 0), .06);
  const reversed = domain.aggregateCellStock([], [{ ...instance, allocations: [...instance.allocations].reverse() }]);
  assert.equal(reversed.get(ids.c1.toString()).quantityOnHand, 1, 'quantity is assigned once to the stable lowest-Cell primary key');
  assert.equal(reversed.get(ids.c2.toString()).quantityOnHand, 0);
});
test('cell stock rejects negative quantities, excessive holds, and cross-scope missing identifiers', () => {
  for (const candidate of [lot({ quantityOnHand: -1 }), lot({ quantityHeld: 3 }), lot({ quantityAvailable: 0 }), lot({ customerId: null })]) {
    assert.throws(() => domain.validateCellStock(candidate));
  }
});
test('Item Instance allocations must conserve one item weight and volume', () => {
  const invalid = { itemInstanceId: 'instance-1', skuId: ids.skuId, itemSpecId: ids.specB, reservationId: ids.reservationId, facilityId: ids.facilityId, customerId: ids.customerId, sourceReceiptId: 'r1', quantity: 1, unitWeightKgSnapshot: 10, unitVolumeM3Snapshot: .06,
    unitDimensionsSnapshot: { widthM: .2, depthM: .3, heightM: 1 }, allocations: [{ cellId: ids.c1, weightKg: 9, volumeM3: .06 }], status: 'PLACED' };
  assert.throws(() => domain.aggregateCellStock([], [invalid]), { code: 'INVALID_ITEM_INSTANCE' });
});
test('numeric capacity validates finite positive limits and blocks Cell, level, Reservation overages and stale revisions', () => {
  const cell = domain.calculateCapacity({ maxWeightKg: 100, maxVolumeM3: 2, usedWeightKg: 25, usedVolumeM3: .5 });
  assert.equal(cell.remainingWeightKg, 75); assert.equal(cell.remainingVolumeM3, 1.5); assert.equal(cell.weightUsagePercent, 25);
  assert.throws(() => domain.calculateCapacity({ maxWeightKg: 0, maxVolumeM3: 2, usedWeightKg: 0, usedVolumeM3: 0 }), { code: 'CAPACITY_NOT_CONFIGURED' });
  assert.throws(() => domain.calculateCapacity({ maxWeightKg: 100, maxVolumeM3: 2, usedWeightKg: 101, usedVolumeM3: 0 }), { code: 'CAPACITY_MISMATCH' });
  const fits = { cell: { maxWeightKg: 100, maxVolumeM3: 2, usedWeightKg: 25, usedVolumeM3: .5 }, level: { maxWeightKg: 200, usedWeightKg: 80 }, reservation: { maxVolumeM3: 1, usedVolumeM3: .4 }, addition: { weightKg: 10, volumeM3: .2 }, expectedRevision: 3, currentRevision: 3 };
  assert.equal(domain.assertCapacityFits(fits).reservation.usedVolumeM3, .6);
  assert.throws(() => domain.assertCapacityFits({ ...fits, cell: { ...fits.cell, maxWeightKg: 30 } }), { code: 'CELL_CAPACITY_EXCEEDED' });
  assert.throws(() => domain.assertCapacityFits({ ...fits, level: { maxWeightKg: 85, usedWeightKg: 80 } }), { code: 'LEVEL_CAPACITY_EXCEEDED' });
  assert.throws(() => domain.assertCapacityFits({ ...fits, reservation: { maxVolumeM3: .5, usedVolumeM3: .4 } }), { code: 'RESERVATION_CAPACITY_EXCEEDED' });
  assert.throws(() => domain.assertCapacityFits({ ...fits, currentRevision: 4 }), { code: 'CAPACITY_REVISION_CONFLICT' });
});
test('fresh verified empty Cell is NOT_REQUIRED; historical discrepancies are never called reconciled', () => {
  assert.deepEqual(domain.reconcileCell({ hasMovementHistory: false, stockQuantity: 0, projectedWeightKg: 0, projectedVolumeM3: 0, counterWeightKg: 0, counterVolumeM3: 0, sourceComplete: false }), { status: 'NOT_REQUIRED', reasonCode: 'NO_STOCK_HISTORY' });
  assert.equal(domain.reconcileCell({ hasMovementHistory: true, stockQuantity: 0, projectedWeightKg: 0, projectedVolumeM3: 0, counterWeightKg: 0, counterVolumeM3: 0, sourceComplete: false }).status, 'UNKNOWN');
  assert.equal(domain.reconcileCell({ hasMovementHistory: true, stockQuantity: 1, projectedWeightKg: 1, projectedVolumeM3: .1, counterWeightKg: 2, counterVolumeM3: .1, sourceComplete: true }).status, 'MISMATCH');
  assert.equal(domain.reconcileCell({ hasMovementHistory: true, stockQuantity: 0, projectedWeightKg: 1, projectedVolumeM3: .1, counterWeightKg: 1, counterVolumeM3: .1, sourceComplete: true }).status, 'RECONCILED');
  assert.equal(domain.reconcileCell({ hasMovementHistory: false, stockQuantity: 0, projectedWeightKg: 0, projectedVolumeM3: 0, counterWeightKg: undefined, counterVolumeM3: 0, sourceComplete: true }).status, 'NOT_CONFIGURED');
});
test('Customer stock DTO hides raw reconciliation reasons and translates internal states', () => {
  const needsReview = customerSafeStockDto({ skuId: ids.skuId, reconciliationStatus: 'MISMATCH', ledgerStatus: 'MISMATCH', reasonCode: 'CELL_COUNTER_MISMATCH', totalQuantity: null,
    byCell: [{ cellId: ids.c1, quantityOnHand: null }] });
  assert.equal(needsReview.reconciliationStatus, 'CHECKING');
  assert.match(needsReview.verificationMessage, /Cơ sở đang kiểm tra/);
  assert.equal(Object.hasOwn(needsReview, 'reasonCode'), false);
  assert.equal(Object.hasOwn(needsReview, 'ledgerStatus'), false);
  assert.deepEqual(needsReview.byCell, [{ cellId: ids.c1, quantityOnHand: null }]);
  const empty = customerSafeStockDto({ reconciliationStatus: 'NOT_REQUIRED', ledgerStatus: 'NOT_REQUIRED', reasonCode: 'NO_STOCK_HISTORY', totalQuantity: 0 });
  assert.equal(empty.reconciliationStatus, 'NO_ACTIVITY');
  assert.equal(empty.verificationMessage, null);
  assert.equal(Object.hasOwn(empty, 'reasonCode'), false);
});
test('placement reconciliation requires an OCCUPIED allocation for the exact Reservation and Cell', () => {
  const placement = { reservationId: ids.reservationId, cellId: ids.c1 };
  assert.equal(domain.placementsHaveCellAllocations([placement], [{ reservationId: ids.reservationId, cellId: ids.c1, status: 'OCCUPIED' }]), true);
  assert.equal(domain.placementsHaveCellAllocations([placement], [{ reservationId: ids.reservationId, cellId: ids.c2, status: 'OCCUPIED' }]), false);
  assert.equal(domain.placementsHaveCellAllocations([placement], [{ reservationId: ids.reservationId, cellId: ids.c1, status: 'RESERVED' }]), false);
  assert.equal(domain.placementsHaveCellAllocations([placement], [{ reservationId: ids.specA, cellId: ids.c1, status: 'OCCUPIED' }]), false);
});
test('Mongoose stock projections enforce quantity and snapshot arithmetic without connecting to MongoDB', async () => {
  const good = new CellStock(lot()); await good.validate();
  const bad = new CellStock(lot({ quantityHeld: 3 })); await assert.rejects(bad.validate());
  const instance = new ItemInstance({ itemInstanceId: 'i-1', skuId: ids.skuId, itemSpecId: ids.specB, reservationId: ids.reservationId, facilityId: ids.facilityId, customerId: ids.customerId, sourceReceiptId: 'r1', quantity: 1, unitWeightKgSnapshot: 2, unitVolumeM3Snapshot: .02,
    unitDimensionsSnapshot: { widthM: .2, depthM: .2, heightM: .5 }, allocations: [{ cellId: ids.c1, weightKg: 1, volumeM3: .01 }, { cellId: ids.c2, weightKg: 1, volumeM3: .01 }], status: 'PLACED' });
  await instance.validate(); assert.equal(instance.quantity, 1);
  const removed = new ItemInstance({ itemInstanceId: 'i-removed', skuId: ids.skuId, itemSpecId: ids.specB, reservationId: ids.reservationId, facilityId: ids.facilityId, customerId: ids.customerId, sourceReceiptId: 'r1', quantity: 1, unitWeightKgSnapshot: 2, unitVolumeM3Snapshot: .02,
    unitDimensionsSnapshot: { widthM: .2, depthM: .2, heightM: .5 }, allocations: [], status: 'REMOVED' });
  await removed.validate();
  const duplicateCell = new ItemInstance({ itemInstanceId: 'i-duplicate-cell', skuId: ids.skuId, itemSpecId: ids.specB, reservationId: ids.reservationId, facilityId: ids.facilityId, customerId: ids.customerId, sourceReceiptId: 'r1', quantity: 1, unitWeightKgSnapshot: 2, unitVolumeM3Snapshot: .02,
    unitDimensionsSnapshot: { widthM: .2, depthM: .2, heightM: .5 }, allocations: [{ cellId: ids.c1, weightKg: 1, volumeM3: .01 }, { cellId: ids.c1, weightKg: 1, volumeM3: .01 }], status: 'PLACED' });
  await assert.rejects(duplicateCell.validate());
});

function movement(action, revision, lines, overrides = {}) {
  const dimensions = lines[0]?.unitDimensionsSnapshot || { widthM: .2, depthM: .2, heightM: .25 };
  const unitWeight = lines[0]?.unitWeightKgSnapshot || 2, unitVolume = lines[0]?.unitVolumeM3Snapshot || .01;
  const totalWeight = lines.reduce((sum, line) => sum + line.allocatedWeightKg, 0), totalVolume = lines.reduce((sum, line) => sum + line.allocatedVolumeM3, 0);
  const quantity = lines.filter(line => !line.itemInstanceId).reduce((sum, line) => sum + line.quantity, 0) + new Set(lines.filter(line => line.itemInstanceId).map(line => line.itemInstanceId)).size;
  return { _id: oid(20 + revision), itemId: ids.skuId, itemSpecId: ids.specA, managedReservationId: ids.reservationId, facilityId: ids.facilityId, customerId: ids.customerId,
    type: action === 'ADD' ? 'INBOUND' : action === 'REMOVE' ? 'OUTBOUND' : 'RELOCATION', quantity, quantityUnit: 'unit', actualUnitWeightKg: unitWeight,
    actualTotalWeightKg: totalWeight, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: totalVolume, performedBy: ids.customerId, performedAt: new Date(`2026-11-${String(revision).padStart(2,'0')}T10:00:00Z`),
    inspectionNote: 'Customer declared receipt', handoverNote: 'Customer attested removal', relocationNote: 'Customer attested move', idempotencyKey: `key-${revision}`, schemaVersion: 4,
    operationId: `op-${revision}`, stockEffect: { action, operationId: `op-${revision}`, requestHash: 'a'.repeat(64), ledgerRevision: revision,
      source: action === 'ADD' ? [] : lines, destination: action === 'REMOVE' ? [] : lines }, ...overrides };
}
test('shared V4 SKU evidence reconciler preserves replay, projection, scope, and fail-closed semantics', () => {
  const add = movement('ADD', 1, [stockLine({ quantity: 10, unitWeightKgSnapshot: 1, unitVolumeM3Snapshot: .008,
    unitDimensionsSnapshot: { widthM: .2, depthM: .2, heightM: .2 }, allocatedWeightKg: 10, allocatedVolumeM3: .08 })]);
  const replay = domain.replayManagedStockMovements([add]);
  const specification = { _id: ids.specA, quantityUnitId: { _id: oid(10), code: 'BOX', name: 'thùng' } };
  const valid = reconcileManagedV4SkuEvidence({ skuId: ids.skuId, movements: [add], stocks: replay.lots, instances: replay.instances,
    specifications: [specification], canonicalScopeMatches: true, initialized: false });
  assert.equal(valid.ledgerStatus, 'REPLAYED'); assert.equal(valid.totalWeightKg, 10); assert.equal(valid.totalVolumeM3, .08);
  assert.deepEqual(valid.quantityByUnit.map(row => ({ unit: row.quantityUnit, quantity: row.quantity })), [{ unit: 'thùng', quantity: 10 }]);
  const mismatch = reconcileManagedV4SkuEvidence({ skuId: ids.skuId, movements: [{ ...add, stockEffect: { ...add.stockEffect, ledgerRevision: 2 } }],
    stocks: replay.lots, instances: replay.instances, specifications: [specification], canonicalScopeMatches: true, initialized: false });
  assert.equal(mismatch.ledgerStatus, 'MISMATCH'); assert.equal(mismatch.totalWeightKg, null);
  const projectionMismatch = reconcileManagedV4SkuEvidence({ skuId: ids.skuId, movements: [add], stocks: [], instances: replay.instances,
    specifications: [specification], canonicalScopeMatches: true, initialized: false });
  assert.equal(projectionMismatch.ledgerStatus, 'UNKNOWN'); assert.equal(projectionMismatch.totalVolumeM3, null);
  const outOfScope = reconcileManagedV4SkuEvidence({ skuId: ids.skuId, movements: [add], stocks: replay.lots, instances: replay.instances,
    specifications: [specification], canonicalScopeMatches: false, initialized: false });
  assert.equal(outOfScope.reasonCode, 'STOCK_SCOPE_MISMATCH'); assert.equal(outOfScope.totalWeightKg, null);
  const empty = reconcileManagedV4SkuEvidence({ skuId: ids.skuId, movements: [], stocks: [], instances: [], specifications: [], canonicalScopeMatches: true, initialized: true });
  assert.equal(empty.ledgerStatus, 'NOT_REQUIRED'); assert.equal(empty.totalWeightKg, 0); assert.equal(empty.totalVolumeM3, 0);
  const overLimit = reconcileManagedV4SkuEvidence({ skuId: ids.skuId, movements: Array.from({ length: 10001 }, () => ({ schemaVersion: 4 })),
    stocks: [], instances: [], specifications: [], canonicalScopeMatches: true, initialized: false });
  assert.equal(overLimit.ledgerStatus, 'UNKNOWN'); assert.equal(overLimit.reasonCode, 'MOVEMENT_HISTORY_LIMIT_EXCEEDED');
});
function stockLine({cellId=ids.c1,receiptId='receipt-1',quantity=10,unitWeightKgSnapshot=2,unitVolumeM3Snapshot=.01,unitDimensionsSnapshot={widthM:.2,depthM:.2,heightM:.25},allocatedWeightKg=quantity*unitWeightKgSnapshot,allocatedVolumeM3=quantity*unitVolumeM3Snapshot,itemInstanceId}={}) {
  return { itemSpecId: ids.specA, receiptId, ...(itemInstanceId?{itemInstanceId}:{}), cellId, quantity, unitWeightKgSnapshot, unitVolumeM3Snapshot, unitDimensionsSnapshot, allocatedWeightKg, allocatedVolumeM3 };
}
test('schema v4 canonical movements preserve Item Specification, receipt and Cell identity without A1/A2/topology fields', async () => {
  const movementRow = new ItemMovement(movement('ADD', 1, [stockLine()]));
  await movementRow.validate();
  assert.equal(movementRow.schemaVersion,4); assert.equal(movementRow.itemSpecId.toString(),ids.specA.toString());
  assert.equal(movementRow.v3Effect,undefined); assert.equal(movementRow.stockEffect.destination[0].receiptId,'receipt-1');
});
test('V4 replay handles partial REMOVE, stable receipt snapshots and exact per-Cell physical totals', () => {
  const add=movement('ADD',1,[stockLine()]), remove=movement('REMOVE',2,[stockLine({quantity:3,allocatedWeightKg:6,allocatedVolumeM3:.03})]);
  const replay=domain.replayManagedStockMovements([remove,add]);
  assert.equal(replay.ledgerRevision,2); assert.equal(replay.lots.length,1); assert.equal(replay.lots[0].quantityOnHand,7);
  assert.equal(replay.lots[0].totalWeightKg,14); assert.equal(replay.lots[0].totalVolumeM3,.07); assert.equal(replay.lots[0].receiptId,'receipt-1');
});
test('V4 replay tracks multiple receipts and batch placements across Cells independently', () => {
  const first=movement('ADD',1,[stockLine({receiptId:'r1',quantity:3,allocatedWeightKg:6,allocatedVolumeM3:.03})]);
  const second=movement('ADD',2,[stockLine({cellId:ids.c2,receiptId:'r2',quantity:2,allocatedWeightKg:4,allocatedVolumeM3:.02})]);
  const replay=domain.replayManagedStockMovements([first,second]); assert.equal(replay.lots.length,2);
  assert.deepEqual(replay.lots.map(row=>row.quantityOnHand),[3,2]);
  const cells=domain.aggregateCellStock(replay.lots); assert.equal([...cells.values()].reduce((n,row)=>n+row.quantityOnHand,0),5);
});
test('V4 inbound then MOVE replays the full SKU history and preserves receipt quantity across Cells', () => {
  const add = movement('ADD', 1, [stockLine({ quantity: 3, allocatedWeightKg: 6, allocatedVolumeM3: .03 })]);
  const source = stockLine({ cellId: ids.c1, quantity: 1, allocatedWeightKg: 2, allocatedVolumeM3: .01 });
  const destination = stockLine({ cellId: ids.c2, quantity: 1, allocatedWeightKg: 2, allocatedVolumeM3: .01 });
  const move = movement('MOVE', 2, [source, destination], { quantity: 1, actualTotalWeightKg: 2, actualTotalVolumeM3: .01,
    stockEffect: { action: 'MOVE', operationId: 'op-2', requestHash: 'b'.repeat(64), ledgerRevision: 2, source: [source], destination: [destination] } });
  const replay = domain.replayManagedStockMovements([move, add]);
  assert.equal(replay.ledgerRevision, 2);
  assert.deepEqual(replay.lots.map(row => [row.cellId.toString(), row.quantityOnHand]), [[ids.c1.toString(), 2], [ids.c2.toString(), 1]]);
  assert.equal(replay.lots.reduce((sum, row) => sum + row.quantityOnHand, 0), 3);
});
test('V4 inbound then partial and full REMOVE replays to zero without deleting ledger events', () => {
  const add = movement('ADD', 1, [stockLine({ quantity: 3, allocatedWeightKg: 6, allocatedVolumeM3: .03 })]);
  const partial = movement('REMOVE', 2, [stockLine({ quantity: 1, allocatedWeightKg: 2, allocatedVolumeM3: .01 })]);
  const full = movement('REMOVE', 3, [stockLine({ quantity: 2, allocatedWeightKg: 4, allocatedVolumeM3: .02 })]);
  const events = [add, partial, full];
  const replay = domain.replayManagedStockMovements(events);
  assert.equal(events.length, 3);
  assert.equal(replay.ledgerRevision, 3);
  assert.deepEqual(replay.lots, []);
});
test('Facility replay keeps independent SKU ledger revisions and placements separate', () => {
  const otherSku = oid(31), otherSpec = oid(32);
  const first = movement('ADD', 1, [stockLine({ receiptId: 'same-receipt', quantity: 2, allocatedWeightKg: 4, allocatedVolumeM3: .02 })]);
  const second = movement('ADD', 1, [{ ...stockLine({ receiptId: 'same-receipt', quantity: 3, allocatedWeightKg: 6, allocatedVolumeM3: .03 }), itemSpecId: otherSpec }], { itemId: otherSku, itemSpecId: otherSpec, operationId: 'other-sku-op', stockEffect: { action: 'ADD', operationId: 'other-sku-op', requestHash: 'b'.repeat(64), ledgerRevision: 1, source: [], destination: [{ ...stockLine({ receiptId: 'same-receipt', quantity: 3, allocatedWeightKg: 6, allocatedVolumeM3: .03 }), itemSpecId: otherSpec }] } });
  const replay = domain.replayManagedStockMovementsBySku([first, second]);
  assert.equal(replay.lots.length, 2);
  assert.deepEqual(replay.lots.map(row => row.quantityOnHand).sort(), [2, 3]);
  assert.deepEqual(replay.lots.map(row => row.skuId.toString()).sort(), [ids.skuId.toString(), otherSku.toString()].sort());
});
test('V4 Item Instance spanning Cells remains quantity one and conserves allocated loads', () => {
  const dimensions={widthM:.5,depthM:.5,heightM:.2}, common={unitWeightKgSnapshot:10,unitVolumeM3Snapshot:.05,unitDimensionsSnapshot:dimensions,itemInstanceId:'instance-1',quantity:1};
  const lines=[stockLine({...common,cellId:ids.c1,receiptId:'physical-r',allocatedWeightKg:6,allocatedVolumeM3:.03}),stockLine({...common,cellId:ids.c2,receiptId:'physical-r',allocatedWeightKg:4,allocatedVolumeM3:.02})];
  const replay=domain.replayManagedStockMovements([movement('ADD',1,lines)]); assert.equal(replay.instances.length,1); assert.equal(replay.instances[0].quantity,1);
  const cells=domain.aggregateCellStock([],replay.instances); assert.equal([...cells.values()].reduce((n,row)=>n+row.quantityOnHand,0),1);
  assert.equal([...cells.values()].reduce((n,row)=>n+row.weightKg,0),10); assert.equal([...cells.values()].reduce((n,row)=>n+row.volumeM3,0),.05);
});
test('V4 replay fails closed for oversold sources and stale ledger revisions', () => {
  const add=movement('ADD',1,[stockLine()]), over=movement('REMOVE',2,[stockLine({quantity:11,allocatedWeightKg:22,allocatedVolumeM3:.11})]);
  assert.throws(()=>domain.replayManagedStockMovements([add,over]),{code:'INSUFFICIENT_CELL_STOCK'});
  assert.throws(()=>domain.replayManagedStockMovements([movement('ADD',2,[stockLine()])]),{code:'STOCK_LEDGER_REVISION_GAP'});
});
