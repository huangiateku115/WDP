import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const apiPath = fileURLToPath(new URL('../src/api/inventoryApi.js', import.meta.url));
const v3ApiPath = fileURLToPath(new URL('../src/api/managedInventoryV3Api.js', import.meta.url));
const customerPath = fileURLToPath(new URL('../src/components/customer/inventory/RepeatedInboundRequests.jsx', import.meta.url));
const staffPath = fileURLToPath(new URL('../src/pages/staff/RepeatedInboundQueuePage.jsx', import.meta.url));
const routesPath = fileURLToPath(new URL('../src/routes/StaffRoutes.jsx', import.meta.url));
const facilityOutboundPath = fileURLToPath(new URL('../src/components/facility/FacilityOutboundRequests.jsx', import.meta.url));
const relocationApiPath = fileURLToPath(new URL('../src/api/managedInventoryV3RelocationApi.js', import.meta.url));
const relocationCustomerPath = fileURLToPath(new URL('../src/components/customer/inventory/ManagedSelfRelocationV3.jsx', import.meta.url));
const inventoryIntegrationPath = fileURLToPath(new URL('../src/components/customer/inventory/InventoryIntegration.jsx', import.meta.url));
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

test('Facility Outbound view is read-only and observes committed V3 REMOVE movements', async () => {
  const [api, component] = await Promise.all([readFile(v3ApiPath, 'utf8'), readFile(facilityOutboundPath, 'utf8')]);
  assert.match(api, /facilityOverview:/);
  assert.match(component, /managedInventoryV3Api\.facilityOverview/);
  assert.match(component, /stockEffect\?\.action === 'REMOVE'/);
  assert.match(component, /không tự xác nhận hoặc giảm tồn/);
  assert.doesNotMatch(component, /confirmCanonicalOutbound|cancelCanonicalOutbound|router\.post|outbound-requests/i);
});

test('Customer Managed V3 relocation uses scoped session, receipt-aware preview and replay-safe MOVE API', async () => {
  const [api, component, integration, routes] = await Promise.all([
    readFile(relocationApiPath, 'utf8'), readFile(relocationCustomerPath, 'utf8'),
    readFile(inventoryIntegrationPath, 'utf8'), readFile(routesPath, 'utf8'),
  ]);
  assert.match(api, /v3\/relocation/);
  assert.match(api, /Idempotency-Key/);
  assert.match(api, /If-Match/);
  assert.match(api, /sessionStorage/);
  assert.match(api, /operation:/);
  assert.match(component, /allowedPurposes\?\.includes\('RELOCATION'\)/);
  assert.match(component, /managedInventoryV3RelocationApi\.preview/);
  assert.match(component, /managedInventoryV3RelocationApi\.confirm/);
  assert.match(component, /customerAttestation: attested \? 'CONFIRMED'/);
  assert.match(component, /itemInstanceId/);
  assert.match(component, /sourceCellId/);
  assert.match(component, /quantity: Number\(line\.quantity\)/);
  assert.match(integration, /ManagedSelfRelocationV3 item=\{item\} rental=\{rental\}/);
  assert.doesNotMatch(routes, /CanonicalRelocationPage/);
});

test('Customer relocation keeps explicit error and retry states; Facility routes remain role-gated', async () => {
  const [relocation, outlet, facilityGate, workspace] = await Promise.all([
    readFile(relocationCustomerPath, 'utf8'), readFile(roleOutletPath, 'utf8'), readFile(facilityGatePath, 'utf8'), readFile(workspacePath, 'utf8'),
  ]);
  assert.match(relocation, /role="alert"/);
  assert.match(relocation, /Tải lại tồn và vị trí/);
  assert.match(outlet, /FacilitySessionGate role=\{role\}/);
  assert.match(facilityGate, /<Navigate to="\/login"/);
  assert.match(facilityGate, /expected=role==='staff'\?'FACILITY_STAFF'/);
  assert.match(workspace, /"managed"/);
  assert.doesNotMatch(workspace, /"inventory\/(outbound|relocation)"/);
});
