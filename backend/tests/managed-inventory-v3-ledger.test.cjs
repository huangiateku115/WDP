const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { replayManagedInventoryV3 } = require('../dist/services/inventory-items/managed-inventory-v3-ledger.service');
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Projection = require('../dist/models/inventory-items/managed-v3-stock-projection.model').default;
const { ManagedInventoryV3Service } = require('../dist/services/inventory-items/managed-inventory-v3.service');

const ids = { sku: new Types.ObjectId(), reservation: new Types.ObjectId(), customer: new Types.ObjectId(), facility: new Types.ObjectId(),
  actor: new Types.ObjectId(), session: new Types.ObjectId(), topology: new Types.ObjectId(), c1: new Types.ObjectId(), c2: new Types.ObjectId(),
  c3: new Types.ObjectId(), c4: new Types.ObjectId(), unit: new Types.ObjectId() };
const item = { _id: ids.sku, managedReservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility };
function movement({ revision, action = 'ADD', itemKind = 'A2_BATCH', destination = [], source = [], quantity, weight, volume, operationId = `op-${revision}`, id = new Types.ObjectId() }) {
  return { _id: id, itemId: ids.sku, managedReservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    schemaVersion: 3, quantity, actualTotalWeightKg: weight, actualTotalVolumeM3: volume, performedAt: new Date(`2026-11-12T12:00:0${revision}Z`),
    v3Effect: { action, itemKind, operationId, ledgerRevision: revision, source, destination } };
}
const a2 = (cellId, batchId, quantity, weightKg, volumeM3) => ({ cellId, topologyCertificationId: ids.topology, topologyRevision: 1, batchId, quantity, quantityUnit: 'box', weightKg, volumeM3 });
const a1 = (cellId, physicalUnitId, weightKg, volumeM3, supportReactionKg) => ({ cellId, topologyCertificationId: ids.topology, topologyRevision: 1, physicalUnitId, quantity: 1, quantityUnit: 'unit', weightKg, volumeM3, supportReactionKg, occupiedVolumeM3: volumeM3, pose: { xStartM: 0, yStartM: 0, rotationDeg: 0 } });

test('A2 batch split across Cells and multiple batches replay to exact SKU and Cell totals', () => {
  const rows = [
    movement({ revision: 1, destination: [a2(ids.c1, 'b-1', 4, 4, .4), a2(ids.c2, 'b-1', 3, 3, .3)], quantity: 7, weight: 7, volume: .7 }),
    movement({ revision: 2, destination: [a2(ids.c2, 'b-2', 2, 6, .2)], quantity: 2, weight: 6, volume: .2 }),
  ];
  const result = replayManagedInventoryV3(item, rows);
  assert.equal(result.onHandQuantity, 9); assert.equal(result.totalWeightKg, 13); assert.equal(result.totalVolumeM3, .9);
  assert.equal(result.byBatch.length, 3); assert.equal(result.byCell.find(row => row.cellId === String(ids.c2)).quantity, 5);
});

test('A1 footprint spanning Cells remains one unit and conserves distributed support reactions', () => {
  const result = replayManagedInventoryV3(item, [movement({ revision: 1, itemKind: 'A1_PHYSICAL_UNIT', quantity: 1, weight: 50, volume: .475,
    destination: [a1(ids.c1, ids.unit, 25, .25, 25), a1(ids.c2, ids.unit, 25, .225, 25)] })]);
  assert.equal(result.onHandQuantity, 1); assert.equal(result.byPhysicalUnit.length, 1); assert.equal(result.totalWeightKg, 50);
  assert.equal(result.byCell.reduce((n, row) => n + row.weightKg, 0), 50);
});

test('ledger replay DTO validates as a strict persisted projection for both A1 and A2', async () => {
  const normalize = value => value?.toHexString ? value.toHexString() : Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !['_id', 'createdAt', 'updatedAt', '__v'].includes(key) && value[key] !== undefined).sort().map(key => [key, normalize(value[key])]))
    : value;
  const a2Replay = replayManagedInventoryV3(item, [movement({ revision: 1, destination: [a2(ids.c1, 'batch-1', 2, 4, .2)], quantity: 2, weight: 4, volume: .2 })]);
  assert.equal(a2Replay.byBatch[0].itemKind, 'A2_BATCH');
  assert.equal(a2Replay.byBatch[0].quantityUnit, 'box');
  assert.equal(a2Replay.byBatch[0].heldQuantity, 0);
  const a2Document = new Projection(a2Replay); await assert.doesNotReject(a2Document.validate());
  const a2Read = a2Document.toObject();
  assert.deepEqual(normalize({ ...a2Read, _id: undefined }), normalize({ ...a2Replay, _id: undefined }));
  assert.equal(String(a2Read.skuId), String(ids.sku));
  assert.equal(a2Read.ledgerRevision, 1); assert.equal(a2Read.projectionRevision, 1);
  assert.deepEqual(a2Read.byCell.map(row => String(row.cellId)), a2Replay.byCell.map(row => row.cellId));

  const a1Replay = replayManagedInventoryV3(item, [movement({ revision: 1, itemKind: 'A1_PHYSICAL_UNIT', quantity: 1, weight: 50, volume: .475,
    destination: [a1(ids.c1, ids.unit, 25, .25, 25), a1(ids.c2, ids.unit, 25, .225, 25)] })]);
  assert.equal(a1Replay.byPhysicalUnit[0].itemKind, 'A1_PHYSICAL_UNIT');
  assert.equal(a1Replay.byPhysicalUnit[0].quantityUnit, 'unit');
  assert.equal(a1Replay.byPhysicalUnit[0].quantity, 1);
  assert.deepEqual(a1Replay.byPhysicalUnit[0].cellIds, [String(ids.c1), String(ids.c2)].sort());
  const a1Document = new Projection(a1Replay); await assert.doesNotReject(a1Document.validate());
  const a1Read = a1Document.toObject();
  assert.deepEqual(normalize({ ...a1Read, _id: undefined }), normalize({ ...a1Replay, _id: undefined }));
  assert.equal(a1Read.byPhysicalUnit[0].quantity, 1); assert.deepEqual(a1Read.byPhysicalUnit[0].cellIds.map(String), a1Replay.byPhysicalUnit[0].cellIds);
  assert.equal(a1Read.totalWeightKg, 50); assert.equal(a1Read.totalVolumeM3, .475);
});

test('direct confirm rejects A1 without a declared pose before any database access', async () => {
  await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), {
    itemKind: 'A1_PHYSICAL_UNIT', accessSessionId: ids.session.toString(), sessionRevision: 0,
    physicalUnitId: ids.unit.toString(), cellIds: [ids.c1.toString()], placements: [{ cellId: ids.c1.toString() }],
  }, { _id: ids.customer, role: 'CUSTOMER' }, 'missing-pose-key'), error => error.code === 'A1_POSE_REQUIRED' && error.status === 422);
});

test('MOVE conserves A2 batches split across Cells and moves an entire A1 footprint as one unit', () => {
  const a2Add = movement({ revision: 1, destination: [a2(ids.c1, 'b-1', 4, 4, .4), a2(ids.c2, 'b-1', 3, 3, .3)], quantity: 7, weight: 7, volume: .7 });
  const a2Move = movement({ revision: 2, action: 'MOVE', source: [a2(ids.c1, 'b-1', 4, 4, .4), a2(ids.c2, 'b-1', 3, 3, .3)],
    destination: [a2(ids.c3, 'b-1', 4, 4, .4), a2(ids.c4, 'b-1', 3, 3, .3)], quantity: 7, weight: 7, volume: .7 });
  const movedBatch = replayManagedInventoryV3(item, [a2Add, a2Move]);
  assert.equal(movedBatch.onHandQuantity, 7); assert.deepEqual(movedBatch.byCell.map(row => row.cellId).sort(), [String(ids.c3), String(ids.c4)].sort());

  const a1Add = movement({ revision: 1, itemKind: 'A1_PHYSICAL_UNIT', quantity: 1, weight: 50, volume: .475,
    destination: [a1(ids.c1, ids.unit, 25, .25, 25), a1(ids.c2, ids.unit, 25, .225, 25)] });
  const a1Move = movement({ revision: 2, action: 'MOVE', itemKind: 'A1_PHYSICAL_UNIT', quantity: 1, weight: 50, volume: .475,
    source: [a1(ids.c1, ids.unit, 25, .25, 25), a1(ids.c2, ids.unit, 25, .225, 25)],
    destination: [a1(ids.c3, ids.unit, 25, .25, 25), a1(ids.c4, ids.unit, 25, .225, 25)] });
  const movedUnit = replayManagedInventoryV3(item, [a1Add, a1Move]);
  assert.equal(movedUnit.onHandQuantity, 1); assert.equal(movedUnit.byPhysicalUnit[0].weightKg, 50);
  assert.deepEqual(movedUnit.byPhysicalUnit[0].cellIds, [String(ids.c3), String(ids.c4)].sort());
});

test('V3 replay rejects duplicate operations, stale revisions, duplicate placement lines and conservation errors', () => {
  const good = movement({ revision: 1, destination: [a2(ids.c1, 'b-1', 1, 1, .1)], quantity: 1, weight: 1, volume: .1 });
  assert.throws(() => replayManagedInventoryV3(item, [good, { ...good, _id: new Types.ObjectId(), v3Effect: { ...good.v3Effect, ledgerRevision: 2 } }]), /duplicate operation/i);
  assert.throws(() => replayManagedInventoryV3(item, [{ ...good, v3Effect: { ...good.v3Effect, ledgerRevision: 2 } }]), /not contiguous/i);
  assert.throws(() => replayManagedInventoryV3(item, [movement({ revision: 1, destination: [a2(ids.c1, 'b-1', 1, 1, .1), a2(ids.c1, 'b-1', 1, 1, .1)], quantity: 2, weight: 2, volume: .2 })]), /duplicate placement/i);
  assert.throws(() => replayManagedInventoryV3(item, [movement({ revision: 1, destination: [a2(ids.c1, 'b-1', 1, 1, .1)], quantity: 1, weight: 2, volume: .1 })]), /does not reconcile/i);
});

test('V3 ItemMovement schema validates canonical ADD shape without legacy single-Cell fields', async () => {
  const row = new Movement({ itemId: ids.sku, managedReservationId: ids.reservation, facilityId: ids.facility, customerId: ids.customer,
    type: 'INBOUND', quantity: 1, quantityUnit: 'unit', actualUnitWeightKg: 50, actualTotalWeightKg: 50,
    actualUnitDimensionsM: { widthM: 1, depthM: .5, heightM: .95 }, actualTotalVolumeM3: .475, performedBy: ids.actor, performedAt: new Date(),
    idempotencyKey: 'inbound-key-0001', schemaVersion: 3, operationId: 'operation-0001', v3Effect: { action: 'ADD', itemKind: 'A1_PHYSICAL_UNIT',
      operationId: 'operation-0001', requestHash: 'a'.repeat(64), accessSessionId: ids.session, inventoryRevision: 0, ledgerRevision: 1,
      topologyCertificationId: ids.topology, topologyRevision: 1, correlationId: 'correlation-0001', destination: [a1(ids.c1, ids.unit, 50, .475, 50)] } });
  await assert.doesNotReject(row.validate());
  row.destinationCellId = ids.c1;
  await assert.rejects(row.validate(), /cannot use legacy single-Cell/);
});
