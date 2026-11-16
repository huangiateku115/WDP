import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Phase 4 Customer SKU detail mounts direct V3 Self-Outbound beside Unified Inbound", async () => {
  const source = await read(
    "../src/components/customer/inventory/InventoryIntegration.jsx",
  );
  assert.match(
    source,
    /inventorySchemaVersion===3&&<ManagedUnifiedSelfInbound/,
  );
  assert.match(source, /inventorySchemaVersion===3&&<ManagedSelfOutboundV3/);
  assert.doesNotMatch(source, /<CanonicalCustomerOutbound/);
  assert.doesNotMatch(source, /<ManagedSelfInboundV3/);
});

test("V3 direct outbound API routes are mounted for Customer only with preview and confirm", async () => {
  const source = await read(
    "../../backend/src/routes/inventory-item.routes.ts",
  );
  for (const route of [
    "router.get('/:id/v3/outbound/context', customer, v3OutboundController.context)",
    "router.get('/:id/v3/outbound/operations', customer, v3OutboundController.operation)",
    "router.post('/:id/v3/outbound/preview', customer, v3OutboundLimiter, v3OutboundController.preview)",
    "router.post('/:id/v3/outbound', customer, v3OutboundLimiter, v3OutboundController.confirm)",
  ])
    assert.ok(source.includes(route), `missing ${route}`);
  assert.doesNotMatch(source, /v3\/outbound-requests/);
  assert.doesNotMatch(source, /router\.post\('\/:id\/v3\/outbound-requests/);
});

test("Customer direct outbound adapter keeps exact request identity for recovery", async () => {
  const source = await read("../src/api/managedInventoryV3OutboundApi.js");
  for (const route of ["'/context'", "'/preview'", "'/operations'"])
    assert.ok(source.includes(route));
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /If-Match/);
  assert.match(source, /savePending/);
  assert.match(source, /payload: canonical\(payload\)/);
});

test("Customer outbound UI previews before attested confirm and has no manager approval/request-hold flow", async () => {
  const source = await read(
    "../src/components/customer/inventory/ManagedSelfOutboundV3.jsx",
  );
  assert.match(source, /managedInventoryV3OutboundApi\.preview/);
  assert.match(source, /managedInventoryV3OutboundApi\.confirm/);
  assert.match(source, /physicalRemovalConfirmed: true/);
  assert.match(source, /customerAttestation/);
  assert.doesNotMatch(source, /WAITING_MANAGER_APPROVAL|approve|stock hold/i);
});
