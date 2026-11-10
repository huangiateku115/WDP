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

export function formatPayosVnd(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) return "—";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount);
}

export function normalizePayosReferenceId(value) {
  const seen = new Set();
  function normalize(candidate, depth = 0) {
    if (typeof candidate === "string") return isValidObjectId(candidate) ? candidate.toLowerCase() : "";
    if (!candidate || typeof candidate !== "object" || depth > 3 || seen.has(candidate)) return "";
    seen.add(candidate);

    // BSON ObjectIds are not strings until explicitly serialized. Never stringify
    // a populated document as a whole; read only its scalar identifier.
    if (candidate._bsontype === "ObjectId" && typeof candidate.toHexString === "function") {
      try {
        const hex = candidate.toHexString();
        return isValidObjectId(hex) ? hex.toLowerCase() : "";
      } catch {
        return "";
      }
    }
    for (const key of ["_id", "id"]) {
      let nested;
      try { nested = candidate[key]; } catch { continue; }
      const normalized = normalize(nested, depth + 1);
      if (normalized) return normalized;
    }
    return "";
  }
  return normalize(value);
}

export function payosContractMatchesIdentity(contract, reservationId, customerId) {
  const expectedReservationId = normalizePayosReferenceId(reservationId);
  const expectedCustomerId = normalizePayosReferenceId(customerId);
  return !!contract && !!expectedReservationId && !!expectedCustomerId &&
    normalizePayosReferenceId(contract.reservationId) === expectedReservationId &&
    normalizePayosReferenceId(contract.customerId) === expectedCustomerId;
}

export function assessPayosEligibility(reservation, contract, now = Date.now(), expectedCustomerId) {
  const reservationId = normalizePayosReferenceId(reservation);
  if (!reservationId) return { eligible: false, purpose: null, reason: "INVALID_RESERVATION_ID" };
  if (reservation?.serviceType === "MANAGED_INVENTORY" && reservation?.bookingFlowVersion === 3) {
    const owner = normalizePayosReferenceId(reservation.customerId);
    if (expectedCustomerId !== undefined && (!owner || owner !== normalizePayosReferenceId(expectedCustomerId))) return { eligible: false, purpose: null, reason: "CONTRACT_CUSTOMER_MISMATCH" };
    if (reservation.status === "RESERVED") {
      const expiry = Date.parse(reservation.expiresAt || "");
      return Number.isFinite(expiry) && expiry > now
        ? { eligible: true, purpose: "DEPOSIT", reason: "ELIGIBLE" }
        : { eligible: false, purpose: null, reason: "RESERVATION_HOLD_EXPIRED" };
    }
    if (reservation.status === "DEPOSIT_PAID") {
      if (!payosContractMatchesIdentity(contract, reservation, reservation.customerId)) return { eligible: false, purpose: null, reason: "CONTRACT_RESERVATION_MISMATCH" };
      const version = contract.currentContentVersion;
      const active = contract.contentVersions?.find(entry => entry.version === version);
      const current = (contract.signatures || []).filter(signature => signature.version === version && signature.contentHash === active?.contentHash);
      if (contract.status !== "SIGNED" || !active || !current.some(signature => signature.signerRole === "CUSTOMER") ||
          !current.some(signature => ["FACILITY_STAFF", "FACILITY_MANAGER"].includes(signature.signerRole))) return { eligible: false, purpose: null, reason: "CONTRACT_NOT_SIGNED" };
      return { eligible: true, purpose: "BALANCE", reason: "ELIGIBLE" };
    }
    return { eligible: false, purpose: null, reason: "INVALID_RESERVATION_STATUS" };
  }
  if (reservation?.serviceType !== "SELF_STORAGE") {
    return { eligible: false, purpose: null, reason: "UNSUPPORTED_SERVICE" };
  }
  if (!["CONTRACTED", "CHECKIN_READY"].includes(reservation.status)) {
    return { eligible: false, purpose: null, reason: "INVALID_RESERVATION_STATUS" };
  }
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { eligible: false, purpose: null, reason: "CONTRACT_NOT_LOADED" };
  }
  if (!normalizePayosReferenceId(contract)) {
    return { eligible: false, purpose: null, reason: "INVALID_CONTRACT_ID" };
  }
  if (normalizePayosReferenceId(contract.reservationId) !== reservationId) {
    return { eligible: false, purpose: null, reason: "CONTRACT_RESERVATION_MISMATCH" };
  }

  const reservationCustomerId = normalizePayosReferenceId(reservation.customerId);
  const contractCustomerId = normalizePayosReferenceId(contract.customerId);
  const expectedCustomer = expectedCustomerId === undefined
    ? ""
    : normalizePayosReferenceId(expectedCustomerId);
  if (expectedCustomerId !== undefined && (!expectedCustomer ||
      reservationCustomerId !== expectedCustomer || contractCustomerId !== expectedCustomer)) {
    return { eligible: false, purpose: null, reason: "CONTRACT_CUSTOMER_MISMATCH" };
  }
  if (reservationCustomerId && contractCustomerId && reservationCustomerId !== contractCustomerId) {
    return { eligible: false, purpose: null, reason: "CONTRACT_CUSTOMER_MISMATCH" };
  }

  if (reservation.status === "CONTRACTED") {
    if (contract.status !== "DRAFT") {
      return { eligible: false, purpose: null, reason: "CONTRACT_NOT_DRAFT" };
    }
    const expiresAt = Date.parse(reservation.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      return { eligible: false, purpose: null, reason: "RESERVATION_HOLD_EXPIRED" };
    }
    return { eligible: true, purpose: "DEPOSIT", reason: "ELIGIBLE" };
  }

  if (contract.status !== "SIGNED") {
    return { eligible: false, purpose: null, reason: "CONTRACT_NOT_SIGNED" };
  }
  if (!(typeof contract.signedProofPublicId === "string" && contract.signedProofPublicId.length > 0 &&
      typeof contract.signedProofUrl === "string" && contract.signedProofUrl.length > 0 && contract.verifiedAt)) {
    return { eligible: false, purpose: null, reason: "SIGNED_PROOF_NOT_VERIFIED" };
  }
  return { eligible: true, purpose: "BALANCE", reason: "ELIGIBLE" };
}

export function payosEligibilityMessage(reason) {
  const messages = {
    INVALID_RESERVATION_ID: "The Reservation identifier could not be verified. Payment is unavailable.",
    INVALID_CONTRACT_ID: "The linked Contract identifier is invalid. Payment is unavailable until the contract is corrected.",
    CONTRACT_RESERVATION_MISMATCH: "The linked Contract does not match this Reservation. Payment is unavailable; contact support.",
    CONTRACT_CUSTOMER_MISMATCH: "Contract ownership could not be verified for this account. Payment is unavailable.",
    UNSUPPORTED_SERVICE: "PayOS checkout here is available only for supported Self-Storage or Managed V3 Reservations.",
    INVALID_RESERVATION_STATUS: "The Reservation is not in a payment-eligible state. Refresh its status before continuing.",
    CONTRACT_NOT_DRAFT: "Deposit checkout requires the linked Contract to remain in DRAFT status.",
    RESERVATION_HOLD_EXPIRED: "The CONTRACTED Reservation payment eligibility window has expired.",
    CONTRACT_NOT_LOADED: "A linked Contract could not be found. The Reservation is saved; retry contract lookup before attempting a Deposit.",
    CONTRACT_LOAD_FAILED: "The linked Contract could not be verified because it failed to load. Retry contract lookup; no payment was started.",
    CONTRACT_NOT_SIGNED: "Balance checkout requires the linked Contract to be SIGNED.",
    SIGNED_PROOF_NOT_VERIFIED: "Balance checkout requires verified signed-paper proof on the linked Contract.",
    ELIGIBLE: "",
  };
  return messages[reason] || "Reservation and Contract eligibility could not be verified. Payment is unavailable.";
}

export function eligiblePayosPurpose(reservation, contract, now = Date.now()) {
  return assessPayosEligibility(reservation, contract, now).purpose;
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
  if (payment.status === "CANCELLED" && payment.cancelVerifiedAt && payment.providerSettlementStatus === "NOT_VERIFIED" && payment.applicationStatus === "NOT_APPLIED") {
    return { key: "CANCELLED", label: "Đã hủy thanh toán", tone: "warning" };
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
  return (payment?.status === "FAILED" || payment?.status === "CANCELLED" && !!payment?.cancelVerifiedAt) && payment?.retryAllowed === true &&
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
  const code = error?.response?.data?.code;
  if (status === 400) return "The payment request was invalid. Refresh and try again.";
  if (status === 401) return "Your session expired. Sign in again, then check payment status before retrying.";
  if (status === 403) return "This payment is unavailable for your account.";
  if (status === 404) return "PayOS checkout is unavailable or the payment could not be found.";
  if (status === 409) return "Reservation or payment eligibility changed. Refresh the reservation before continuing.";
  if (code === "PAYOS_CHECKOUT_OUTCOME_UNKNOWN" || code === "PAYMENT_OUTCOME_UNKNOWN") {
    return "PayOS has not confirmed whether the previous checkout was created. Keep this payment attempt; do not pay again or create a new attempt. Refresh payment history and the existing Payment status.";
  }
  if (status === 503 || error?.isAxiosError && !error.response) {
    return "Không thể xác định kết quả tạo giao dịch. Giữ nguyên lần thử hiện tại, làm mới lịch sử/trạng thái thanh toán và không tạo thanh toán mới.";
  }
  return "The payment service could not confirm the request. Refresh payment status before retrying.";
}
