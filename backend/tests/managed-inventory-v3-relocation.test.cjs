const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { normalizeRelocation, buildRelocationPlan, relocationReservationVolumeDeltas, validateRelocationLevels } = require('../dist/services/inventory-items/managed-inventory-v3-relocation.domain');
const { replayManagedStockMovements } = require('../dist/services/inventory-items/managed-cell-stock.domain');
const { relocationDestinationHasRunway, validateRelocationDestinationRunway, RELOCATION_DESTINATION_MIN_REMAINING_DAYS, ManagedV3RelocationError } = require('../dist/services/inventory-items/managed-inventory-v3-relocation.service');
const Movement = require('../dist/models/inventory-items/item-movement.model').default;

const oid = value => new mongoose.Types.ObjectId(value);
const ids = {
  sku: '507f1f77bcf86cd799439001', reservation: '507f1f77bcf86cd799439002', customer: '507f1f77bcf86cd799439003',
  facility: '507f1f77bcf86cd799439004', spec: '507f1f77bcf86cd799439005', source: '507f1f77bcf86cd799439006',
  destination: '507f1f77bcf86cd799439007', rack: '507f1f77bcf86cd799439008', session: '507f1f77bcf86cd799439009',
  source2: '507f1f77bcf86cd799439010', destination2: '507f1f77bcf86cd799439011',
};
const baseCandidate = (overrides = {}) => normalizeRelocation({ accessSessionId: ids.session, sessionRevision: 2, skuRevision: 3,
  lines: [{ lineId: 'move-1', itemSpecId: ids.spec, itemSpecRevision: 4, sourceCellId: ids.source, destinationCellId: ids.destination, quantity: 4 }], ...overrides });
const sku = { _id: oid(ids.sku), customerId: oid(ids.customer), facilityId: oid(ids.facility), managedV3Revision: 3 };
const reservation = { _id: oid(ids.reservation), allocatedCellIds: [oid(ids.source), oid(ids.destination), oid(ids.source2), oid(ids.destination2)] };
const spec = { _id: oid(ids.spec), skuId: oid(ids.sku), customerId: oid(ids.customer), facilityId: oid(ids.facility), reservationId: oid(ids.reservation), status: 'ACTIVE', revision: 4, code: 'BOX', name: 'Hộp', quantityUnitName: 'thùng' };
const cell = (id, usedWeightKg, usedVolumeM3, overrides = {}) => ({ _id: oid(id), rackId: oid(ids.rack), levelNumber: 1, code: id.slice(-3),
  operationalStatus: 'AVAILABLE', maxWeightKg: 100, usedWeightKg, usedVolumeM3,
  dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 }, ...overrides });
const lot = (receiptId, cellId, quantityOnHand, overrides = {}) => ({ skuId: oid(ids.sku), reservationId: oid(ids.reservation), itemSpecId: oid(ids.spec), receiptId, cellId: oid(cellId), quantityOnHand, quantityHeld: 0,
  quantityAvailable: quantityOnHand, unitWeightKgSnapshot: 5, unitVolumeM3Snapshot: .004,
  unitDimensionsSnapshot: { widthM: .2, depthM: .2, heightM: .1 }, quantityUnitSnapshot: 'thùng', ...overrides });
const plan = ({ candidate = baseCandidate(), lots = [lot('receipt-a', ids.source, 10)], cells = [cell(ids.source, 50, .04), cell(ids.destination, 0, 0)], movements = [], instances = [] } = {}) =>
  buildRelocationPlan({ candidate, sku, reservation, state: { cells, movements, replay: { lots, instances } }, specifications: [spec] });

test('Relocation destination needs at least seven full days; a near-expiry reservation can still be a source', () => {
  const now = new Date('2026-11-17T12:00:00.000Z');
  assert.equal(RELOCATION_DESTINATION_MIN_REMAINING_DAYS, 7);
  assert.equal(relocationDestinationHasRunway(new Date(now.getTime() + 7 * 86400000), now), true);
  assert.equal(relocationDestinationHasRunway(new Date(now.getTime() + 6 * 86400000 + 86399999), now), false);
  assert.equal(relocationDestinationHasRunway('invalid-date', now), false);
  const sourceId = ids.reservation, targetId = '507f1f77bcf86cd799439012';
  const candidate = baseCandidate({ lines: [{ lineId: 'move-runway', itemSpecId: ids.spec, itemSpecRevision: 4,
    sourceCellId: ids.source, destinationCellId: ids.destination2, sourceReservationId: sourceId, destinationReservationId: targetId, quantity: 1 }] });
  assert.doesNotThrow(() => validateRelocationDestinationRunway(candidate, sourceId, [
    { _id: oid(sourceId), endDate: new Date(now.getTime() + 2 * 86400000) },
    { _id: oid(targetId), endDate: new Date(now.getTime() + 7 * 86400000) },
  ], now));
  assert.throws(() => validateRelocationDestinationRunway(candidate, sourceId, [
    { _id: oid(sourceId), endDate: new Date(now.getTime() + 2 * 86400000) },
    { _id: oid(targetId), endDate: new Date(now.getTime() + 6 * 86400000) },
  ], now), error => error instanceof ManagedV3RelocationError && error.code === 'DESTINATION_RESERVATION_EXPIRING');
});

test('A2 relocation moves only requested quantity and preserves exact receipt lineage and counters', () => {
  const result = plan();
  assert.equal(result.quantity, 4);
  assert.equal(result.source.length, 1);
  assert.equal(result.destination.length, 1);
  assert.equal(result.source[0].receiptId, 'receipt-a');
  assert.equal(result.destination[0].receiptId, 'receipt-a');
  assert.equal(result.source[0].quantityBefore, 10);
  assert.equal(result.source[0].quantityAfter, 6);
  assert.equal(result.destination[0].quantityBefore, 0);
  assert.equal(result.destination[0].quantityAfter, 4);
  assert.deepEqual(result.cellDeltas.get(ids.source), { weightKg: -20, volumeM3: -.016, weightAfterKg: 30, volumeAfterM3: .024, maxVolumeM3: 1 });
  assert.equal(result.cellDeltas.get(ids.destination).weightAfterKg, 20);
  assert.equal(result.cellDeltas.get(ids.destination).volumeAfterM3, .016);
});

test('A2 MOVE can reassign stock to a second Reservation for the same customer and facility', () => {
  const targetId = '507f1f77bcf86cd799439012';
  const target = { _id: oid(targetId), customerId: oid(ids.customer), facilityId: oid(ids.facility), allocatedCellIds: [oid(ids.destination2)] };
  const candidate = baseCandidate({ lines: [{ lineId: 'cross-res', itemSpecId: ids.spec, itemSpecRevision: 4,
    sourceCellId: ids.source, destinationCellId: ids.destination2, sourceReservationId: ids.reservation, destinationReservationId: targetId, quantity: 2 }] });
  const result = buildRelocationPlan({ candidate, sku, reservation, state: { cells: [cell(ids.source, 50, .04), cell(ids.destination2, 0, 0)],
    reservations: [reservation, target], movements: [], replay: { lots: [lot('receipt-a', ids.source, 10)], instances: [] } }, specifications: [spec] });
  assert.equal(String(result.source[0].reservationId), ids.reservation);
  assert.equal(String(result.destination[0].reservationId), targetId);
  assert.equal(result.destination[0].quantity, 2);
});

test('Reservation capacity deltas conserve A2 volume and count an A1 footprint only once', () => {
  const sourceReservationId = oid(ids.reservation), destinationReservationId = oid('507f1f77bcf86cd799439012');
  const deltas = relocationReservationVolumeDeltas(
    [{ reservationId: sourceReservationId, allocatedVolumeM3: .008 },
      { reservationId: sourceReservationId, itemInstanceId: 'unit-1', unitVolumeM3Snapshot: .006, allocatedVolumeM3: .003 },
      { reservationId: sourceReservationId, itemInstanceId: 'unit-1', unitVolumeM3Snapshot: .006, allocatedVolumeM3: .003 }],
    [{ reservationId: destinationReservationId, allocatedVolumeM3: .008 },
      { reservationId: destinationReservationId, itemInstanceId: 'unit-1', unitVolumeM3Snapshot: .006, allocatedVolumeM3: .002 },
      { reservationId: destinationReservationId, itemInstanceId: 'unit-1', unitVolumeM3Snapshot: .006, allocatedVolumeM3: .004 }], sourceReservationId);
  assert.equal(deltas.get(ids.reservation), -.014);
  assert.equal(deltas.get(String(destinationReservationId)), .014);
});

test('A2 source allocation uses authoritative receipt FIFO across multiple receipts in one Cell', () => {
  const candidate = baseCandidate({ lines: [{ lineId: 'move-fifo', itemSpecId: ids.spec, itemSpecRevision: 4,
    sourceCellId: ids.source, destinationCellId: ids.destination, quantity: 5 }] });
  const older = lot('receipt-old', ids.source, 3);
  const newer = lot('receipt-new', ids.source, 4, { unitWeightKgSnapshot: 6, unitVolumeM3Snapshot: .005,
    unitDimensionsSnapshot: { widthM: .25, depthM: .2, heightM: .1 } });
  const result = plan({ candidate, lots: [newer, older], cells: [cell(ids.source, 39, .032), cell(ids.destination, 0, 0)], movements: [
    { _id: oid(ids.destination), itemId: oid(ids.sku), performedAt: new Date('2026-01-02T00:00:00Z'), stockEffect: { action: 'ADD', destination: [{ receiptId: 'receipt-new' }] } },
    { _id: oid(ids.source2), itemId: oid(ids.sku), performedAt: new Date('2026-01-01T00:00:00Z'), stockEffect: { action: 'ADD', destination: [{ receiptId: 'receipt-old' }] } },
  ] });
  assert.deepEqual(result.source.map(row => [row.receiptId, row.quantity]), [['receipt-old', 3], ['receipt-new', 2]]);
  assert.deepEqual(result.destination.map(row => [row.receiptId, row.quantity]), [['receipt-old', 3], ['receipt-new', 2]]);
  assert.equal(result.totalWeightKg, 27);
});

test('multi-line MOVE is valid when opposite transfers conserve each Cell capacity exactly', () => {
  const candidate = baseCandidate({ lines: [
    { lineId: 'move-out', itemSpecId: ids.spec, itemSpecRevision: 4, sourceCellId: ids.source, destinationCellId: ids.destination, quantity: 2 },
    { lineId: 'move-back', itemSpecId: ids.spec, itemSpecRevision: 4, sourceCellId: ids.destination, destinationCellId: ids.source, quantity: 2 },
  ] });
  const sourceLot = lot('receipt-a', ids.source, 2);
  const destinationLot = lot('receipt-a', ids.destination, 2);
  const result = plan({ candidate, lots: [sourceLot, destinationLot], cells: [cell(ids.source, 10, .008), cell(ids.destination, 10, .008)] });
  assert.equal(result.lines.length, 2);
  assert.equal(result.quantity, 4);
  assert.deepEqual(result.cellDeltas.get(ids.source), { weightKg: 0, volumeM3: 0, weightAfterKg: 10, volumeAfterM3: .008, maxVolumeM3: 1 });
  assert.deepEqual(result.cellDeltas.get(ids.destination), { weightKg: 0, volumeM3: 0, weightAfterKg: 10, volumeAfterM3: .008, maxVolumeM3: 1 });
});

test('A1 multi-Cell Item Instance remains quantity one and conserves all load shares', () => {
  const instanceId = 'MI:whole-unit-1';
  const candidate = baseCandidate({ lines: [{ lineId: 'whole-unit', itemSpecId: ids.spec, itemSpecRevision: 4, quantity: 1,
    itemInstanceId: instanceId, destinationAllocations: [
      { cellId: ids.destination, weightKg: 6, volumeM3: .01 },
      { cellId: ids.destination2, weightKg: 9, volumeM3: .02 },
    ] }] });
  const instance = { itemInstanceId: instanceId, itemSpecId: oid(ids.spec), skuId: oid(ids.sku), reservationId: oid(ids.reservation), status: 'PLACED', quantity: 1,
    sourceReceiptId: 'receipt-unit', unitWeightKgSnapshot: 15, unitVolumeM3Snapshot: .03,
    unitDimensionsSnapshot: { widthM: .3, depthM: .5, heightM: .2 },
    allocations: [{ cellId: oid(ids.source), weightKg: 15, volumeM3: .03 }] };
  const result = plan({ candidate, lots: [], instances: [instance], cells: [cell(ids.source, 15, .03), cell(ids.destination, 0, 0), cell(ids.destination2, 0, 0)] });
  assert.equal(result.quantity, 1);
  assert.equal(result.totalWeightKg, 15);
  assert.equal(result.totalVolumeM3, .03);
  assert.equal(result.source.reduce((sum, row) => sum + row.quantity, 0), 1);
  assert.equal(result.destination.reduce((sum, row) => sum + row.quantity, 0), 2, 'footprint rows represent one item and are not movement quantity');
  assert.equal(result.cellDeltas.get(ids.destination).weightAfterKg, 6);
  assert.equal(result.cellDeltas.get(ids.destination2).weightAfterKg, 9);
});

test('one Item Specification can relocate divisible receipt stock and a whole Item Instance in the same stock domain', () => {
  const instanceId = 'MI:mixed-stock-instance';
  const candidate = baseCandidate({ lines: [
    { lineId: 'quantity-stock', itemSpecId: ids.spec, itemSpecRevision: 4, sourceCellId: ids.source, destinationCellId: ids.destination, quantity: 1 },
    { lineId: 'whole-instance', itemSpecId: ids.spec, itemSpecRevision: 4, quantity: 1, itemInstanceId: instanceId,
      destinationAllocations: [{ cellId: ids.destination2, weightKg: 8, volumeM3: .01 }] },
  ] });
  const instance = { itemInstanceId: instanceId, itemSpecId: oid(ids.spec), skuId: oid(ids.sku), reservationId: oid(ids.reservation), status: 'PLACED', quantity: 1,
    sourceReceiptId: 'receipt-instance', unitWeightKgSnapshot: 8, unitVolumeM3Snapshot: .01,
    unitDimensionsSnapshot: { widthM: .2, depthM: .25, heightM: .2 },
    allocations: [{ cellId: oid(ids.source2), weightKg: 8, volumeM3: .01 }] };
  const result = plan({ candidate, lots: [lot('receipt-a', ids.source, 2)], instances: [instance],
    cells: [cell(ids.source, 10, .008), cell(ids.destination, 0, 0), cell(ids.source2, 8, .01), cell(ids.destination2, 0, 0)] });
  assert.equal(result.quantity, 2);
  assert.deepEqual(result.lines.map(line => [line.itemInstanceId || 'QUANTITY', line.quantity]), [['QUANTITY', 1], [instanceId, 1]]);
  assert.equal(result.totalWeightKg, 13);
  assert.equal(result.totalVolumeM3, .014);
});

test('unknown or insufficient Cell and Level capacity fails closed', () => {
  assert.throws(() => plan({ cells: [cell(ids.source, 50, .04), cell(ids.destination, 98, .99, { maxWeightKg: 100 })] }),
    error => error.code === 'CELL_WEIGHT_CAPACITY_EXCEEDED' || error.code === 'CELL_VOLUME_CAPACITY_EXCEEDED');
  const candidate = baseCandidate();
  const planned = plan({ candidate });
  const cells = [cell(ids.source, 50, .04), cell(ids.destination, 0, 0)];
  assert.throws(() => validateRelocationLevels(planned, cells, [{ _id: oid(ids.rack), operationalStatus: 'AVAILABLE', maxWeightKgPerLevel: 49 }]), { code: 'LEVEL_WEIGHT_CAPACITY_EXCEEDED' });
  assert.throws(() => plan({ cells: [cell(ids.source, 50, .04), cell(ids.destination, 0, 0, { dimensions: { widthM: 1, depthM: 1 } })] }), { code: 'CELL_CAPACITY_UNKNOWN' });
});

test('schema-v4 MOVE replay reduces the source lot and adds the same receipt at destination', () => {
  const itemSpecId = oid(ids.spec), sourceCellId = oid(ids.source), destinationCellId = oid(ids.destination);
  const dimensions = { widthM: .2, depthM: .2, heightM: .1 };
  const line = (cellId, quantity, before, after) => ({ lineId: 'line-1', itemSpecId, receiptId: 'receipt-a', cellId, quantity,
    quantityUnitSnapshot: 'thùng', unitWeightKgSnapshot: 5, unitVolumeM3Snapshot: .004, unitDimensionsSnapshot: dimensions,
    allocatedWeightKg: 5 * quantity, allocatedVolumeM3: .004 * quantity, quantityBefore: before, quantityAfter: after });
  const movements = [
    { _id: oid(ids.source2), itemId: oid(ids.sku), managedReservationId: oid(ids.reservation), facilityId: oid(ids.facility), customerId: oid(ids.customer),
      schemaVersion: 4, performedAt: new Date('2026-01-01T00:00:00Z'), quantity: 10, actualTotalWeightKg: 50, actualTotalVolumeM3: .04,
      stockEffect: { action: 'ADD', operationId: 'add-1', ledgerRevision: 1, destination: [line(sourceCellId, 10, undefined, undefined)] } },
    { _id: oid(ids.source), itemId: oid(ids.sku), managedReservationId: oid(ids.reservation), facilityId: oid(ids.facility), customerId: oid(ids.customer),
      schemaVersion: 4, performedAt: new Date('2026-01-02T00:00:00Z'), quantity: 4, actualTotalWeightKg: 20, actualTotalVolumeM3: .016,
      stockEffect: { action: 'MOVE', operationId: 'move-1', ledgerRevision: 2, source: [line(sourceCellId, 4, 10, 6)], destination: [line(destinationCellId, 4, 0, 4)] } },
  ];
  const replay = replayManagedStockMovements(movements);
  assert.deepEqual(replay.lots.map(row => [String(row.cellId), row.receiptId, row.quantityOnHand]).sort(), [
    [ids.destination, 'receipt-a', 4], [ids.source, 'receipt-a', 6],
  ].sort());
});

test('schema accepts auditable MOVE with same receipt/cell repeated on distinct logical lines', async () => {
  const itemSpecId = oid(ids.spec), sourceCellId = oid(ids.source), destinationCellId = oid(ids.destination), now = new Date();
  const dimensions = { widthM: .2, depthM: .2, heightM: .1 };
  const row = (lineId, cellId, quantity, before, after) => ({ lineId, itemSpecId, receiptId: 'receipt-a', cellId, quantity, quantityUnitSnapshot: 'thùng',
    unitWeightKgSnapshot: 5, unitVolumeM3Snapshot: .004, unitDimensionsSnapshot: dimensions, allocatedWeightKg: 5 * quantity, allocatedVolumeM3: .004 * quantity,
    quantityBefore: before, quantityAfter: after });
  const movement = new Movement({ itemId: oid(ids.sku), managedReservationId: oid(ids.reservation), facilityId: oid(ids.facility), customerId: oid(ids.customer),
    type: 'RELOCATION', quantity: 4, quantityUnit: 'thùng', actualUnitWeightKg: 5, actualTotalWeightKg: 20, actualUnitDimensionsM: dimensions,
    actualTotalVolumeM3: .016, performedBy: oid(ids.customer), performedAt: now, movementCode: 'MI-MOVE-1', referenceCode: 'op-1', operationId: 'op-1',
    relocationNote: 'Customer chuyển trong kho', physicalPackingConfirmed: true, idempotencyKey: 'relocation-test-001', schemaVersion: 4, itemSpecId,
    stockEffect: { action: 'MOVE', operationId: 'op-1', requestHash: 'a'.repeat(64), ledgerRevision: 2, contractVersion: 2,
      accessSessionId: oid(ids.session), customerAttestation: { customerId: oid(ids.customer), attestedAt: now, statement: 'Customer xác nhận đã chuyển hàng thực tế.' },
      source: [row('line-a', sourceCellId, 2, 6, 4), row('line-b', sourceCellId, 2, 4, 2)],
      destination: [row('line-a', destinationCellId, 2, 0, 2), row('line-b', destinationCellId, 2, 2, 4)] } });
  await assert.doesNotReject(movement.validate());
});

test('canonical MOVE replay carries lot ownership from source Reservation to destination Reservation', () => {
  const targetReservation = '507f1f77bcf86cd799439012';
  const dimensions = { widthM: .2, depthM: .2, heightM: .1 };
  const stockLine = (reservationId, cellId, quantity) => ({ lineId: 'line-1', ...(reservationId ? { reservationId: oid(reservationId) } : {}),
    itemSpecId: oid(ids.spec), receiptId: 'receipt-a', cellId: oid(cellId), quantity, quantityUnitSnapshot: 'thùng',
    unitWeightKgSnapshot: 5, unitVolumeM3Snapshot: .004, unitDimensionsSnapshot: dimensions,
    allocatedWeightKg: 5 * quantity, allocatedVolumeM3: .004 * quantity });
  const base = { itemId: oid(ids.sku), facilityId: oid(ids.facility), customerId: oid(ids.customer), schemaVersion: 4 };
  const add = { ...base, _id: oid(ids.source2), managedReservationId: oid(ids.reservation), performedAt: new Date('2026-01-01T00:00:00Z'), quantity: 5,
    actualTotalWeightKg: 25, actualTotalVolumeM3: .02, stockEffect: { action: 'ADD', operationId: 'add-1', requestHash: 'a'.repeat(64), ledgerRevision: 1, destination: [stockLine(null, ids.source, 5)] } };
  const move = { ...base, _id: oid(ids.destination2), managedReservationId: oid(ids.reservation), performedAt: new Date('2026-01-02T00:00:00Z'), quantity: 2,
    actualTotalWeightKg: 10, actualTotalVolumeM3: .008, stockEffect: { action: 'MOVE', operationId: 'move-1', requestHash: 'b'.repeat(64), ledgerRevision: 2,
      source: [stockLine(ids.reservation, ids.source, 2)], destination: [stockLine(targetReservation, ids.destination2, 2)] } };
  const result = replayManagedStockMovements([move, add]);
  assert.equal(result.lots.length, 2);
  assert.equal(result.lots.find(row => String(row.reservationId) === ids.reservation).quantityOnHand, 3);
  assert.equal(result.lots.find(row => String(row.reservationId) === targetReservation).quantityOnHand, 2);
});
