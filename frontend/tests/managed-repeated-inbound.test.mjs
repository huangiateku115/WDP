import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const apiPath = fileURLToPath(new URL('../src/api/inventoryApi.js', import.meta.url));
const customerPath = fileURLToPath(new URL('../src/components/customer/inventory/RepeatedInboundRequests.jsx', import.meta.url));
const staffPath = fileURLToPath(new URL('../src/pages/staff/RepeatedInboundQueuePage.jsx', import.meta.url));
const routesPath = fileURLToPath(new URL('../src/routes/StaffRoutes.jsx', import.meta.url));
const customerOutboundPath = fileURLToPath(new URL('../src/components/customer/inventory/CanonicalCustomerOutbound.jsx', import.meta.url));
const staffOutboundPath = fileURLToPath(new URL('../src/pages/staff/CanonicalOutboundQueuePage.jsx', import.meta.url));
const relocationPath = fileURLToPath(new URL('../src/pages/staff/CanonicalRelocationPage.jsx', import.meta.url));
const workspacePath = fileURLToPath(new URL('../src/lib/facilityWorkspace.js', import.meta.url));
const roleOutletPath = fileURLToPath(new URL('../src/components/common/RoleWorkspaceOutlet.jsx', import.meta.url));
const facilityGatePath = fileURLToPath(new URL('../src/components/common/FacilitySessionGate.jsx', import.meta.url));

test('Customer API exposes repeated receipt lifecycle with operation keys and If-Match versions', async () => {
  const source = await readFile(apiPath, 'utf8');
  for (const method of ['createRepeatedInbound', 'repeatedInboundHistory', 'repeatedInboundDetail', 'amendRepeatedInbound', 'cancelRepeatedInbound']) assert.match(source, new RegExp(`${method}:`));
  assert.match(source, /'Idempotency-Key': idempotencyKey/);
  assert.match(source, /'If-Match': `"\$\{version\}"`/);
});

test('Customer repeated receipt screen handles replay, uncertain outcome, safe amendment and session replacement', async () => {
  const source = await readFile(customerPath, 'utf8');
  assert.match(source, /response\.status === 200/);
  assert.match(source, /e\.response\?\.status === 503/);
  assert.match(source, /Retry same request/);
  assert.match(source, /useAuthSession/);
  assert.match(source, /setEditing/);
  assert.match(source, /getAccessToken\(\) !== token/);
});

test('Staff repeated receiving page uses the real Facility-scoped API and saves attempts before confirmation', async () => {
  const [source, routes] = await Promise.all([readFile(staffPath, 'utf8'), readFile(routesPath, 'utf8')]);
  for (const action of ['repeatedInboundQueue', 'repeatedInboundReceivingDetail', 'inspectRepeatedInbound', 'confirmRepeatedInbound', 'completeRepeatedInboundReturn']) assert.match(source, new RegExp(`${action}\\(`));
  assert.match(source, /uploadEvidence=\{inventoryApi\.uploadRepeatedInboundEvidence\}/);
  assert.match(source, /evidenceUploadIds/);
  assert.match(source, /ACCEPTED_PENDING_CONFIRMATION/);
  assert.match(source, /RETURN_PENDING/);
  assert.match(routes, /path="inventory\/inbound" element=\{<Navigate to="\/staff\/managed-inventory-v3" replace \/>\}/);
  assert.doesNotMatch(routes, /\['inventory\/inbound',\s*'INBOUND'\]/);
  assert.match(source, /token !== getAccessToken\(\)/);
});

test('Staff legacy inventory routes redirect to V3 supervision without stock mutation pages', async () => {
  const [routes, workspace] = await Promise.all([readFile(routesPath, 'utf8'), readFile(workspacePath, 'utf8')]);
  for (const route of ['inventory/inbound', 'inventory/outbound', 'inventory/relocation']) {
    const target = route === 'inventory/inbound' ? '/staff/managed-inventory-v3' : '/staff/managed';
    assert.ok(routes.includes(`path="${route}" element={<Navigate to="${target}" replace />}`));
    assert.ok(!workspace.includes(`"${route}"`));
  }
  assert.match(routes, /path="managed" element=\{<ManagedFacilityPage \/>\}/);
});

test('Customer canonical outbound is separate from legacy action and uses authoritative balance plus lifecycle APIs', async () => {
  const [api, component] = await Promise.all([readFile(apiPath, 'utf8'), readFile(customerOutboundPath, 'utf8')]);
  for (const method of ['createCanonicalOutbound', 'canonicalOutboundHistory', 'canonicalOutboundDetail', 'cancelCanonicalOutbound']) assert.match(api, new RegExp(`${method}:`));
  assert.match(component, /inventoryApi\.stockBalance/);
  assert.match(component, /inventoryApi\.createCanonicalOutbound/);
  assert.match(component, /inventoryApi\.cancelCanonicalOutbound/);
  assert.match(component, /'CANONICAL_V1'/);
  assert.match(component, /sessionStorage\.setItem/);
  assert.match(component, /JSON\.stringify\(\{ key, version: expectedVersion \}\)/);
  assert.match(component, /The cancellation result is uncertain/);
  assert.match(component, /response\.status === 200/);
  assert.match(component, /row\.state === 'PENDING'/);
});

test('Staff outbound queue confirms partial handover with version, stable retry key and refreshed reads', async () => {
  const [api, page] = await Promise.all([readFile(apiPath, 'utf8'), readFile(staffOutboundPath, 'utf8')]);
  for (const method of ['canonicalOutboundStaffQueue', 'canonicalOutboundStaffDetail', 'confirmCanonicalOutbound']) assert.match(api, new RegExp(`${method}:`));
  assert.match(page, /actualDeliveredQty/);
  assert.match(page, /handoverConfirmed: true/);
  assert.match(page, /detail\.request\.version/);
  assert.match(page, /Thử lại cùng xác nhận/);
  assert.match(page, /JSON\.stringify\(\{ key, payload, version: expectedVersion \}\)/);
  assert.match(page, /const expectedVersion = retry/);
  assert.match(page, /Chưa xác định kết quả xác nhận trước/);
  assert.match(page, /canonicalOutboundStaffQueue/);
  assert.match(page, /stockBalance/);
});

test('Canonical relocation screen loads allocated destinations and calls the existing canonical MOVE endpoint', async () => {
  const [api, page] = await Promise.all([readFile(apiPath, 'utf8'), readFile(relocationPath, 'utf8')]);
  assert.match(api, /canonicalRelocationContext:/);
  assert.match(api, /relocateCanonical:/);
  assert.match(page, /sourceCellId: context\.currentCellId/);
  assert.match(page, /destinationCellId: destination/);
  assert.match(page, /physicalPackingConfirmed: true/);
  assert.match(page, /Idempotency-Key|operationKey/);
  assert.match(page, /JSON\.stringify\(\{ key, payload \}\)/);
  assert.match(page, /Chưa rõ kết quả di chuyển trước/);
  assert.match(page, /stockBalance/);
  assert.match(page, /warehouseMapApi\.getWarehouseMap/);
  assert.match(page, /repeatedInboundQueue/);
  assert.match(page, /canonicalOutboundStaffQueue/);
  assert.match(page, /Biến động di chuyển đã lưu/);
});

test('Canonical Staff pages retain authenticated role gating and explicit empty, loading, error and retry states', async () => {
  const [outbound, relocation, outlet, facilityGate, workspace] = await Promise.all([
    readFile(staffOutboundPath, 'utf8'), readFile(relocationPath, 'utf8'), readFile(roleOutletPath, 'utf8'), readFile(facilityGatePath, 'utf8'), readFile(workspacePath, 'utf8'),
  ]);
  assert.match(outbound, /Đang tải yêu cầu xuất hàng/);
  assert.match(outbound, /Không có yêu cầu khớp trạng thái/);
  assert.match(outbound, /role="alert"/);
  assert.match(outbound, /Tải lại hàng chờ/);
  assert.match(relocation, /role="alert"/);
  assert.match(relocation, /Tải dữ liệu di chuyển/);
  assert.match(outlet, /FacilitySessionGate role=\{role\}/);
  assert.match(facilityGate, /<Navigate to="\/login"/);
  assert.match(facilityGate, /expected=role==='staff'\?'FACILITY_STAFF'/);
  assert.match(workspace, /"managed"/);
  assert.doesNotMatch(workspace, /"inventory\/(outbound|relocation)"/);
});
