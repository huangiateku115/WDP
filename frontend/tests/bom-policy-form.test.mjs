import test from "node:test";
import assert from "node:assert/strict";
import { policyBlank, policyBody, policyCloseBody, BOM_POLICY_FORM_TYPES } from "../src/lib/bomPolicyForm.js";

const base = (overrides) => ({ ...policyBlank(), facilityId: "a".repeat(24), effectiveFrom: "2026-12-01", ...overrides });

test("policyBlank starts a future Self Storage deposit policy", () => {
  const blank = policyBlank();
  assert.equal(blank.type, "DEPOSIT");
  assert.equal(blank.service, "SELF_STORAGE");
  assert.equal(blank.status, "ACTIVE");
  assert.equal(blank.facilityId, "");
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(blank.effectiveFrom));
  assert.ok(new Date(blank.effectiveFrom) > new Date(new Date().toISOString().slice(0, 10)));
});

test("policy form offers only the types whose config contract exists", () => {
  const keys = BOM_POLICY_FORM_TYPES.map(({ key }) => key);
  for (const key of ["DEPOSIT", "CANCELLATION", "REFUND", "OVERDUE", "CATEGORY", "SHELF_CONSTRAINT"]) {
    assert.ok(keys.includes(key), `${key} must be creatable`);
  }
  // Discount and waiver wait for the engine spec, so they are not offered yet.
  assert.equal(keys.includes("DISCOUNT"), false);
  assert.equal(keys.includes("WAIVER"), false);
});

test("policyBody builds a Self Storage deposit body without an end date", () => {
  assert.deepEqual(policyBody(base({})), {
    facilityId: "a".repeat(24),
    serviceType: "SELF_STORAGE",
    type: "DEPOSIT",
    effectiveFrom: "2026-12-01T00:00:00.000Z",
    isActive: true,
    config: { amount: 500000, currency: "VND" },
  });
});

test("policyBody builds a Managed deposit body as a rent percentage", () => {
  const body = policyBody(base({ service: "MANAGED_INVENTORY", percentage: "15", effectiveTo: "2027-06-01" }));
  assert.deepEqual(body.config, { calculation: "PERCENT_OF_RENT", percentage: 15 });
  assert.equal(body.effectiveTo, "2027-06-01T00:00:00.000Z");
});

test("policyBody trims category lists and refuses an empty allow list", () => {
  const body = policyBody(base({ type: "CATEGORY", service: "MANAGED_INVENTORY", allowedCategories: " Đồ điện tử , vải vóc ", blockedCategories: "Chất lỏng" }));
  assert.deepEqual(body.config, { allowedCategories: ["Đồ điện tử", "vải vóc"], blockedCategories: ["Chất lỏng"] });
  assert.throws(() => policyBody(base({ type: "CATEGORY", service: "MANAGED_INVENTORY", allowedCategories: "  " })), /danh mục được phép/);
  assert.throws(() => policyBody(base({ type: "CATEGORY", service: "SELF_STORAGE", allowedCategories: "A" })), /Lưu trữ hàng hóa/);
});

test("policyBody keeps informational policies to a description and validates numbers", () => {
  assert.deepEqual(policyBody(base({ type: "REFUND", description: " Hoàn 100% trong 24h " })).config, { description: "Hoàn 100% trong 24h" });
  assert.throws(() => policyBody(base({ type: "OVERDUE", description: " " })), /mô tả/);
  assert.throws(() => policyBody(base({ amount: "0" })), /đặt cọc/);
  assert.throws(() => policyBody(base({ service: "MANAGED_INVENTORY", percentage: "-1" })), /Tỷ lệ đặt cọc/);
  assert.throws(() => policyBody(base({ facilityId: "" })), /cơ sở/);
});

test("policyCloseBody sends one prospective end date", () => {
  assert.deepEqual(policyCloseBody({ effectiveTo: "2027-01-01" }), { effectiveTo: "2027-01-01T00:00:00.000Z" });
  assert.throws(() => policyCloseBody({ effectiveTo: "" }), /ngày đóng/);
});
