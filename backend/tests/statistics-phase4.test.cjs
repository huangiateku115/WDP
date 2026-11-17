'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeManagedCapacityV4Fixture, resolveV4ReconciliationStatus, resolveSkuStockUsageStatus, mergeFacilityUsageStatus, mergeSkuCellUsage } = require('../dist/services/statistics/statistics-phase2.service');
const { summarizeManagedMovementFixtures, buildManagedMovementPipeline } = require('../dist/services/statistics/statistics-phase3.service');
const { summarizeFacilityManagedOperations } = require('../dist/services/statistics/statistics-phase4.service');

test('skuStock replay evidence is interpreted separately from its legacy UNKNOWN reconciliation convention', () => {
  assert.equal(resolveSkuStockUsageStatus('NOT_REQUIRED', 'NOT_REQUIRED'), 'NOT_REQUIRED');
  assert.equal(resolveSkuStockUsageStatus('REPLAYED', 'REPLAYED'), 'REPLAYED');
  assert.equal(resolveSkuStockUsageStatus('REPLAYED', 'UNKNOWN'), 'REPLAYED');
  assert.equal(resolveSkuStockUsageStatus('MISMATCH', 'UNKNOWN'), 'MISMATCH');
  assert.equal(resolveSkuStockUsageStatus('UNKNOWN', 'UNKNOWN'), 'UNKNOWN'); // stale projection / orphan / legacy history
  assert.equal(mergeFacilityUsageStatus('REPLAYED', 'UNKNOWN'), 'UNKNOWN');
  assert.equal(mergeFacilityUsageStatus('UNKNOWN', 'REPLAYED'), 'UNKNOWN');
  assert.equal(mergeFacilityUsageStatus('UNKNOWN', 'MISMATCH'), 'MISMATCH');
  assert.equal(mergeFacilityUsageStatus('NOT_REQUIRED', 'REPLAYED'), 'REPLAYED');
});

test('V4 managed capacity fails closed for unknown/mismatched facilities and confirms per-facility reconciliation', () => {
  assert.deepEqual(resolveV4ReconciliationStatus(['NOT_REQUIRED', 'REPLAYED']), { status: 'RECONCILED', complete: true });
  assert.deepEqual(resolveV4ReconciliationStatus(['REPLAYED', 'UNKNOWN']), { status: 'UNKNOWN', complete: false });
  assert.deepEqual(resolveV4ReconciliationStatus(['MISMATCH']), { status: 'MISMATCH', complete: false });
  const result = summarizeManagedCapacityV4Fixture({
    facilityIds: ['F1', 'F2'], reconciliationByFacility: new Map([['F1', 'REPLAYED'], ['F2', 'UNKNOWN']]),
    cells: [{ _id: 'C1', facilityId: 'F1', zoneId: 'Z1', rackId: 'R1', operationalStatus: 'AVAILABLE', parentOperational: true,
      maxWeightKg: 100, dimensions: { widthM: 2, depthM: 2, usableHeightM: 2 } }],
    usageByCell: new Map([['C1', { facilityId: 'F1', quantityOnHand: 1, quantityHeld: 0, quantityAvailable: 1, weightKg: 5, volumeM3: 1 }]]),
  });
  assert.equal(result.facilityRows.find(row => row.facilityId === 'F1').usedWeightKg, 5);
  assert.equal(result.facilityRows.find(row => row.facilityId === 'F2').usedWeightKg, null);
  assert.equal(result.global.usedWeightKg, null);
  assert.equal(result.reconciliationStatus, 'UNKNOWN');
  assert.equal(result.dataComplete, false);
});

test('orphan V4 cell usage suppresses facility usage and missing usable height suppresses volume capacity', () => {
  const result = summarizeManagedCapacityV4Fixture({
    facilityIds: ['F'], reconciliationByFacility: new Map([['F', 'REPLAYED']]),
    cells: [{ _id: 'C', facilityId: 'F', zoneId: 'Z', rackId: 'R', operationalStatus: 'AVAILABLE', parentOperational: true,
      maxWeightKg: 20, dimensions: { widthM: 1, depthM: 1 } }],
    usageByCell: new Map([['ORPHAN', { facilityId: 'F', quantityOnHand: 1, weightKg: 2, volumeM3: 1 }]]),
  });
  const facility = result.facilityRows[0];
  assert.equal(facility.usedWeightKg, null);
  assert.equal(facility.capacityVolumeM3, null);
  assert.equal(facility.volumeUtilizationRate, null);
  assert.equal(result.dataComplete, false);
  const orphanFacility = summarizeManagedCapacityV4Fixture({
    facilityIds: ['F'], reconciliationByFacility: new Map([['F', 'REPLAYED']]),
    cells: [{ _id: 'C2', facilityId: 'DELETED-FACILITY', zoneId: 'Z', rackId: 'R', operationalStatus: 'AVAILABLE', parentOperational: true,
      maxWeightKg: 20, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } }], usageByCell: new Map(),
  });
  assert.equal(orphanFacility.reconciliationStatus, 'UNKNOWN');
  assert.equal(orphanFacility.dataComplete, false);
});

test('managed capacity handles reserved/available Cells and has no twelve-Facility presentation cap', () => {
  const facilityIds = Array.from({ length: 15 }, (_, index) => `F${index + 1}`);
  const cells = [
    { _id: 'HELD', facilityId: 'F1', zoneId: 'Z', rackId: 'R', operationalStatus: 'AVAILABLE', parentOperational: true,
      maxWeightKg: 25, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } },
    { _id: 'FREE', facilityId: 'F1', zoneId: 'Z', rackId: 'R', operationalStatus: 'AVAILABLE', parentOperational: true,
      maxWeightKg: 25, dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } },
  ];
  const result = summarizeManagedCapacityV4Fixture({ facilityIds, cells, usageByCell: new Map(), activeAllocationCellIds: new Set(['HELD']),
    reconciliationByFacility: new Map(facilityIds.map(facilityId => [facilityId, 'NOT_REQUIRED'])) });
  const first = result.facilityRows.find(row => row.facilityId === 'F1');
  assert.equal(first.reservedCells, 1);
  assert.equal(first.availableCells, 1);
  assert.equal(result.facilityRows.length, 15);
  assert.equal(result.facilityRows.at(-1).totalCells, 0);
});

test('verified SKU Cell footprints sum across SKUs without double-counting Instance allocation weight or volume', () => {
  const usageByCell = new Map();
  const conflictsA = mergeSkuCellUsage(usageByCell, 'F1', [
    { cellId: 'C1', quantityOnHand: 6, weightKg: 11, volumeM3: 2.2 },
    { cellId: 'C2', quantityOnHand: 1, weightKg: 1, volumeM3: 0.2 },
  ]); // batch quantity 5 + one Instance allocated across two Cells
  const conflictsB = mergeSkuCellUsage(usageByCell, 'F1', [{ cellId: 'C1', quantityOnHand: 2, weightKg: 4, volumeM3: 0.4 }]);
  assert.equal(conflictsA.size, 0);
  assert.equal(conflictsB.size, 0);
  const summary = summarizeManagedCapacityV4Fixture({
    facilityIds: ['F1'], reconciliationByFacility: new Map([['F1', mergeFacilityUsageStatus(mergeFacilityUsageStatus('NOT_REQUIRED', resolveSkuStockUsageStatus('REPLAYED','UNKNOWN')), resolveSkuStockUsageStatus('REPLAYED','REPLAYED'))]]),
    cells: [
      { _id: 'C1', facilityId: 'F1', zoneId: 'Z', rackId: 'R', operationalStatus: 'AVAILABLE', parentOperational: true, maxWeightKg: 100, dimensions: { widthM: 1, depthM: 1, usableHeightM: 2 } },
      { _id: 'C2', facilityId: 'F1', zoneId: 'Z', rackId: 'R', operationalStatus: 'AVAILABLE', parentOperational: true, maxWeightKg: 100, dimensions: { widthM: 1, depthM: 1, usableHeightM: 2 } },
    ], usageByCell,
  });
  const facility = summary.facilityRows[0];
  assert.equal(facility.reconciliationStatus, 'REPLAYED');
  assert.equal(facility.usedWeightKg, 16);
  assert.equal(Math.round(facility.usedVolumeM3 * 1e6) / 1e6, 2.8);
  assert.equal(facility.weightUtilizationRate, 8);
  assert.equal(facility.volumeUtilizationRate, 70);
});

test('Facilities KPI groups every action per Facility and scopes away other Facilities', () => {
  const sourceRows = [
    { facilityId: 'F1', action: 'ADD', operationCount: 10, weightKg: 20, volumeM3: 3 },
    { facilityId: 'F1', action: 'REMOVE', operationCount: 6, weightKg: 12, volumeM3: 2 },
    { facilityId: 'F1', action: 'MOVE', operationCount: 4, weightKg: 8, volumeM3: 1 },
    { facilityId: 'F2', action: 'ADD', operationCount: 3, weightKg: 5, volumeM3: 1 },
    { facilityId: 'F2', action: 'MOVE', operationCount: 1, weightKg: 2, volumeM3: 0.5 },
  ];
  const all = summarizeFacilityManagedOperations(sourceRows, ['F1', 'F2', 'F3']);
  assert.equal(all.get('F1').inboundOperations, 10);
  assert.equal(all.get('F1').outboundOperations, 6);
  assert.equal(all.get('F1').relocationOperations, 4);
  assert.equal(all.get('F1').totalCommittedOperations, 20);
  assert.equal(all.get('F2').totalCommittedOperations, 4);
  assert.equal(all.get('F3').totalCommittedOperations, 0);
  assert.equal(all.get('F1').weightByAction.MOVE, 8); // source-side weight once
  const managerF1 = summarizeFacilityManagedOperations(sourceRows, ['F1']);
  assert.deepEqual([...managerF1.keys()], ['F1']);
});

test('V4 operation fixture counts batch 5 plus one instance allocated across two Cells as quantity 6', () => {
  const common = { itemSpecId: 'SPEC', receiptId: 'RECEIPT', reservationId: 'RES', quantityUnitSnapshot: 'BOX' };
  const batch = { ...common, cellId: 'C1', quantity: 5, allocatedWeightKg: 10, allocatedVolumeM3: 2 };
  const instance1 = { ...common, cellId: 'C1', itemInstanceId: 'INSTANCE', quantity: 1, allocatedWeightKg: 1, allocatedVolumeM3: 0.2 };
  const instance2 = { ...common, cellId: 'C2', itemInstanceId: 'INSTANCE', quantity: 1, allocatedWeightKg: 1, allocatedVolumeM3: 0.2 };
  const movement = { _id: 'MOVEMENT', itemId: 'SKU', facilityId: 'FAC', schemaVersion: 4, operationId: 'OP', performedAt: new Date('2026-11-01T00:00:00Z'), quantity: 6,
    actualTotalWeightKg: 12, actualTotalVolumeM3: 2.4, stockEffect: { action: 'ADD', operationId: 'OP', source: [], destination: [batch, instance1, instance2] } };
  const result = summarizeManagedMovementFixtures([movement]);
  assert.equal(result.operationsByItemSpecification[0].quantityByUnit.BOX, 6);
  assert.equal(result.operationsByItemSpecification[0].weightKg, 12);
  assert.equal(result.operationsByItemSpecification[0].volumeM3, 2.4);
  assert.equal(result.operationsByItemSpecification[0].operationCount, 1);
  const pipeline = buildManagedMovementPipeline({ from: new Date('2026-10-31'), toExclusive: new Date('2026-11-02') }, { type: 'ALL' });
  assert.ok(pipeline.some(stage => stage.$set && stage.$set._instanceIds && stage.$set._batchQuantity), 'aggregation uses unique Instance ids plus batch quantity');
});
