const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { allocateManagedV3Fifo, currentManagedV3A1Footprint, reconcileManagedV3A1PhysicalUnits, staffCanReadManagedV3OutboundRequest, reconcileManagedV3OutboundHolds } = require('../dist/services/inventory-items/managed-v3-outbound-domain');
const OutboundRequest = require('../dist/models/inventory-items/managed-v3-outbound-request.model').default;
const OutboundEvent = require('../dist/models/inventory-items/managed-v3-outbound-event.model').default;
const { ManagedInventoryV3OutboundService, ManagedV3OutboundError } = require('../dist/services/inventory-items/managed-inventory-v3-outbound.service');

const cellA = new Types.ObjectId('000000000000000000000001');
const cellB = new Types.ObjectId('000000000000000000000002');
const topology = new Types.ObjectId('000000000000000000000003');
const receiptA = new Types.ObjectId('000000000000000000000011');
const receiptB = new Types.ObjectId('000000000000000000000012');

test('FIFO allocation spans receipts deterministically and preserves source lineage', () => {
  const lines = [
    { batchId: 'B2', cellId: cellB, receiptMovementId: receiptB, receivedAt: new Date('2026-11-02T00:00:00Z'), quantity: 7, quantityUnit: 'box', weightKg: 14.007, volumeM3: 0.000014, topologyCertificationId: topology, topologyRevision: 1 },
    { batchId: 'B1', cellId: cellA, receiptMovementId: receiptA, receivedAt: new Date('2026-11-01T00:00:00Z'), quantity: 5, quantityUnit: 'box', weightKg: 5.005, volumeM3: 0.00001, topologyCertificationId: topology, topologyRevision: 1 },
  ];
  const result = allocateManagedV3Fifo({ byBatch: lines }, 8);
  assert.deepEqual(result.map(x => [x.batchId, x.quantity, String(x.receiptMovementId)]), [['B1', 5, String(receiptA)], ['B2', 3, String(receiptB)]]);
  assert.equal(result.reduce((n, x) => n + x.quantity, 0), 8);
  assert.ok(result.every(x => x.weightKg >= 0 && x.volumeM3 >= 0));
});

test('FIFO stable tie-break uses receipt Movement ID then Batch and Cell IDs', () => {
  const base = { receivedAt: new Date('2026-11-01T00:00:00Z'), quantity: 1, quantityUnit: 'box', weightKg: 1, volumeM3: 0.1, topologyCertificationId: topology, topologyRevision: 1 };
  const result = allocateManagedV3Fifo({ byBatch: [
    { ...base, batchId: 'Z', cellId: cellA, receiptMovementId: receiptB },
    { ...base, batchId: 'A', cellId: cellB, receiptMovementId: receiptA },
  ] }, 1);
  assert.equal(result[0].batchId, 'A');
});

test('hold reconciliation releases only a terminal event and rejects projection drift', () => {
  const requestId = new Types.ObjectId('000000000000000000000021');
  const line = { itemKind: 'A2_BATCH', batchId: 'B1', cellId: cellA, quantity: 3, quantityUnit: 'box', weightKg: 3, volumeM3: 0.3 };
  const create = { requestId, operation: 'CREATE', resultingState: 'PENDING', resultingVersion: 0, allocationSnapshot: [line], requestHash: 'hash' };
  const request = { _id: requestId, state: 'PENDING', version: 0, allocations: [line], requestHash: 'hash' };
  const pending = reconcileManagedV3OutboundHolds([create], [request]);
  assert.equal(pending.heldByPlacement.get(`B:B1:${String(cellA)}`), 3);
  const cancel = { ...create, operation: 'CANCEL', resultingState: 'CANCELLED', resultingVersion: 1 };
  const released = reconcileManagedV3OutboundHolds([create, cancel], [{ ...request, state: 'CANCELLED', version: 1 }]);
  assert.equal(released.heldByPlacement.size, 0);
  assert.throws(() => reconcileManagedV3OutboundHolds([create], [{ ...request, version: 9 }]), { code: 'OUTBOUND_HOLDS_UNKNOWN' });
});

test('A1 hold keys reserve complete unit identity and conflicting active requests fail closed', () => {
  const unitId = new Types.ObjectId('000000000000000000000031');
  const requestA = new Types.ObjectId('000000000000000000000032');
  const requestB = new Types.ObjectId('000000000000000000000033');
  const line = { itemKind: 'A1_PHYSICAL_UNIT', physicalUnitId: unitId, cellId: cellA, quantity: 1, quantityUnit: 'unit', weightKg: 10, volumeM3: 0.1 };
  const event = { requestId: requestA, operation: 'CREATE', resultingState: 'PENDING', resultingVersion: 0, allocationSnapshot: [line], requestHash: 'a' };
  assert.equal(reconcileManagedV3OutboundHolds([event], [{ _id: requestA, state: 'PENDING', version: 0, allocations: [line], requestHash: 'a' }]).heldByPlacement.get(`U:${String(unitId)}:${String(cellA)}`), 1);
  const second = { ...event, requestId: requestB, requestHash: 'b' };
  assert.throws(() => reconcileManagedV3OutboundHolds([event, second], [
    { _id: requestA, state: 'PENDING', version: 0, allocations: [line], requestHash: 'a' },
    { _id: requestB, state: 'PENDING', version: 0, allocations: [line], requestHash: 'b' },
  ]), { code: 'OUTBOUND_HOLDS_UNKNOWN' });
});

test('A1 outbound allocation follows latest committed MOVE footprint and rejects removed or missing units', () => {
  const unit = new Types.ObjectId('000000000000000000000041');
  const oldLine = { physicalUnitId: unit, cellId: cellA, quantity: 1, weightKg: 4, volumeM3: 0.4 };
  const newLineA = { ...oldLine, cellId: cellB, weightKg: 2, volumeM3: 0.2 };
  const newLineB = { ...oldLine, cellId: new Types.ObjectId('000000000000000000000004'), weightKg: 2, volumeM3: 0.2 };
  const history = [
    { _id: receiptA, schemaVersion: 3, performedAt: new Date('2026-11-01T00:00:00Z'), v3Effect: { action: 'ADD', destination: [oldLine], source: [] } },
    { _id: receiptB, schemaVersion: 3, performedAt: new Date('2026-11-02T00:00:00Z'), v3Effect: { action: 'MOVE', source: [oldLine], destination: [newLineA, newLineB] } },
  ];
  assert.deepEqual(currentManagedV3A1Footprint(history, String(unit)).map(line => String(line.cellId)).sort(), [String(cellB), String(newLineB.cellId)].sort());
  assert.throws(() => currentManagedV3A1Footprint([...history, { _id: new Types.ObjectId(), schemaVersion: 3, performedAt: new Date('2026-11-03T00:00:00Z'), v3Effect: { action: 'REMOVE', source: [newLineA, newLineB], destination: [] } }], String(unit)), { code: 'A1_FOOTPRINT_UNKNOWN' });
  assert.throws(() => currentManagedV3A1Footprint(history, 'missing'), { code: 'A1_FOOTPRINT_UNKNOWN' });
});

test('request/event schemas accept exact A2 and whole A1 allocations and reject quantity or duplicate-line drift', async () => {
  const skuId = new Types.ObjectId(), reservationId = new Types.ObjectId(), customerId = new Types.ObjectId(), facilityId = new Types.ObjectId();
  const batch = { itemKind: 'A2_BATCH', batchId: 'B1', cellId: cellA, quantity: 3, quantityUnit: 'box', weightKg: 6, volumeM3: 0.3,
    receiptMovementId: receiptA, topologyCertificationId: topology, topologyRevision: 1 };
  const base = { skuId, reservationId, customerId, facilityId, itemKind: 'A2_BATCH', requestedQuantity: 3, quantityUnit: 'box', allocations: [batch],
    state: 'PENDING', version: 0, idempotencyKey: 'outbound-key-0001', requestHash: 'a'.repeat(64), createdAt: new Date() };
  await assert.doesNotReject(new OutboundRequest(base).validate());
  await assert.rejects(new OutboundRequest({ ...base, requestedQuantity: 4 }).validate(), /allocations/i);
  await assert.rejects(new OutboundRequest({ ...base, allocations: [batch, batch] }).validate(), /allocations/i);
  const physicalUnitId = new Types.ObjectId();
  const unitLines = [cellA, cellB].map(cellId => ({ itemKind: 'A1_PHYSICAL_UNIT', physicalUnitId, cellId, quantity: 1, quantityUnit: 'unit', weightKg: 2, volumeM3: 0.1,
    topologyCertificationId: topology, topologyRevision: 1, pose: { xStartM: 0, yStartM: 0, rotationDeg: 0 } }));
  await assert.doesNotReject(new OutboundRequest({ ...base, itemKind: 'A1_PHYSICAL_UNIT', requestedQuantity: 1, quantityUnit: 'unit', allocations: unitLines }).validate());
  const event = new OutboundEvent({ requestId: new Types.ObjectId(), skuId, reservationId, customerId, facilityId, actorId: customerId, operation: 'CREATE',
    idempotencyKey: 'outbound-key-0001', requestHash: 'a'.repeat(64), resultingState: 'PENDING', resultingVersion: 0, allocationSnapshot: [batch], occurredAt: new Date() });
  await assert.doesNotReject(event.validate());
});

test('V3 outbound service rejects role, malformed DTO and missing Session before database access', async () => {
  const skuId = new Types.ObjectId().toHexString(), requestId = new Types.ObjectId().toHexString();
  const staff = { _id: new Types.ObjectId(), role: 'FACILITY_STAFF' };
  const customer = { _id: new Types.ObjectId(), role: 'CUSTOMER' };
  await assert.rejects(ManagedInventoryV3OutboundService.create(skuId, { itemKind: 'A2_BATCH', requestedQuantity: 1 }, 'outbound-key-0002', staff),
    error => error instanceof ManagedV3OutboundError && error.status === 403 && error.code === 'ROLE_DENIED');
  await assert.rejects(ManagedInventoryV3OutboundService.create(skuId, { itemKind: 'A2_BATCH', requestedQuantity: 1, batchId: 'client-controlled' }, 'outbound-key-0002', customer),
    error => error instanceof ManagedV3OutboundError && error.status === 422 && error.code === 'INVALID_OUTBOUND_REQUEST');
  await assert.rejects(ManagedInventoryV3OutboundService.preview(requestId, {}, customer),
    error => error instanceof ManagedV3OutboundError && error.status === 422 && error.code === 'INVALID_OUTBOUND_PREVIEW');
  await assert.rejects(ManagedInventoryV3OutboundService.confirm(requestId, { physicalRemovalConfirmed: true }, 'outbound-key-0002', '"0"', staff),
    error => error instanceof ManagedV3OutboundError && error.status === 403 && error.code === 'ROLE_DENIED');
});

test('A1 reconciliation compares PhysicalUnit facts to receipt and Footprint Cell set to canonical history without assuming a cellIds model field', () => {
  const item = { _id: new Types.ObjectId(), managedReservationId: new Types.ObjectId(), customerId: new Types.ObjectId(), facilityId: new Types.ObjectId() };
  const unitId = new Types.ObjectId(), sourceMovementId = new Types.ObjectId();
  const pose = { xStartM: 0.1, yStartM: 0.2, rotationDeg: 90 };
  const dimensionsM = { widthM: 0.4, depthM: 0.3, heightM: 0.2 };
  const unit = { _id: unitId, ...{ skuId: item._id, reservationId: item.managedReservationId, customerId: item.customerId, facilityId: item.facilityId },
    serial: 'PU-1', state: 'PLACED', sourceMovementId, weightKg: 5, volumeM3: 0.024, dimensionsM, currentPose: pose };
  const receipt = { _id: sourceMovementId, itemId: item._id, managedReservationId: item.managedReservationId, customerId: item.customerId, facilityId: item.facilityId,
    actualUnitWeightKg: 5, actualTotalVolumeM3: 0.024, actualUnitDimensionsM: dimensionsM,
    v3Effect: { action: 'ADD', itemKind: 'A1_PHYSICAL_UNIT', destination: [{ physicalUnitId: unitId }] } };
  const expected = { byPhysicalUnit: [{ physicalUnitId: String(unitId), sourceMovementId: String(sourceMovementId), quantity: 1, pose, weightKg: 5, volumeM3: 0.024 }] };
  assert.equal(reconcileManagedV3A1PhysicalUnits({ item, physicalUnits: [unit], movements: [receipt], replay: expected }), true);
  const withWrongPose = { ...unit, currentPose: { ...pose, xStartM: 0.5 } };
  assert.throws(() => reconcileManagedV3A1PhysicalUnits({ item, physicalUnits: [withWrongPose], movements: [receipt], replay: expected }), { code: 'V3_PHYSICAL_UNIT_RECONCILIATION_UNKNOWN' });
  assert.throws(() => reconcileManagedV3A1PhysicalUnits({ item, physicalUnits: [{ ...unit, dimensionsM: { ...dimensionsM, widthM: 0.9 } }], movements: [receipt], replay: expected }), { code: 'V3_PHYSICAL_UNIT_RECONCILIATION_UNKNOWN' });
});

test('Staff outbound visibility is tied to an assigned current/history Visit and the exact Session Movement', () => {
  const facilityId = new Types.ObjectId(), otherFacility = new Types.ObjectId(), staffId = new Types.ObjectId(), oldStaff = new Types.ObjectId();
  const reservationId = new Types.ObjectId(), customerId = new Types.ObjectId(), cellId = new Types.ObjectId();
  const visitId = new Types.ObjectId(), sessionId = new Types.ObjectId(), movementId = new Types.ObjectId();
  const now = new Date('2026-11-13T12:00:00Z');
  const visit = { _id: visitId, reservationId, customerId, facilityId, purpose: 'OUTBOUND', status: 'COMPLETED', assignedStaffId: oldStaff,
    startsAt: new Date('2026-11-13T10:00:00Z'), endsAt: new Date('2026-11-13T11:00:00Z') };
  const session = { _id: sessionId, visitId, reservationId, customerId, facilityId, assignedStaffId: staffId, allowedPurposes: ['OUTBOUND'], allowedCellIds: [cellId], status: 'CHECKED_OUT' };
  const movement = { _id: movementId, v3Effect: { action: 'REMOVE', operationId: `outbound:${new Types.ObjectId()}`, accessSessionId: sessionId } };
  const requestId = movement.v3Effect.operationId.slice('outbound:'.length);
  const request = { _id: new Types.ObjectId(requestId), reservationId, customerId, facilityId, state: 'CONFIRMED', confirmedMovementId: movementId,
    allocations: [{ cellId }] };
  movement.v3Effect.operationId = `outbound:${request._id}`;
  assert.equal(staffCanReadManagedV3OutboundRequest({ request, visits: [visit], sessions: [session], movements: [movement], actorId: String(staffId), facilityId: String(facilityId), now }), true);
  assert.equal(staffCanReadManagedV3OutboundRequest({ request, visits: [visit], sessions: [session], movements: [movement], actorId: String(oldStaff), facilityId: String(facilityId), now }), false);
  assert.equal(staffCanReadManagedV3OutboundRequest({ request, visits: [visit], sessions: [session], movements: [movement], actorId: String(staffId), facilityId: String(otherFacility), now }), false);
  const laterRequest = { ...request, _id: new Types.ObjectId(), state: 'PENDING', createdAt: new Date('2026-11-13T12:01:00Z'), confirmedMovementId: undefined };
  assert.equal(staffCanReadManagedV3OutboundRequest({ request: laterRequest, visits: [visit], sessions: [session], movements: [], actorId: String(staffId), facilityId: String(facilityId), now }), false);
  assert.equal(staffCanReadManagedV3OutboundRequest({ request: laterRequest, visits: [{ ...visit, status: 'CANCELLED' }], sessions: [], movements: [], actorId: String(staffId), facilityId: String(facilityId), now }), false);
});
