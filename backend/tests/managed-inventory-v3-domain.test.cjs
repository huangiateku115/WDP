const { test } = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../dist/services/inventory-items/managed-inventory-v3-domain.service');
const scope = { skuId: 'sku', reservationId: 'res', customerId: 'cus', facilityId: 'fac' };
const now = new Date('2026-11-12T12:00:00Z');
function cell(cellId, xStartM, xEndM, extra = {}) { return { cellId, facilityId: 'fac', rackId: 'rack', levelNumber: 1,
  supportSurfaceId: 'surface-1', xStartM, xEndM, yStartM: 0, yEndM: 1, usableHeightM: 1,
  certified: true, certificationState:'CERTIFIED', certificationRevision: 7, certifiedAt: new Date('2026-10-01'), expiresAt: new Date('2027-01-01'), certifiedBy:'synthetic-fixture', provenance:'SYNTHETIC_TEST_FIXTURE', transformRevision:7, worldTransform:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]}, obstacles: [],
  maxWeightKg: 100, usedWeightKg: 0, maxVolumeM3: 1, usedVolumeM3: 0, ...extra }; }
function a1(overrides = {}) { return { scope, physicalUnit: { ...scope, weightKg: 50, dimensionsM: { widthM: 1.9, depthM: .5, heightM: .5 }, volumeM3: .475, pose:{xStartM:0,yStartM:0,rotationDeg:0} },allowSyntheticFixtures:true,
  cells: [cell('c1', 0, 1), cell('c2', 1, 2)], supports: [{ cellId: 'c1', reactionKg: 25, occupiedVolumeM3: .25 }, { cellId: 'c2', reactionKg: 25, occupiedVolumeM3: .225 }],
  level: { facilityId: 'fac', rackId: 'rack', levelNumber: 1, maxWeightKg: 200, usedWeightKg: 100, certificationRevision: 7 },
  allocatedCellIds: ['c1', 'c2'], now, ...overrides }; }

test('V3 registration permits preparation at CHECKIN_READY without stock and active in-term rental', () => {
  assert.deepEqual(domain.validateV3Registration({ bookingFlowVersion: 3, status: 'CHECKIN_READY', startDate: now, endDate: new Date('2026-12-01'), hasAllocation: true }, now), { mayPrepareSku: true, mayRecordStock: false });
  assert.equal(domain.validateV3Registration({ bookingFlowVersion: 3, status: 'ACTIVE', startDate: new Date('2026-11-01'), endDate: new Date('2026-12-01'), hasAllocation: true }, now).mayRecordStock, true);
  assert.throws(() => domain.validateV3Registration({ bookingFlowVersion: 2, status: 'DEPOSIT_PAID', startDate: now, endDate: new Date('2026-12-01'), hasAllocation: true }, now), /V3 reservation/);
  assert.throws(() => domain.validateV3Registration({ bookingFlowVersion: 3, status: 'CHECKIN_READY', startDate: now, endDate: new Date('2026-12-01'), hasAllocation: false }, now), /allocation/);
});

test('A1 contiguous certified footprint conserves one PhysicalUnit quantity, weight and volume', () => {
  assert.deepEqual(domain.validateA1Footprint(a1()), { quantity: 1, cellIds: ['c1', 'c2'], totalWeightKg: 50, totalVolumeM3: .475 });
  assert.throws(() => domain.validateA1Footprint({...a1(),allowSyntheticFixtures:false}),/certification/);
});
test('A1 fails closed on non-adjacent, cross-rack, uncertified, expired, future or out-of-allocation Cells', () => {
  assert.throws(() => domain.validateA1Footprint(a1({ cells: [cell('c1', 0, 1), cell('c2', 1.02, 2)] })), /continuous/);
  assert.throws(() => domain.validateA1Footprint(a1({ cells: [cell('c1', 0, 1), cell('c2', 1, 2, { rackId: 'rack2' })] })), /Facility, Rack/);
  assert.throws(() => domain.validateA1Footprint(a1({ cells: [cell('c1', 0, 1, { certified: false }), cell('c2', 1, 2)] })), /certification/);
  assert.throws(() => domain.validateA1Footprint(a1({ cells: [cell('c1', 0, 1, { certifiedAt: new Date('2026-12-01') }), cell('c2', 1, 2)] })), /certification/);
  assert.throws(() => domain.validateA1Footprint(a1({ cells: [cell('c1', 0, 1, { expiresAt: now }), cell('c2', 1, 2)] })), /certification/);
  assert.throws(() => domain.validateA1Footprint(a1({ allocatedCellIds: ['c1'] })), /outside/);
  assert.throws(() => domain.validateA1Footprint(a1({physicalUnit:{...a1().physicalUnit,dimensionsM:{widthM:.5,depthM:.5,heightM:.5},volumeM3:.125},supports:[{cellId:'c1',reactionKg:25,occupiedVolumeM3:.0625},{cellId:'c2',reactionKg:25,occupiedVolumeM3:.0625}]})),/does not physically occupy every/);
});
test('A1 enforces per-Cell reactions, level capacity, obstacle, dimensions and canonical load conservation', () => {
  assert.throws(() => domain.validateA1Footprint(a1({ supports: [{ cellId: 'c1', reactionKg: 60, occupiedVolumeM3: .25 }, { cellId: 'c2', reactionKg: -10, occupiedVolumeM3: .225 }] })), /support load|support reactions/);
  assert.throws(() => domain.validateA1Footprint(a1({ supports: [{ cellId: 'c1', reactionKg: 40, occupiedVolumeM3: .25 }, { cellId: 'c2', reactionKg: 10, occupiedVolumeM3: .225 }], cells: [cell('c1', 0, 1, { maxWeightKg: 30 }), cell('c2', 1, 2)] })), /Cell capacity/);
  assert.throws(() => domain.validateA1Footprint(a1({ level: { facilityId: 'fac', rackId: 'rack', levelNumber: 1, maxWeightKg: 120, usedWeightKg: 100, certificationRevision: 7 } })), /level capacity/);
  assert.throws(() => domain.validateA1Footprint(a1({ cells: [cell('c1', 0, 1, { obstacles: [{ xStartM: .2, xEndM: .3, yStartM: 0, yEndM: .5 }] }), cell('c2', 1, 2)] })), /obstacle/);
  assert.throws(() => domain.validateA1Footprint(a1({ physicalUnit: { ...scope, weightKg: 50, dimensionsM: { widthM: 3, depthM: .5, heightM: .5 }, volumeM3: .475 } })), /dimensions/);
  assert.throws(() => domain.validateA1Footprint(a1({physicalUnit:{...a1().physicalUnit,volumeM3:.4}})),/volume must match/);
  assert.throws(() => domain.validateA1Footprint(a1({physicalUnit:{...a1().physicalUnit,pose:{xStartM:0,yStartM:0,rotationDeg:45}}})),/pose/);
  assert.throws(() => domain.validateA1Footprint(a1({cells:[cell('c1',0,1,{provenance:''}),cell('c2',1,2)]})),/certification/);
});

test('A2 placement reconciles batch quantities across separate allocated Cells', () => {
  const expectedBatches = [{ batchId: 'b1', quantity: 7, weightKg: 70, volumeM3: .7 }, { batchId: 'b2', quantity: 3, weightKg: 30, volumeM3: .3 }];
  const placements = [
    { ...scope, batchId: 'b1', cellId: 'c1', quantity: 4, weightKg: 40, volumeM3: .4 },
    { ...scope, batchId: 'b1', cellId: 'c2', quantity: 3, weightKg: 30, volumeM3: .3 },
    { ...scope, batchId: 'b2', cellId: 'c3', quantity: 3, weightKg: 30, volumeM3: .3 },
  ];
  const options={scope,expectedBatches,placements,allocatedCellIds:['c1','c2','c3'],cellCapacity:['c1','c2','c3'].map(cellId=>({cellId,usedWeightKg:0,maxWeightKg:100,usedVolumeM3:0,maxVolumeM3:1}))};
  assert.deepEqual(domain.validateA2BatchPlacements(options), { totalQuantity: 10, batchCount: 2 });
  assert.throws(() => domain.validateA2BatchPlacements({...options,expectedBatches:[...expectedBatches,{batchId:'b1',quantity:1,weightKg:1,volumeM3:.1}]}), /unique/);
  assert.throws(() => domain.validateA2BatchPlacements({...options,placements:[{...placements[0],customerId:'other'},...placements.slice(1)]}), /scope mismatch/);
  assert.throws(() => domain.validateA2BatchPlacements({...options,placements:[{...placements[0],cellId:'other'},...placements.slice(1)]}), /outside/);
  assert.throws(() => domain.validateA2BatchPlacements({...options,placements:[placements[0],placements[0],...placements.slice(1)]}), /Duplicate/);
  assert.throws(() => domain.validateA2BatchPlacements({...options,cellCapacity:[{cellId:'c1',usedWeightKg:95,maxWeightKg:100,usedVolumeM3:0,maxVolumeM3:1},...options.cellCapacity.slice(1)]}),/capacity.*exceeded/);
  assert.throws(() => domain.validateA2BatchPlacements({...options,cellCapacity:options.cellCapacity.filter(c=>c.cellId!=='c1')}),/capacity evidence is missing/);
});

test('V3 schemas expose explicit inventory version, ownership indexes and optimistic revisions', () => {
  const Sku = require('../dist/models/inventory-items/inventory-item.model').default;
  const PhysicalUnit = require('../dist/models/inventory-items/managed-v3-physical-unit.model').default;
  const Footprint = require('../dist/models/inventory-items/managed-v3-footprint.model').default;
  const Placement = require('../dist/models/inventory-items/managed-v3-batch-placement.model').default;
  const Topology = require('../dist/models/warehouse-map/managed-v3-topology-certification.model').default;
  assert.equal(Sku.schema.path('inventorySchemaVersion').options.immutable, true);
  assert.equal(PhysicalUnit.schema.options.optimisticConcurrency, true);
  assert.equal(Footprint.schema.options.optimisticConcurrency, true);
  assert.equal(Placement.schema.options.optimisticConcurrency, true);
  assert.ok(PhysicalUnit.schema.indexes().some(([keys, options]) => keys.reservationId && keys.serial && options.unique));
  assert.ok(Footprint.schema.indexes().some(([keys, options]) => keys.physicalUnitId && options.unique));
  assert.ok(Placement.schema.indexes().some(([keys, options]) => keys.skuId && keys.batchId && keys.cellId && options.unique));
  assert.ok(Topology.schema.path('certifiedBy'));
  assert.ok(Topology.schema.path('worldTransform.origin'));
});
