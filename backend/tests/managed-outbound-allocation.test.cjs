const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, { NODE_ENV: 'test', MONGO_URL: 'mongodb://127.0.0.1:27018/unused_test_only',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-only', KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs' });
const mongoose = require('mongoose');
const arithmetic = require('../dist/utils/managed-stock-arithmetic');
const { ItemMovementType } = require('../dist/types/item-movement.type');
const { ManagedOutboundRequestState: State, ManagedOutboundRequestOperation: Operation } = require('../dist/types/managed-outbound-request.type');
const { ManagedStockErrorCode } = require('../dist/types/managed-stock.type');
const stock = require('../dist/services/inventory-items/managed-stock-ledger.service');
const outbound = require('../dist/services/inventory-items/managed-outbound-allocation.service');
const Request = require('../dist/models/inventory-items/managed-outbound-request.model').default;
const Event = require('../dist/models/inventory-items/managed-outbound-request-event.model').default;

const ids = { item: '507f1f77bcf86cd799439001', customer: '507f1f77bcf86cd799439002', reservation: '507f1f77bcf86cd799439003',
  facility: '507f1f77bcf86cd799439004', cell: '507f1f77bcf86cd799439005', actor: '507f1f77bcf86cd799439006' };
const oid = value => new mongoose.Types.ObjectId(value);
const dimsA = { widthM: .1, depthM: .1, heightM: 1 };
const dimsB = { widthM: .3, depthM: .1, heightM: 1 };

function makeItem(overrides = {}) { return { _id: ids.item, customerId: ids.customer, managedReservationId: ids.reservation,
  facilityId: ids.facility, quantityUnit: 'box', status: 'IN_STORAGE', currentCellId: ids.cell, currentPlacementMovementId: null, ...overrides }; }

function legacyReceipt(index, quantity, unitWeightKg, dimensions, day) {
  const totalWeight = arithmetic.canonicalProductNumber([unitWeightKg], quantity, 3);
  const totalVolume = arithmetic.canonicalProductNumber([dimensions.widthM, dimensions.depthM, dimensions.heightM], quantity, 6);
  return { _id: `507f1f77bcf86cd7994390${String(index).padStart(2, '0')}`, itemId: ids.item, customerId: ids.customer,
    managedReservationId: ids.reservation, facilityId: ids.facility, type: ItemMovementType.INBOUND, schemaVersion: 1,
    quantity, quantityUnit: 'box', actualUnitWeightKg: unitWeightKg, actualTotalWeightKg: totalWeight,
    actualUnitDimensionsM: dimensions, actualTotalVolumeM3: totalVolume, sourceCellId: null, destinationCellId: ids.cell,
    performedAt: new Date(Date.UTC(2026, 0, day)) };
}

function historyAndBalance({ heldByBatch = {} } = {}) {
  const movements = [legacyReceipt(11, 5, 10, dimsA, 1), legacyReceipt(12, 4, 20, dimsB, 2)];
  const ledger = stock.reconcileManagedItemStock(makeItem(), movements);
  const batches = ledger.batches.map(batch => ({ ...batch, receiptMovementId: oid(batch.receiptMovementId),
    heldQuantity: heldByBatch[batch.batchId] ?? 0, actualUnitDimensionsM: { ...batch.actualUnitDimensionsM } }));
  const weightUnits = arithmetic.sumExactPrecisionUnits(batches.map(row => row.actualTotalWeightKg), 3);
  const volumeUnits = arithmetic.sumExactPrecisionUnits(batches.map(row => row.actualTotalVolumeM3), 6);
  const result = { itemId: oid(ids.item), facilityId: oid(ids.facility), customerId: oid(ids.customer), managedReservationId: oid(ids.reservation),
    currentCellId: oid(ids.cell), batches, onHandQuantity: batches.reduce((sum, row) => sum + row.quantity, 0),
    heldQuantity: batches.reduce((sum, row) => sum + row.heldQuantity, 0),
    actualTotalWeightKg: arithmetic.precisionUnitsToNumber(weightUnits, 3),
    actualTotalVolumeM3: arithmetic.precisionUnitsToNumber(volumeUnits, 6), schemaVersion: 1,
    source: 'LEGACY_RECONCILED', version: 0 };
  return { movements, ledger, balance: result };
}

function pendingRequest(balance, quantity) {
  const allocations = outbound.allocateManagedOutboundBatches(balance, quantity);
  return { _id: oid('507f1f77bcf86cd799439099'), itemId: balance.itemId, reservationId: balance.managedReservationId,
    facilityId: balance.facilityId, customerId: balance.customerId, requestedQuantity: quantity, quantityUnit: 'box',
    batchAllocations: allocations, state: State.PENDING, version: 0 };
}

function snapshot(value) {
  if (value instanceof Date) return { $date: value.getTime() };
  if (value instanceof mongoose.Types.ObjectId) return { $objectId: value.toHexString() };
  if (Array.isArray(value)) return value.map(snapshot);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, snapshot(value[key])]));
  return value;
}

function requestDocument(overrides = {}) {
  const receipt = oid('507f1f77bcf86cd799439011');
  return new Request({ itemId: oid(ids.item), reservationId: oid(ids.reservation), facilityId: oid(ids.facility),
    customerId: oid(ids.customer), createdBy: oid(ids.actor), requestedQuantity: 2, quantityUnit: 'box',
    batchAllocations: [{ batchId: 'legacy:507f1f77bcf86cd799439011', quantity: 2, receiptMovementId: receipt,
      receivedAt: new Date('2026-01-01T00:00:00.000Z'), arithmeticPolicy: 'COMPATIBILITY' }],
    state: State.PENDING, idempotencyKey: 'outbound-create-0001', payloadHash: 'a'.repeat(64), version: 0, ...overrides });
}

test('allocates a single batch immutably and does not mutate balance input', () => {
  const { balance } = historyAndBalance();
  balance.batches = [balance.batches[0]];
  balance.onHandQuantity = 5; balance.actualTotalWeightKg = 50; balance.actualTotalVolumeM3 = .05;
  const before = snapshot(balance);
  const allocation = outbound.allocateManagedOutboundBatches(balance, 3);
  assert.deepEqual(allocation.map(row => [row.batchId, row.quantity]), [[balance.batches[0].batchId, 3]]);
  assert.equal(Object.isFrozen(allocation), true); assert.equal(Object.isFrozen(allocation[0]), true);
  assert.deepEqual(snapshot(balance), before);
});

test('allocates across receipt batches by FIFO and stores original receipt provenance', () => {
  const { balance } = historyAndBalance();
  const rows = outbound.allocateManagedOutboundBatches(balance, 6);
  assert.deepEqual(rows.map(row => [row.batchId, row.quantity]), [[balance.batches[0].batchId, 5], [balance.batches[1].batchId, 1]]);
  assert.equal(String(rows[0].receiptMovementId), String(balance.batches[0].receiptMovementId));
  assert.equal(rows[0].arithmeticPolicy, 'COMPATIBILITY');
});

test('uses batchId as deterministic tie breaker for identical receipt timestamps', () => {
  const { balance } = historyAndBalance();
  for (const batch of balance.batches) batch.receivedAt = new Date('2026-01-01T00:00:00.000Z');
  balance.batches.reverse();
  const rows = outbound.allocateManagedOutboundBatches(balance, 1);
  assert.equal(rows[0].batchId, [...balance.batches.map(row => row.batchId)].sort()[0]);
});

test('skips existing batch holds when allocating available quantity', () => {
  const { balance } = historyAndBalance({ heldByBatch: { [`legacy:${'507f1f77bcf86cd799439011'}`]: 5 } });
  const rows = outbound.allocateManagedOutboundBatches(balance, 2);
  assert.equal(rows.length, 1); assert.equal(rows[0].batchId, balance.batches[1].batchId);
});

test('rejects invalid, zero, negative, fractional and oversized allocations', () => {
  const { balance } = historyAndBalance();
  for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 10]) {
    assert.throws(() => outbound.allocateManagedOutboundBatches(balance, quantity), error =>
      [ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID, ManagedStockErrorCode.NEGATIVE_STOCK].includes(error.code));
  }
});

test('rejects duplicate batch IDs, missing receipt lineage and invalid batch states', () => {
  const { balance } = historyAndBalance();
  const duplicate = structuredClone(balance); duplicate.batches[1].batchId = duplicate.batches[0].batchId;
  assert.throws(() => outbound.allocateManagedOutboundBatches(duplicate, 1), { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
  const missingReceipt = structuredClone(balance); missingReceipt.batches[0].receiptMovementId = null;
  assert.throws(() => outbound.allocateManagedOutboundBatches(missingReceipt, 1), { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
  const invalidHold = structuredClone(balance); invalidHold.batches[0].heldQuantity = invalidHold.batches[0].quantity + 1;
  invalidHold.heldQuantity = invalidHold.batches[0].heldQuantity;
  assert.throws(() => outbound.allocateManagedOutboundBatches(invalidHold, 1), { code: ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH });
});

test('rejects unsupported balance schema versions and arithmetic policies', () => {
  const { balance } = historyAndBalance();
  assert.throws(() => outbound.allocateManagedOutboundBatches({ ...balance, schemaVersion: 2 }, 1), { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
  const unsupported = structuredClone(balance); unsupported.batches[0].arithmeticPolicy = 'FUTURE_POLICY';
  assert.throws(() => outbound.allocateManagedOutboundBatches(unsupported, 1), { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
});

test('legacy v1 receipt batches retain compatibility identity and arithmetic through allocation', () => {
  const { balance } = historyAndBalance();
  const allocation = outbound.allocateManagedOutboundBatches(balance, 1)[0];
  assert.match(allocation.batchId, /^legacy:/); assert.equal(allocation.arithmeticPolicy, 'COMPATIBILITY');
  assert.equal(String(allocation.receiptMovementId), '507f1f77bcf86cd799439011');
});

test('reconciles request holds against movement history and StockBalance and derives AvailableQty', () => {
  const { movements, balance } = historyAndBalance();
  const allocations = outbound.allocateManagedOutboundBatches(balance, 6);
  for (const row of allocations) balance.batches.find(batch => batch.batchId === row.batchId).heldQuantity = row.quantity;
  balance.heldQuantity = 6;
  const request = { ...pendingRequest({ ...balance, batches: balance.batches.map(batch => ({ ...batch, heldQuantity: 0 })), heldQuantity: 0 }, 6), batchAllocations: allocations };
  const result = outbound.reconcileManagedOutboundHolds({ item: makeItem(), movements, stockBalance: balance, requests: [request] });
  assert.equal(result.onHandQuantity, 9); assert.equal(result.heldQuantity, 6); assert.equal(result.availableQuantity, 3);
});

test('detects orphan holds and movement versus StockBalance disagreement', () => {
  const { movements, balance } = historyAndBalance({ heldByBatch: { [`legacy:${'507f1f77bcf86cd799439011'}`]: 1 } });
  assert.throws(() => outbound.reconcileManagedOutboundHolds({ item: makeItem(), movements, stockBalance: balance, requests: [] }),
    { code: ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH });
  const noHold = historyAndBalance();
  noHold.balance.batches[0].quantity -= 1; noHold.balance.batches[0].actualTotalWeightKg = 40;
  noHold.balance.batches[0].actualTotalVolumeM3 = .04; noHold.balance.onHandQuantity -= 1;
  noHold.balance.actualTotalWeightKg = 120; noHold.balance.actualTotalVolumeM3 = .16;
  assert.throws(() => outbound.reconcileManagedOutboundHolds({ item: makeItem(), movements: noHold.movements, stockBalance: noHold.balance, requests: [] }),
    { code: ManagedStockErrorCode.OUTBOUND_HOLD_MISMATCH });
});

test('rejects oversubscribed and non-FIFO request allocations during hold reconciliation', () => {
  const { movements, balance } = historyAndBalance();
  const allocations = outbound.allocateManagedOutboundBatches(balance, 6);
  balance.batches[0].heldQuantity = 5; balance.batches[1].heldQuantity = 1; balance.heldQuantity = 6;
  const request = { ...pendingRequest({ ...balance, batches: balance.batches.map(batch => ({ ...batch, heldQuantity: 0 })), heldQuantity: 0 }, 6), batchAllocations: allocations };
  const reversed = { ...request, batchAllocations: [...allocations].reverse() };
  assert.throws(() => outbound.reconcileManagedOutboundHolds({ item: makeItem(), movements, stockBalance: balance, requests: [reversed] }),
    { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
  const twice = { ...request, requestedQuantity: 9, batchAllocations: [...allocations, { ...allocations[0], quantity: 3 }] };
  assert.throws(() => outbound.reconcileManagedOutboundHolds({ item: makeItem(), movements, stockBalance: balance, requests: [twice] }),
    { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
});

test('partial delivery consumes reserved FIFO batches and releases every unused hold', () => {
  const { balance } = historyAndBalance();
  const request = pendingRequest(balance, 6);
  const allocations = request.batchAllocations;
  for (const row of allocations) balance.batches.find(batch => batch.batchId === row.batchId).heldQuantity = row.quantity;
  balance.heldQuantity = 6;
  const before = snapshot(balance);
  const result = outbound.calculateManagedOutboundConfirmation({ stockBalance: balance, request, deliveredQuantity: 4 });
  assert.equal(result.requestState, State.PARTIALLY_FULFILLED);
  assert.equal(result.releasedHoldQuantity, 2); assert.equal(result.onHandQuantity, 5); assert.equal(result.heldQuantity, 0);
  assert.deepEqual(result.movement.batchLines.map(row => [row.batchId, row.quantity]), [[allocations[0].batchId, 4]]);
  assert.equal(result.nextBalance.batches[0].quantity, 1);
  assert.equal(result.nextBalance.batches[1].quantity, 4);
  assert.deepEqual(snapshot(balance), before);
});

test('partial delivery across two batches uses projection deltas for counters', () => {
  const { balance } = historyAndBalance();
  const request = pendingRequest(balance, 6);
  for (const row of request.batchAllocations) balance.batches.find(batch => batch.batchId === row.batchId).heldQuantity = row.quantity;
  balance.heldQuantity = 6;
  const result = outbound.calculateManagedOutboundConfirmation({ stockBalance: balance, request, deliveredQuantity: 5 });
  assert.equal(result.requestState, State.PARTIALLY_FULFILLED);
  assert.deepEqual(result.movement.batchLines.map(row => [row.batchId, row.quantity]), [[request.batchAllocations[0].batchId, 5]]);
  assert.equal(result.releasedHoldQuantity, 1); assert.equal(result.nextBalance.onHandQuantity, 4);
  assert.equal(result.counterDeltas.weightKg, 50); assert.equal(result.counterDeltas.volumeM3, .05);
});

test('full delivery across multiple batches consumes all reservations and leaves remaining stock accessible', () => {
  const { balance } = historyAndBalance();
  const request = pendingRequest(balance, 6);
  for (const row of request.batchAllocations) balance.batches.find(batch => batch.batchId === row.batchId).heldQuantity = row.quantity;
  balance.heldQuantity = 6;
  const result = outbound.calculateManagedOutboundConfirmation({ stockBalance: balance, request, deliveredQuantity: 6 });
  assert.equal(result.requestState, State.CONFIRMED); assert.equal(result.releasedHoldQuantity, 0);
  assert.equal(result.onHandQuantity, 3); assert.equal(result.availableQuantity, 3);
  assert.deepEqual(result.movement.batchLines.map(row => row.quantity), [5, 1]);
});

test('delivery to zero clears Item and balance placement calculations but preserves allocation outside this projection', () => {
  const { balance } = historyAndBalance();
  const request = pendingRequest(balance, 9);
  for (const row of request.batchAllocations) balance.batches.find(batch => batch.batchId === row.batchId).heldQuantity = row.quantity;
  balance.heldQuantity = 9;
  const result = outbound.calculateManagedOutboundConfirmation({ stockBalance: balance, request, deliveredQuantity: 9 });
  assert.equal(result.itemTransition.status, 'CHECKED_OUT'); assert.equal(result.itemTransition.currentCellId, null);
  assert.equal(result.nextBalance.currentCellId, null); assert.equal(result.nextBalance.batches.length, 0);
  assert.equal(result.onHandQuantity, 0); assert.equal(result.heldQuantity, 0);
});

test('canonical rounding keeps movement-line totals separate from before/after projection deltas', () => {
  const dims = { widthM: .125, depthM: .125, heightM: .125 };
  const movement = { _id: '507f1f77bcf86cd799439099', itemId: ids.item, customerId: ids.customer,
    managedReservationId: ids.reservation, facilityId: ids.facility, type: 'INBOUND', schemaVersion: 2,
    arithmeticPolicy: 'CANONICAL_V1', quantity: 100, quantityUnit: 'box', actualUnitWeightKg: 1.5,
    actualTotalWeightKg: 150, actualUnitDimensionsM: dims, actualTotalVolumeM3: .195313,
    destinationCellId: ids.cell, sourceCellId: null, performedAt: new Date('2026-01-01T00:00:00Z'),
    batchLines: [{ batchId: 'rounding-batch', action: 'ADD', quantity: 100, quantityUnit: 'box', actualUnitWeightKg: 1.5,
      actualUnitDimensionsM: dims, actualTotalWeightKg: 150, actualTotalVolumeM3: .195313 }] };
  const item = makeItem({ currentPlacementMovementId: movement._id });
  const ledger = stock.reconcileManagedItemStock(item, [movement]);
  const batch = { ...ledger.batches[0], receiptMovementId: oid(String(movement._id)), heldQuantity: 1 };
  const balance = { itemId: oid(ids.item), facilityId: oid(ids.facility), customerId: oid(ids.customer), managedReservationId: oid(ids.reservation),
    currentCellId: oid(ids.cell), batches: [batch], onHandQuantity: 100, heldQuantity: 1, actualTotalWeightKg: 150,
    actualTotalVolumeM3: .195313, schemaVersion: 1, source: 'LEDGER_V2', version: 1 };
  const request = { itemId: balance.itemId, reservationId: balance.managedReservationId, customerId: balance.customerId,
    facilityId: balance.facilityId, state: State.PENDING, requestedQuantity: 1, quantityUnit: 'box', batchAllocations: [
    { batchId: batch.batchId, quantity: 1, receiptMovementId: batch.receiptMovementId, receivedAt: batch.receivedAt,
      arithmeticPolicy: 'CANONICAL_V1' }] };
  const result = outbound.calculateManagedOutboundConfirmation({ stockBalance: balance, request, deliveredQuantity: 1 });
  assert.equal(result.movement.batchLines[0].actualTotalVolumeM3, .001953);
  assert.equal(result.counterDeltas.volumeM3, .001954);
});

test('rejects delivery above request and quantity-unit mismatch', () => {
  const { balance } = historyAndBalance();
  const request = pendingRequest(balance, 2);
  for (const row of request.batchAllocations) balance.batches.find(batch => batch.batchId === row.batchId).heldQuantity = row.quantity;
  balance.heldQuantity = 2;
  assert.throws(() => outbound.calculateManagedOutboundConfirmation({ stockBalance: balance, request, deliveredQuantity: 3 }),
    { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
  assert.throws(() => outbound.calculateManagedOutboundConfirmation({ stockBalance: balance, request: { ...request, quantityUnit: 'piece' }, deliveredQuantity: 1 }),
    { code: ManagedStockErrorCode.OUTBOUND_REQUEST_INVALID });
});

test('request lifecycle allows only one version-matched transition from pending', () => {
  assert.equal(outbound.canTransitionManagedOutboundRequest(State.PENDING, State.CANCELLED), true);
  assert.equal(outbound.canTransitionManagedOutboundRequest(State.PENDING, State.PARTIALLY_FULFILLED), true);
  assert.equal(outbound.canTransitionManagedOutboundRequest(State.CONFIRMED, State.CANCELLED), false);
  outbound.assertManagedOutboundRequestTransition({ from: State.PENDING, to: State.CANCELLED, expectedVersion: 2, currentVersion: 2 });
  assert.throws(() => outbound.assertManagedOutboundRequestTransition({ from: State.PENDING, to: State.CONFIRMED, expectedVersion: 1, currentVersion: 2 }),
    { code: ManagedStockErrorCode.OUTBOUND_REQUEST_CONFLICT });
});

test('request model validates immutable batch provenance, terminal outcomes and unresolved index', async () => {
  await requestDocument().validate();
  await assert.rejects(requestDocument({ batchAllocations: [{ batchId: 'orphan', quantity: 2 }] }).validate());
  await assert.rejects(requestDocument({ state: State.CONFIRMED, confirmedBy: oid(ids.actor), confirmedAt: new Date(),
    confirmedMovementId: oid('507f1f77bcf86cd799439012'), confirmedQuantity: 1 }).validate(), /Fully confirmed request quantity/);
  await assert.rejects(requestDocument({ state: State.PARTIALLY_FULFILLED, confirmedBy: oid(ids.actor), confirmedAt: new Date(),
    confirmedMovementId: oid('507f1f77bcf86cd799439012'), confirmedQuantity: 2 }).validate(), /Partially fulfilled request/);
  const indexes = Request.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.itemId === 1 && options.unique && options.partialFilterExpression?.state === State.PENDING));
  assert.equal(Request.schema.path('idempotencyKey').options.immutable, true);
  assert.equal(Request.schema.options.optimisticConcurrency, true);
});

test('confirmation event requires one movement link and one positive delivered quantity', async () => {
  const common = { requestId: oid('507f1f77bcf86cd799439020'), itemId: oid(ids.item), reservationId: oid(ids.reservation),
    facilityId: oid(ids.facility), customerId: oid(ids.customer), actorId: oid(ids.actor), operation: Operation.CONFIRM,
    idempotencyKey: 'outbound-confirm-0001', payloadHash: 'b'.repeat(64), inputSnapshot: { deliveredQuantity: 1 },
    resultingState: State.PARTIALLY_FULFILLED, resultingVersion: 1, resultSnapshot: {}, occurredAt: new Date() };
  await assert.rejects(new Event(common).validate(), /Confirmation event must link/);
  const movementId = oid('507f1f77bcf86cd799439021');
  await new Event({ ...common, movementId, confirmedQuantity: 1,
    resultSnapshot: { confirmedMovementId: String(movementId), confirmedQuantity: 1 } }).validate();
});
