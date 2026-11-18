// Effective state of a pricing rule or a business policy, derived only from fields the read DTO
// already carries. `hasEffectiveTo` is the "the DTO did include effectiveTo" flag from
// lib/bomMappers: it separates an open-ended rule from a read that simply omitted the field.
export const RULE_PHASE_LABELS = {
  ACTIVE: "Đang hiệu lực",
  SCHEDULED: "Sắp hiệu lực",
  CLOSED: "Đã đóng",
  INACTIVE: "Ngừng sử dụng",
};

// Tones available in components/ui/badge.
export const RULE_PHASE_TONE = { ACTIVE: "green", SCHEDULED: "sky", CLOSED: "orange", INACTIVE: "orange" };

export function rulePhase(record, now = new Date()) {
  if (!record) return "INACTIVE";
  if (record.status === "INACTIVE") return "INACTIVE";
  const from = record.effectiveFrom ? new Date(record.effectiveFrom) : null;
  const to = record.hasEffectiveTo && record.effectiveTo ? new Date(record.effectiveTo) : null;
  if (from && !Number.isNaN(from.getTime()) && from > now) return "SCHEDULED";
  if (to && !Number.isNaN(to.getTime()) && to <= now) return "CLOSED";
  return "ACTIVE";
}

export default rulePhase;
