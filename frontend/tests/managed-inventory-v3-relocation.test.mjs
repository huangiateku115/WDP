import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';

const id = 'a'.repeat(24);
const apiPath = fileURLToPath(new URL('../src/api/managedInventoryV3RelocationApi.js', import.meta.url));
const componentPath = fileURLToPath(new URL('../src/components/customer/inventory/ManagedSelfRelocationV3.jsx', import.meta.url));
const integrationPath = fileURLToPath(new URL('../src/components/customer/inventory/InventoryIntegration.jsx', import.meta.url));

test('Customer relocation allowlist is exact and legacy relocation writers are blocked', () => {
  const allowed = [
    ['GET', `/inventory-items/${id}/v3/relocation/context`],
    ['GET', `/inventory-items/${id}/v3/relocation/operations`],
    ['POST', `/inventory-items/${id}/v3/relocation/preview`],
    ['POST', `/inventory-items/${id}/v3/relocation`],
  ];
  for (const [method, url] of allowed) assert.doesNotThrow(() => assertConfirmedRequest({ method, url }));
  for (const [method, url] of allowed) {
    for (const wrongMethod of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (wrongMethod !== method) assert.throws(() => assertConfirmedRequest({ method: wrongMethod, url }), /not confirmed/);
    }
    assert.throws(() => assertConfirmedRequest({ method, url: `${url}/extra` }), /not confirmed/);
  }
  for (const url of [`/inventory-items/${id}/relocate`, `/inventory-items/${id}/relocate-canonical`, `/inventory-items/${id}/relocate-canonical/context`]) {
    assert.throws(() => assertConfirmedRequest({ method: 'POST', url }), /not confirmed/);
  }
});

test('Customer UI requires an active checked-in RELOCATION scope, preview, attestation and movement verification', async () => {
  const [api, component, integration] = await Promise.all([
    readFile(apiPath, 'utf8'), readFile(componentPath, 'utf8'), readFile(integrationPath, 'utf8'),
  ]);
  assert.match(api, /sessionStorage/);
  assert.match(api, /Idempotency-Key/);
  assert.match(api, /If-Match/);
  assert.match(api, /operation:/);
  assert.match(component, /allowedPurposes\?\.includes\('RELOCATION'\)/);
  assert.match(component, /chosenSessionCoversSelectedCells/);
  assert.match(component, /sourceReservationId/);
  assert.match(component, /destinationReservationId/);
  assert.match(component, /reservationCode/);
  assert.match(component, /additionalReservationId/);
  assert.match(component, /managedInventoryV3RelocationApi\.preview/);
  assert.match(component, /managedInventoryV3RelocationApi\.confirm/);
  assert.match(component, /customerAttestation: attested \? 'CONFIRMED'/);
  assert.match(component, /movement\?\.stockEffect\?\.action !== 'MOVE'/);
  assert.match(component, /itemSpecificationStock\(skuId, ref\(spec\.itemSpecId\)\)/);
  assert.match(component, /managedInventoryV3Api\.movements\(skuId\)/);
  assert.match(component, /warehouseMapApi\.getWarehouseMap\(facilityId\)/);
  assert.match(component, /line\.stockKind === 'INSTANCE'/);
  assert.match(component, /availableStockKinds\(spec\)/);
  assert.match(component, /Theo số lượng trong lô/);
  assert.match(component, /Món nguyên vẹn/);
  assert.doesNotMatch(component, /spec\?\.instances\?\.length \? 'INSTANCE' : 'LOT'/);
  assert.match(component, /đặt lịch đến kho với mục đích chuyển vị trí/);
  assert.match(integration, /ManagedSelfRelocationV3 item=\{item\} rental=\{rental\}/);
});
