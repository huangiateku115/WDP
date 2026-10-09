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
const Facility = require('../dist/models/facilities/facility.model').default;
const Unit = require('../dist/models/storage-units/storage-unit.model').default;
const Pricing = require('../dist/models/pricing-policy/pricing-rule.model').default;
const { PublicCatalogService: service } = require('../dist/services/public/public-catalog.service');
const facilityId = '507f1f77bcf86cd799439011';
const query = value => ({
  select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
  lean() { return this; }, exec: async () => value,
});

test('public facility catalog filters ACTIVE non-deleted rows and serializes an allowlist', async t => {
  let listFilter, countFilter;
  const facility = {
    _id: facilityId, code: 'HCM-01', name: 'Main', status: 'ACTIVE',
    address: { line1: 'Road', city: 'HCM', country: 'VN', internalNotes: 'private' },
    contact: { email: 'x@example.test', phone: '123', secret: 'private' },
    serviceTypes: ['SELF_STORAGE'], description: 'Public', operatingHours: 'Daily',
    deletedAt: undefined, deletedBy: 'private', createdBy: 'private', __v: 8,
  };
  t.mock.method(Facility, 'find', filter => { listFilter = filter; return query([facility]); });
  t.mock.method(Facility, 'countDocuments', filter => { countFilter = filter; return query(1); });
  const result = await service.listFacilities({ page: '1', limit: '10' });
  assert.equal(listFilter.status, 'ACTIVE');
  assert.deepEqual(listFilter.deletedAt, { $exists: false });
  assert.deepEqual(countFilter, listFilter);
  assert.equal(result.data.length, 1);
  assert.deepEqual(Object.keys(result.data[0]), ['_id', 'code', 'name', 'address', 'contact', 'serviceTypes', 'description', 'operatingHours']);
  assert.deepEqual(result.data[0].address, { line1: 'Road', city: 'HCM', country: 'VN' });
  assert.deepEqual(result.data[0].contact, { phone: '123', email: 'x@example.test' });
  for (const field of ['deletedAt', 'deletedBy', 'version', 'createdBy', '__v']) {
    assert.equal(JSON.stringify(result).includes(field), false);
  }
  for (const input of [{ isActive: 'true' }, { status: 'INACTIVE' }, { limit: '101' }, { serviceType: 'bad' }])
    await assert.rejects(service.listFacilities(input), { status: 400 });
});

test('public detail and secondary catalog return 404 for inactive/deleted/non-self-storage facility', async t => {
  let filter;
  t.mock.method(Facility, 'findOne', seen => { filter = seen; return query(null); });
  await assert.rejects(service.getFacility(facilityId), { status: 404 });
  assert.equal(filter.status, 'ACTIVE'); assert.deepEqual(filter.deletedAt, { $exists: false });
  await assert.rejects(service.storageOptions(facilityId), { status: 404 });
  t.mock.method(Facility, 'findOne', () => query({ serviceTypes: ['MANAGED_INVENTORY'] }));
  await assert.rejects(service.storageOptions(facilityId), { status: 404 });
});

test('public storage availability counts AVAILABLE non-deleted units by size only', async t => {
  let pipeline;
  t.mock.method(Facility, 'findOne', () => query({ serviceTypes: ['SELF_STORAGE'] }));
  t.mock.method(Unit, 'aggregate', value => { pipeline = value; return { exec: async () => [{ size: 'SMALL', availableCount: 2 }] }; });
  const result = await service.storageOptions(facilityId);
  assert.equal(pipeline[0].$match.status, 'AVAILABLE');
  assert.deepEqual(pipeline[0].$match.deletedAt, { $exists: false });
  assert.equal(String(pipeline[0].$match.facilityId), facilityId);
  assert.deepEqual(result, {
    availabilityIsInformational: true,
    options: [
      { size: 'SMALL', availableCount: 2 }, { size: 'MEDIUM', availableCount: 0 }, { size: 'LARGE', availableCount: 0 },
    ],
  });
  for (const field of ['deletedAt', 'deletedBy', 'version', 'createdBy', '__v']) {
    assert.equal(JSON.stringify(result).includes(field), false);
  }
});

test('public pricing returns only current sanitized rules and supports managed-only facilities', async t => {
  const now = new Date();
  const future = new Date(Date.now() + 60_000);
  let filter;
  t.mock.method(Facility, 'findOne', () => query({ serviceTypes: ['MANAGED_INVENTORY'] }));
  t.mock.method(Pricing, 'find', seen => {
    filter = seen;
    const effective = { serviceType: 'MANAGED_INVENTORY', term: { value: 1, unit: 'MONTH' }, price: 20, currency: 'USD', effectiveFrom: now, isActive: true, version: 9, createdBy: 'private', __v: 4 };
    const futureRule = { ...effective, effectiveFrom: future };
    const inactiveRule = { ...effective, isActive: false };
    const expiredRule = { ...effective, effectiveTo: new Date(Date.now() - 60_000) };
    // Simulate MongoDB applying the actual effective filter at its captured instant.
    const at = seen.effectiveFrom.$lte;
    return query([effective, futureRule, inactiveRule, expiredRule].filter(rule =>
      rule.isActive && rule.effectiveFrom <= at && (!rule.effectiveTo || rule.effectiveTo > at)));
  });
  const result = await service.pricing(facilityId);
  assert.deepEqual(filter.facilityId, new mongoose.Types.ObjectId(facilityId));
  assert.equal(filter.isActive, true);
  assert.ok(filter.effectiveFrom.$lte instanceof Date);
  assert.ok(Array.isArray(filter.$or));
  assert.deepEqual(result, { managedInventory: [{
    serviceType: 'MANAGED_INVENTORY', term: { value: 1, unit: 'MONTH' }, price: 20,
    currency: 'USD', effectiveFrom: now,
  }] });
  assert.equal(JSON.stringify(result).includes('createdBy'), false);
  assert.equal(JSON.stringify(result).includes('version'), false);
  for (const field of ['deletedAt', 'deletedBy', 'createdBy', '__v']) {
    assert.equal(JSON.stringify(result).includes(field), false);
  }
});

test('public HTTP routes are unauthenticated and registered under /api/v1/public', async t => {
  const app = require('../dist/app').default;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/public`;
  const response = await fetch(`${base}/facilities/${facilityId}`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, message: 'Not Found' });
  assert.equal((await fetch(`${base}/facilities/bad`)).status, 400);
});
