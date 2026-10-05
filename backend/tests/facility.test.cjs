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
// No database connection is opened. All persistence calls below are mocked.
mongoose.set('bufferCommands', false);
const Model = require('../dist/models/facilities/facility.model').default;
const { FacilityService: service } = require('../dist/services/facilities/facility.service');
const { parseList } = require('../dist/services/facilities/facility.validation');
const id = '507f1f77bcf86cd799439011';
const valid = () => ({
  code: ' hcm-01 ', name: ' Main facility ',
  address: { line1: '1 Main Street', city: 'HCM', country: 'VN' },
  contact: { email: 'TEAM@example.com' },
  serviceTypes: ['SELF_STORAGE', 'MANAGED_INVENTORY'],
});
const query = value => ({ exec: async () => value });

test('schema normalizes code and defines required unique/filter indexes', async () => {
  const doc = new Model(valid());
  await doc.validate();
  assert.equal(doc.code, 'HCM-01');
  assert.equal(doc.name, 'Main facility');
  assert.equal(doc.status, 'ACTIVE');
  assert.equal(doc.contact.email, 'team@example.com');
  const indexes = Model.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.code === 1 && options.unique));
  assert.ok(indexes.some(([keys]) => keys.status === 1));
  assert.ok(indexes.some(([keys]) => keys.serviceTypes === 1));
  for (const serviceTypes of [[], ['OTHER'], ['SELF_STORAGE', 'SELF_STORAGE']]) {
    await assert.rejects(new Model({ ...valid(), serviceTypes }).validate());
  }
});

test('create valid facility passes normalized allowlisted data', async t => {
  t.mock.method(Model, 'create', async data => {
    assert.equal(data.code, 'HCM-01');
    assert.equal(data.contact.email, 'team@example.com');
    return new Model(data);
  });
  const facility = await service.createFacility(valid());
  assert.equal(facility.status, 'ACTIVE');
  assert.equal(facility.address.city, 'HCM');
});

test('duplicate code translates to 409 on create and update', async t => {
  const duplicate = () => { throw Object.assign(new Error('private Mongo details'), { code: 11000 }); };
  t.mock.method(Model, 'create', duplicate);
  t.mock.method(Model, 'findByIdAndUpdate', duplicate);
  for (const op of [
    () => service.createFacility(valid()), () => service.updateFacility(id, { code: 'hcm-01' }),
  ]) {
    await assert.rejects(op, error => error.status === 409 && !error.message.includes('Mongo'));
  }
});

test('invalid fields, enums, email, immutable fields and update operators rejected', async () => {
  for (const input of [
    { ...valid(), name: ' ' }, { ...valid(), serviceTypes: ['OTHER'] },
    { ...valid(), serviceTypes: [] }, { ...valid(), status: 'DELETED' },
    { ...valid(), contact: { email: 'bad' } }, { ...valid(), address: { city: 'HCM' } },
    { ...valid(), address: { ...valid().address, $set: 'bad' } },
  ]) await assert.rejects(() => service.createFacility(input), { status: 400 });
  for (const input of [{}, null, [], { _id: id }, { createdAt: 'x' },
    { updatedAt: 'x' }, { __v: 5 }, { $set: { name: 'x' } }, { contact: {} }]) {
    await assert.rejects(() => service.updateFacility(id, input), { status: 400 });
  }
});

test('invalid ObjectId is rejected before model access', async t => {
  const find = t.mock.method(Model, 'findById', () => { throw new Error('must not query'); });
  await assert.rejects(() => service.getFacilityById('bad'), { status: 400 });
  await assert.rejects(() => service.updateFacility('bad', { name: 'New' }), { status: 400 });
  await assert.rejects(() => service.updateFacilityStatus('bad', { status: 'ACTIVE' }), { status: 400 });
  assert.equal(find.mock.callCount(), 0);
});

test('get and not-found responses', async t => {
  const doc = new Model(valid());
  t.mock.method(Model, 'findById', requested => { assert.equal(requested, id); return query(doc); });
  assert.equal(await service.getFacilityById(id), doc);
  t.mock.method(Model, 'findById', () => query(null));
  t.mock.method(Model, 'findByIdAndUpdate', () => query(null));
  await assert.rejects(() => service.getFacilityById(id), { status: 404 });
  await assert.rejects(() => service.updateFacility(id, { name: 'New' }), { status: 404 });
  await assert.rejects(() => service.updateFacilityStatus(id, { status: 'INACTIVE' }), { status: 404 });
});

test('list pagination, status/service filters and literal search reach model', async t => {
  let seen;
  const data = [{ code: 'HCM-01', status: 'INACTIVE' }];
  t.mock.method(Model, 'find', filter => {
    seen = filter;
    return {
      sort(value) { assert.deepEqual(value, { createdAt: -1, _id: -1 }); return this; },
      skip(value) { assert.equal(value, 2); return this; },
      limit(value) { assert.equal(value, 2); return this; },
      lean() { return this; }, ...query(data),
    };
  });
  t.mock.method(Model, 'countDocuments', filter => { assert.deepEqual(filter, seen); return query(5); });
  const result = await service.getFacilities({
    page: '2', limit: '2', status: 'INACTIVE', serviceType: 'SELF_STORAGE', search: 'HCM.*',
  });
  assert.equal(seen.status, 'INACTIVE');
  assert.equal(seen.serviceTypes, 'SELF_STORAGE');
  const regex = new RegExp(seen.$or[0].code.$regex, 'i');
  assert.ok(regex.test('hcm.*'));
  assert.equal(regex.test('hcm-anything'), false);
  assert.deepEqual(result, { data, pagination: { page: 2, limit: 2, total: 5, totalPages: 3 } });
  assert.deepEqual(parseList({}), { page: 1, limit: 20, filter: {} });
  for (const input of [{ page: '0' }, { page: '1.5' }, { limit: '101' },
    { limit: ['2'] }, { status: 'bad' }, { serviceType: 'bad' }, { search: { $ne: '' } }]) {
    assert.throws(() => parseList(input), { status: 400 });
  }
});

test('update uses dotted nested fields and validation without upsert', async t => {
  t.mock.method(Model, 'findByIdAndUpdate', (requested, update, options) => {
    assert.equal(requested, id);
    assert.deepEqual(update, { $set: { name: 'Updated', 'address.city': 'Da Nang' } });
    assert.deepEqual(options, { new: true, runValidators: true });
    return query({ name: 'Updated' });
  });
  assert.equal((await service.updateFacility(id, { name: ' Updated ', address: { city: 'Da Nang' } })).name, 'Updated');
});

test('activate/deactivate updates only status; no cascade/delete', async t => {
  t.mock.method(Model, 'findByIdAndUpdate', (_id, update) => {
    assert.deepEqual(Object.keys(update.$set), ['status']);
    return query({ status: update.$set.status });
  });
  for (const status of ['INACTIVE', 'ACTIVE']) {
    assert.equal((await service.updateFacilityStatus(id, { status })).status, status);
  }
  await assert.rejects(() => service.updateFacilityStatus(id, { status: 'DELETED' }), { status: 400 });
  await assert.rejects(() => service.updateFacilityStatus(id, { status: 'ACTIVE', name: 'bad' }), { status: 400 });
});

test('unexpected persistence errors never expose Mongo details', async t => {
  t.mock.method(Model, 'create', () => { throw new Error('private connection details'); });
  await assert.rejects(() => service.createFacility(valid()), { status: 500, message: 'Internal Server Error' });
});

test('HTTP endpoints: auth roles, success envelopes and global error statuses', async t => {
  // Stub only the authentication boundary; the actual requireRole middleware is exercised.
  const auth = require('../dist/middlewares/auth/requireAuth');
  const realAuth = auth.requireAuth;
  let unauthorized;
  await realAuth({ headers: {} }, {
    status(code) { unauthorized = code; return this; }, json() {},
  }, () => assert.fail('missing token accepted'));
  assert.equal(unauthorized, 401);
  t.mock.method(auth, 'requireAuth', (req, res, next) => {
    if (!req.headers['x-test-role']) return res.status(401).json({ success: false, message: 'Unauthorized' });
    req.user = { role: req.headers['x-test-role'] }; next();
  });
  const app = require('../dist/app').default;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1/facilities';
  const request = (method, suffix = '', role, body) => fetch(base + suffix, {
    method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const method of ['GET', 'POST', 'PATCH']) {
    assert.equal((await request(method, method === 'PATCH' ? '/' + id : '')).status, 401);
  }
  for (const role of ['CUSTOMER', 'FACILITY_STAFF', 'FACILITY_MANAGER']) {
    for (const [method, suffix, body] of [
      ['POST', '', valid()], ['PATCH', '/' + id, { name: 'New' }],
      ['PATCH', '/' + id + '/status', { status: 'INACTIVE' }],
    ]) assert.equal((await request(method, suffix, role, body)).status, 403);
  }
  t.mock.method(Model, 'create', async data => new Model(data));
  for (const role of ['ADMIN', 'BOM']) {
    const response = await request('POST', '', role, valid());
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.code, 'HCM-01');
  }
  t.mock.method(Model, 'findById', () => query(new Model(valid())));
  let response = await request('GET', '/' + id, 'CUSTOMER');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  t.mock.method(Model, 'findByIdAndUpdate', (_id, update) => query(update.$set));
  assert.equal((await request('PATCH', '/' + id, 'ADMIN', { name: 'New' })).status, 200);
  assert.equal((await request('PATCH', '/' + id + '/status', 'BOM', { status: 'INACTIVE' })).status, 200);
  assert.equal((await request('GET', '/invalid', 'CUSTOMER')).status, 400);
  t.mock.method(Model, 'findById', () => query(null));
  assert.equal((await request('GET', '/' + id, 'CUSTOMER')).status, 404);
  t.mock.method(Model, 'create', () => { throw { code: 11000, message: 'private Mongo' }; });
  response = await request('POST', '', 'ADMIN', valid());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, message: 'Conflict' });
  t.mock.method(Model, 'create', () => { throw new Error('private Mongo'); });
  response = await request('POST', '', 'ADMIN', valid());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, message: 'Internal Server Error' });
  assert.equal((await request('DELETE', '/' + id, 'ADMIN')).status, 404);
});

