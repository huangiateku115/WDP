'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStatisticsQuery, StatisticsQueryError } = require('../dist/services/statistics/statistics.validation');
const { summarizeManagedMovementFixtures, buildManagedMovementPipeline, buildPaymentIntentMatch, validateFinancialPaymentStatus } = require('../dist/services/statistics/statistics-phase3.service');
const { verifiedCapturePipeline } = require('../dist/services/statistics/statistics.service');
const { PaymentStatus } = require('../dist/types/payment.type');

const facility = '64b000000000000000000001';
const otherFacility = '64b000000000000000000002';
const specA = '64b000000000000000000010';
const specB = '64b000000000000000000011';
const cellA = '64b000000000000000000020';
const cellB = '64b000000000000000000021';
const reservationA = '64b000000000000000000030';
const reservationB = '64b000000000000000000031';
const date = new Date('2026-11-05T10:00:00.000Z');

function line({ spec = specA, cell = cellA, reservation = reservationA, receipt = 'receipt-1', quantity = 1, unit = 'BOX', instance, weight = 1, volume = 0.1 } = {}) {
  return { itemSpecId: spec, cellId: cell, reservationId: reservation, receiptId: receipt, quantity, quantityUnitSnapshot: unit,
    ...(instance ? { itemInstanceId: instance } : {}), allocatedWeightKg: weight, allocatedVolumeM3: volume };
}
function movement(action, op, source, destination, extra = {}) {
  const ledgerQuantity = action === 'ADD' ? destination : source;
  const quantity = ledgerQuantity.reduce((sum, row) => sum + (row.itemInstanceId ? 0 : row.quantity), 0) + new Set(ledgerQuantity.filter(row => row.itemInstanceId).map(row => row.itemInstanceId)).size;
  const lines = action === 'ADD' ? destination : source;
  return { schemaVersion: 4, operationId: op, facilityId: facility, itemId: 'sku-1', performedAt: date, quantity,
    actualTotalWeightKg: lines.reduce((sum, row) => sum + row.allocatedWeightKg, 0), actualTotalVolumeM3: lines.reduce((sum, row) => sum + row.allocatedVolumeM3, 0),
    managedReservationId: reservationA, stockEffect: { action, operationId: op, source, destination }, ...extra };
}

test('managed movement query validates action and all canonical ObjectId filters', () => {
  const parsed = parseStatisticsQuery({ action: 'MOVE', skuId: facility, itemSpecId: specA, reservationId: reservationA });
  assert.equal(parsed.action, 'MOVE');
  assert.equal(parsed.skuId.toString(), facility);
  assert.throws(() => parseStatisticsQuery({ action: 'TRANSFER' }), e => e instanceof StatisticsQueryError && e.code === 'INVALID_ACTION');
  for (const field of ['skuId', 'itemSpecId', 'reservationId']) assert.throws(() => parseStatisticsQuery({ [field]: 'bad' }), e => e instanceof StatisticsQueryError && e.status === 400);
});

test('Payments Analysis accepts each current PaymentStatus and Finance allows only SUCCEEDED filtering', () => {
  for (const status of Object.values(PaymentStatus)) assert.equal(parseStatisticsQuery({ paymentStatus: status }).paymentStatus, status);
  assert.throws(() => parseStatisticsQuery({ paymentStatus: 'REFUNDED' }), e => e instanceof StatisticsQueryError && e.code === 'INVALID_PAYMENT_STATUS');
  for (const status of ['SUCCEEDED', 'FAILED', 'PENDING', 'CANCELLED', 'RECONCILIATION_REQUIRED']) {
    const query = parseStatisticsQuery({ paymentStatus: status });
    assert.equal(buildPaymentIntentMatch(query, { type: 'ALL' }).status, status);
    const captureMatch = verifiedCapturePipeline(parseStatisticsQuery({}), { type: 'ALL' })[0].$match;
    assert.equal(captureMatch.status, 'SUCCEEDED');
    assert.equal(captureMatch.providerSettlementStatus, 'VERIFIED');
    if (status === 'SUCCEEDED') assert.doesNotThrow(() => validateFinancialPaymentStatus(query.paymentStatus));
    else assert.throws(() => validateFinancialPaymentStatus(query.paymentStatus), e => e instanceof StatisticsQueryError && e.code === 'UNSUPPORTED_FINANCIAL_STATUS');
  }
  assert.equal(parseStatisticsQuery({}).paymentStatus, undefined);
  assert.doesNotThrow(() => validateFinancialPaymentStatus(undefined));
});

test('ADD counts multiple specifications and receipts across multi-Cell batch lines once', () => {
  const add = movement('ADD', 'add-1', [], [
    line({ quantity: 2, receipt: 'r1', cell: cellA, weight: 2, volume: 0.2 }),
    line({ quantity: 3, receipt: 'r1', cell: cellB, weight: 3, volume: 0.3 }),
    line({ spec: specB, quantity: 1, receipt: 'r2', weight: 1, volume: 0.1 }),
  ]);
  const result = summarizeManagedMovementFixtures([add]);
  assert.equal(result.inboundOperations, 1);
  assert.equal(result.inboundQuantity, 6);
  assert.equal(result.inboundReceiptCount, 2);
  assert.equal(result.operationsByItemSpecification.length, 2);
});

test('ItemInstance split across Cell allocation rows counts once by distinct instance identity', () => {
  const add = movement('ADD', 'add-instance', [], [
    line({ instance: 'instance-1', cell: cellA, weight: 0.4, volume: 0.04 }),
    line({ instance: 'instance-1', cell: cellB, weight: 0.6, volume: 0.06 }),
    line({ quantity: 2, receipt: 'r1', weight: 2, volume: 0.2 }),
  ]);
  const result = summarizeManagedMovementFixtures([add]);
  assert.equal(result.inboundQuantity, 3);
  assert.equal(result.inboundItemInstanceCount, 1);
  assert.equal(result.inboundWeightKg, 3);
});

test('same Item Specification batch and two-Cell ItemInstance quantity sums to six', () => {
  const add = movement('ADD', 'mixed-batch-instance', [], [
    line({ quantity: 5, receipt: 'receipt-batch', cell: cellA, weight: 5, volume: 0.5 }),
    line({ instance: 'instance-mixed', receipt: 'receipt-instance', cell: cellA, weight: 0.4, volume: 0.04 }),
    line({ instance: 'instance-mixed', receipt: 'receipt-instance', cell: cellB, weight: 0.6, volume: 0.06 }),
  ]);
  const summary = summarizeManagedMovementFixtures([add]);
  const spec = summary.operationsByItemSpecification.find(row => row.itemSpecId === specA);
  assert.equal(summary.inboundQuantity, 6);
  assert.equal(spec.quantityByUnit.BOX, 6);
  assert.equal(spec.operationCount, 1);
  assert.equal(spec.weightKg, 6);
  assert.equal(spec.volumeM3, 0.6);
});

test('REMOVE is counted once as outbound and never classified partial/full without receipt balance evidence', () => {
  const remove = movement('REMOVE', 'remove-1', [line({ quantity: 2 })], []);
  const result = summarizeManagedMovementFixtures([remove]);
  assert.equal(result.outboundOperations, 1);
  assert.equal(result.outboundQuantity, 2);
  assert.equal(result.partialOutbound, undefined);
  assert.equal(result.fullOutbound, undefined);
});

test('MOVE within one reservation counts source once and classifies cell relocation', () => {
  const move = movement('MOVE', 'move-within', [line({ cell: cellA })], [line({ cell: cellB })]);
  const result = summarizeManagedMovementFixtures([move]);
  assert.equal(result.relocationOperations, 1);
  assert.equal(result.movedQuantity, 1);
  assert.equal(result.movedWeightKg, 1);
  assert.equal(result.relocationByScope.WITHIN_RESERVATION, 1);
});

test('cross-reservation MOVE, with multiple lines, remains one operation and uses the source side', () => {
  const move = movement('MOVE', 'move-cross', [line({ quantity: 2, reservation: reservationA, weight: 2, volume: 0.2 }), line({ quantity: 1, spec: specB, reservation: reservationA, receipt: 'r2', weight: 1, volume: 0.1 })],
    [line({ quantity: 2, reservation: reservationB, weight: 2, volume: 0.2 }), line({ quantity: 1, spec: specB, reservation: reservationB, receipt: 'r2', weight: 1, volume: 0.1 })]);
  const result = summarizeManagedMovementFixtures([move]);
  assert.equal(result.relocationOperations, 1);
  assert.equal(result.movedQuantity, 3);
  assert.equal(result.movedWeightKg, 3);
  assert.equal(result.relocationByScope.CROSS_RESERVATION, 1);
});

test('operation replay is deduplicated and schema v3 is excluded', () => {
  const add = movement('ADD', 'same-operation', [], [line({ quantity: 2 })]);
  const replay = { ...add, _id: 'duplicate-document' };
  const legacy = { ...add, schemaVersion: 3, operationId: 'legacy', stockEffect: { ...add.stockEffect, operationId: 'legacy' } };
  const result = summarizeManagedMovementFixtures([add, replay, legacy]);
  assert.equal(result.totalCommittedOperations, 1);
  assert.equal(result.inboundQuantity, 2);
});

test('date, facility, SKU, item specification and reservation filters narrow events', () => {
  const add = movement('ADD', 'filter-1', [], [line({ spec: specA, reservation: reservationA }), line({ spec: specB, reservation: reservationB, receipt: 'r2' })]);
  const other = { ...movement('ADD', 'filter-2', [], [line({ quantity: 7 })]), facilityId: otherFacility };
  const filtered = summarizeManagedMovementFixtures([add, other], { facilityId: { toString: () => facility }, skuId: { toString: () => 'sku-1' }, itemSpecId: { toString: () => specB }, reservationId: { toString: () => reservationB } });
  assert.equal(filtered.totalCommittedOperations, 1);
  assert.equal(filtered.inboundQuantity, 1);
  const outOfRange = summarizeManagedMovementFixtures([add], { from: new Date('2026-11-06T00:00:00Z') });
  assert.equal(outOfRange.totalCommittedOperations, 0);
  assert.equal(outOfRange.inboundQuantity, 0);
});

test('incomplete or malformed effects are excluded instead of partially counted', () => {
  const good = movement('ADD', 'good', [], [line()]);
  const badQuantity = movement('ADD', 'bad-q', [], [{ ...line(), quantity: 0 }]);
  const mismatchedMove = movement('MOVE', 'bad-move', [line({ quantity: 2 })], [line({ quantity: 1 })]);
  const badOperation = { ...good, operationId: 'different' };
  const rootQuantityMismatch = { ...movement('ADD', 'bad-root-q', [], [line({ quantity: 2 })]), quantity: 3 };
  const result = summarizeManagedMovementFixtures([good, badQuantity, mismatchedMove, badOperation, rootQuantityMismatch]);
  assert.equal(result.totalCommittedOperations, 1);
  assert.equal(result.inboundOperations, 1);
});

test('server pipeline fences schema v4, valid actions, and time/facility scope', () => {
  const query = parseStatisticsQuery({ action: 'ADD' });
  const pipeline = buildManagedMovementPipeline(query, { type: 'FACILITY', facilityId: facility });
  assert.deepEqual(pipeline[0].$match.schemaVersion, 4);
  assert.deepEqual(pipeline[0].$match.facilityId, facility);
  assert.equal(pipeline[0].$match['stockEffect.action'], 'ADD');
  assert.ok(pipeline.some(stage => stage.$group && stage.$group._id.operationId));
});
