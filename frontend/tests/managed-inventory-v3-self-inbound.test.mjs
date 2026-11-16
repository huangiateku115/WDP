import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildUnifiedInboundPayload } from "../src/components/customer/inventory/managedUnifiedInboundForm.js";
import { managedUnifiedInboundErrorMessage } from "../src/components/customer/inventory/managedUnifiedInboundErrors.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = read(
  "../src/components/customer/inventory/ManagedUnifiedSelfInbound.jsx",
);
const adapter = read("../src/api/managedInventoryV3Api.js");
const allowlist = read("../src/api/confirmedContract.js");
const integration = read(
  "../src/components/customer/inventory/InventoryIntegration.jsx",
);
const routes = read("../../backend/src/routes/inventory-item.routes.ts");
const inboundService = read(
  "../../backend/src/services/inventory-items/managed-unified-inbound.service.ts",
);
const movementModel = read(
  "../../backend/src/models/inventory-items/item-movement.model.ts",
);

test("V3 SKU detail mounts unified inbound and direct outbound without legacy A1/A2 UI", () => {
  assert.match(
    integration,
    /inventorySchemaVersion===3&&<ManagedUnifiedSelfInbound/,
  );
  assert.match(
    integration,
    /inventorySchemaVersion===3&&<ManagedSelfOutboundV3/,
  );
  assert.doesNotMatch(integration, /<ManagedSelfInboundV3/);
  assert.doesNotMatch(integration, /<CanonicalCustomerOutbound/);
  assert.match(component, /Phiếu nhập nhiều dòng/);
  assert.match(component, /Thêm dòng hàng/);
  assert.match(component, /Xem trước phiếu nhập/);
  assert.match(component, /Xác nhận đã nhập kho/);
  assert.doesNotMatch(component, /A1|A2|ledger|topology/i);
});

test("one Customer request carries several Item Specifications and normalizes all numeric input", () => {
  const result = buildUnifiedInboundPayload({
    accessSessionId: "session-id",
    sessionRevision: 2,
    skuRevision: 4,
    lines: [
      {
        lineId: "a",
        itemSpecId: "spec-a",
        itemSpecRevision: 1,
        quantity: "3",
        measurementMode: "SPECIFICATION",
        cellAllocations: [{ cellId: "cell-a", quantity: "3" }],
      },
      {
        lineId: "b",
        itemSpecId: "spec-b",
        itemSpecRevision: 2,
        quantity: "2",
        measurementMode: "MEASURED",
        actualUnitWeightKg: "8",
        dimensionsM: { widthM: "0.6", depthM: "0.4", heightM: "0.3" },
        cellAllocations: [{ cellId: "cell-b", quantity: "2" }],
      },
      {
        lineId: "c",
        itemSpecId: "spec-c",
        itemSpecRevision: 1,
        quantity: "1",
        measurementMode: "SPECIFICATION",
        cellAllocations: [{ cellId: "cell-c", quantity: "1" }],
      },
    ],
  });
  assert.deepEqual(result.errors, {});
  assert.equal(result.payload.lines.length, 3);
  assert.equal(
    result.payload.lines.reduce((sum, line) => sum + line.quantity, 0),
    6,
  );
  assert.equal(typeof result.payload.lines[1].actualUnitWeightKg, "number");
  assert.equal(typeof result.payload.lines[1].dimensionsM.heightM, "number");
});

test("Web A1/A2 preview DTOs exclude sessionRevision, while Confirm uses Backend preview revision proof", () => {
  assert.match(
    component,
    /const a1Payload = \(\) => \(\{ itemKind: 'A1_PHYSICAL_UNIT', accessSessionId: sessionId, cellIds:/,
  );
  assert.match(component, /buildA2InboundPayload\(\{ sessionId, selectedCells/);
  assert.match(component, /sessionRevision: proof\.sessionRevision/);
  assert.match(component, /previewRevision: proof\.previewRevision/);
  assert.match(component, /inboundPreviewProofCurrent\(proof, selectedSession/);
  assert.doesNotMatch(component, /previewInbound\([^)]*sessionRevision/);
  const payload = buildA2InboundPayload({
    sessionId: "session-1",
    selectedCells: ["cell-1"],
    quantities: { "cell-1": "1" },
    quantity: "1",
    quantityUnit: "piece",
    weight: "70",
    dimensions: { widthM: "0.2", depthM: "0.3", heightM: "0.1" },
  }).payload;
  assert.equal(Object.hasOwn(payload, "sessionRevision"), false);
  assert.deepEqual(
    Object.keys(payload).sort(),
    [
      "accessSessionId",
      "actualUnitWeightKg",
      "cellIds",
      "dimensionsM",
      "itemKind",
      "placements",
      "quantity",
      "quantityUnit",
    ].sort(),
  );
});

test("Confirm proof must match current session revision, reservation, SKU, cells and expiry", () => {
  const now = Date.parse("2026-11-13T00:00:00.000Z");
  const session = { revision: 4 };
  const expected = {
    sessionId: "session-1",
    reservationId: "reservation-1",
    skuId: "sku-1",
    cellIds: ["cell-1"],
  };
  const proof = {
    accessSessionId: "session-1",
    reservationId: "reservation-1",
    skuId: "sku-1",
    sessionRevision: 4,
    previewRevision: 2,
    expiresAt: "2026-11-13T00:05:00.000Z",
    cellIds: ["cell-1"],
  };
  assert.equal(inboundPreviewProofCurrent(proof, session, expected, now), true);
  assert.equal(
    inboundPreviewProofCurrent(
      { ...proof, sessionRevision: 3 },
      session,
      expected,
      now,
    ),
    false,
  );
  assert.equal(
    inboundPreviewProofCurrent(
      { ...proof, expiresAt: "2026-11-12T23:59:00.000Z" },
      session,
      expected,
      now,
    ),
    false,
  );
  assert.equal(
    inboundPreviewProofCurrent(
      { ...proof, cellIds: ["cell-2"] },
      session,
      expected,
      now,
    ),
    false,
  );
  assert.equal(inboundPreviewProofCurrent(null, session, expected, now), false);
});

test("allocation mismatch, missing Session and invalid measurement are rejected before preview", () => {
  const result = buildUnifiedInboundPayload({
    accessSessionId: "",
    sessionRevision: 1,
    skuRevision: 1,
    lines: [
      {
        lineId: "bad",
        itemSpecId: "spec-a",
        itemSpecRevision: 0,
        quantity: "2",
        measurementMode: "MEASURED",
        actualUnitWeightKg: "NaN",
        dimensionsM: { widthM: "0.2", depthM: "0.3", heightM: "0.1" },
        cellAllocations: [{ cellId: "cell-a", quantity: "1" }],
      },
    ],
  });
  assert.ok(result.errors.accessSessionId);
  assert.ok(result.errors["lines.0.cellAllocations"]);
  assert.ok(result.errors["lines.0.measurements"]);
});

test("Customer adapter preserves exact payload and idempotency identity for replay", () => {
  assert.match(adapter, /\/v3\/inbound\/preview/);
  assert.match(adapter, /\/v3\/inbound`/);
  assert.match(adapter, /Idempotency-Key/);
  assert.match(adapter, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
  assert.match(adapter, /payload: canonical\(payload\)/);
  assert.match(adapter, /sessionStorage/);
  assert.match(adapter, /operation:/);
  assert.match(allowlist, /inventory-items\\\/\[a-f\\d\]\{24\}\\\/v3\\\//);
});

test("Backend exposes Preview and Unified Confirm without reopening legacy stock writers or feature flags", () => {
  assert.match(
    routes,
    /router\.post\('\/:id\/v3\/inbound\/preview', customer, v3Controller\.previewInbound\)/,
  );
  assert.match(
    routes,
    /router\.post\('\/:id\/v3\/inbound', customer, v3Controller\.confirmInbound\)/,
  );
  assert.match(
    routes,
    /router\.post\('\/:id\/inbound-request', customer, phaseOneNoStockMutation\)/,
  );
  assert.doesNotMatch(
    inboundService,
    /process\.env\.MI_MANAGED_V3|INBOUND_CONFIRM_NOT_VERIFIED|gateEnabled/,
  );
  assert.doesNotMatch(
    component,
    /confirmEnabled|confirmUnavailableReason|tính năng.*chưa bật|đang khóa/,
  );
  assert.match(inboundService, /assertManagedAccessSessionScope/);
  assert.match(inboundService, /readManagedFacilityStockState/);
  assert.match(inboundService, /CONTRACT_NOT_SIGNED/);
  assert.match(inboundService, /TRANSACTIONS_UNAVAILABLE/);
  assert.match(inboundService, /process\.env\.NODE_ENV === 'production'/);
});

test("Customer receives Vietnamese business errors instead of a generic invalid body message", () => {
  assert.equal(
    managedUnifiedInboundErrorMessage({
      response: { data: { code: "CONTRACT_NOT_SIGNED" } },
    }),
    "Hợp đồng hiện hành cần chữ ký của bạn và đại diện cơ sở trước khi nhập kho.",
  );
  assert.equal(
    managedUnifiedInboundErrorMessage({
      response: { data: { code: "TRANSACTIONS_UNAVAILABLE" } },
    }),
    "Cơ sở dữ liệu không hỗ trợ giao dịch an toàn nên phiếu chưa được ghi.",
  );
  assert.equal(
    managedUnifiedInboundErrorMessage({
      response: { data: { message: "Invalid body request" } },
    }),
    "Không thể hoàn tất thao tác nhập kho.",
  );
  assert.equal(
    managedUnifiedInboundErrorMessage({
      response: { data: { code: "CAPACITY_EXCEEDED" } },
    }),
    "Khối lượng hoặc thể tích hàng vượt sức chứa.",
  );
});

test("new canonical Movement contract persists access Session, movement identity and mixed Item Specification lines", () => {
  assert.match(
    movementModel,
    /contractVersion: \{ type: Number, enum: \[2\] \}/,
  );
  assert.match(
    movementModel,
    /accessSessionId: \{ type: Schema\.Types\.ObjectId, ref: 'ManagedAccessSession' \}/,
  );
  assert.match(
    movementModel,
    /multiLineContract \|\| !!line\.itemSpecId\?\.equals\?\.\(this\.itemSpecId\)/,
  );
  assert.match(
    inboundService,
    /contractVersion: 2, accessSessionId: candidate\.accessSessionId/,
  );
});
