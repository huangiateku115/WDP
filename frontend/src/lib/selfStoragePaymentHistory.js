export function customerPaymentStatus(payment) {
  if (payment?.providerSettlementStatus === "VERIFIED" && payment?.applicationStatus === "APPLIED") {
    return { label: "Thanh toán thành công", tone: "text-emerald-700" };
  }
  if (payment?.applicationStatus === "MANUAL_REVIEW" || payment?.reconciliationRequired === true || payment?.status === "RECONCILIATION_REQUIRED") {
    return { label: "Cần kiểm tra giao dịch", tone: "text-amber-800" };
  }
  if (payment?.status === "FAILED" && payment?.providerSettlementStatus === "NOT_VERIFIED" && payment?.applicationStatus === "NOT_APPLIED") {
    return { label: "Thanh toán không thành công", tone: "text-rose-700" };
  }
  if (payment?.status === "CANCELLED" && payment?.cancelVerifiedAt && payment?.providerSettlementStatus === "NOT_VERIFIED" && payment?.applicationStatus === "NOT_APPLIED") {
    return { label: "Đã hủy thanh toán", tone: "text-amber-800" };
  }
  if (payment?.checkoutStatus === "UNKNOWN" || payment?.checkoutStatus === "CREATING" || payment?.status === "SUCCEEDED") {
    return { label: "Đang xác nhận", tone: "text-amber-800" };
  }
  return { label: "Đang chờ thanh toán", tone: "text-slate-600" };
}

export function selectOwnedSelfStorageReservation(reservations, requestedId) {
  if (!Array.isArray(reservations) || !reservations.length) return "";
  const selected = reservations.find((reservation) => recordId(reservation) === requestedId) ||
    [...reservations].sort((left, right) => Date.parse(right.updatedAt || right.createdAt || right.startDate || 0) - Date.parse(left.updatedAt || left.createdAt || left.startDate || 0))[0];
  return recordId(selected) || "";
}

function recordId(record) {
  return typeof record === "string" ? record : record?._id || record?.id || "";
}
