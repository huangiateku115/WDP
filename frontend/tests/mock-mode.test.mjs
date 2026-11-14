import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (relative) => readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');

// Mock/demo data is opt-in. A build without VITE_USE_MOCK must call the Backend, otherwise a
// deployment that forgets the variable silently renders fake facilities, units and contracts.
const FAIL_CLOSED = [
  'api/contractApi.js', 'api/facilityApi.js', 'api/inventoryApi.js',
  'api/reservationApi.js', 'api/storageApi.js', 'api/supportApi.js',
  'lib/customerDemoStore.js', 'lib/managerDemoStore.js', 'lib/staffDemoStore.js',
];

test('every mock switch is opt-in and no longer mock-by-default', () => {
  for (const file of FAIL_CLOSED) {
    const text = source(file);
    assert.doesNotMatch(text, /VITE_USE_MOCK\s*!==\s*["']false["']/, `${file} still treats a missing VITE_USE_MOCK as mock mode`);
    assert.match(text, /VITE_USE_MOCK\s*===\s*["']true["']/, `${file} must only enable mock data when VITE_USE_MOCK=true`);
  }
});

test('role workspace and the two remaining page switches use the same opt-in rule', () => {
  const outlet = source('components/common/RoleWorkspaceOutlet.jsx');
  assert.doesNotMatch(outlet, /VITE_USE_MOCK\s*!==\s*['"]false['"]/);
  assert.doesNotMatch(outlet, /VITE_USE_MOCK\s*===\s*['"]false['"]/);
  assert.match(outlet, /VITE_USE_MOCK\s*!==\s*'true'.*FacilitySessionGate/s);

  assert.match(source('pages/customer/MyInventoryPage.jsx'), /VITE_USE_MOCK\s*!==\s*'true'/);
  assert.match(source('pages/manager/ServiceDeskPage.jsx'), /VITE_USE_MOCK\s*!==\s*'true'/);
});

test('the shared BOM/Admin shell does not depend on the manager demo store', () => {
  const managerUi = source('components/manager/ManagerUI.jsx');
  assert.doesNotMatch(managerUi, /lib\/managerDemoStore/, 'ManagerUI must not import the demo store (it would bundle the mock seed into BOM/Admin)');
  assert.doesNotMatch(managerUi, /mocks\//, 'ManagerUI must not import mock seeds');
  assert.match(managerUi, /const money\s*=/, 'ManagerUI must own its money formatter');
  assert.match(managerUi, /export \{Button,Input,Card,CardContent,money\}/);
});

test('BOM/Admin screens never claim the Backend is unavailable when data is live', () => {
  const managerUi = source('components/manager/ManagerUI.jsx');
  assert.doesNotMatch(managerUi, /Chưa kết nối dịch vụ quản lý/);
  assert.match(managerUi, /note&&<p className="manager-demo/, 'the demo notice must only render when demo mode is on');
  assert.doesNotMatch(source('layouts/BomLayout.jsx'), /Business demo workspace/);
});
