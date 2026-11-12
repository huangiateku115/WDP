import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const component = read('../src/components/customer/inventory/ManagedSelfInboundV3.jsx');
const adapter = read('../src/api/managedInventoryV3Api.js');
const allowlist = read('../src/api/confirmedContract.js');
const integration = read('../src/components/customer/inventory/InventoryIntegration.jsx');
const staffMonitor = read('../src/components/facility/ManagedInventoryV3Monitor.jsx');
const managerRoutes = read('../src/routes/ManagerRoutes.jsx');

test('Customer Self-Inbound uses real V3 preview, confirmation, stock and movement endpoints', () => {
  for (const method of ['physicalUnits', 'preparePhysicalUnit', 'previewInbound', 'confirmInbound', 'stock', 'movements', 'operation']) assert.match(component, new RegExp(`managedInventoryV3Api\\.${method}\\(`));
  assert.match(component, /Session INBOUND/);
  assert.match(component, /Xác nhận nghĩa là bạn đã tự đặt hàng/);
  assert.match(component, /if \(!payload \|\| \(busy && !allowBusy\)\) return/);
  assert.doesNotMatch(component, /requestInbound\(|confirm-inbound|inventoryApi/);
  assert.match(integration, /ManagedSelfInboundV3/);
});

test('Customer API preserves exact idempotent payload for retry and refuses changed pending request', () => {
  assert.match(adapter, /Idempotency-Key/);
  assert.match(adapter, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
  assert.match(adapter, /payload: canonical\(payload\)/);
  assert.match(adapter, /sessionStorage/);
  assert.match(adapter, /IDEMPOTENCY_STORAGE_UNAVAILABLE/);
  assert.match(adapter, /preview/);
  assert.match(allowlist, /inventory-items\\\/\[a-f\\d\]\{24\}\\\/v3\\\//);
  assert.match(allowlist, /managed-v3\\\/facility\\\/overview/);
});

test('Staff and Manager V3 pages are read-only and Manager route is present', () => {
  assert.match(staffMonitor, /readOnly|chỉ hiển thị|không có nút xác nhận/i);
  assert.match(managerRoutes, /managed-inventory-v3/);
  assert.match(staffMonitor, /facilityOverview\(\)/);
  assert.match(staffMonitor, /facilitySessions\(\)/);
  assert.doesNotMatch(staffMonitor, /confirmInbound|preparePhysicalUnit|setQuantity\(/);
});
