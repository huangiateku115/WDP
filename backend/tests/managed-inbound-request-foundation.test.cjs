const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Request = require('../dist/models/inventory-items/inventory-inbound-request.model').default;
const {
  InventoryInboundCustodyState: Custody,
  InventoryInboundRequestState: State,
} = require('../dist/types/inventory-inbound-request.type');
const lifecycle = require('../dist/services/inventory-items/inventory-inbound-request.lifecycle');
const { resolveMi06BRepeatedInboundGate } = require('../dist/config/mi06b-feature-gate');

const ids = {
  itemId: new mongoose.Types.ObjectId(), reservationId: new mongoose.Types.ObjectId(),
  facilityId: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId(),
  createdBy: new mongoose.Types.ObjectId(),
};
const payload = {
  requestedQuantity: 4, quantityUnit: 'box', declaredUnitWeightKg: 2.5,
  declaredUnitDimensionsM: { widthM: .2, depthM: .3, heightM: .4 },
};
const base = () => ({ ...ids, ...payload, state: State.PENDING_INSPECTION, custodyState: Custody.NOT_TAKEN,
  requestIdempotencyKey: 'receipt-create-0001', creationPayloadHash: 'a'.repeat(64), currentPayloadHash: 'a'.repeat(64) });

test('receipt request model validates identity and physical request fields without a database', async () => {
  await assert.doesNotReject(new Request(base()).validate());
  await assert.rejects(new Request({ ...base(), requestedQuantity: 0 }).validate());
  await assert.rejects(new Request({ ...base(), requestedQuantity: 1.5 }).validate());
  await assert.rejects(new Request({ ...base(), declaredUnitWeightKg: Infinity }).validate());
  await assert.rejects(new Request({ ...base(), declaredUnitDimensionsM: { widthM: .2, depthM: 0, heightM: .4 } }).validate());
  await assert.rejects(new Request({ ...base(), creationPayloadHash: 'not-a-hash' }).validate());
});

test('physical payload requires positive safe-integer quantity and positive measurements', () => {
  assert.doesNotThrow(() => lifecycle.validateReceiptPhysicalPayload(payload));
  for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => lifecycle.validateReceiptPhysicalPayload({ ...payload, requestedQuantity: quantity }));
  }
  assert.doesNotThrow(() => lifecycle.assertAcceptedReceiptQuantityMatches(4, 4));
  assert.throws(() => lifecycle.assertAcceptedReceiptQuantityMatches(4, 3), /exactly match/);
});

test('request lifecycle allows only custody-safe transitions', () => {
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'INSPECT_ACCEPTED', { custodyTaken: true }),
    { state: State.ACCEPTED_PENDING_CONFIRMATION, custodyState: Custody.IN_CUSTODY });
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'INSPECT_DISCREPANCY'),
    { state: State.DISCREPANCY, custodyState: Custody.NOT_TAKEN });
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.DISCREPANCY, Custody.NOT_TAKEN, 'INSPECT_ACCEPTED', { custodyTaken: true }),
    { state: State.ACCEPTED_PENDING_CONFIRMATION, custodyState: Custody.IN_CUSTODY });
  assert.throws(() => lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'INSPECT_ACCEPTED'), /custody/);
  assert.throws(() => lifecycle.transitionReceiptRequest(State.CONFIRMED, Custody.IN_CUSTODY, 'INSPECT_DISCREPANCY'));
});

test('discrepancy inspection preserves existing custody and records custody taken during the event', () => {
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN,
    'INSPECT_DISCREPANCY', { custodyTaken: true }),
  { state: State.DISCREPANCY, custodyState: Custody.IN_CUSTODY });
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN,
    'INSPECT_DISCREPANCY'),
  { state: State.DISCREPANCY, custodyState: Custody.NOT_TAKEN });
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.DISCREPANCY, Custody.IN_CUSTODY,
    'INSPECT_DISCREPANCY', { custodyTaken: false }),
  { state: State.DISCREPANCY, custodyState: Custody.IN_CUSTODY });
});

test('amendment is allowed only before the first inspection and custody', () => {
  assert.equal(lifecycle.canAmendReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, false), true);
  assert.equal(lifecycle.canAmendReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, true), false);
  assert.equal(lifecycle.canAmendReceiptRequest(State.DISCREPANCY, Custody.NOT_TAKEN, true), false);
  assert.equal(lifecycle.canAmendReceiptRequest(State.PENDING_INSPECTION, Custody.IN_CUSTODY, false), false);
  assert.equal(lifecycle.canAmendReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, undefined), false);
});

test('rejection considers custody taken during this inspection and requires explicit return completion', () => {
  const newlyHeld = lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN,
    'INSPECT_REJECTED', { custodyTaken: true });
  assert.deepEqual(newlyHeld, { state: State.RETURN_PENDING, custodyState: Custody.IN_CUSTODY });

  const pending = lifecycle.transitionReceiptRequest(State.DISCREPANCY, Custody.IN_CUSTODY, 'INSPECT_REJECTED');
  assert.deepEqual(pending, { state: State.RETURN_PENDING, custodyState: Custody.IN_CUSTODY });
  assert.throws(() => lifecycle.transitionReceiptRequest(State.RETURN_PENDING, Custody.IN_CUSTODY, 'CONFIRM'));
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.RETURN_PENDING, Custody.IN_CUSTODY, 'RETURN_COMPLETED'),
    { state: State.REJECTED, custodyState: Custody.RETURNED });
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'INSPECT_REJECTED'),
    { state: State.REJECTED, custodyState: Custody.NOT_TAKEN });
  assert.deepEqual(lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'CANCEL', { hasInspectionAttempt: false }),
    { state: State.CANCELLED, custodyState: Custody.NOT_TAKEN });
  assert.throws(() => lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'CANCEL'), /inspection attempt/);
  assert.throws(() => lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'CANCEL', { hasInspectionAttempt: true }), /inspection attempt/);
  assert.throws(() => lifecycle.transitionReceiptRequest(State.PENDING_INSPECTION, Custody.NOT_TAKEN, 'CANCEL', { hasInspectionAttempt: undefined }), /inspection attempt/);
  assert.throws(() => lifecycle.transitionReceiptRequest(State.DISCREPANCY, Custody.IN_CUSTODY, 'CANCEL'));
});

test('canonical idempotency hashing is key-order stable and rejects changed payloads', () => {
  const first = { quantity: 4, dimensions: { widthM: .2, depthM: .3 }, date: new Date('2026-10-25T00:00:00.000Z') };
  const reordered = { date: new Date('2026-10-25T00:00:00.000Z'), dimensions: { depthM: .3, widthM: .2 }, quantity: 4 };
  const hash = lifecycle.canonicalReceiptPayloadHash(first);
  assert.equal(hash.length, 64);
  assert.equal(lifecycle.canonicalReceiptPayloadHash(reordered), hash);
  assert.doesNotThrow(() => lifecycle.assertSameReceiptPayload(hash, reordered));
  assert.throws(() => lifecycle.assertSameReceiptPayload(hash, { ...reordered, quantity: 5 }), /different payload/);
});

test('model declares one unresolved request per Item with a partial unique index', () => {
  const index = Request.schema.indexes().find(([keys, options]) => keys.itemId === 1 && options.unique && options.partialFilterExpression);
  assert.ok(index, 'partial unique index exists');
  assert.deepEqual(index[1].partialFilterExpression, { state: { $in: [
    State.PENDING_INSPECTION, State.DISCREPANCY, State.ACCEPTED_PENDING_CONFIRMATION, State.RETURN_PENDING,
  ] } });
});

test('MI-06B gate defaults OFF and is forced OFF in production independently of MI-06A', () => {
  assert.equal(resolveMi06BRepeatedInboundGate('development', undefined), false);
  assert.equal(resolveMi06BRepeatedInboundGate('test', 'true'), true);
  assert.equal(resolveMi06BRepeatedInboundGate('development', ' TRUE '), true);
  assert.equal(resolveMi06BRepeatedInboundGate('production', 'true'), false);
});
