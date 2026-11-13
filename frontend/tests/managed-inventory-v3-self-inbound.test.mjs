import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildA2InboundPayload, inboundErrorMessage, inboundFieldErrors } from '../src/components/customer/inventory/managedSelfInboundV3Validation.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const component = read('../src/components/customer/inventory/ManagedSelfInboundV3.jsx');
const adapter = read('../src/api/managedInventoryV3Api.js');
const allowlist = read('../src/api/confirmedContract.js');
const integration = read('../src/components/customer/inventory/InventoryIntegration.jsx');
const staffMonitor = read('../src/components/facility/ManagedInventoryV3Monitor.jsx');
const managerRoutes = read('../src/routes/ManagerRoutes.jsx');

test('Customer Self-Inbound uses real V3 preview, confirmation, stock and movement endpoints', () => {
  for (const method of ['physicalUnits', 'preparePhysicalUnit', 'previewInbound', 'confirmInbound', 'stock', 'movements', 'operation']) assert.match(component, new RegExp(`managedInventoryV3Api\\.${method}\\(`));
  assert.match(component, /includes\('INBOUND'\)/);
  assert.match(component, /Xác nhận nghĩa là bạn đã tự đặt hàng/);
  assert.match(component, /if \(!payload \|\| \(busy && !allowBusy\)\) return/);
  assert.doesNotMatch(component, /requestInbound\(|confirm-inbound|inventoryApi/);
  assert.match(integration, /ManagedSelfInboundV3/);
});

test('A1 Self-Inbound sends explicit pose and explains unsupported multi-Cell placement', () => {
  assert.match(component, /pose:\s*\{\s*xStartM:\s*Number\(pose\.xStartM\),\s*yStartM:\s*Number\(pose\.yStartM\),\s*rotationDeg:\s*Number\(pose\.rotationDeg\)/);
  assert.match(component, /A1 tọa độ X mét/);
  assert.match(component, /A1 tọa độ Y mét/);
  assert.match(component, /A1 góc xoay/);
  assert.match(component, /A1 nhiều Cell hiện chưa hỗ trợ vì thiếu chứng nhận load-sharing/);
  assert.match(component, /poseBounds/);
});

test('A2 UI payload normalizes numeric strings and preserves the verified screen field names', () => {
  const result = buildA2InboundPayload({ sessionId:'session-1', sessionRevision:3, selectedCells:['cell-1'], quantities:{'cell-1':'1'}, quantity:'1', quantityUnit:'piece', weight:'70', dimensions:{widthM:'0.2',depthM:'0.3',heightM:'0.1'} });
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.payload, { itemKind:'A2_BATCH', accessSessionId:'session-1', sessionRevision:3, cellIds:['cell-1'], quantity:1, quantityUnit:'piece', actualUnitWeightKg:70, dimensionsM:{widthM:0.2,depthM:0.3,heightM:0.1}, placements:[{cellId:'cell-1',quantity:1}] });
  for (const value of [result.payload.quantity, result.payload.actualUnitWeightKg, result.payload.dimensionsM.widthM, result.payload.placements[0].quantity]) assert.equal(typeof value, 'number');
});

test('A2 validation rejects malformed numeric values and placement totals before preview', () => {
  const invalid = buildA2InboundPayload({ sessionId:'session-1', sessionRevision:3, selectedCells:['cell-1','cell-2'], quantities:{'cell-1':'1','cell-2':'1'}, quantity:'1', quantityUnit:'piece', weight:'not-a-number', dimensions:{widthM:'0.2',depthM:'',heightM:'0.1'} });
  assert.equal(invalid.errors.placementsTotal, 'Tổng số lượng tại các ô kệ phải bằng số lượng dự kiến.');
  assert.ok(invalid.errors.actualUnitWeightKg);
  assert.ok(invalid.errors['dimensionsM.depthM']);
  assert.equal(invalid.payload.actualUnitWeightKg, NaN);
  assert.ok(invalid.payload.placements.every(line => typeof line.quantity === 'number'));
});

test('Inbound backend failures remain distinct and field validation details are surfaced', () => {
  assert.match(inboundErrorMessage({response:{data:{code:'CAPACITY_EXCEEDED'}}}), /sức chứa/);
  assert.match(inboundErrorMessage({response:{data:{code:'LEVEL_CAPACITY_EXCEEDED'}}}), /sức chịu tải/);
  assert.match(inboundErrorMessage({response:{data:{code:'ACCESS_SESSION_SCOPE_INVALID'}}}), /Phiên đến kho/);
  assert.match(inboundErrorMessage({response:{data:{code:'TOPOLOGY_CELL_UNCERTIFIED'}}}), /Cấu trúc kho/);
  assert.match(inboundErrorMessage({response:{data:{code:'INVALID_INPUT'}}}), /định dạng/);
  assert.deepEqual(inboundFieldErrors({response:{data:{errors:{quantity:'Must be integer',weight:'Must be positive',ignored:{}}}}}), {quantity:'Must be integer',weight:'Must be positive'});
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
