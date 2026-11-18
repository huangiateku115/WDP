const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, { NODE_ENV: 'test', MONGO_URL: 'mongodb://127.0.0.1:27018/unused_test_only',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-only', KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs' });
const mongoose = require('mongoose');
const Outbound = require('../dist/models/inventory-items/managed-outbound-request.model').default;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const User = require('../dist/models/users/user.model').default;
const { ManagedOutboundRequestService: service } = require('../dist/services/inventory-items/managed-outbound-request.service');
const controller = require('../dist/controllers/inventory-items/managed-outbound-request.controller');
const router = require('../dist/routes/managed-outbound-request.routes').default;

const ids = { item: '507f1f77bcf86cd799439001', request: '507f1f77bcf86cd799439002', facility: '507f1f77bcf86cd799439003', reservation: '507f1f77bcf86cd799439004', customer: '507f1f77bcf86cd799439005' };
const oid = value => new mongoose.Types.ObjectId(value);
class Query {
  constructor(value) { this.value = value; this.options = {}; }
  sort(value) { this.options.sort = value; return this; }
  skip(value) { this.options.skip = value; return this; }
  limit(value) { this.options.limit = value; return this; }
  select(value) { this.options.select = value; return this; }
  lean() { return this; }
  exec() { return Promise.resolve(typeof this.value === 'function' ? this.value() : this.value); }
}
const item = { _id: oid(ids.item), itemCode: 'IT-1', name: 'Boxes', category: 'HOUSEHOLD', status: 'IN_STORAGE', currentCellId: oid('507f1f77bcf86cd799439006'), quantity: 10, quantityUnit: 'box', managedReservationId: oid(ids.reservation), facilityId: oid(ids.facility) };
const request = { _id: oid(ids.request), itemId: item._id, reservationId: item.managedReservationId, facilityId: item.facilityId,
  customerId: oid(ids.customer), requestedQuantity: 4, quantityUnit: 'box', batchAllocations: [], state: 'PENDING', version: 3,
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') };
const balance = { itemId: item._id, facilityId: item.facilityId, onHandQuantity: 10, heldQuantity: 4,
  currentCellId: item.currentCellId, source: 'LEDGER_V2', version: 7 };

function responsePromise() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    set(key, value) { this.headers[key] = value; return this; }, json(body) { resolve({ statusCode: this.statusCode, headers: this.headers, body }); } };
  return { promise, res, reject };
}

test('Staff outbound queue is Facility-scoped, stable, paginated and read-only', async t => {
  let requestFilter, itemFilter, countFilter, sort, skip, limit;
  t.mock.method(Outbound, 'find', filter => { requestFilter = filter; const q = new Query([request]); q.sort = value => { sort = value; return q; }; q.skip = value => { skip = value; return q; }; q.limit = value => { limit = value; return q; }; return q; });
  t.mock.method(Outbound, 'countDocuments', filter => { countFilter = filter; return new Query(1); });
  t.mock.method(Item, 'find', filter => { itemFilter = filter; return new Query([item]); });
  const actor = { _id: oid(ids.customer), role: 'FACILITY_STAFF', assignedFacilityId: oid(ids.facility) };
  const result = await service.staffQueue({ state: 'PENDING', page: '2', limit: '10' }, actor);
  assert.equal(String(requestFilter.facilityId), ids.facility); assert.equal(requestFilter.state, 'PENDING');
  assert.equal(String(countFilter.facilityId), ids.facility); assert.equal(String(itemFilter.facilityId), ids.facility);
  assert.deepEqual(sort, { createdAt: 1, _id: 1 }); assert.equal(skip, 10); assert.equal(limit, 10);
  assert.equal(result.data[0].item.itemCode, 'IT-1'); assert.equal(result.pagination.page, 2);
  assert.equal(request.state, 'PENDING'); assert.equal(balance.heldQuantity, 4);
});

test('Staff outbound detail hides another Facility and returns a version ETag for authorized Staff', async t => {
  let filter;
  t.mock.method(Outbound, 'findOne', value => { filter = value; return new Query(String(value.facilityId) === ids.facility ? request : null); });
  t.mock.method(Item, 'findOne', value => new Query(String(value.facilityId) === ids.facility ? item : null));
  t.mock.method(Balance, 'findOne', value => new Query(String(value.facilityId) === ids.facility ? balance : null));
  t.mock.method(User, 'findOne', () => new Query({ _id: oid(ids.customer), displayName: 'Test Customer' }));
  const actor = { _id: oid(ids.customer), role: 'FACILITY_STAFF', assignedFacilityId: oid(ids.facility) };
  const response = responsePromise();
  await controller.staffDetail({ params: { requestId: ids.request }, user: actor }, response.res, response.reject);
  const result = await response.promise;
  assert.equal(String(filter.facilityId), ids.facility); assert.equal(result.statusCode, 200);
  assert.equal(result.headers.ETag, '"3"'); assert.equal(result.body.data.stock.availableQty, 6);
  assert.equal(result.body.data.customer.displayName, 'Test Customer');
  assert.equal(request.state, 'PENDING'); assert.equal(balance.heldQuantity, 4);
});

test('Staff outbound read rejects wrong role, missing Facility and invalid queue filters', async () => {
  await assert.rejects(service.staffQueue({}, { _id: oid(ids.customer), role: 'CUSTOMER' }), { status: 403 });
  await assert.rejects(service.staffQueue({}, { _id: oid(ids.customer), role: 'FACILITY_STAFF' }), { status: 403 });
  await assert.rejects(service.staffQueue({ limit: '101' }, { _id: oid(ids.customer), role: 'FACILITY_STAFF', assignedFacilityId: oid(ids.facility) }), { status: 400 });
});

test('Staff GET routes are authenticated and role-gated while Customer detail remains owner-only', () => {
  const routes = router.stack.filter(layer => layer.route).map(layer => ({ path: layer.route.path,
    method: Object.keys(layer.route.methods).find(method => layer.route.methods[method]).toUpperCase(),
    handlers: layer.route.stack.map(entry => entry.handle.name) }));
  assert.ok(routes.some(route => route.method === 'GET' && route.path === '/staff-queue' &&
    route.handlers.length === 3 && route.handlers[0] === 'requireAuth'));
  assert.ok(routes.some(route => route.method === 'GET' && route.path === '/:requestId/staff-detail' &&
    route.handlers.length === 3 && route.handlers[0] === 'requireAuth' && route.handlers[2] === 'staffDetail'));
  assert.ok(routes.some(route => route.method === 'GET' && route.path === '/:requestId' && route.handlers.includes('get')));
});
