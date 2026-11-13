import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('V3 SKU uses Customer Self-Outbound component and does not mount V2 outbound', async () => {
  const source = await read('../src/components/customer/inventory/InventoryIntegration.jsx');
  assert.match(source, /ManagedSelfOutboundV3/);
  assert.match(source, /inventorySchemaVersion\s*===\s*3/);
  assert.match(source, /CanonicalCustomerOutbound/);
  assert.match(source, /<ManagedSelfOutboundV3/);
});

test('Customer V3 outbound UI exposes FIFO, held/available stock, OUTBOUND scheduling and physical attestation', async () => {
  const source = await read('../src/components/customer/inventory/ManagedSelfOutboundV3.jsx');
  for (const expected of ['Tồn thực tế', 'Đang giữ', 'Khả dụng', 'FIFO', 'Đặt lịch đến kho để xuất hàng', 'purpose=OUTBOUND', 'Session OUTBOUND', 'Tôi đã thực tế lấy đúng hàng', 'Xác nhận xuất hàng']) assert.ok(source.includes(expected), `missing ${expected}`);
  assert.match(source, /managedInventoryV3OutboundApi\.preview/);
  assert.match(source, /managedInventoryV3OutboundApi\.confirm/);
  assert.match(source, /pendingConfirm/);
  assert.match(source, /Movement/);
  assert.doesNotMatch(source, /Manager approval|WAITING_MANAGER_APPROVAL|mock success/i);
});

test('Customer V3 outbound adapter uses the dedicated API namespace and reuses pending idempotency evidence', async () => {
  const source = await read('../src/api/managedInventoryV3OutboundApi.js');
  for (const route of ["'/context'", "'-requests'", '/cancel', '/preview', '/confirm', '/v3/outbound/operations']) assert.ok(source.includes(route), `missing ${route}`);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /If-Match/);
  assert.match(source, /savePending/);
});
