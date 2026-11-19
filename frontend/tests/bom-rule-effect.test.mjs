import test from "node:test";
import assert from "node:assert/strict";
import { RULE_PHASE_LABELS, rulePhase } from "../src/lib/ruleEffect.js";

const now = new Date("2026-11-18T00:00:00.000Z");
const record = (overrides) => ({
  status: "ACTIVE", effectiveFrom: "2026-01-01", effectiveTo: "", hasEffectiveTo: false, ...overrides,
});

test("rulePhase reports an open-ended rule starting in the past as active", () => {
  assert.equal(rulePhase(record(), now), "ACTIVE");
  assert.equal(RULE_PHASE_LABELS.ACTIVE, "Đang hiệu lực");
});

test("rulePhase reports a future start as scheduled and a past end as closed", () => {
  assert.equal(rulePhase(record({ effectiveFrom: "2027-01-01" }), now), "SCHEDULED");
  assert.equal(rulePhase(record({ effectiveTo: "2026-06-01", hasEffectiveTo: true }), now), "CLOSED");
});

test("rulePhase keeps an open-ended rule active even when effectiveTo is present but not returned", () => {
  // hasEffectiveTo=false means the read DTO did not carry the field: open-ended, not closed.
  assert.equal(rulePhase(record({ effectiveTo: "2026-06-01", hasEffectiveTo: false }), now), "ACTIVE");
});

test("rulePhase lets the inactive flag win over the dates", () => {
  assert.equal(rulePhase(record({ status: "INACTIVE" }), now), "INACTIVE");
  assert.equal(rulePhase(record({ status: "INACTIVE", effectiveFrom: "2027-01-01" }), now), "INACTIVE");
  assert.equal(rulePhase(null, now), "INACTIVE");
});

test("rulePhase treats a rule whose end equals now as closed", () => {
  assert.equal(rulePhase(record({ effectiveTo: now.toISOString(), hasEffectiveTo: true }), now), "CLOSED");
});
