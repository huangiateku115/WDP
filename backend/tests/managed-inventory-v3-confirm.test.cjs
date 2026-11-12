const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Types } = mongoose;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Movement = require('../dist/models/inventory-items/item-movement.model').default;
const Projection = require('../dist/models/inventory-items/managed-v3-stock-projection.model').default;
const PhysicalUnit = require('../dist/models/inventory-items/managed-v3-physical-unit.model').default;
const Footprint = require('../dist/models/inventory-items/managed-v3-footprint.model').default;
const BatchPlacement = require('../dist/models/inventory-items/managed-v3-batch-placement.model').default;
const Topology = require('../dist/models/warehouse-map/managed-v3-topology-certification.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Session = require('../dist/models/access/managed-access-session.model').default;
const access = require('../dist/services/access/managed-access.service');
const { ManagedInventoryV3Service } = require('../dist/services/inventory-items/managed-inventory-v3.service');

const oid = () => new Types.ObjectId();
class Query {
  constructor(value) { this.value = value; }
  session() { return this; } lean() { return this; } sort() { return this; } select() { return this; }
  exec() { return Promise.resolve(this.value); }
}
const ids = { sku: oid(), reservation: oid(), customer: oid(), facility: oid(), session: oid(), cell1: oid(), cell2: oid(), rack: oid(), zone: oid(), unit: oid() };
const now = new Date();
const geometry = (cellId, xStartM = 0) => ({ cellId, xStartM, xEndM: xStartM + 1, yStartM: 0, yEndM: 1, usableHeightM: 1,
  maxWeightKg: 100, maxVolumeM3: 1, obstacles: [] });
let keySequence = 0;
const makeWorld = (t, { cells = [ids.cell1], capacity = 100, unitWeight = 10, unitDimensions = { widthM: .2, depthM: .2, heightM: .2 }, unitVolume = .008,
  topologyMaxVolume = 1, levelCapacity = 1000, existing = null, failProjection = false, accessFailure = null, staleInventory = false } = {}) => {
  const rack = { _id: ids.rack, facilityId: ids.facility, layoutVersion: 1, maxWeightKgPerLevel: 1000, operationalStatus: 'AVAILABLE', managedInventoryRevision: 0 };
  const cellDocs = cells.map((cellId, index) => ({ _id: cellId, facilityId: ids.facility, rackId: ids.rack, zoneId: ids.zone, levelNumber: 1,
    dimensions: { widthM: 1, depthM: 1, heightM: 1 }, maxWeightKg: capacity, usedWeightKg: 0, usedVolumeM3: 0, managedInventoryRevision: 0, allocationVersion: 1, operationalStatus: 'AVAILABLE' }));
  const cert = { _id: oid(), facilityId: ids.facility, rackId: ids.rack, levelNumber: 1, revision: 1, rackLayoutVersion: 1, managedInventoryRevision: 0,
    supportSurfaceId: 'surface-a', certificationState: 'CERTIFIED', certifiedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 3600000), certifiedBy: oid(), provenance: 'FACILITY_SURVEY',
    worldTransform: { origin: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, levelMaxWeightKg: levelCapacity,
    cells: cells.map((cellId, index) => ({ ...geometry(cellId, index), maxVolumeM3: topologyMaxVolume })) };
  const item = { _id: ids.sku, managedReservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility, inventorySchemaVersion: 3,
    managedV3Revision: 0, quantityUnit: 'box', toObject() { return { ...this }; } };
  let persistedItemRevision = 0;
  const reservation = { _id: ids.reservation, customerId: ids.customer, facilityId: ids.facility, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3,
    status: 'ACTIVE', startDate: new Date(now.getTime() - 60000), endDate: new Date(now.getTime() + 3600000), handoverAt: now,
    allocatedCellIds: cells, allocatedCapacity: 20, usedCapacityM3: 0, inventoryVersion: 0 };
  const allocations = cells.map(cellId => ({ reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility, cellId, status: 'OCCUPIED', startDate: new Date(now.getTime() - 60000), endDate: new Date(now.getTime() + 3600000) }));
  const unit = { _id: ids.unit, skuId: ids.sku, reservationId: ids.reservation, customerId: ids.customer, facilityId: ids.facility,
    state: 'PREPARED', revision: 0, serial: 'PU-1', weightKg: unitWeight, dimensionsM: unitDimensions, volumeM3: unitVolume, currentPose: null };
  const log = { movements: existing ? [existing] : [], projections: [], units: [], footprints: [], batches: [], cellAdds: 0, reservationAdds: 0, transactionAborted: false };
  const transaction = { withTransaction: async fn => { const snapshot = { ...log, movements: [...log.movements], projections: [...log.projections], units: [...log.units], footprints: [...log.footprints], batches: [...log.batches],
      cellRows: cellDocs.map(row => ({ ...row })), reservation: { ...reservation }, itemRevision: persistedItemRevision };
    try { return await fn(); } catch (error) { Object.assign(log, snapshot); cellDocs.forEach((row, index) => Object.assign(row, snapshot.cellRows[index]));
      Object.assign(reservation, snapshot.reservation); persistedItemRevision = snapshot.itemRevision; log.transactionAborted = true; throw error; } }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => transaction);
  t.mock.method(access, 'assertManagedAccessSessionScope', async input => { assert.equal(String(input.customerId), String(ids.customer)); assert.equal(String(input.reservationId), String(ids.reservation)); if (accessFailure) throw accessFailure; return { _id: ids.session }; });
  t.mock.method(Item, 'findOne', () => new Query({ ...item, managedV3Revision: persistedItemRevision, toObject() { return { ...this }; } }));
  t.mock.method(Item, 'findOneAndUpdate', filter => { if (staleInventory || filter.managedV3Revision !== persistedItemRevision) return new Query(null); persistedItemRevision += 1;
    return new Query({ ...item, managedV3Revision: persistedItemRevision, toObject() { return { ...this }; } }); });
  t.mock.method(Reservation, 'findOne', () => new Query(reservation));
  t.mock.method(Reservation, 'findOneAndUpdate', (_filter, update) => { log.reservationAdds += update.$inc.usedCapacityM3; reservation.usedCapacityM3 += update.$inc.usedCapacityM3; reservation.inventoryVersion += update.$inc.inventoryVersion; return new Query({ ...reservation }); });
  t.mock.method(Movement, 'findOne', filter => new Query(existing || log.movements.find(row => String(row.idempotencyKey) === String(filter.idempotencyKey)) || null));
  t.mock.method(Movement, 'create', async (rows) => { const created = rows.map(row => ({ ...row, _id: row._id || oid() })); log.movements.push(...created); return created; });
  t.mock.method(Movement, 'find', () => new Query(log.movements));
  t.mock.method(Allocation, 'find', filter => new Query(allocations.filter(row => !filter.cellId?.$in || filter.cellId.$in.some(value => String(value) === String(row.cellId)))));
  t.mock.method(Cell, 'find', filter => new Query(filter._id?.$in ? cellDocs.filter(row => filter._id.$in.some(value => String(value) === String(row._id))) : cellDocs));
  t.mock.method(Cell, 'updateOne', (filter, update) => { const row = cellDocs.find(value => String(value._id) === String(filter._id)); if (!row || row.managedInventoryRevision !== filter.managedInventoryRevision) return new Query({ matchedCount: 0 });
    row.usedWeightKg += update.$inc.usedWeightKg; row.usedVolumeM3 += update.$inc.usedVolumeM3; row.managedInventoryRevision += update.$inc.managedInventoryRevision; log.cellAdds += update.$inc.usedWeightKg; return new Query({ matchedCount: 1 }); });
  t.mock.method(Rack, 'find', () => new Query([rack]));
  t.mock.method(Rack, 'findOne', () => new Query(rack));
  t.mock.method(Rack, 'updateOne', () => new Query({ matchedCount: 1 }));
  t.mock.method(Topology, 'find', () => new Query([cert]));
  t.mock.method(Topology, 'updateOne', () => new Query({ matchedCount: 1 }));
  t.mock.method(Session, 'findOne', () => new Query({ _id: ids.session }));
  t.mock.method(PhysicalUnit, 'findOne', () => new Query(unit));
  t.mock.method(PhysicalUnit, 'updateOne', (_filter, update) => { log.units.push(update.$set); return new Query({ matchedCount: 1 }); });
  t.mock.method(Footprint, 'create', async rows => { log.footprints.push(...rows); return rows; });
  t.mock.method(BatchPlacement, 'create', async rows => { log.batches.push(...rows); return rows; });
  t.mock.method(Projection, 'findOne', () => new Query(log.projections.at(-1) || null));
  t.mock.method(Projection, 'create', async rows => { if (failProjection) throw Error('projection failure'); await new Projection(rows[0]).validate(); log.projections.push(rows[0]); return rows; });
  t.mock.method(Projection, 'updateOne', (_filter, update) => ({ exec: async () => { const next = new Projection(update.$set); await next.validate(); log.projections[log.projections.length - 1] = update.$set; return { matchedCount: 1 }; } }));
  return { item, reservation, cert, cellDocs, unit, log, get persistedItemRevision() { return persistedItemRevision; } };
};

const a1Request = (pose = { xStartM: .1, yStartM: .1, rotationDeg: 0 }) => ({ itemKind: 'A1_PHYSICAL_UNIT', accessSessionId: ids.session.toString(), sessionRevision: 1,
  physicalUnitId: ids.unit.toString(), cellIds: [ids.cell1.toString()], placements: [{ cellId: ids.cell1.toString() }], pose,
  topologyCertificationId: 'replace-cert', topologyRevision: 1, previewRevision: 0 });
const a2Request = (cells = [ids.cell1], quantities = [2]) => ({ itemKind: 'A2_BATCH', accessSessionId: ids.session.toString(), sessionRevision: 1,
  quantity: quantities.reduce((a, b) => a + b, 0), quantityUnit: 'box', actualUnitWeightKg: 1, dimensionsM: { widthM: .1, depthM: .1, heightM: .1 },
  cellIds: cells.map(String), placements: cells.map((cellId, index) => ({ cellId: String(cellId), quantity: quantities[index] })),
  topologyCertificationIds: ['replace-cert'], topologyRevisions: [1], previewRevision: 0 });

test('confirmInbound A1 persists the validated pose on Movement, PhysicalUnit and Footprint', async t => {
  const world = makeWorld(t); const payload = a1Request(); payload.topologyCertificationId = world.cert._id.toString();
  const preview = await ManagedInventoryV3Service.previewInbound(ids.sku.toString(), { itemKind: payload.itemKind, accessSessionId: payload.accessSessionId,
    physicalUnitId: payload.physicalUnitId, cellIds: payload.cellIds, pose: payload.pose }, { _id: ids.customer, role: 'CUSTOMER' });
  assert.deepEqual(preview.pose, payload.pose);
  payload.topologyCertificationId = preview.topologyCertificationId; payload.topologyRevision = preview.topologyRevision; payload.previewRevision = preview.previewRevision;
  const result = await ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), payload, { _id: ids.customer, role: 'CUSTOMER' }, 'a1-confirm-key');
  assert.equal(result.movement.v3Effect.destination[0].pose.xStartM, .1);
  assert.deepEqual(world.log.units[0].currentPose, payload.pose); assert.deepEqual(world.log.footprints[0].pose, payload.pose);
  assert.equal(result.projection.byPhysicalUnit[0].quantity, 1); assert.deepEqual(result.projection.byPhysicalUnit[0].pose, payload.pose);
});

test('confirmInbound A1 rejects missing pose before database access', async () => {
  const payload = a1Request(null); delete payload.pose;
  await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), payload, { _id: ids.customer, role: 'CUSTOMER' }, 'a1-no-pose'), error => error.code === 'A1_POSE_REQUIRED');
});

test('confirmInbound A1 rejects oversized dimensions, out-of-cell pose, obstacles and insufficient weight/volume', async t => {
  for (const scenario of [
    { dimensions: { widthM: 1.1, depthM: .2, heightM: .2 }, volume: .044, code: 'A1_GEOMETRY_INVALID' },
    { dimensions: { widthM: .2, depthM: 1.1, heightM: .2 }, volume: .044, code: 'A1_GEOMETRY_INVALID' },
    { dimensions: { widthM: .2, depthM: .2, heightM: 1.1 }, volume: .044, code: 'A1_GEOMETRY_INVALID' },
    { pose: { xStartM: .9, yStartM: .1, rotationDeg: 0 }, code: 'A1_GEOMETRY_INVALID' },
    { weight: 101, code: 'A1_GEOMETRY_INVALID' },
    { weight: 10, levelCapacity: 5, code: 'A1_GEOMETRY_INVALID' },
    { volume: .008, maxVolume: .005, code: 'A1_GEOMETRY_INVALID' },
  ]) await t.test(`rejects ${scenario.pose ? 'out-of-cell pose' : scenario.dimensions?.heightM > 1 ? 'oversized height' : scenario.dimensions?.depthM > 1 ? 'oversized depth' : scenario.dimensions ? 'oversized width' : scenario.levelCapacity ? 'level capacity' : scenario.weight ? 'weight capacity' : 'volume capacity'}`, async t => {
    const world = makeWorld(t, { unitWeight: scenario.weight ?? 10, levelCapacity: scenario.levelCapacity ?? 1000,
      unitDimensions: scenario.dimensions ?? { widthM: .2, depthM: .2, heightM: .2 }, unitVolume: scenario.volume ?? .008, topologyMaxVolume: scenario.maxVolume ?? 1 });
    const payload = a1Request(scenario.pose); payload.topologyCertificationId = world.cert._id.toString();
    await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), payload, { _id: ids.customer, role: 'CUSTOMER' }, `a1-invalid-${++keySequence}-key`), error => error.code === scenario.code);
  });
  await t.test('rejects obstacle collision', async t => {
    const world = makeWorld(t); world.cert.cells[0].obstacles = [{ xStartM: .15, xEndM: .25, yStartM: .15, yEndM: .25 }];
    const payload = a1Request(); payload.topologyCertificationId = world.cert._id.toString();
    await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), payload, { _id: ids.customer, role: 'CUSTOMER' }, 'a1-obstacle-key'), error => error.code === 'A1_GEOMETRY_INVALID');
  });
});

test('confirmInbound A1 multi-Cell stays blocked and stale topology fails closed', async t => {
  await t.test('multi-Cell is fail-closed', async t => {
    const world = makeWorld(t, { cells: [ids.cell1, ids.cell2] });
    const multi = a1Request(); multi.cellIds = [ids.cell1.toString(), ids.cell2.toString()]; multi.placements.push({ cellId: ids.cell2.toString() }); multi.topologyCertificationId = world.cert._id.toString();
    await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), multi, { _id: ids.customer, role: 'CUSTOMER' }, 'a1-multi-key'), error => error.code === 'A1_LOAD_SHARING_UNCERTIFIED');
  });
  await t.test('stale topology is rejected', async t => {
    const world = makeWorld(t); const stale = a1Request(); stale.topologyCertificationId = oid().toString();
    await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), stale, { _id: ids.customer, role: 'CUSTOMER' }, 'a1-stale-key'), error => error.code === 'STALE_TOPOLOGY');
  });
});

test('confirmInbound A2 first and repeated operations accept split Cells and preserve replay projection totals', async t => {
  const world = makeWorld(t, { cells: [ids.cell1, ids.cell2] });
  const payload = a2Request([ids.cell1, ids.cell2], [2, 3]); payload.actualUnitWeightKg = .3333;
  payload.dimensionsM = { widthM: .123, depthM: .1, heightM: .1 }; payload.topologyCertificationIds = [world.cert._id.toString()];
  const first = await ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), payload, { _id: ids.customer, role: 'CUSTOMER' }, 'a2-first-inbound');
  assert.equal(first.projection.onHandQuantity, 5); assert.equal(first.projection.byBatch.length, 2); assert.equal(first.projection.byCell.length, 2);
  assert.equal(first.projection.totalWeightKg, 1.667); assert.equal(first.projection.totalVolumeM3, .00615);
  assert.equal(world.log.batches.length, 2);
  const repeat = a2Request([ids.cell1, ids.cell2], [1, 1]); repeat.actualUnitWeightKg = .3333;
  repeat.dimensionsM = { widthM: .123, depthM: .1, heightM: .1 }; repeat.topologyCertificationIds = [world.cert._id.toString()]; repeat.previewRevision = 1;
  const second = await ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), repeat, { _id: ids.customer, role: 'CUSTOMER' }, 'a2-second-inbound');
  assert.equal(second.projection.onHandQuantity, 7); assert.equal(second.projection.ledgerRevision, 2); assert.equal(second.projection.byBatch.length, 4);
  assert.equal(second.projection.totalWeightKg, 2.334); assert.equal(second.projection.totalVolumeM3, .00861);
  assert.equal(world.log.movements.length, 2); assert.equal(world.log.batches.length, 4);
});

test('same Idempotency-Key exact replay returns original movement; changed payload conflicts', async t => {
  const payload = a2Request(); const { v3RequestHash } = require('../dist/services/inventory-items/managed-inventory-v3-ledger.service');
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const prior = { _id: oid(), schemaVersion: 3, v3Effect: { requestHash: v3RequestHash(canonical(payload)) } };
  const world = makeWorld(t, { existing: prior });
  const replay = await ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), payload, { _id: ids.customer, role: 'CUSTOMER' }, 'a2-replay-key');
  assert.equal(replay.replayed, true); assert.equal(replay.movement, prior);
  await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), { ...payload, quantity: 9 }, { _id: ids.customer, role: 'CUSTOMER' }, 'a2-replay-key'), error => error.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(world.log.movements.length, 1);
});

test('invalid/revoked Access Session and stale inventory revision block writes', async t => {
  await t.test('invalid/revoked Session is rejected', async t => {
    const sessionError = Error('session invalid'); sessionError.status = 409; sessionError.code = 'ACCESS_SESSION_SCOPE_INVALID';
    const world = makeWorld(t, { accessFailure: sessionError });
    await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), a2Request(), { _id: ids.customer, role: 'CUSTOMER' }, 'invalid-session'), error => error.code === 'ACCESS_SESSION_SCOPE_INVALID');
    assert.equal(world.log.movements.length, 0);
  });
  await t.test('stale inventory revision is rejected', async t => {
    const staleWorld = makeWorld(t, { staleInventory: true });
    await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), a2Request(), { _id: ids.customer, role: 'CUSTOMER' }, 'stale-inventory'), error => error.code === 'STALE_INVENTORY_REVISION');
    assert.equal(staleWorld.log.movements.length, 0);
  });
});

test('projection write failure rolls back the mocked ADD transaction effects', async t => {
  const world = makeWorld(t, { failProjection: true });
  const payload = a2Request(); payload.topologyCertificationIds = [world.cert._id.toString()];
  await assert.rejects(ManagedInventoryV3Service.confirmInbound(ids.sku.toString(), payload, { _id: ids.customer, role: 'CUSTOMER' }, 'rollback-key'), /projection failure/);
  assert.equal(world.log.transactionAborted, true); assert.equal(world.log.movements.length, 0); assert.equal(world.log.batches.length, 0);
  assert.equal(world.cellDocs[0].usedWeightKg, 0); assert.equal(world.cellDocs[0].usedVolumeM3, 0);
  assert.equal(world.reservation.usedCapacityM3, 0); assert.equal(world.persistedItemRevision, 0);
});
