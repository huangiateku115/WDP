const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
Object.assign(process.env, { NODE_ENV: 'test', MONGO_URL: 'mongodb://127.0.0.1:27018/unused_test_only',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-only', KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs' });
const mongoose = require('mongoose');
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const Balance = require('../dist/models/inventory-items/inventory-stock-balance.model').default;
const { RepeatedInboundOperationsService: service } = require('../dist/services/inventory-items/repeated-inbound-operations.service');
const ids = { item: '507f1f77bcf86cd799439001', owner: '507f1f77bcf86cd799439002', other: '507f1f77bcf86cd799439003', facility: '507f1f77bcf86cd799439004' };
const oid = value => new mongoose.Types.ObjectId(value);
class Query { constructor(value) { this.value = value; } select() { return this; } lean() { return this; } exec() { return Promise.resolve(this.value); } }

test('Customer stock-balance GET is owner-scoped and returns no data for another Customer', async t => {
  let itemFilter;
  const row = { _id: oid(ids.item), facilityId: oid(ids.facility), customerId: oid(ids.owner), managedReservationId: oid('507f1f77bcf86cd799439005') };
  const balance = { itemId: row._id, facilityId: row.facilityId, customerId: row.customerId, onHandQuantity: 8, heldQuantity: 3, version: 2 };
  t.mock.method(Item, 'findOne', filter => { itemFilter = filter; return new Query(String(filter.customerId) === ids.owner ? row : null); });
  t.mock.method(Balance, 'findOne', filter => new Query(String(filter.itemId) === ids.item ? balance : null));
  const owned = await service.stockBalance(ids.item, { _id: oid(ids.owner), role: 'CUSTOMER' });
  assert.equal(String(itemFilter.customerId), ids.owner); assert.equal(owned.onHandQuantity, 8); assert.equal(owned.heldQuantity, 3);
  await assert.rejects(service.stockBalance(ids.item, { _id: oid(ids.other), role: 'CUSTOMER' }), { status: 404 });
});
