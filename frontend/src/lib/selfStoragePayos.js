const OBJECT_ID = /^[a-f\d]{24}$/i;
const PURPOSES = new Set(["DEPOSIT", "BALANCE"]);
const MAX_PAYOS_QR_PAYLOAD_LENGTH = 4096;

export function isUsablePayosQrPayload(value) {
  return typeof value === "string" && value.length >= 16 && value.length <= MAX_PAYOS_QR_PAYLOAD_LENGTH &&
    value.trim() === value && value.startsWith("000201") && /^[\x20-\x7E]+$/.test(value);
}

export function isValidObjectId(value) {
  return typeof value === "string" && OBJECT_ID.test(value);
}

function id(value) {
  return typeof value === "string" ? value : value?._id || value?.id || "";
}

export function eligiblePayosPurpose(reservation, contract, now = Date.now()) {
  if (
    reservation?.serviceType !== "SELF_STORAGE" ||
    !isValidObjectId(id(reservation)) ||
    !isValidObjectId(id(contract)) ||
    id(contract.reservationId) !== id(reservation)
  ) return null;

  if (reservation.status === "CONTRACTED") {
    const expiresAt = Date.parse(reservation.expiresAt || "");
    if (contract.status === "DRAFT" && Number.isFinite(expiresAt) && expiresAt > now) return "DEPOSIT";
    return null;
  }

  if (
    reservation.status === "CHECKIN_READY" &&
    contract.status === "SIGNED" &&
    typeof contract.signedProofPublicId === "string" && contract.signedProofPublicId.length > 0 &&
    typeof contract.signedProofUrl === "string" && contract.signedProofUrl.length > 0 &&
    !!contract.verifiedAt
  ) return "BALANCE";

  return null;
}

export function paymentStatusView(payment) {
  if (!payment || typeof payment !== "object") return { key: "UNKNOWN", label: "Payment status unavailable" };
  if (payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED") {
    return { key: "APPLIED", label: "Payment verified and applied to the reservation", tone: "success" };
  }
  if (payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "MANUAL_REVIEW") {
    return { key: "MANUAL_REVIEW", label: "Funds received; manual reconciliation is required", tone: "warning" };
  }
  if (
    payment.status === "FAILED" &&
    payment.providerSettlementStatus === "NOT_VERIFIED" &&
    payment.applicationStatus === "NOT_APPLIED" &&
    payment.reconciliationRequired === false
  ) {
    return { key: "FAILED", label: "PayOS confirmed this attempt failed without receiving funds. A new attempt may be started only after this status is confirmed.", tone: "danger" };
  }
  if (
    payment.status === "RECONCILIATION_REQUIRED" ||
    payment.applicationStatus === "MANUAL_REVIEW" ||
    payment.checkoutStatus === "RECONCILIATION_REQUIRED"
  ) return { key: "RECONCILIATION_REQUIRED", label: "Payment requires verification or manual reconciliation", tone: "warning" };
  if (payment.status === "SUCCEEDED") {
    return { key: "SUCCEEDED_UNAPPLIED", label: "Funds were received, but the reservation payment has not been applied", tone: "warning" };
  }
  if (payment.status === "FAILED") {
    return { key: "FAILED", label: "The payment attempt failed; a new attempt may be considered after this status is confirmed", tone: "danger" };
  }
  if (payment.status === "PENDING" && payment.checkoutStatus === "UNKNOWN") {
    return { key: "UNCERTAIN", label: "Payment outcome is uncertain. Keep this attempt and check its status before retrying.", tone: "warning" };
  }
  if (payment.status === "PENDING" && payment.checkoutStatus === "CREATING") {
    return { key: "CREATING", label: "Checkout creation is still in progress", tone: "pending" };
  }
  if (payment.status === "PENDING" && payment.checkoutStatus === "READY") {
    return { key: "PENDING", label: "Awaiting provider confirmation", tone: "pending" };
  }
  return { key: "UNKNOWN", label: "Payment status requires a refresh", tone: "warning" };
}

export function canStartNewPayosAttempt(payment) {
  return payment?.status === "FAILED" &&
    payment.providerSettlementStatus === "NOT_VERIFIED" &&
    payment.applicationStatus === "NOT_APPLIED" &&
    payment.reconciliationRequired === false;
}

export function mergePayosPaymentHistory(existing = [], incoming = [], reservationId) {
  const merged = new Map();
  for (const payment of existing) {
    if (payment?.reservationId === reservationId && payment.provider === "PAYOS") merged.set(payment.id, payment);
  }
  for (const payment of incoming) {
    if (payment?.reservationId !== reservationId || payment.provider !== "PAYOS") continue;
    const previous = merged.get(payment.id);
    if (previous && (previous.purpose !== payment.purpose || previous.amount !== payment.amount ||
        previous.currency !== payment.currency || previous.reservationId !== payment.reservationId ||
        previous.provider !== payment.provider)) continue;
    merged.set(payment.id, { ...previous, ...payment });
  }
  return [...merged.values()].sort((left, right) => {
    const timeDifference = Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0);
    return timeDifference || right.id.localeCompare(left.id);
  });
}

export function unresolvedPayosPayment(payments, purpose) {
  return (Array.isArray(payments) ? payments : [])
    .filter((payment) => payment?.purpose === purpose && (
      payment.status === "PENDING" ||
      payment.status === "RECONCILIATION_REQUIRED" ||
      payment.applicationStatus === "MANUAL_REVIEW" ||
      payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus !== "APPLIED" ||
      payment.checkoutStatus === "CREATING" || payment.checkoutStatus === "UNKNOWN" ||
      payment.checkoutStatus === "RECONCILIATION_REQUIRED"
    ))
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0] || null;
}

export function trackingStorageKey(customerId, reservationId, purpose) {
  if (!isValidObjectId(customerId) || !isValidObjectId(reservationId) || !PURPOSES.has(purpose)) {
    throw Error("Payment tracking identity is invalid.");
  }
  return `SelfStorage_payos_${customerId}_${reservationId}_${purpose}`;
}

export function readPayosAttempts(storage, customerId, reservationId, purpose) {
  const key = trackingStorageKey(customerId, reservationId, purpose);
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { attempts: [], unavailable: true, corrupt: false };
  }
  if (raw === null) return { attempts: [], unavailable: false, corrupt: false };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw Error("Invalid tracking data.");
    const attempts = parsed.filter((attempt) =>
      attempt && typeof attempt === "object" &&
      typeof attempt.idempotencyKey === "string" && attempt.idempotencyKey.length > 0 &&
      attempt.idempotencyKey.length <= 120 && !/[\r\n]/.test(attempt.idempotencyKey) &&
      (attempt.paymentId === null || attempt.paymentId === undefined || isValidObjectId(attempt.paymentId))
    ).map((attempt) => ({
      idempotencyKey: attempt.idempotencyKey,
      paymentId: attempt.paymentId || null,
    }));
    if (attempts.length !== parsed.length) throw Error("Invalid tracking data.");
    return { attempts, unavailable: false, corrupt: false };
  } catch {
    return { attempts: [], unavailable: false, corrupt: true };
  }
}

export function writePayosAttempts(storage, customerId, reservationId, purpose, attempts) {
  const key = trackingStorageKey(customerId, reservationId, purpose);
  if (!Array.isArray(attempts) || attempts.some((attempt) =>
    !attempt || typeof attempt.idempotencyKey !== "string" ||
    !attempt.idempotencyKey.length || attempt.idempotencyKey.length > 120 ||
    /[\r\n]/.test(attempt.idempotencyKey) ||
    (attempt.paymentId !== null && attempt.paymentId !== undefined && !isValidObjectId(attempt.paymentId))
  )) throw Error("Payment tracking data is invalid.");
  try {
    storage.setItem(key, JSON.stringify(attempts.map(({ idempotencyKey, paymentId }) => ({
      idempotencyKey,
      paymentId: paymentId || null,
    }))));
  } catch {
    throw Error("This browser could not safely save the payment attempt. No checkout was opened.");
  }
}

export function newPayosIdempotencyKey(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.randomUUID === "function") return `wdp-${cryptoProvider.randomUUID()}`;
  if (typeof cryptoProvider?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    return `wdp-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  throw Error("Secure payment attempt IDs are unavailable in this browser.");
}

export function paymentErrorMessage(error) {
  const status = error?.response?.status;
  if (status === 400) return "The payment request was invalid. Refresh and try again.";
  if (status === 401) return "Your session expired. Sign in again, then check payment status before retrying.";
  if (status === 403) return "This payment is unavailable for your account.";
  if (status === 404) return "PayOS checkout is unavailable or the payment could not be found.";
  if (status === 409) return "Reservation or payment eligibility changed. Refresh the reservation before continuing.";
  if (status === 503 || error?.isAxiosError && !error.response) {
    return "Không thể xác định kết quả tạo giao dịch. Vui lòng kiểm tra lại trạng thái, không tạo thanh toán mới.";
  }
  return "The payment service could not confirm the request. Refresh payment status before retrying.";
}
