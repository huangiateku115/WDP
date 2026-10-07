const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'production', MONGO_URL: 'mongodb+srv://cluster.example.invalid/wdp',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'test-only',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
});
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const Model = require('../dist/models/storage-units/storage-unit.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const { StorageUnitService: service } = require('../dist/services/storage-units/storage-unit.service');
const { parseList, parseUnit } = require('../dist/services/storage-units/storage-unit.validation');
const facilityId = '507f1f77bcf86cd799439011', otherId = '507f1f77bcf86cd799439012';
const id = '507f1f77bcf86cd799439013';
const admin = { role: 'ADMIN' };
const customer = { role: 'CUSTOMER' };
const manager = { role: 'FACILITY_MANAGER', assignedFacilityId: new mongoose.Types.ObjectId(facilityId) };
const valid = () => ({ unitCode: ' a-01 ', size: 'SMALL', dimensions: { lengthM: 2, widthM: 3, heightM: 4 } });
const query = value => ({ exec: async () => value });
const parent = (extra = {}) => ({ status: 'ACTIVE', serviceTypes: ['SELF_STORAGE'], ...extra });
function mockParent(t, value = parent()) { t.mock.method(Facility, 'findOne', () => query(value)); }
function document(extra = {}) {
  return Model.hydrate({ _id: id, __v: 0, facilityId, ...valid(), volumeM3: 24, status: 'AVAILABLE', ...extra });
}

test('schema compound uniqueness and server-derived volume', async () => {
  const doc = new Model({ ...valid(), facilityId, volumeM3: 999 });
  await doc.validate();
  assert.equal(doc.volumeM3, 24);
  assert.equal(doc.unitCode, 'A-01');
  assert.equal(doc.status, 'AVAILABLE');
  assert.equal(Model.schema.options.optimisticConcurrency, true);
  const indexes = Model.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.facilityId === 1 && keys.unitCode === 1 && options.unique));
  assert.equal(indexes.some(([keys, options]) => keys.unitCode === 1 && !keys.facilityId && options.unique), false);
  for (const dimensions of [
    { lengthM: 0, widthM: 3, heightM: 4 }, { lengthM: -1, widthM: 3, heightM: 4 },
    { lengthM: Infinity, widthM: 3, heightM: 4 },
  ]) await assert.rejects(new Model({ ...valid(), facilityId, dimensions }).validate());
});

test('create validates active SELF_STORAGE parent and calculates volume', async t => {
  mockParent(t);
  t.mock.method(Model, 'create', async data => {
    assert.equal(data.volumeM3, undefined);
    const doc = new Model(data); await doc.validate(); return doc;
  });
  const result = await service.createStorageUnit(facilityId, valid(), manager);
  assert.equal(result.unitCode, 'A-01');
  assert.equal(result.volumeM3, 24);
  assert.equal(result.facilityId.toString(), facilityId);
});

test('same facility duplicate -> 409; same code in another facility allowed', async t => {
  mockParent(t);
  const keys = new Set();
  t.mock.method(Model, 'create', async data => {
    const key = data.facilityId + ':' + data.unitCode;
    if (keys.has(key)) throw { code: 11000, message: 'private Mongo information' };
    keys.add(key);
    return new Model(data);
  });
  await service.createStorageUnit(facilityId, valid(), admin);
  await assert.rejects(() => service.createStorageUnit(facilityId, valid(), admin), { status: 409 });
  const other = await service.createStorageUnit(otherId, valid(), admin);
  assert.equal(other.facilityId.toString(), otherId);
});

test('invalid/missing/inactive/managed-only facility is rejected before create', async t => {
  const create = t.mock.method(Model, 'create', () => assert.fail('must not create'));
  await assert.rejects(() => service.createStorageUnit('bad', valid(), admin), { status: 400 });
  for (const [value, status] of [
    [null, 404], [parent({ status: 'INACTIVE' }), 409],
    [parent({ serviceTypes: ['MANAGED_INVENTORY'] }), 409],
  ]) {
    mockParent(t, value);
    await assert.rejects(() => service.createStorageUnit(facilityId, valid(), admin), { status });
  }
  assert.equal(create.mock.callCount(), 0);
});

test('validation rejects unsafe dimensions, invalid size, supplied volume and immutable fields', () => {
  for (const n of [0, -1, NaN, Infinity, '2', null]) {
    assert.throws(() => parseUnit({ ...valid(), dimensions: { ...valid().dimensions, lengthM: n } }), { status: 400 });
  }
  for (const input of [
    { ...valid(), size: 'XL' }, { ...valid(), volumeM3: 100 }, { ...valid(), facilityId },
    { ...valid(), unitCode: ' ' }, { ...valid(), dimensions: { lengthM: 2 } },
    { ...valid(), dimensions: { lengthM: 1e308, widthM: 1e308, heightM: 1 } },
    { ...valid(), dimensions: { lengthM: 1e-308, widthM: 1e-308, heightM: 1 } },
  ]) assert.throws(() => parseUnit(input), { status: 400 });
  for (const input of [{}, { _id: id }, { __v: 1 }, { updatedAt: 'x' }, { createdAt: 'x' },
    { volumeM3: 1 }, { facilityId: otherId }, { status: 'AVAILABLE' }, { $set: { size: 'SMALL' } }]) {
    assert.throws(() => parseUnit(input, true), { status: 400 });
  }
});

test('get by ID and not found/invalid IDs', async t => {
  const doc = document();
  t.mock.method(Model, 'findOne', () => query(doc));
  assert.equal(await service.getStorageUnitById(id, customer), doc);
  for (const operation of [
    () => service.getStorageUnitById('bad', admin),
    () => service.updateStorageUnit('bad', { description: 'x' }, admin),
    () => service.updateStorageUnitStatus('bad', { status: 'INACTIVE' }, admin),
  ]) await assert.rejects(operation, { status: 400 });
  t.mock.method(Model, 'findOne', () => query(null));
  await assert.rejects(() => service.getStorageUnitById(id, admin), { status: 404 });
  await assert.rejects(() => service.updateStorageUnit(id, { description: 'x' }, admin), { status: 404 });
});

test('list scopes query to facility and applies status/size/pagination/literal search', async t => {
  mockParent(t);
  let seen;
  t.mock.method(Model, 'find', filter => {
    seen = filter;
    return {
      sort(value) { assert.deepEqual(value, { createdAt: -1, _id: -1 }); return this; },
      skip(value) { assert.equal(value, 2); return this; },
      limit(value) { assert.equal(value, 2); return this; },
      lean() { return this; }, ...query([{ unitCode: 'A-01' }]),
    };
  });
  t.mock.method(Model, 'countDocuments', filter => { assert.deepEqual(filter, seen); return query(5); });
  const result = await service.getStorageUnits(facilityId, {
    page: '2', limit: '2', size: 'SMALL', status: 'AVAILABLE', search: 'A.*',
  }, customer);
  assert.equal(seen.facilityId.toString(), facilityId);
  assert.equal(seen.status, 'AVAILABLE');
  assert.equal(seen.size, 'SMALL');
  const regex = new RegExp(seen.unitCode.$regex, seen.unitCode.$options);
  assert.ok(regex.test('a.*')); assert.equal(regex.test('A-01'), false);
  assert.deepEqual(result.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
  assert.equal(result.data.length, 1);
  assert.deepEqual(parseList({}), { page: 1, limit: 20, filter: {} });
  for (const input of [{ page: '0' }, { limit: '101' }, { page: '1.2' }, { size: 'XL' },
    { status: 'DELETED' }, { search: { $ne: '' } }, { limit: ['2'] }]) {
    assert.throws(() => parseList(input), { status: 400 });
  }
});

test('update recalculates volume and preserves facility; real save uses version check', async t => {
  mockParent(t);
  const doc = document();
  t.mock.method(Model, 'findOne', () => query(doc));
  t.mock.method(Model.collection, 'updateOne', async (filter, update) => {
    assert.equal(filter.__v, 0);
    assert.equal(update.$inc.__v, 1);
    assert.equal(update.$set.volumeM3, 60);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });
  const updated = await service.updateStorageUnit(id, {
    dimensions: { lengthM: 3, widthM: 4, heightM: 5 }, description: 'Updated',
  }, manager);
  assert.equal(updated.volumeM3, 60);
  assert.equal(updated.facilityId.toString(), facilityId);
});

test('concurrent write returns 409 from actual optimistic save', async t => {
  mockParent(t);
  t.mock.method(Model, 'findOne', () => query(document()));
  t.mock.method(Model.collection, 'updateOne', async () => ({ acknowledged: true, matchedCount: 0 }));
  await assert.rejects(() => service.updateStorageUnit(id, { description: 'Conflict' }, admin), { status: 409 });
});

test('resource status transitions work; inactive parents cannot become AVAILABLE', async t => {
  mockParent(t);
  t.mock.method(Model.collection, 'updateOne', async () => ({ acknowledged: true, matchedCount: 1 }));
  for (const current of ['AVAILABLE', 'MAINTENANCE', 'INACTIVE']) {
    for (const next of ['AVAILABLE', 'MAINTENANCE', 'INACTIVE']) {
      t.mock.method(Model, 'findOne', () => query(document({ status: current })));
      // A no-op status save uses findOne to verify existence.
      t.mock.method(Model.collection, 'findOne', async () => ({ _id: new mongoose.Types.ObjectId(id), __v: 0 }));
      assert.equal((await service.updateStorageUnitStatus(id, { status: next }, admin)).status, next);
    }
  }
  mockParent(t, parent({ status: 'INACTIVE' }));
  t.mock.method(Model, 'findOne', () => query(document({ status: 'INACTIVE' })));
  await assert.rejects(() => service.updateStorageUnitStatus(id, { status: 'AVAILABLE' }, admin), { status: 409 });
  assert.equal((await service.updateStorageUnitStatus(id, { status: 'MAINTENANCE' }, admin)).status, 'MAINTENANCE');
});

test('administrative APIs cannot enter or modify HELD/OCCUPIED', async t => {
  for (const status of ['HELD', 'OCCUPIED']) {
    await assert.rejects(() => service.createStorageUnit(facilityId, { ...valid(), status }, admin), { status: 409 });
    await assert.rejects(() => service.updateStorageUnitStatus(id, { status }, admin), { status: 409 });
    t.mock.method(Model, 'findOne', () => query(document({ status })));
    await assert.rejects(() => service.updateStorageUnit(id, { description: 'unsafe' }, admin), { status: 409 });
    await assert.rejects(() => service.updateStorageUnitStatus(id, { status: 'AVAILABLE' }, admin), { status: 409 });
  }
});

test('scope denies unassigned and other-facility staff/managers; customers cannot write', async t => {
  t.mock.method(Model, 'findOne', () => query(document()));
  for (const role of ['FACILITY_MANAGER', 'FACILITY_STAFF']) {
    for (const assignedFacilityId of [undefined, new mongoose.Types.ObjectId(otherId)]) {
      const actor = { role, assignedFacilityId };
      await assert.rejects(() => service.getStorageUnits(facilityId, {}, actor), { status: 403 });
      await assert.rejects(() => service.getStorageUnitById(id, actor), { status: 403 });
      await assert.rejects(() => service.updateStorageUnit(id, { description: 'x' }, actor), { status: 403 });
    }
  }
  assert.equal((await service.getStorageUnitById(id, { role: 'FACILITY_STAFF', assignedFacilityId: manager.assignedFacilityId }))._id.toString(), id);
  await assert.rejects(() => service.createStorageUnit(facilityId, valid(), customer), { status: 403 });
  await assert.rejects(() => service.createStorageUnit(facilityId, valid(), undefined), { status: 401 });
});

test('persistence failures are sanitized', async t => {
  mockParent(t);
  t.mock.method(Model, 'create', () => { throw new Error('secret Mongo host'); });
  await assert.rejects(() => service.createStorageUnit(facilityId, valid(), admin), { status: 500, message: 'Internal Server Error' });
});

test('soft delete permits only AVAILABLE/MAINTENANCE/INACTIVE and never physically deletes', async t => {
  const physicalDelete = t.mock.method(Model, 'deleteOne', async () => ({}));
  const physicalDeleteMany = t.mock.method(Model, 'deleteMany', async () => ({}));
  for (const status of ['AVAILABLE', 'MAINTENANCE', 'INACTIVE']) {
    const unit = document({ status });
    t.mock.method(Model, 'findOne', filter => {
      assert.deepEqual(filter.deletedAt, { $exists: false });
      return query(unit);
    });
    const saved = t.mock.method(unit, 'save', async () => unit);
    const result = await service.deleteStorageUnit(id, admin);
    assert.ok(result.deletedAt instanceof Date);
    assert.equal(saved.mock.callCount(), 1);
  }
  for (const status of ['HELD', 'OCCUPIED']) {
    t.mock.method(Model, 'findOne', () => query(document({ status })));
    await assert.rejects(service.deleteStorageUnit(id, admin), { status: 409 });
  }
  assert.equal(physicalDelete.mock.callCount(), 0);
  assert.equal(physicalDeleteMany.mock.callCount(), 0);
});

test('deleted Storage Unit is hidden, restore requires a valid parent and code stays reserved', async t => {
  t.mock.method(Model, 'findOne', filter => {
    assert.deepEqual(filter.deletedAt, { $exists: false });
    return query(null);
  });
  await assert.rejects(service.getStorageUnitById(id, customer), { status: 404 });
  mockParent(t);
  let listFilter;
  t.mock.method(Model, 'find', filter => {
    listFilter = filter;
    return { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return this; }, ...query([]) };
  });
  t.mock.method(Model, 'countDocuments', filter => { assert.deepEqual(filter.deletedAt, { $exists: false }); return query(0); });
  await service.getStorageUnits(facilityId, {}, customer);
  assert.deepEqual(listFilter.deletedAt, { $exists: false });

  const deleted = document({ deletedAt: new Date(), status: 'AVAILABLE' });
  t.mock.method(Model, 'findById', () => query(deleted));
  t.mock.method(Facility, 'findOne', () => query(parent({ status: 'INACTIVE' })));
  t.mock.method(Model, 'findOneAndUpdate', (filter, update) => {
    assert.deepEqual(filter.deletedAt, { $exists: true });
    assert.deepEqual(update, { $unset: { deletedAt: 1, deletedBy: 1 } });
    return query(document());
  });
  assert.equal((await service.restoreStorageUnit(id, admin)).deletedAt, undefined);

  t.mock.method(Model, 'findById', () => query(document()));
  await assert.rejects(service.restoreStorageUnit(id, admin), { status: 404 });
  t.mock.method(Model, 'findById', () => query(deleted));
  t.mock.method(Facility, 'findOne', () => query(null));
  await assert.rejects(service.restoreStorageUnit(id, admin), { status: 404 });

  const codes = new Set(['A-01']);
  t.mock.method(Model, 'create', async data => {
    if (codes.has(data.unitCode)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    codes.add(data.unitCode); return new Model(data);
  });
  mockParent(t);
  await assert.rejects(service.createStorageUnit(facilityId, valid(), admin), { status: 409 });
  assert.equal(Model.schema.indexes().some(([keys, options]) => keys.facilityId === 1 && keys.unitCode === 1 && options.unique), true);
});

test('HTTP routes apply real role middleware and service scope; restore/delete are management-only', async t => {
  const auth = require('../dist/middlewares/auth/requireAuth');
  t.mock.method(auth, 'requireAuth', (req, res, next) => {
    if (!req.headers['x-test-role']) return res.status(401).json({ success: false, message: 'Unauthorized' });
    req.user = { role: req.headers['x-test-role'], assignedFacilityId: req.headers['x-test-facility'] };
    next();
  });
  mockParent(t);
  t.mock.method(Model, 'create', async data => { const doc = new Model(data); await doc.validate(); return doc; });
  t.mock.method(Model, 'findOne', () => query(document()));
  t.mock.method(Model.collection, 'updateOne', async () => ({ acknowledged: true, matchedCount: 1 }));
  t.mock.method(Model, 'find', () => ({
    sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return this; },
    ...query([document()]),
  }));
  t.mock.method(Model, 'countDocuments', () => query(1));
  const server = require('../dist/app').default.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  const list = '/facilities/' + facilityId + '/storage-units', single = '/storage-units/' + id;
  const request = (method, path, role, data, assigned = facilityId) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json',
      ...(role ? { 'x-test-role': role, 'x-test-facility': assigned } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  for (const [method, path, data] of [['POST', list, valid()], ['GET', list],
    ['GET', single], ['PATCH', single, { description: 'x' }], ['PATCH', single + '/status', { status: 'INACTIVE' }]]) {
    assert.equal((await request(method, path, undefined, data)).status, 401);
  }
  for (const role of ['CUSTOMER', 'FACILITY_STAFF']) {
    assert.equal((await request('POST', list, role, valid())).status, 403);
    assert.equal((await request('PATCH', single, role, { description: 'x' })).status, 403);
    assert.equal((await request('PATCH', single + '/status', role, { status: 'INACTIVE' })).status, 403);
  }
  for (const role of ['ADMIN', 'BOM', 'FACILITY_MANAGER']) {
    const response = await request('POST', list, role, valid());
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.volumeM3, 24);
  }
  assert.equal((await request('POST', list, 'FACILITY_MANAGER', valid(), otherId)).status, 403);
  assert.equal((await request('GET', single, 'FACILITY_STAFF', undefined, otherId)).status, 403);
  assert.equal((await request('GET', list, 'CUSTOMER')).status, 200);
  assert.equal((await request('GET', single, 'CUSTOMER')).status, 200);
  assert.equal((await request('PATCH', single, 'FACILITY_MANAGER', { description: 'x' })).status, 200);
  assert.equal((await request('PATCH', single + '/status', 'FACILITY_MANAGER', { status: 'INACTIVE' })).status, 200);
  assert.equal((await request('DELETE', single, 'CUSTOMER')).status, 403);
  assert.equal((await request('POST', single + '/restore', 'CUSTOMER')).status, 403);
});

