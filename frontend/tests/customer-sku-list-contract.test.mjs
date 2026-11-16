import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryCollection, inventoryError, editableInventory } from '../src/lib/inventoryRegistration.js';

const id = 'a'.repeat(24);
const reservationId = 'b'.repeat(24);
const facilityId = 'c'.repeat(24);
const sku = { _id: id, skuId: id, inventorySchemaVersion: 3, customerId: 'd'.repeat(24), reservationId, managedReservationId: reservationId, facilityId, categoryId: 'e'.repeat(24), itemCode: 'SKU-001', name: 'Thùng hồ sơ', category: 'Hồ sơ', images: [], status: 'ACTIVE' };
const page = items => ({ data: { success: true, data: items, pagination: { page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0 } } });

test('Customer SKU list accepts the flat paginated collection contract and renders valid SKU rows', () => {
  const parsed = inventoryCollection(page([sku]));
  assert.deepEqual(parsed.items, [sku]);
  assert.equal(parsed.pagination.total, 1);
});

test('Customer SKU list accepts a valid empty collection without fabricating rows', () => {
  const parsed = inventoryCollection(page([]));
  assert.deepEqual(parsed.items, []);
  assert.equal(parsed.pagination.totalPages, 0);
});

test('Customer SKU list preserves multi-page pagination metadata', () => {
  const response = { data: { success: true, data: [sku], pagination: { page: 2, limit: 20, total: 41, totalPages: 3 } } };
  assert.deepEqual(inventoryCollection(response).pagination, response.data.pagination);
});

test('Customer SKU list rejects a nested or malformed collection rather than treating it as empty', () => {
  assert.throws(() => inventoryCollection({ data: { success: true, data: { data: [sku], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } } }), /không đúng định dạng/);
  assert.throws(() => inventoryCollection({ data: { success: true, data: [sku], pagination: { page: 1, limit: 20, total: 1 } } }), /không đúng định dạng/);
});

test('Customer SKU API errors remain visible and localized for auth, ownership and server failures', () => {
  assert.match(inventoryError({ response: { status: 401 } }), /đăng nhập lại/);
  assert.match(inventoryError({ response: { status: 403 } }), /không có quyền/);
  assert.match(inventoryError({ response: { status: 404 } }), /Không tìm thấy/);
  assert.match(inventoryError({ response: { status: 500 } }), /Máy chủ/);
});

test('ACTIVE V3 SKU returned by Backend can open its specifications workflow', () => {
  const now = Date.now();
  const rental = { _id: reservationId, facilityId, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, status: 'CHECKIN_READY', allocatedCapacity: 1, endDate: new Date(now + 60_000).toISOString() };
  assert.equal(editableInventory({ ...sku, inventorySchemaVersion: 3 }, rental, now), true);
});

test('SKU list uses the authenticated /me adapter and exposes a real reload action', () => {
  const api = readFileSync(new URL('../src/api/inventoryApi.js', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../src/components/customer/inventory/InventoryIntegration.jsx', import.meta.url), 'utf8');
  assert.match(api, /get\("\/inventory-items\/me"/);
  assert.match(screen, /inventoryApi\s*\.getMine\(\{ page, limit: 20 \}, config\)/);
  assert.match(screen, /onClick=\{resource\.retry\}/);
});
