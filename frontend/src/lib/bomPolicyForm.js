import { bomFutureDate, toInstant } from "./bomDates.js";

// Policy creation form + request body. Dependency-free (only ./bomDates.js) so the rules can be
// unit tested without the Vite alias or any UI import.
//
// Only types with a defined `config` contract are offered: DEPOSIT (amount for Self Storage,
// percentage for Managed), CATEGORY (two lists) and the informational types carrying a
// description. DISCOUNT/WAIVER wait for the discount engine spec.
export const BOM_POLICY_FORM_TYPES = [
  { key: "DEPOSIT", label: "Đặt cọc" },
  { key: "CANCELLATION", label: "Hủy đơn" },
  { key: "REFUND", label: "Hoàn tiền" },
  { key: "OVERDUE", label: "Quá hạn" },
  { key: "CATEGORY", label: "Danh mục hàng hóa" },
  { key: "SHELF_CONSTRAINT", label: "Ràng buộc kệ" },
];

// Types whose config is a plain description until their engine exists.
export const POLICY_DESCRIPTION_TYPES = ["CANCELLATION", "REFUND", "OVERDUE", "SHELF_CONSTRAINT"];

const DEFAULT_CURRENCY = "VND";

export const policyBlank = () => ({
  facilityId: "",
  service: "SELF_STORAGE",
  type: "DEPOSIT",
  effectiveFrom: bomFutureDate(1),
  effectiveTo: "",
  status: "ACTIVE",
  // DEPOSIT · SELF_STORAGE
  amount: "500000",
  currency: DEFAULT_CURRENCY,
  // DEPOSIT · MANAGED_INVENTORY
  percentage: "20",
  // CATEGORY
  allowedCategories: "",
  blockedCategories: "",
  // Informational types
  description: "",
});

const splitList = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);

// `config` is immutable once the policy exists, so every value is validated here instead of
// relying on a later edit. Messages are user facing (rendered by the form).
export function policyConfig(form) {
  if (form.type === "CATEGORY") {
    if (form.service !== "MANAGED_INVENTORY") throw new Error("Chính sách danh mục chỉ áp dụng cho Lưu trữ hàng hóa.");
    const allowedCategories = splitList(form.allowedCategories);
    if (!allowedCategories.length) throw new Error("Cần nhập ít nhất một danh mục được phép.");
    return { allowedCategories, blockedCategories: splitList(form.blockedCategories) };
  }
  if (form.type === "DEPOSIT") {
    if (form.service === "MANAGED_INVENTORY") {
      const percentage = Number(form.percentage);
      if (!Number.isFinite(percentage) || percentage < 0) throw new Error("Tỷ lệ đặt cọc phải là số không âm.");
      return { calculation: "PERCENT_OF_RENT", percentage };
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Số tiền đặt cọc phải lớn hơn 0.");
    return { amount, currency: (form.currency || DEFAULT_CURRENCY).trim().toUpperCase() };
  }
  if (POLICY_DESCRIPTION_TYPES.includes(form.type)) {
    const description = String(form.description || "").trim();
    if (!description) throw new Error("Hãy mô tả nội dung chính sách.");
    return { description };
  }
  throw new Error("Loại chính sách này chưa hỗ trợ tạo mới.");
}

export function policyBody(form) {
  if (!form.facilityId) throw new Error("Hãy chọn cơ sở áp dụng chính sách.");
  const body = {
    facilityId: form.facilityId,
    serviceType: form.service,
    type: form.type,
    effectiveFrom: toInstant(form.effectiveFrom),
    isActive: form.status === "ACTIVE",
    config: policyConfig(form),
  };
  if (form.effectiveTo) body.effectiveTo = toInstant(form.effectiveTo);
  return body;
}

// Closing a policy is the only allowed mutation of an existing record: it never rewrites config.
export function policyCloseBody(form) {
  const effectiveTo = toInstant(form?.effectiveTo);
  if (!effectiveTo) throw new Error("Hãy chọn ngày đóng chính sách.");
  return { effectiveTo };
}
