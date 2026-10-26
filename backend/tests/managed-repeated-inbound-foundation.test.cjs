const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const Snapshot = require('../dist/models/inventory-items/repeated-inbound-inspection.model').default;
const Request = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const EventOperation = require('../dist/types/inventory-inbound-request-event.type').InventoryInboundRequestEventOperation;
const id = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));

test('repeated inbound immutable inspection schema is request-attempt scoped', async () => {
  const indexes = Snapshot.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.requestId === 1 && keys.attempt === 1 && options.unique));
  assert.ok(indexes.some(([keys, options]) => keys.requestId === 1 && keys.inspectionKey === 1 && options.unique));
  assert.ok([EventOperation.INSPECT, EventOperation.RETURN_COMPLETED, EventOperation.CONFIRM].every(v => Object.values(EventOperation).includes(v)));
  const snapshot = new Snapshot({ requestId: id(10), itemId: id(1), reservationId: id(2), facilityId: id(3), attempt: 1, requestVersion: 1,
    inspectionKey: 'inspection-test-key', payloadHash: 'a'.repeat(64), decision: 'ACCEPTED', receivedQuantity: 1, actualUnitWeightKg: 1,
    actualUnitDimensionsM: { widthM: .1, depthM: .1, heightM: .1 }, compatibleCellIds: [], packingLayoutVerified: true, custodyTaken: true,
    note: 'accepted', inspectedBy: id(6), inspectedAt: new Date(), images: [] });
  snapshot.isNew = false;
  await assert.rejects(snapshot.save(), /immutable/);
});

test('canonical repeated receipt movement validates exact ADD lineage without database access', async () => {
  const dims = { widthM: .125, depthM: .125, heightM: .125 };
  const movement = new Movement({ itemId: id(1), managedReservationId: id(2), facilityId: id(3), customerId: id(4), type: 'INBOUND',
    destinationCellId: id(5), quantity: 100, quantityUnit: 'box', actualUnitWeightKg: 1.125,
    actualTotalWeightKg: 112.5, actualUnitDimensionsM: dims, actualTotalVolumeM3: .195313,
    performedBy: id(6), performedAt: new Date('2026-10-25T00:00:00.000Z'), inspectionNote: 'Accepted receipt', idempotencyKey: 'receipt-v2-000001',
    schemaVersion: 2, arithmeticPolicy: 'CANONICAL_V1', batchLines: [{ batchId: 'receipt-test-batch-1', receiptRequestId: id(7), receivingInspectionEvidenceId: id(8),
      action: 'ADD', quantity: 100, quantityUnit: 'box', actualUnitWeightKg: 1.125, actualUnitDimensionsM: dims,
      actualTotalWeightKg: 112.5, actualTotalVolumeM3: .195313 }] });
  await assert.doesNotReject(movement.validate());
  movement.batchLines[0].actualTotalVolumeM3 = .1953;
  await assert.rejects(movement.validate());
});

test('stock balance projects canonical receipt identity and refuses negative/held overflow', async () => {
  const dims = { widthM: .2, depthM: .3, heightM: .4 };
  const base = { itemId: id(1), facilityId: id(3), customerId: id(4), managedReservationId: id(2), currentCellId: id(5),
    batches: [{ batchId: 'receipt-batch-1', receiptMovementId: id(9), receiptRequestId: id(7), receivingInspectionEvidenceId: id(8), quantity: 4,
      heldQuantity: 0, quantityUnit: 'box', actualUnitWeightKg: 2.5, actualUnitDimensionsM: dims, actualTotalWeightKg: 10,
      actualTotalVolumeM3: .096, arithmeticPolicy: 'CANONICAL_V1', receivedAt: new Date() }],
    onHandQuantity: 4, heldQuantity: 0, actualTotalWeightKg: 10, actualTotalVolumeM3: .096, source: 'LEDGER_V2' };
  await assert.doesNotReject(new Balance(base).validate());
  await assert.rejects(new Balance({ ...base, heldQuantity: 5 } ).validate());
  await assert.rejects(new Balance({ ...base, onHandQuantity: -1 } ).validate());
});

test('repeated request unresolved states remain protected independently of feature gate', () => {
  const unresolved = Request.schema.indexes().find(([keys, options]) => keys.itemId === 1 && options.partialFilterExpression);
  assert.ok(unresolved);
  assert.deepEqual(unresolved[1].partialFilterExpression.state.$in, ['PENDING_INSPECTION', 'DISCREPANCY', 'ACCEPTED_PENDING_CONFIRMATION', 'RETURN_PENDING']);
});
