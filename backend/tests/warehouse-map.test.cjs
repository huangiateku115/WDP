const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'production', MONGO_URL: 'mongodb+srv://cluster.example.invalid/test',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const Facility = require('../dist/models/facilities/facility.model').default;
const Zone = require('../dist/models/warehouse-map/warehouse-zone.model').default;
const Rack = require('../dist/models/warehouse-map/warehouse-rack.model').default;
const Cell = require('../dist/models/warehouse-map/warehouse-cell.model').default;
const { WarehouseMapService: service } = require('../dist/services/warehouse-map/warehouse-map.service');
const {
  parseRackCreate, parseCellUpdate, parseList, WarehouseMapError,
} = require('../dist/services/warehouse-map/warehouse-map.validation');

const facilityId = '507f1f77bcf86cd799439011';
const zoneId = '507f1f77bcf86cd799439012';
const rackId = '507f1f77bcf86cd799439013';
const cellId = '507f1f77bcf86cd799439014';
const userId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439015');
const oid = value => new mongoose.Types.ObjectId(value);
const actor = (role = 'ADMIN', assigned = facilityId) => ({ _id: userId, role, assignedFacilityId: assigned ? oid(assigned) : null });
const facility = (overrides = {}) => new Facility({
  _id: oid(facilityId), code: 'MI-01', name: 'Managed Inventory',
  address: { line1: '1 Test Road', city: 'HCM', country: 'VN' },
  serviceTypes: ['MANAGED_INVENTORY'], status: 'ACTIVE', ...overrides,
});
const zone = (overrides = {}) => new Zone({
  _id: oid(zoneId), facilityId: oid(facilityId), code: 'A', name: 'Zone A', isActive: true, ...overrides,
});
const rack = (overrides = {}) => new Rack({
  _id: oid(rackId), facilityId: oid(facilityId), zoneId: oid(zoneId), aisleCode: 'R1', rackCode: 'R1-01',
  dimensions: { widthM: 2, depthM: 0.6, heightM: 2 }, levelCount: 4, cellsPerLevel: 4,
  maxWeightKgPerLevel: 500, mapX: 0, mapY: 0, orientation: 0, operationalStatus: 'AVAILABLE', layoutVersion: 0,
  ...overrides,
});
const cell = (levelNumber, cellNumber, overrides = {}) => new Cell({
  _id: new mongoose.Types.ObjectId(), facilityId: oid(facilityId), zoneId: oid(zoneId), rackId: oid(rackId),
  levelNumber, cellNumber, code: `R1-01-L${levelNumber}-C${cellNumber}`,
  dimensions: { widthM: 0.5, depthM: 0.6 }, maxWeightKg: 125, operationalStatus: 'AVAILABLE', ...overrides,
});

class Query {
  constructor(value) { this.value = value; }
  session(session) { this.txSession = session; return this; }
  select() { return this; }
  sort() { return this; }
  skip() { return this; }
  limit() { return this; }
  lean() { return this; }
  exec() { return Promise.resolve(this.value); }
}
function mockTransaction(t, options = {}) {
  const state = { session: {}, started: 0, ended: 0, aborted: false };
  state.session.withTransaction = async callback => {
    state.started += 1;
    try { return await callback(); }
    catch (error) { state.aborted = true; throw error; }
  };
  state.session.endSession = async () => { state.ended += 1; };
  t.mock.method(mongoose, 'startSession', async () => state.session);
  if (options.facility !== false) t.mock.method(Facility, 'findOne', () => new Query(options.facilityValue ?? facility()));
  return state;
}
function mockRestoreRackModels(t, parentValue) {
  const tx = mockTransaction(t);
  t.mock.method(Rack, 'findOne', () => new Query(rack({ deletedAt: new Date(), deletedBy: userId })));
  t.mock.method(Zone, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(String(filter._id), zoneId);
    assert.equal(String(filter.facilityId), facilityId);
    assert.equal(filter.isActive, true);
    assert.deepEqual(filter.deletedAt, { $exists: false });
    assert.deepEqual(update.$inc, { structureVersion: 1 });
    assert.equal(options.session, tx.session);
    return new Query(parentValue);
  });
  return tx;
}
const createRackInput = (overrides = {}) => ({
  facilityId, zoneId, aisleCode: 'aisle-1', rackCode: 'rack-1', mapX: 2, mapY: 3, ...overrides,
});

test('MI-01 models define unique stable code, cell-position and active map-coordinate indexes', () => {
  const index = (Model, predicate) => Model.schema.indexes().find(([keys, options]) => predicate(keys, options));
  assert.ok(index(Zone, (keys, options) => keys.facilityId === 1 && keys.code === 1 && options.unique));
  assert.ok(index(Rack, (keys, options) => keys.facilityId === 1 && keys.rackCode === 1 && options.unique));
  assert.ok(index(Rack, (keys, options) => keys.zoneId === 1 && keys.aisleCode === 1 && keys.mapX === 1 && keys.mapY === 1 && options.unique));
  assert.ok(index(Cell, (keys, options) => keys.rackId === 1 && keys.levelNumber === 1 && keys.cellNumber === 1 && options.unique));
  assert.ok(index(Cell, (keys, options) => keys.facilityId === 1 && keys.code === 1 && options.unique));
});

test('rack defaults are 2m x 0.6m x 2m, 4x4, 500kg per level, 125kg per cell', () => {
  const parsed = parseRackCreate(createRackInput());
  assert.deepEqual(parsed.dimensions, { widthM: 2, depthM: 0.6, heightM: 2 });
  assert.equal(parsed.levelCount, 4);
  assert.equal(parsed.cellsPerLevel, 4);
  assert.equal(parsed.maxWeightKgPerLevel, 500);
  assert.deepEqual(parsed.cellCapacitiesKg, Array.from({ length: 4 }, () => [125, 125, 125, 125]));
  assert.equal(parsed.levelCount * parsed.maxWeightKgPerLevel, 2000);
  assert.equal(parsed.usableHeightMByLevel, undefined, 'nominal rack height is not treated as usable tier clearance');
});

test('rack create transaction generates the complete stable 4x4 cell layout', async t => {
  const tx = mockTransaction(t);
  t.mock.method(Zone, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.isActive, true); assert.deepEqual(update.$inc, { structureVersion: 1 }); assert.equal(options.session, tx.session);
    return new Query(zone({ structureVersion: 1 }));
  });
  t.mock.method(Rack.prototype, 'save', async function (options) { assert.equal(options.session, tx.session); return this; });
  let written;
  t.mock.method(Cell, 'insertMany', async (rows, options) => {
    assert.equal(options.session, tx.session); written = rows; return rows.map(row => new Cell(row));
  });
  const result = await service.createRack(createRackInput(), actor('FACILITY_MANAGER'));
  assert.equal(tx.started, 1);
  assert.equal(tx.ended, 1);
  assert.equal(written.length, 16);
  assert.equal(result.cells.length, 16);
  assert.equal(result.rack.maxWeightKg, 2000);
  assert.deepEqual(written.slice(0, 4).map(row => row.code), [
    'RACK-1-L1-C1', 'RACK-1-L1-C2', 'RACK-1-L1-C3', 'RACK-1-L1-C4',
  ]);
  assert.equal(written[0].dimensions.widthM, 0.5);
  assert.equal(written[0].dimensions.depthM, 0.6);
  assert.equal(written[0].dimensions.usableHeightM, undefined);
  assert.ok(written.every(row => row.maxWeightKg === 125));
});

test('rack supports a 100kg cell and stores usable clearance only when configured', async t => {
  const capacities = Array.from({ length: 4 }, () => [100, 125, 125, 125]);
  const parsed = parseRackCreate(createRackInput({ cellCapacitiesKg: capacities, usableHeightMByLevel: [0.4, 0.42, 0.44, 0.46] }));
  assert.equal(parsed.cellCapacitiesKg[0][0], 100);
  assert.equal(parsed.usableHeightMByLevel[3], 0.46);
  assert.throws(() => parseRackCreate(createRackInput({ cellCapacitiesKg: Array.from({ length: 4 }, () => [130, 125, 125, 125]) })), { status: 400 });
  assert.throws(() => parseRackCreate(createRackInput({ usableHeightMByLevel: [0.4] })), { status: 400 });
  assert.throws(() => parseRackCreate(createRackInput({ usableHeightMByLevel: [0.7, 0.7, 0.7, 0.7] })), { status: 400 });
  assert.throws(() => parseCellUpdate({ maxWeightKg: 0 }), { status: 400 });
});

test('create rejects invalid facilities, non-managed service and assigned-facility scope', async t => {
  const wrongFacility = '507f1f77bcf86cd799439099';
  await assert.rejects(service.createZone({ facilityId, code: 'z', name: 'Z' }, actor('FACILITY_MANAGER', wrongFacility)), { status: 403 });
  t.mock.method(Facility, 'findOne', () => new Query(facility({ serviceTypes: ['SELF_STORAGE'] })));
  await assert.rejects(service.createZone({ facilityId, code: 'z', name: 'Z' }, actor()), { status: 409 });
  t.mock.method(Facility, 'findOne', () => new Query(null));
  await assert.rejects(service.createZone({ facilityId, code: 'z', name: 'Z' }, actor()), { status: 404 });
  t.mock.method(Facility, 'findOne', () => new Query(facility({ status: 'INACTIVE' })));
  await assert.rejects(service.createZone({ facilityId, code: 'z', name: 'Z' }, actor()), { status: 409 });
});

test('strict validators reject operators, unknown fields, invalid positions and unsafe pagination', () => {
  for (const body of [
    { ...createRackInput(), $set: { mapX: 9 } },
    { ...createRackInput(), facilityId: { $ne: null } },
    { ...createRackInput(), mapX: -1 },
    { ...createRackInput(), orientation: 45 },
    { ...createRackInput(), dimensions: { widthM: 2, depthM: 0.6, heightM: 2, $gt: 0 } },
  ]) assert.throws(() => parseRackCreate(body), { status: 400 });
  for (const query of [{ page: '1.5' }, { limit: ['2'] }, { limit: '101' }, { $where: 'x' }, { levelNumber: '0' }]) {
    assert.throws(() => parseList(query, query.levelNumber ? 'cell' : 'rack'), { status: 400 });
  }
  assert.deepEqual(parseList({ page: '2', limit: '5', aisleCode: ' a-1 ' }, 'rack').filter.aisleCode, 'A-1');
});

test('duplicate database keys translate to a safe conflict and abort the rack transaction', async t => {
  const tx = mockTransaction(t);
  t.mock.method(Zone, 'findOneAndUpdate', () => new Query(zone()));
  t.mock.method(Rack.prototype, 'save', async () => { throw Object.assign(new Error('duplicate index details'), { code: 11000 }); });
  let cellsAttempted = false;
  t.mock.method(Cell, 'insertMany', async () => { cellsAttempted = true; return []; });
  await assert.rejects(service.createRack(createRackInput(), actor()), error => error.status === 409 && !error.message.includes('index'));
  assert.equal(tx.aborted, true);
  assert.equal(tx.ended, 1);
  assert.equal(cellsAttempted, false);
});

test('partial cell creation failures abort the rack-and-cells transaction', async t => {
  const tx = mockTransaction(t);
  t.mock.method(Zone, 'findOneAndUpdate', () => new Query(zone()));
  let rackSaved = 0;
  t.mock.method(Rack.prototype, 'save', async function (options) { assert.equal(options.session, tx.session); rackSaved += 1; return this; });
  t.mock.method(Cell, 'insertMany', async (_rows, options) => {
    assert.equal(options.session, tx.session);
    throw Object.assign(new Error('simulated cell insert failure'), { name: 'ValidationError' });
  });
  await assert.rejects(service.createRack(createRackInput(), actor()), { status: 400 });
  assert.equal(rackSaved, 1);
  assert.equal(tx.aborted, true);
  assert.equal(tx.ended, 1);
});

test('a new customer can browse the sanitized managed map without a reservation', async t => {
  const own = actor('CUSTOMER');
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Zone, 'find', () => new Query([zone().toObject()]));
  t.mock.method(Zone, 'findOne', () => new Query(zone()));
  t.mock.method(Rack, 'find', () => new Query([rack().toObject()]));
  t.mock.method(Rack, 'findOne', () => new Query(rack()));
  t.mock.method(Cell, 'find', () => new Query(Array.from({ length: 16 }, (_, i) => cell(4 - Math.floor(i / 4), i % 4 + 1, { maxWeightKg: i === 0 ? 100 : 125 }).toObject())));
  const result = await service.warehouseMap(facilityId, own);
  assert.equal(result.zones[0].aisles[0].racks[0].cellCount, 16);
  assert.equal(result.zones[0].aisles[0].racks[0].utilization.usedWeightKg, 0);
  assert.equal(result.zones[0].aisles[0].racks[0].utilization.ratedCapacityKg, 2000);
  assert.equal(result.zones[0].aisles[0].racks[0].utilization.allocatableCapacityKg, 1975);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['deletedAt', 'deletedBy', 'layoutVersion', '__v', 'createdBy', 'ownerId']) assert.equal(serialized.includes(forbidden), false);
  const detail = await service.rackDetailMap(rackId, own);
  assert.equal(detail.capacity.usedWeightKg, 0);
  assert.equal(JSON.stringify(detail).includes('customerId'), false);
});

test('customer maps reject inactive, deleted, and non-managed facilities; customer cannot change structure', async t => {
  t.mock.method(Rack, 'findOne', () => new Query(rack()));
  t.mock.method(Facility, 'findOne', () => new Query(facility({ status: 'INACTIVE' })));
  await assert.rejects(service.warehouseMap(facilityId, actor('CUSTOMER')), { status: 409 });
  t.mock.method(Facility, 'findOne', () => new Query(null));
  await assert.rejects(service.warehouseMap(facilityId, actor('CUSTOMER')), { status: 404 });
  t.mock.method(Facility, 'findOne', () => new Query(facility({ serviceTypes: ['SELF_STORAGE'] })));
  await assert.rejects(service.rackDetailMap(rackId, actor('CUSTOMER')), { status: 409 });
  await assert.rejects(service.warehouseMap(facilityId, actor('FACILITY_STAFF', null)), { status: 403 });
  await assert.rejects(service.createZone({ facilityId, code: 'z', name: 'Z' }, actor('FACILITY_STAFF')), { status: 403 });
  await assert.rejects(service.createZone({ facilityId, code: 'z', name: 'Z' }, actor('CUSTOMER')), { status: 403 });
});

test('cell update rejects per-level capacity overflow and uses rack as the transaction lock', async t => {
  const tx = mockTransaction(t);
  t.mock.method(Cell, 'findOne', () => new Query(cell(1, 1)));
  const savedRack = rack();
  t.mock.method(Rack, 'findOne', () => new Query(savedRack));
  let aggregateSession;
  t.mock.method(Cell, 'aggregate', () => ({
    session(session) { aggregateSession = session; return this; },
    exec: async () => [{ totalKg: 400 }],
  }));
  t.mock.method(Rack.prototype, 'save', async function (options) { assert.equal(options.session, tx.session); return this; });
  await assert.rejects(service.updateCell(cellId, { maxWeightKg: 125 }, actor()), { status: 409 });
  assert.equal(aggregateSession, tx.session);
  assert.equal(savedRack.layoutVersion, 1);
  assert.equal(tx.aborted, true);
});

test('management reads are filtered, paginated and scoped to an assigned facility', async t => {
  const manager = actor('FACILITY_MANAGER');
  let seen;
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Zone, 'find', filter => {
    seen = filter;
    return Object.assign(new Query([zone().toObject()]), { sort() { return this; }, skip(value) { assert.equal(value, 1); return this; }, limit(value) { assert.equal(value, 1); return this; } });
  });
  t.mock.method(Zone, 'countDocuments', filter => { assert.equal(filter, seen); return new Query(1); });
  const result = await service.listZones({ facilityId, page: '2', limit: '1' }, manager);
  assert.equal(String(seen.facilityId), facilityId);
  assert.deepEqual(seen.deletedAt, { $exists: false });
  assert.equal(result.pagination.totalPages, 1);
  await assert.rejects(service.listZones({ facilityId: '507f1f77bcf86cd799439099' }, manager), { status: 403 });
});

test('ADMIN and BOM list zones, racks, and cells across eligible facilities without stringifying $in', async t => {
  const otherFacility = '507f1f77bcf86cd799439099';
  t.mock.method(Facility, 'find', () => new Query([{ _id: oid(facilityId) }, { _id: oid(otherFacility) }]));
  t.mock.method(Facility, 'findOne', () => { assert.fail('omitted facilityId must not validate a MongoDB filter object as one facility'); });
  const seen = [];
  for (const [Model, method, role] of [[Zone, 'listZones', 'ADMIN'], [Rack, 'listRacks', 'BOM'], [Cell, 'listCells', 'ADMIN']]) {
    t.mock.method(Model, 'find', filter => { seen.push(filter); return new Query([]); });
    t.mock.method(Model, 'countDocuments', filter => { assert.equal(filter, seen.at(-1)); return new Query(0); });
    await service[method]({}, actor(role));
    const facilityFilter = seen.at(-1).facilityId;
    assert.equal(typeof facilityFilter, 'object');
    assert.deepEqual(facilityFilter.$in.map(String), [facilityId, otherFacility]);
  }
});

test('zone deletion is blocked while active racks remain; rack deletion preserves records with soft delete', async t => {
  const tx = mockTransaction(t);
  t.mock.method(Zone, 'findOneAndUpdate', (filter, update, options) => {
    assert.deepEqual(filter.deletedAt, { $exists: false });
    assert.deepEqual(update.$inc, { structureVersion: 1 });
    assert.equal(options.session, tx.session);
    return new Query(zone({ structureVersion: 1 }));
  });
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Rack, 'exists', () => ({ session() { return this; }, exec: async () => ({ _id: oid(rackId) }) }));
  await assert.rejects(service.deleteZone(zoneId, actor()), { status: 409 });
  assert.equal(tx.aborted, true);

  const tx2 = mockTransaction(t);
  t.mock.method(Rack, 'findOne', () => new Query(rack()));
  t.mock.method(Cell, 'countDocuments', () => ({ session() { return this; }, exec: async () => 0 }));
  let softUpdates = 0;
  t.mock.method(Cell, 'updateMany', (filter, update, options) => {
    assert.equal(options.session, tx2.session);
    assert.ok(update.$set.deletedAt instanceof Date);
    softUpdates += 1;
    return new Query({ acknowledged: true });
  });
  t.mock.method(Rack.prototype, 'save', async function (options) { assert.equal(options.session, tx2.session); return this; });
  const deleted = await service.deleteRack(rackId, actor());
  assert.equal(deleted.rackCode, 'R1-01');
  assert.ok(deleted._id);
  assert.equal(softUpdates, 1);
});

test('rack deletion is rejected while available cells remain', async t => {
  const tx = mockTransaction(t);
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Rack, 'findOne', () => new Query(rack()));
  t.mock.method(Zone, 'findOne', () => new Query(zone()));
  t.mock.method(Cell, 'countDocuments', () => ({ session() { return this; }, exec: async () => 1 }));
  t.mock.method(Cell, 'updateMany', () => { assert.fail('available rack cells must not be deleted'); });
  await assert.rejects(service.deleteRack(rackId, actor()), { status: 409 });
  assert.equal(tx.aborted, true);
});

test('zone version lock serializes rack creation against deactivation and deletion', async t => {
  const createTx = mockTransaction(t);
  t.mock.method(Zone, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.isActive, true);
    assert.deepEqual(update.$inc, { structureVersion: 1 });
    assert.equal(options.session, createTx.session);
    // The parent became inactive before this transaction acquired its write lock.
    return new Query(null);
  });
  await assert.rejects(service.createRack(createRackInput(), actor()), { status: 404 });
  assert.equal(createTx.aborted, true);

  const deactivateTx = mockTransaction(t);
  t.mock.method(Zone, 'findOne', () => new Query(zone()));
  t.mock.method(Zone, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(filter.deletedAt.$exists, false);
    assert.deepEqual(update.$inc, { structureVersion: 1 });
    assert.equal(options.session, deactivateTx.session);
    return new Query(zone({ structureVersion: 1 }));
  });
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Rack, 'exists', () => ({ session() { return this; }, exec: async () => ({ _id: oid(rackId) }) }));
  await assert.rejects(service.updateZone(zoneId, { isActive: false }, actor()), { status: 409 });
  assert.equal(deactivateTx.aborted, true);
});

test('restoreRack locks its active parent and atomically restores Rack and Cells', async t => {
  const tx = mockRestoreRackModels(t, zone({ structureVersion: 1 }));
  t.mock.method(Rack, 'findOneAndUpdate', (filter, update, options) => {
    assert.deepEqual(update.$unset, { deletedAt: 1, deletedBy: 1 });
    assert.equal(options.session, tx.session);
    return new Query(rack());
  });
  let restoredCells = false;
  t.mock.method(Cell, 'updateMany', (filter, update, options) => {
    assert.equal(String(filter.rackId), rackId);
    assert.deepEqual(update.$unset, { deletedAt: 1, deletedBy: 1 });
    assert.equal(options.session, tx.session);
    restoredCells = true;
    return new Query({ acknowledged: true });
  });
  const result = await service.restoreRack(rackId, actor());
  assert.equal(result.rackCode, 'R1-01');
  assert.equal(restoredCells, true);
  assert.equal(tx.started, 1);
  assert.equal(tx.ended, 1);
});

test('restoreRack rejects inactive parent Zone without touching Rack or Cells', async t => {
  const tx = mockRestoreRackModels(t, null);
  t.mock.method(Rack, 'findOneAndUpdate', () => { assert.fail('Rack must not be restored under an inactive Zone'); });
  t.mock.method(Cell, 'updateMany', () => { assert.fail('Cells must not be restored under an inactive Zone'); });
  await assert.rejects(service.restoreRack(rackId, actor()), { status: 409 });
  assert.equal(tx.aborted, true);
});

test('restoreRack rejects deleted parent Zone without touching Rack or Cells', async t => {
  const tx = mockRestoreRackModels(t, null);
  t.mock.method(Rack, 'findOneAndUpdate', () => { assert.fail('Rack must not be restored under a deleted Zone'); });
  t.mock.method(Cell, 'updateMany', () => { assert.fail('Cells must not be restored under a deleted Zone'); });
  await assert.rejects(service.restoreRack(rackId, actor()), { status: 409 });
  assert.equal(tx.aborted, true);
});

test('restoreRack loses safely to concurrent deleteZone', async t => {
  const tx = mockTransaction(t);
  let zoneLocks = 0;
  t.mock.method(Zone, 'findOneAndUpdate', () => {
    zoneLocks += 1;
    // First transaction deletes the now-empty Zone; restore's live/active lock
    // then observes the committed deletion and receives no matching parent.
    return new Query(zoneLocks === 1 ? zone({ structureVersion: 1 }) : null);
  });
  t.mock.method(Zone.prototype, 'save', async function (options) { assert.equal(options.session, tx.session); return this; });
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Rack, 'exists', () => ({ session() { return this; }, exec: async () => null }));
  t.mock.method(Rack, 'findOne', () => new Query(rack({ deletedAt: new Date(), deletedBy: userId })));
  t.mock.method(Rack, 'findOneAndUpdate', () => { assert.fail('restore must not proceed after Zone deletion wins'); });
  t.mock.method(Cell, 'updateMany', () => { assert.fail('Cell restoration must abort after Zone deletion wins'); });
  await service.deleteZone(zoneId, actor());
  await assert.rejects(service.restoreRack(rackId, actor()), { status: 409 });
  assert.equal(zoneLocks, 2);
  assert.equal(tx.aborted, true);
});

test('restoreRack loses safely to concurrent Zone deactivation', async t => {
  const tx = mockTransaction(t);
  let zoneLocks = 0;
  t.mock.method(Zone, 'findOne', () => new Query(zone()));
  t.mock.method(Zone, 'findOneAndUpdate', () => {
    zoneLocks += 1;
    return new Query(zoneLocks === 1 ? zone({ structureVersion: 1 }) : null);
  });
  t.mock.method(Zone.prototype, 'save', async function (options) { assert.equal(options.session, tx.session); return this; });
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Rack, 'exists', () => ({ session() { return this; }, exec: async () => null }));
  t.mock.method(Rack, 'findOne', () => new Query(rack({ deletedAt: new Date(), deletedBy: userId })));
  t.mock.method(Rack, 'findOneAndUpdate', () => { assert.fail('restore must not proceed after Zone deactivation wins'); });
  t.mock.method(Cell, 'updateMany', () => { assert.fail('Cell restoration must abort after Zone deactivation wins'); });
  await service.updateZone(zoneId, { isActive: false }, actor());
  await assert.rejects(service.restoreRack(rackId, actor()), { status: 409 });
  assert.equal(zoneLocks, 2);
  assert.equal(tx.aborted, true);
});

test('restoreRack transaction aborts when Cell restoration fails after Rack write', async t => {
  const tx = mockRestoreRackModels(t, zone({ structureVersion: 1 }));
  let rackWriteAttempted = false;
  t.mock.method(Rack, 'findOneAndUpdate', (filter, update, options) => {
    rackWriteAttempted = true;
    assert.equal(options.session, tx.session);
    return new Query(rack());
  });
  let cellWriteAttempted = false;
  t.mock.method(Cell, 'updateMany', () => {
    cellWriteAttempted = true;
    throw new Error('simulated cell restore failure');
  });
  await assert.rejects(service.restoreRack(rackId, actor()), error => error.status === 500);
  assert.equal(rackWriteAttempted, true);
  assert.equal(cellWriteAttempted, true);
  assert.equal(tx.aborted, true);
});

test('rack height update checks the sum of configured usable level heights', async t => {
  const tx = mockTransaction(t);
  t.mock.method(Rack, 'findOne', () => new Query(rack()));
  t.mock.method(Zone, 'findOne', () => new Query(zone()));
  t.mock.method(Cell, 'aggregate', () => ({
    session() { return this; }, exec: async () => [{ _id: 1, maxHeightM: 0.55 }, { _id: 2, maxHeightM: 0.55 }, { _id: 3, maxHeightM: 0.55 }, { _id: 4, maxHeightM: 0.55 }],
  }));
  await assert.rejects(service.updateRack(rackId, { dimensions: { widthM: 2, depthM: 0.6, heightM: 2 } }, actor()), { status: 409 });
  assert.equal(tx.aborted, true);
});

test('detail map returns 16 top-to-bottom empty cells with allowlisted output', async t => {
  const rackDoc = rack();
  const cells = [];
  for (let level = 1; level <= 4; level += 1) for (let c = 1; c <= 4; c += 1) cells.push(cell(level, c, { maxWeightKg: level === 1 && c === 1 ? 100 : 125 }));
  t.mock.method(Rack, 'findOne', () => new Query(rackDoc));
  t.mock.method(Facility, 'findOne', () => new Query(facility()));
  t.mock.method(Zone, 'findOne', () => new Query(zone()));
  t.mock.method(Cell, 'find', () => Object.assign(new Query(cells.map(doc => doc.toObject())), { sort(spec) { assert.deepEqual(spec, { levelNumber: -1, cellNumber: 1 }); return this; } }));
  const result = await service.rackDetailMap(rackId, actor('FACILITY_STAFF'));
  assert.equal(result.capacity.maxWeightKg, 2000);
  assert.equal(result.capacity.ratedCapacityKg, 2000);
  assert.equal(result.capacity.allocatableCapacityKg, 1975);
  assert.equal(result.capacity.usedWeightKg, 0);
  assert.deepEqual(result.levels.map(level => level.levelNumber), [4, 3, 2, 1]);
  assert.equal(result.levels.reduce((sum, level) => sum + level.cells.length, 0), 16);
  assert.equal(result.levels[0].cells[0].maxWeightKg, 125);
  assert.equal(result.levels[0].ratedCapacityKg, 500);
  assert.equal(result.levels[0].allocatableCapacityKg, 500);
  assert.equal(result.levels[3].allocatableCapacityKg, 475);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['deletedAt', 'deletedBy', 'layoutVersion', '__v', 'createdBy']) assert.equal(serialized.includes(forbidden), false);
});

test('API route registration exposes only the MI-01 routes behind authentication', () => {
  const router = require('../dist/routes/warehouse-map.routes').default;
  const routes = router.stack.filter(layer => layer.route).flatMap(layer =>
    Object.entries(layer.route.methods).filter(([, enabled]) => enabled).map(([method]) => `${method.toUpperCase()} ${layer.route.path}`));
  assert.ok(router.stack.filter(layer => layer.route).every(layer => layer.route.stack[0].handle.name === 'requireAuth'));
  for (const expected of [
    'GET /warehouse-map', 'GET /racks/:id/detail-map',
    'POST /warehouse-zones', 'GET /warehouse-zones', 'GET /warehouse-zones/:id',
    'PATCH /warehouse-zones/:id', 'DELETE /warehouse-zones/:id', 'POST /warehouse-zones/:id/restore',
    'POST /racks', 'GET /racks', 'GET /racks/:id', 'PATCH /racks/:id', 'DELETE /racks/:id', 'POST /racks/:id/restore',
    'GET /rack-cells', 'GET /rack-cells/:id', 'PATCH /rack-cells/:id',
  ]) assert.ok(routes.includes(expected), `${expected} is registered`);
  assert.equal(routes.length, 17);
});
