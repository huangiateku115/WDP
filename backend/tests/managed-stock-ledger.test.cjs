const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'test', MONGO_URL: 'mongodb://localhost/test', KEYCLOAK_BASE_URL: 'http://localhost:8081',
  KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
const { ManagedStockErrorCode } = require('../dist/types/managed-stock.type');
const stock = require('../dist/services/inventory-items/managed-stock-ledger.service');
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const arithmetic = require('../dist/utils/managed-stock-arithmetic');
const ids = { item: '507f1f77bcf86cd799439001', customer: '507f1f77bcf86cd799439002',
  reservation: '507f1f77bcf86cd799439003', facility: '507f1f77bcf86cd799439004',
  cellA: '507f1f77bcf86cd799439005', cellB: '507f1f77bcf86cd799439006' };
const dims = { widthM: .5, depthM: .5, heightM: .4 };
const line = (batchId, action, quantity) => ({ batchId, action, quantity, quantityUnit: 'box',
  actualUnitWeightKg: 10, actualUnitDimensionsM: dims,
  actualTotalWeightKg: arithmetic.canonicalProductNumber([10], quantity, 3),
  actualTotalVolumeM3: arithmetic.canonicalProductNumber([dims.widthM, dims.depthM, dims.heightM], quantity, 6) });
function item(overrides = {}) { return { _id: ids.item, customerId: ids.customer, managedReservationId: ids.reservation,
  facilityId: ids.facility, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cellA, currentPlacementMovementId: null, ...overrides }; }
function movement(type, index, overrides = {}) { return { _id: `507f1f77bcf86cd7994390${String(index).padStart(2, '0')}`,
  itemId: ids.item, customerId: ids.customer, managedReservationId: ids.reservation, facilityId: ids.facility,
  type, quantity: 2, quantityUnit: 'box', actualUnitWeightKg: 10, actualTotalWeightKg: 20,
  actualUnitDimensionsM: dims, actualTotalVolumeM3: .2, performedAt: new Date(Date.UTC(2026, 0, index)), ...overrides }; }
function inbound(index, batchId, quantity, cellId = ids.cellA) {
  const batchLine = line(batchId, 'ADD', quantity);
  return movement('INBOUND', index, { schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', quantity, destinationCellId: cellId,
    actualTotalWeightKg: batchLine.actualTotalWeightKg, actualTotalVolumeM3: batchLine.actualTotalVolumeM3,
    batchLines: [batchLine] });
}
function schema2Movement(type, index, quantity, batchLines, overrides = {}) {
  const weightUnits = arithmetic.sumExactPrecisionUnits(batchLines.map(entry => entry.actualTotalWeightKg), 3);
  const volumeUnits = arithmetic.sumExactPrecisionUnits(batchLines.map(entry => entry.actualTotalVolumeM3), 6);
  return movement(type, index, { schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', quantity, batchLines,
    actualTotalWeightKg: weightUnits === null ? batchLines.reduce((sum, entry) => sum + entry.actualTotalWeightKg, 0)
      : arithmetic.precisionUnitsToNumber(weightUnits, 3),
    actualTotalVolumeM3: volumeUnits === null ? batchLines.reduce((sum, entry) => sum + entry.actualTotalVolumeM3, 0)
      : arithmetic.precisionUnitsToNumber(volumeUnits, 6), ...overrides });
}
function expectCode(code, action) { assert.throws(action, error => error.code === code); }
function validateHistoricalMovement(fields) {
  const doc = new Movement(fields);
  doc.$isNew = false;
  return doc.validate();
}
function stableSnapshot(value) {
  if (value instanceof Date) return { $date: value.getTime() };
  if (value instanceof mongoose.Types.ObjectId) return { $objectId: value.toHexString() };
  if (Array.isArray(value)) return value.map(stableSnapshot);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableSnapshot(value[key])]),
  );
  return value;
}

test('folds multiple immutable receipt batches and deterministic batch removals', () => {
  const events = [inbound(1, 'batch-one', 3), inbound(2, 'batch-two', 2),
    schema2Movement('OUTBOUND', 3, 2, [line('batch-one', 'REMOVE', 2)], { sourceCellId: ids.cellA })];
  const balance = stock.reconcileManagedItemStock(item({ currentPlacementMovementId: events[1]._id }), events);
  assert.equal(balance.onHandQuantity, 3);
  assert.equal(balance.actualTotalWeightKg, 30);
  assert.equal(balance.actualTotalVolumeM3, .3);
  assert.deepEqual(balance.batches.map(batch => [batch.batchId, batch.quantity]), [['batch-one', 1], ['batch-two', 2]]);
  assert.equal(balance.source, 'LEDGER_V2');
});

test('legacy outbound allocates oldest receipt batch first with deterministic tie breaking', () => {
  const receivedA = movement('INBOUND', 1, { quantity: 2, destinationCellId: ids.cellA,
    actualTotalWeightKg: 20, actualTotalVolumeM3: .2, inspectionNote: 'received' });
  const receivedB = movement('INBOUND', 2, { quantity: 1, destinationCellId: ids.cellA,
    actualTotalWeightKg: 10, actualTotalVolumeM3: .1, inspectionNote: 'received later' });
  const shipped = movement('OUTBOUND', 3, { quantity: 1, sourceCellId: ids.cellA,
    actualTotalWeightKg: 10, actualTotalVolumeM3: .1, destinationCellId: null, handoverNote: 'handed over' });
  const balance = stock.reconcileManagedItemStock(item(), [shipped, receivedB, receivedA]);
  assert.equal(balance.onHandQuantity, 2);
  assert.equal(balance.batches[0].batchId, `legacy:${receivedA._id}`);
  assert.equal(balance.batches[0].quantity, 1);
});

test('rejects a batch removal that would create negative stock', () => {
  const events = [inbound(1, 'batch-one', 1), schema2Movement('OUTBOUND', 2, 2,
    [line('batch-one', 'REMOVE', 2)], { sourceCellId: ids.cellA })];
  expectCode(ManagedStockErrorCode.NEGATIVE_STOCK, () => stock.reconcileManagedItemStock(item(), events));
});

test('preserves legacy inbound-relocation-outbound lineage and zero-stock Item identity', () => {
  const received = movement('INBOUND', 1, { quantity: 2, destinationCellId: ids.cellA,
    actualTotalWeightKg: 20, actualTotalVolumeM3: .2, inspectionNote: 'received' });
  const moved = movement('RELOCATION', 2, { quantity: 2, sourceCellId: ids.cellA,
    destinationCellId: ids.cellB, previousPlacementMovementId: received._id, relocationNote: 'move' });
  const shipped = movement('OUTBOUND', 3, { quantity: 2, sourceCellId: ids.cellB,
    destinationCellId: null, handoverNote: 'handed over' });
  const result = stock.reconcileManagedItemStock(item({ status: 'CHECKED_OUT', currentCellId: null, currentPlacementMovementId: null }), [shipped, moved, received]);
  assert.equal(result.onHandQuantity, 0);
  assert.equal(result.currentCellId, null);
  assert.equal(result.batches.length, 0);
  assert.equal(result.source, 'LEGACY_RECONCILED');
});

test('detects broken relocation pointers, placement projection and ownership corruption', () => {
  const received = movement('INBOUND', 1, { quantity: 2, destinationCellId: ids.cellA,
    actualTotalWeightKg: 20, actualTotalVolumeM3: .2, inspectionNote: 'received' });
  const wrongPointer = movement('RELOCATION', 2, { quantity: 2, sourceCellId: ids.cellA,
    destinationCellId: ids.cellB, previousPlacementMovementId: '507f1f77bcf86cd799439099', relocationNote: 'move' });
  expectCode(ManagedStockErrorCode.PLACEMENT_LINEAGE_INVALID, () => stock.reconcileManagedItemStock(item({ currentCellId: ids.cellB }), [received, wrongPointer]));
  expectCode(ManagedStockErrorCode.ITEM_PROJECTION_MISMATCH, () => stock.reconcileManagedItemStock(item({ currentCellId: ids.cellB }), [received]));
  const wrongOwner = inbound(1, 'batch-one', 1);
  wrongOwner.customerId = '507f1f77bcf86cd799439099';
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [wrongOwner]));
});

test('checks movement-to-batch arithmetic and duplicate batch identities', () => {
  const wrongTotals = schema2Movement('INBOUND', 1, 1, [line('batch-one', 'ADD', 1)],
    { destinationCellId: ids.cellA, actualTotalWeightKg: 999 });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [wrongTotals]));
  const duplicate = schema2Movement('INBOUND', 1, 2, [line('same', 'ADD', 1), line('same', 'ADD', 1)],
    { destinationCellId: ids.cellA });
  expectCode(ManagedStockErrorCode.BATCH_MISMATCH, () => stock.reconcileManagedItemStock(item(), [duplicate]));
  const received = inbound(1, 'batch-one', 2);
  const corruptRemoveLine = { ...line('batch-one', 'REMOVE', 1), actualTotalVolumeM3: 9 };
  const corruptRemove = schema2Movement('OUTBOUND', 2, 1, [corruptRemoveLine], { sourceCellId: ids.cellA });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item({ currentPlacementMovementId: received._id }), [received, corruptRemove]));
});

test('rejects unsupported ledger versions and v1 movements carrying batch lines while preserving null legacy version', () => {
  const unsupported = inbound(1, 'batch-one', 1);
  unsupported.schemaVersion = 3;
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [unsupported]));
  const v1WithLines = movement('INBOUND', 1, { schemaVersion: 1, quantity: 1, destinationCellId: ids.cellA,
    actualTotalWeightKg: 10, actualTotalVolumeM3: .1, batchLines: [line('batch-one', 'ADD', 1)] });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [v1WithLines]));
  const legacy = movement('INBOUND', 1, { schemaVersion: null, quantity: 2, destinationCellId: ids.cellA,
    actualTotalWeightKg: 20, actualTotalVolumeM3: .2 });
  const result = stock.reconcileManagedItemStock(item(), [legacy]);
  assert.equal(result.source, 'LEGACY_RECONCILED');
  assert.equal(result.onHandQuantity, 2);
});

test('requires Item, movement and every batch line to use the same quantity unit', () => {
  const parentMismatch = movement('INBOUND', 1, { quantity: 2, destinationCellId: ids.cellA,
    actualTotalWeightKg: 20, actualTotalVolumeM3: .2, quantityUnit: 'piece' });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [parentMismatch]));
  const mismatchedLine = { ...line('batch-one', 'ADD', 1), quantityUnit: 'piece' };
  const v2 = schema2Movement('INBOUND', 1, 1, [mismatchedLine], { destinationCellId: ids.cellA });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [v2]));
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item({ quantityUnit: 'piece' }), [inbound(1, 'batch-one', 1)]));
});

test('accepts heterogeneous physical batches with parent unit fields defined by the first line', () => {
  const first = line('batch-one', 'ADD', 2);
  const second = { ...line('batch-two', 'ADD', 1), actualUnitWeightKg: 4, actualTotalWeightKg: 4,
    actualUnitDimensionsM: { widthM: .4, depthM: .4, heightM: .5 }, actualTotalVolumeM3: .08 };
  const event = schema2Movement('INBOUND', 1, 3, [first, second], { destinationCellId: ids.cellA });
  const result = stock.reconcileManagedItemStock(item({ currentPlacementMovementId: event._id }), [event]);
  assert.equal(result.onHandQuantity, 3);
  assert.equal(result.actualTotalWeightKg, 24);
  assert.equal(result.actualTotalVolumeM3, .28);
});

test('accepts unrounded unit-volume products multiplied by quantity across schema, reconciliation, and stock balance', async () => {
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  const receiptLine = { ...line('fractional-volume-batch', 'ADD', 100), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 150, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195313 };
  const event = schema2Movement('INBOUND', 1, 100, [receiptLine], { destinationCellId: ids.cellA,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions });
  const movementDoc = new Movement({ ...event, performedBy: new mongoose.Types.ObjectId(), inspectionNote: 'received',
    idempotencyKey: 'mi06-rounding-volume-0001' });
  assert.equal(await movementDoc.validate().then(() => true), true);

  const result = stock.reconcileManagedItemStock(item({ currentPlacementMovementId: event._id }), [event]);
  assert.equal(result.actualTotalVolumeM3, .195313);
  assert.equal(result.batches[0].actualTotalVolumeM3, .195313);

  const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
  const balanceDoc = new Balance({ itemId: new mongoose.Types.ObjectId(ids.item), facilityId: new mongoose.Types.ObjectId(ids.facility),
    customerId: new mongoose.Types.ObjectId(ids.customer), managedReservationId: new mongoose.Types.ObjectId(ids.reservation),
    currentCellId: new mongoose.Types.ObjectId(ids.cellA), source: 'LEDGER_V2', onHandQuantity: 100, heldQuantity: 0,
    actualTotalWeightKg: 150, actualTotalVolumeM3: .195313, batches: [{ batchId: receiptLine.batchId,
      receiptMovementId: new mongoose.Types.ObjectId(event._id), quantity: 100, heldQuantity: 0, quantityUnit: 'box',
      actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalWeightKg: 150,
      actualTotalVolumeM3: .195313, arithmeticPolicy: 'CANONICAL_V1', receivedAt: new Date() }] });
  assert.equal(await balanceDoc.validate().then(() => true), true);
});

test('canonical decimal arithmetic rounds once and rejects values outside its safe numeric range', () => {
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  assert.equal(arithmetic.canonicalProductNumber([dimensions.widthM, dimensions.depthM, dimensions.heightM], 100, 6), .195313);
  assert.equal(arithmetic.canonicalProductNumber([dimensions.widthM, dimensions.depthM, dimensions.heightM], 99, 6), .193359);
  assert.equal(arithmetic.canonicalProductNumber([dimensions.widthM, dimensions.depthM, dimensions.heightM], 1, 6), .001953);
  assert.equal(arithmetic.canonicalProductNumber([1.2345], 1, 3), 1.235);
  assert.equal(arithmetic.canonicalProductNumber([1e308], Number.MAX_SAFE_INTEGER, 3), null);
  assert.equal(arithmetic.precisionUnitsToNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3), null);
  assert.equal(arithmetic.exactPrecisionUnits(.1953125, 6), null);
});

test('canonical schema v2 rejects a one-precision-unit mismatch while historical missing/null policy remains readable', async () => {
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  const canonicalLine = { ...line('canonical-batch', 'ADD', 100), actualUnitWeightKg: 1.5, actualTotalWeightKg: 150,
    actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195313 };
  const canonical = schema2Movement('INBOUND', 1, 100, [canonicalLine], { destinationCellId: ids.cellA,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions });
  assert.equal(await new Movement({ ...canonical, performedBy: new mongoose.Types.ObjectId(), inspectionNote: 'canonical',
    idempotencyKey: 'mi06-canonical-valid-0001' }).validate().then(() => true), true);
  await assert.rejects(new Movement({ ...canonical, arithmeticPolicy: undefined, performedBy: new mongoose.Types.ObjectId(),
    inspectionNote: 'missing required new-write policy', idempotencyKey: 'mi06-canonical-marker-required-0001' }).validate(),
  /require CANONICAL_V1/);

  const incorrectLine = { ...canonicalLine, actualTotalVolumeM3: .195312 };
  const incorrect = schema2Movement('INBOUND', 2, 100, [incorrectLine], { destinationCellId: ids.cellA,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195312 });
  await assert.rejects(new Movement({ ...incorrect, performedBy: new mongoose.Types.ObjectId(), inspectionNote: 'incorrect',
    idempotencyKey: 'mi06-canonical-wrong-0001' }).validate(), /Schema v2 batch lines/);
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [incorrect]));
  const wrongParent = { ...canonical, actualTotalVolumeM3: .195312 };
  await assert.rejects(new Movement({ ...wrongParent, performedBy: new mongoose.Types.ObjectId(), inspectionNote: 'wrong parent',
    idempotencyKey: 'mi06-canonical-parent-wrong-0001' }).validate(), /Schema v2 batch lines/);
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [wrongParent]));

  const historical = { ...incorrect, arithmeticPolicy: undefined };
  const hydrated = new Movement({ ...historical, performedBy: new mongoose.Types.ObjectId(), inspectionNote: 'historical',
    idempotencyKey: 'mi06-compat-hydrated-0001' });
  hydrated.$isNew = false;
  assert.equal(await hydrated.validate().then(() => true), true);
  assert.equal(stock.reconcileManagedItemStock(item({ currentPlacementMovementId: historical._id }), [historical]).batches[0].arithmeticPolicy, 'COMPATIBILITY');
  assert.equal(stock.reconcileManagedItemStock(item({ currentPlacementMovementId: historical._id }),
    [{ ...historical, arithmeticPolicy: null }]).batches[0].arithmeticPolicy,
    'COMPATIBILITY');
});

test('unknown arithmetic policy and canonical marker on v1 fail closed', async () => {
  const unknown = inbound(1, 'policy-batch', 1);
  unknown.arithmeticPolicy = 'FUTURE_UNKNOWN';
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [unknown]));
  await assert.rejects(new Movement({ ...unknown, performedBy: new mongoose.Types.ObjectId(), inspectionNote: 'unknown',
    idempotencyKey: 'mi06-unknown-policy-0001' }).validate());

  const legacy = movement('INBOUND', 1, { schemaVersion: 1, arithmeticPolicy: 'CANONICAL_V1', quantity: 1,
    destinationCellId: ids.cellA, actualTotalWeightKg: 10, actualTotalVolumeM3: .1, inspectionNote: 'legacy' });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [legacy]));
  await assert.rejects(new Movement({ ...legacy, performedBy: new mongoose.Types.ObjectId(),
    idempotencyKey: 'mi06-v1-policy-0001' }).validate());
});

test('compatibility receipts with tolerated totals project and partial removals preserve provenance', async () => {
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  const receiptLine = { ...line('compat-partial-batch', 'ADD', 100), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 150, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195312 };
  const receipt = schema2Movement('INBOUND', 1, 100, [receiptLine], { arithmeticPolicy: null,
    destinationCellId: ids.cellA, actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195312 });
  const events = [receipt];
  let remaining = 100;
  for (const [index, quantity] of [1, 1].entries()) {
    const removeLine = { ...line('compat-partial-batch', 'REMOVE', quantity), actualUnitWeightKg: 1.5,
      actualUnitDimensionsM: dimensions, actualTotalWeightKg: 1.5, actualTotalVolumeM3: .001953 };
    events.push(schema2Movement('OUTBOUND', index + 2, quantity, [removeLine], { arithmeticPolicy: null,
      sourceCellId: ids.cellA, actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions,
      actualTotalWeightKg: 1.5, actualTotalVolumeM3: .001953 }));
    remaining -= quantity;
    const projected = stock.reconcileManagedItemStock(item({ currentPlacementMovementId: receipt._id }), events);
    assert.equal(projected.batches[0].arithmeticPolicy, 'COMPATIBILITY');
    assert.equal(projected.batches[0].quantity, remaining);
    assert.equal(projected.batches[0].actualTotalVolumeM3,
      arithmetic.canonicalProductNumber([dimensions.widthM, dimensions.depthM, dimensions.heightM], remaining, 6));
  }
  const projected = stock.reconcileManagedItemStock(item({ currentPlacementMovementId: receipt._id }), events);
  assert.equal(projected.batches[0].actualTotalVolumeM3, .191406);
  assert.equal(receipt.batchLines[0].actualTotalVolumeM3, .195312, 'movement history remains unchanged');

  const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
  const balance = new Balance({ itemId: new mongoose.Types.ObjectId(ids.item), facilityId: new mongoose.Types.ObjectId(ids.facility),
    customerId: new mongoose.Types.ObjectId(ids.customer), managedReservationId: new mongoose.Types.ObjectId(ids.reservation),
    currentCellId: new mongoose.Types.ObjectId(ids.cellA), source: 'LEDGER_V2', onHandQuantity: projected.onHandQuantity,
    heldQuantity: 0, actualTotalWeightKg: projected.actualTotalWeightKg, actualTotalVolumeM3: projected.actualTotalVolumeM3,
    batches: projected.batches.map(batch => ({ ...batch,
      receiptMovementId: new mongoose.Types.ObjectId(String(batch.receiptMovementId)) })) });
  assert.equal(await balance.validate().then(() => true), true);
});

test('canonical partial removal separates movement quantity volume from before/after stock delta', () => {
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  const receiptLine = { ...line('canonical-partial', 'ADD', 100), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 150, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195313 };
  const receipt = schema2Movement('INBOUND', 1, 100, [receiptLine], { destinationCellId: ids.cellA,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions });
  const initial = stock.reconcileManagedItemStock(item({ currentPlacementMovementId: receipt._id }), [receipt]);
  assert.equal(initial.actualTotalVolumeM3, .195313);

  const removeLine = { ...line('canonical-partial', 'REMOVE', 1), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .001953 };
  const removal = schema2Movement('OUTBOUND', 2, 1, [removeLine], { sourceCellId: ids.cellA,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions });
  const result = stock.reconcileManagedItemStock(item({ currentPlacementMovementId: receipt._id }), [receipt, removal]);
  assert.equal(removal.actualTotalVolumeM3, .001953);
  assert.equal(result.onHandQuantity, 99);
  assert.equal(result.actualTotalVolumeM3, .193359);
  assert.equal(arithmetic.exactPrecisionUnits(initial.actualTotalVolumeM3, 6) -
    arithmetic.exactPrecisionUnits(result.actualTotalVolumeM3, 6), 1954n);
});

test('mixed v1 compatibility and canonical v2 batches retain receipt policy across full relocation', () => {
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  const oldReceipt = movement('INBOUND', 1, { quantity: 100, destinationCellId: ids.cellA, actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 150, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195312, inspectionNote: 'legacy receipt' });
  const oldBatchId = `legacy:${oldReceipt._id}`;
  const newLine = { ...line('mixed-new', 'ADD', 2), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 3, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .003906 };
  const newReceipt = schema2Movement('INBOUND', 2, 2, [newLine], { destinationCellId: ids.cellA,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .003906 });
  const removeLines = [
    { ...line(oldBatchId, 'REMOVE', 1), actualUnitWeightKg: 1.5, actualTotalWeightKg: 1.5,
      actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .001953 },
    { ...line('mixed-new', 'REMOVE', 1), actualUnitWeightKg: 1.5, actualTotalWeightKg: 1.5,
      actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .001953 },
  ];
  const removal = schema2Movement('OUTBOUND', 3, 2, removeLines, { sourceCellId: ids.cellA,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions });
  const moveLines = [
    { ...line(oldBatchId, 'MOVE', 99), actualUnitWeightKg: 1.5, actualTotalWeightKg: 148.5,
      actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .193359 },
    { ...line('mixed-new', 'MOVE', 1), actualUnitWeightKg: 1.5, actualTotalWeightKg: 1.5,
      actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .001953 },
  ];
  const relocation = schema2Movement('RELOCATION', 4, 100, moveLines, { sourceCellId: ids.cellA, destinationCellId: ids.cellB,
    previousPlacementMovementId: newReceipt._id, relocationNote: 'full relocation', physicalPackingConfirmed: true,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalWeightKg: 150, actualTotalVolumeM3: .195312 });
  const result = stock.reconcileManagedItemStock(item({ currentCellId: ids.cellB, currentPlacementMovementId: relocation._id }),
    [oldReceipt, newReceipt, removal, relocation]);
  assert.deepEqual(result.batches.map(batch => [batch.batchId, batch.quantity, batch.arithmeticPolicy]), [
    [oldBatchId, 99, 'COMPATIBILITY'], ['mixed-new', 1, 'CANONICAL_V1'],
  ]);
});

test('preserves Item identity and permits ledger re-inbound after stock reaches zero', () => {
  const first = inbound(1, 'first-receipt', 2);
  const outbound = schema2Movement('OUTBOUND', 2, 2, [line('first-receipt', 'REMOVE', 2)], { sourceCellId: ids.cellA });
  const second = inbound(3, 'second-receipt', 1);
  const result = stock.reconcileManagedItemStock(item({ currentCellId: ids.cellA,
    currentPlacementMovementId: second._id, status: 'IN_STORAGE' }), [first, outbound, second]);
  assert.equal(result.itemId, ids.item);
  assert.equal(result.onHandQuantity, 1);
  assert.equal(result.batches.length, 1);
  assert.equal(result.batches[0].batchId, 'second-receipt');
  assert.equal(result.batches[0].arithmeticPolicy, 'CANONICAL_V1');
});

test('read-only reconciliation preserves Item and nested movement input including BSON and Date values', () => {
  const itemInput = { ...item(), _id: new mongoose.Types.ObjectId(ids.item), customerId: new mongoose.Types.ObjectId(ids.customer),
    managedReservationId: new mongoose.Types.ObjectId(ids.reservation), facilityId: new mongoose.Types.ObjectId(ids.facility),
    currentCellId: new mongoose.Types.ObjectId(ids.cellA) };
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  const batchLine = { ...line('immutable-input-batch', 'ADD', 100), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 150, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195313,
    receiptRequestId: new mongoose.Types.ObjectId(), receivingInspectionEvidenceId: new mongoose.Types.ObjectId() };
  const movementInput = schema2Movement('INBOUND', 1, 100, [batchLine], {
    itemId: itemInput._id, customerId: itemInput.customerId, managedReservationId: itemInput.managedReservationId,
    facilityId: itemInput.facilityId, destinationCellId: itemInput.currentCellId,
    actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalWeightKg: 150,
    actualTotalVolumeM3: .195313, inspectionNote: 'immutable metadata', idempotencyKey: 'mi06-readonly-input-0001',
  });
  itemInput.currentPlacementMovementId = movementInput._id;
  const before = stableSnapshot({ item: itemInput, movements: [movementInput] });

  const result = stock.reconcileManagedItemStock(itemInput, [movementInput]);

  assert.equal(result.onHandQuantity, 100);
  assert.deepEqual(stableSnapshot({ item: itemInput, movements: [movementInput] }), before);
});

test('characterizes compatibility tolerance and canonical stock-balance precision policy', async () => {
  const dimensions = { widthM: .125, depthM: .125, heightM: .125 };
  const acceptedBoundaryLine = { ...line('boundary-volume-batch', 'ADD', 100), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 150, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195312 };
  const atBoundary = schema2Movement('INBOUND', 1, 100, [acceptedBoundaryLine], { arithmeticPolicy: null,
    destinationCellId: ids.cellA, actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions,
    actualTotalWeightKg: 150, actualTotalVolumeM3: .195312,
  });
  const movementAtBoundary = new Movement({ ...atBoundary, performedBy: new mongoose.Types.ObjectId(),
    inspectionNote: 'boundary', idempotencyKey: 'mi06-rounding-boundary-0001' });
  movementAtBoundary.$isNew = false;
  assert.equal(await movementAtBoundary.validate().then(() => true), true);
  assert.equal(stock.reconcileManagedItemStock(item({ currentPlacementMovementId: atBoundary._id }), [atBoundary])
    .actualTotalVolumeM3, .195312);

  const parentAtBoundary = { ...atBoundary, actualTotalVolumeM3: .195313 };
  assert.equal(await validateHistoricalMovement({ ...parentAtBoundary, performedBy: new mongoose.Types.ObjectId(),
    inspectionNote: 'parent precision boundary', idempotencyKey: 'mi06-parent-boundary-0001' }).then(() => true), true);
  assert.equal(stock.reconcileManagedItemStock(item({ currentPlacementMovementId: parentAtBoundary._id }), [parentAtBoundary])
    .actualTotalVolumeM3, .195312);
  const parentOutsideBoundary = { ...atBoundary, actualTotalVolumeM3: .195314 };
  await assert.rejects(validateHistoricalMovement({ ...parentOutsideBoundary, performedBy: new mongoose.Types.ObjectId(),
    inspectionNote: 'parent outside boundary', idempotencyKey: 'mi06-parent-boundary-0002' }), /Schema v2 batch lines/);
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [parentOutsideBoundary]));

  const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
  const boundaryBalance = new Balance({ itemId: new mongoose.Types.ObjectId(ids.item), facilityId: new mongoose.Types.ObjectId(ids.facility),
    customerId: new mongoose.Types.ObjectId(ids.customer), managedReservationId: new mongoose.Types.ObjectId(ids.reservation),
    currentCellId: new mongoose.Types.ObjectId(ids.cellA), source: 'LEDGER_V2', onHandQuantity: 100, heldQuantity: 0,
    actualTotalWeightKg: 150, actualTotalVolumeM3: .195312, batches: [{ batchId: acceptedBoundaryLine.batchId,
      receiptMovementId: new mongoose.Types.ObjectId(atBoundary._id), quantity: 100, heldQuantity: 0, quantityUnit: 'box',
      actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions, actualTotalWeightKg: 150,
      actualTotalVolumeM3: .195312, arithmeticPolicy: 'COMPATIBILITY', receivedAt: new Date() }] });
  assert.equal(await boundaryBalance.validate().then(() => true), true);

  const outsideBoundaryLine = { ...acceptedBoundaryLine, batchId: 'outside-volume-batch', actualTotalVolumeM3: .195311 };
  const outsideBoundary = schema2Movement('INBOUND', 2, 100, [outsideBoundaryLine], {
    destinationCellId: ids.cellA, actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions,
    actualTotalWeightKg: 150, actualTotalVolumeM3: .195311,
  });
  await assert.rejects(validateHistoricalMovement({ ...outsideBoundary, performedBy: new mongoose.Types.ObjectId(), inspectionNote: 'outside boundary',
    idempotencyKey: 'mi06-rounding-boundary-0002' }), /Schema v2 batch lines/);
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [outsideBoundary]));

  const weightBoundaryLine = { ...line('boundary-weight-batch', 'ADD', 100), actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 149.9995, actualUnitDimensionsM: dimensions, actualTotalVolumeM3: .195313 };
  const weightAtBoundary = schema2Movement('INBOUND', 3, 100, [weightBoundaryLine], { arithmeticPolicy: null,
    destinationCellId: ids.cellA, actualUnitWeightKg: 1.5, actualUnitDimensionsM: dimensions,
    actualTotalWeightKg: 149.9995, actualTotalVolumeM3: .195313,
  });
  assert.equal(await validateHistoricalMovement({ ...weightAtBoundary, performedBy: new mongoose.Types.ObjectId(),
    inspectionNote: 'weight precision boundary', idempotencyKey: 'mi06-weight-boundary-0001' }).then(() => true), true);
  assert.equal(stock.reconcileManagedItemStock(item({ currentPlacementMovementId: weightAtBoundary._id }), [weightAtBoundary])
    .actualTotalWeightKg, 150);
  const weightOutsideBoundary = { ...weightAtBoundary, actualTotalWeightKg: 149.99949,
    batchLines: [{ ...weightBoundaryLine, actualTotalWeightKg: 149.99949 }] };
  await assert.rejects(validateHistoricalMovement({ ...weightOutsideBoundary, performedBy: new mongoose.Types.ObjectId(),
    inspectionNote: 'weight outside boundary', idempotencyKey: 'mi06-weight-boundary-0002' }), /Schema v2 batch lines/);
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [weightOutsideBoundary]));
});

test('rejects inconsistent per-line weight and volume arithmetic during reconciliation', () => {
  const badWeight = { ...line('batch-weight', 'ADD', 2), actualTotalWeightKg: 21 };
  const weightEvent = schema2Movement('INBOUND', 1, 2, [badWeight], { destinationCellId: ids.cellA });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [weightEvent]));
  const badVolume = { ...line('batch-volume', 'ADD', 2), actualTotalVolumeM3: .21 };
  const volumeEvent = schema2Movement('INBOUND', 1, 2, [badVolume], { destinationCellId: ids.cellA });
  expectCode(ManagedStockErrorCode.INVALID_MOVEMENT, () => stock.reconcileManagedItemStock(item(), [volumeEvent]));
});

test('reconciles Cell and Reservation counters with stable reason codes', () => {
  const totals = { usedWeightKg: 20, usedVolumeM3: .2 };
  assert.equal(stock.reconcileManagedCounters(totals, { usedWeightKg: 20, usedVolumeM3: .2 }, { usedCapacityM3: .2 }, .2), true);
  expectCode(ManagedStockErrorCode.CELL_COUNTER_MISMATCH, () => stock.reconcileManagedCounters(totals,
    { usedWeightKg: 19, usedVolumeM3: .2 }, { usedCapacityM3: .2 }, .2));
  expectCode(ManagedStockErrorCode.RESERVATION_COUNTER_MISMATCH, () => stock.reconcileManagedCounters(totals,
    { usedWeightKg: 20, usedVolumeM3: .2 }, { usedCapacityM3: .3 }, .2));
  expectCode(ManagedStockErrorCode.CAPACITY_UNKNOWN, () => stock.reconcileManagedCounters(totals,
    { usedWeightKg: null, usedVolumeM3: .2 }, { usedCapacityM3: .2 }, .2));
});

test('derives capacity status independently of operationalStatus', () => {
  assert.equal(stock.deriveManagedCapacityStatus({ usedWeightKg: 0, usedVolumeM3: 0 }, { maxWeightKg: 100, maxVolumeM3: 1 }).capacityStatus, 'EMPTY');
  assert.equal(stock.deriveManagedCapacityStatus({ usedWeightKg: 20, usedVolumeM3: .2 }, { maxWeightKg: 100, maxVolumeM3: 1 }).capacityStatus, 'PARTIAL');
  assert.equal(stock.deriveManagedCapacityStatus({ usedWeightKg: 20, usedVolumeM3: 1 }, { maxWeightKg: 100, maxVolumeM3: 1 }).capacityStatus, 'FULL');
  assert.equal(stock.deriveManagedCapacityStatus({ usedWeightKg: 101, usedVolumeM3: .2 }, { maxWeightKg: 100, maxVolumeM3: 1 }).capacityStatus, 'UNKNOWN');
  assert.equal(stock.assertManagedCapacityFits({ usedWeightKg: 90, usedVolumeM3: .9 }, { weightKg: 10, volumeM3: .1 },
    { maxWeightKg: 100, maxVolumeM3: 1 }), true);
  expectCode(ManagedStockErrorCode.CAPACITY_EXCEEDED, () => stock.assertManagedCapacityFits(
    { usedWeightKg: 90, usedVolumeM3: .9 }, { weightKg: 11, volumeM3: .1 }, { maxWeightKg: 100, maxVolumeM3: 1 }));
  expectCode(ManagedStockErrorCode.CAPACITY_UNKNOWN, () => stock.assertManagedCapacityFits(
    { usedWeightKg: null, usedVolumeM3: 0 }, { weightKg: 1, volumeM3: .1 }, { maxWeightKg: 100, maxVolumeM3: 1 }));
});

test('ledger write gate defaults off and always blocks production', () => {
  assert.equal(stock.managedStockLedgerWritesEnabled('test', undefined), false);
  assert.equal(stock.managedStockLedgerWritesEnabled('development', 'true'), true);
  assert.equal(stock.managedStockLedgerWritesEnabled('production', 'true'), false);
  assert.throws(() => stock.assertManagedStockLedgerWritesEnabled('production', 'true'), error =>
    error.code === ManagedStockErrorCode.FEATURE_DISABLED && error.status === 503);
});

test('stock projection schema enforces per-Item identity and aggregate invariants', async () => {
  const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
  assert.ok(Balance.schema.indexes().some(([keys, options]) => keys.itemId === 1 && options.unique === true));
  const doc = new Balance({ itemId: new mongoose.Types.ObjectId(ids.item), facilityId: new mongoose.Types.ObjectId(ids.facility),
    customerId: new mongoose.Types.ObjectId(ids.customer), managedReservationId: new mongoose.Types.ObjectId(ids.reservation),
    currentCellId: new mongoose.Types.ObjectId(ids.cellA), source: 'LEDGER_V2', onHandQuantity: 2, heldQuantity: 1,
    actualTotalWeightKg: 20, actualTotalVolumeM3: .2, batches: [{ batchId: 'batch-one', receiptMovementId: new mongoose.Types.ObjectId(),
      quantity: 2, heldQuantity: 1, quantityUnit: 'box', actualUnitWeightKg: 10, actualUnitDimensionsM: dims, actualTotalWeightKg: 20,
      actualTotalVolumeM3: .2, receivedAt: new Date() }] });
  assert.equal(await doc.validate().then(() => true), true);
  doc.heldQuantity = 3;
  await assert.rejects(doc.validate(), /Stock totals must reconcile/);
});

test('version 2 ledger model requires batch lines matching event quantity and direction', async () => {
  const fields = { itemId: new mongoose.Types.ObjectId(ids.item), customerId: new mongoose.Types.ObjectId(ids.customer),
    managedReservationId: new mongoose.Types.ObjectId(ids.reservation), facilityId: new mongoose.Types.ObjectId(ids.facility),
    type: 'INBOUND', destinationCellId: new mongoose.Types.ObjectId(ids.cellA), quantity: 2, quantityUnit: 'box',
    actualUnitWeightKg: 10, actualTotalWeightKg: 20, actualUnitDimensionsM: dims, actualTotalVolumeM3: .2,
    performedBy: new mongoose.Types.ObjectId(), performedAt: new Date(), inspectionNote: 'received', idempotencyKey: 'mi06-batch-0001',
    schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', batchLines: [line('receipt-batch-1', 'ADD', 2)] };
  const valid = new Movement(fields);
  assert.equal(await valid.validate().then(() => true), true);
  const invalid = new Movement({ ...fields, batchLines: [line('receipt-batch-1', 'REMOVE', 2)] });
  await assert.rejects(invalid.validate(), /Schema v2 batch lines must match/);
  const wrongWeight = new Movement({ ...fields, batchLines: [{ ...line('receipt-batch-1', 'ADD', 2), actualTotalWeightKg: 21 }] });
  await assert.rejects(wrongWeight.validate(), /Schema v2 batch lines/);
  const wrongVolume = new Movement({ ...fields, batchLines: [{ ...line('receipt-batch-1', 'ADD', 2), actualTotalVolumeM3: .21 }] });
  await assert.rejects(wrongVolume.validate(), /Schema v2 batch lines/);
  const wrongUnit = new Movement({ ...fields, batchLines: [{ ...line('receipt-batch-1', 'ADD', 2), quantityUnit: 'piece' }] });
  await assert.rejects(wrongUnit.validate(), /Schema v2 batch lines/);
  const v1WithLines = new Movement({ ...fields, schemaVersion: 1 });
  await assert.rejects(v1WithLines.validate(), /Batch lines require movement schema version 2/);
  const heterogeneous = new Movement({ ...fields, quantity: 3, actualTotalWeightKg: 24, actualTotalVolumeM3: .28,
    batchLines: [line('receipt-batch-1', 'ADD', 2), { ...line('receipt-batch-2', 'ADD', 1),
      actualUnitWeightKg: 4, actualTotalWeightKg: 4, actualUnitDimensionsM: { widthM: .4, depthM: .4, heightM: .5 },
      actualTotalVolumeM3: .08 }] });
  assert.equal(await heterogeneous.validate().then(() => true), true);
});
