import { isUsablePayosQrPayload } from "../lib/selfStoragePayos.js";

const OBJECT_ID = /^[a-f\d]{24}$/i;
const PURPOSES = new Set(["DEPOSIT", "BALANCE"]);
const PAYMENT_STATUSES = new Set([
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "RECONCILIATION_REQUIRED",
]);
const APPLICATION_STATUSES = new Set([
  "NOT_APPLIED",
  "APPLIED",
  "MANUAL_REVIEW",
]);
const SETTLEMENT_STATUSES = new Set(["NOT_VERIFIED", "VERIFIED"]);
const CHECKOUT_STATUSES = new Set([
  "NOT_CREATED",
  "CREATING",
  "READY",
  "UNKNOWN",
  "FAILED",
  "CANCELLED",
  "RECONCILIATION_REQUIRED",
]);

export function isMongoObjectId(value) {
  return typeof value === "string" && OBJECT_ID.test(value);
}

function assertCheckoutInput(reservationId, purpose, idempotencyKey) {
  if (!isMongoObjectId(reservationId)) throw Error("Invalid reservation ID.");
  if (!PURPOSES.has(purpose)) throw Error("Payment purpose must be DEPOSIT or BALANCE.");
  if (
    typeof idempotencyKey !== "string" ||
    !idempotencyKey.trim() ||
    idempotencyKey.length > 120 ||
    /[\r\n]/.test(idempotencyKey)
  ) {
    throw Error("A valid payment attempt key is required.");
  }
}

function assertPaymentDto(payment, reservationId, purpose) {
  if (
    !payment ||
    typeof payment !== "object" ||
    Array.isArray(payment) ||
    !isMongoObjectId(payment.id) ||
    payment.reservationId !== reservationId ||
    !(purpose ? payment.purpose === purpose : PURPOSES.has(payment.purpose)) ||
    payment.provider !== "PAYOS" ||
    !Number.isSafeInteger(payment.amount) ||
    payment.amount <= 0 ||
    payment.currency !== "VND" ||
    !PAYMENT_STATUSES.has(payment.status) ||
    !APPLICATION_STATUSES.has(payment.applicationStatus) ||
    !SETTLEMENT_STATUSES.has(payment.providerSettlementStatus) ||
    !CHECKOUT_STATUSES.has(payment.checkoutStatus) ||
    typeof payment.reconciliationRequired !== "boolean" ||
    typeof payment.retryAllowed !== "boolean" ||
    !(payment.cancelVerifiedAt === null || payment.cancelVerifiedAt === undefined || typeof payment.cancelVerifiedAt === "string")
  ) {
    throw Error("The payment service returned an invalid payment record.");
  }
  if (
    payment.checkoutUrl !== null &&
    payment.checkoutUrl !== undefined &&
    (typeof payment.checkoutUrl !== "string" || !isSafePayosCheckoutUrl(payment.checkoutUrl))
  ) {
    throw Error("The payment service returned an unsafe checkout link.");
  }
  return { ...payment, qrCode: isUsablePayosQrPayload(payment.qrCode) ? payment.qrCode : null };
}

export function isSafePayosCheckoutUrl(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "pay.payos.vn" &&
      !url.port && !url.username && !url.password && url.pathname.startsWith("/web/") && url.pathname.length > "/web/".length && !url.hash;
  } catch {
    return false;
  }
}

export function canOpenPayosCheckout(payment) {
  return payment?.provider === "PAYOS" &&
    payment?.status === "PENDING" &&
    payment?.checkoutStatus === "READY" &&
    payment?.applicationStatus !== "MANUAL_REVIEW" &&
    payment?.providerSettlementStatus !== "VERIFIED" &&
    payment?.reconciliationRequired === false &&
    isSafePayosCheckoutUrl(payment?.checkoutUrl);
}

export function canShowPayosQr(payment) {
  return payment?.provider === "PAYOS" &&
    payment?.status === "PENDING" &&
    payment?.checkoutStatus === "READY" &&
    payment?.applicationStatus !== "MANUAL_REVIEW" &&
    payment?.providerSettlementStatus !== "VERIFIED" &&
    isUsablePayosQrPayload(payment?.qrCode);
}

function unwrap(response, reservationId, purpose, allowedHttpStatuses) {
  const envelope = response?.data;
  if (
    !allowedHttpStatuses.includes(response?.status) ||
    envelope?.success !== true ||
    !["CREATED", "REPLAYED", "SETTLED"].includes(envelope?.outcome)
  ) {
    throw Error("The payment service returned an unsupported response.");
  }
  if (envelope.outcome === "SETTLED") {
    if (response.status !== 200 || envelope?.data?.zeroBalance !== true ||
        envelope.data.reservation?.serviceType !== "MANAGED_INVENTORY" || envelope.data.reservation?.bookingFlowVersion !== 3 ||
        envelope.data.reservation?.status !== "PAID" || !envelope.data.reservation?.balanceSettledAt) throw Error("The zero-balance settlement response is invalid.");
    return { payment: null, zeroBalance: true, reservation: envelope.data.reservation, outcome: "SETTLED", httpStatus: 200 };
  }
  const payment = assertPaymentDto(envelope.data, reservationId, purpose);
  const expectedOutcome = response.status === 201 ? "CREATED" : "REPLAYED";
  if (envelope.outcome !== expectedOutcome) {
    throw Error("The payment service response status and outcome do not match.");
  }
  return { payment, outcome: envelope.outcome, httpStatus: response.status };
}

export function createPayosPaymentApi(client) {
  if (!client || typeof client.post !== "function" || typeof client.get !== "function") {
    throw Error("A payment API client is required.");
  }
  return {
    createPayosCheckout: async (reservationId, purpose, idempotencyKey, serviceType = "SELF_STORAGE") => {
      assertCheckoutInput(reservationId, purpose, idempotencyKey);
      if (!["SELF_STORAGE", "MANAGED_INVENTORY"].includes(serviceType)) throw Error("Unsupported payment service type.");
      const root = serviceType === "MANAGED_INVENTORY" ? `/reservations/managed/${reservationId}/payments/payos` : `/reservations/${reservationId}/payments/payos`;
      const response = await client.post(
        root,
        { purpose },
        { headers: { "Idempotency-Key": idempotencyKey } },
      );
      return unwrap(response, reservationId, purpose, [200, 201]);
    },
    getPayosPaymentStatus: async (reservationId, paymentId, serviceType = "SELF_STORAGE") => {
      if (!isMongoObjectId(reservationId) || !isMongoObjectId(paymentId)) {
        throw Error("Invalid reservation or payment ID.");
      }
      if (!["SELF_STORAGE", "MANAGED_INVENTORY"].includes(serviceType)) throw Error("Unsupported payment service type.");
      const root = serviceType === "MANAGED_INVENTORY" ? `/reservations/managed/${reservationId}/payments` : `/reservations/${reservationId}/payments`;
      const response = await client.get(`${root}/${paymentId}`);
      const envelope = response?.data;
      if (response?.status !== 200 || envelope?.success !== true) {
        throw Error("The payment service returned an unsupported status response.");
      }
      const payment = assertPaymentDto(envelope.data, reservationId);
      if (payment.id !== paymentId) throw Error("Payment identity did not match the requested record.");
      return payment;
    },
    reconcilePayosPayment: async (reservationId, paymentId, serviceType = "SELF_STORAGE") => {
      if (!isMongoObjectId(reservationId) || !isMongoObjectId(paymentId)) throw Error("Invalid reservation or payment ID.");
      if (!["SELF_STORAGE", "MANAGED_INVENTORY"].includes(serviceType)) throw Error("Unsupported payment service type.");
      const root = serviceType === "MANAGED_INVENTORY" ? `/reservations/managed/${reservationId}/payments` : `/reservations/${reservationId}/payments`;
      const response = await client.post(`${root}/${paymentId}/reconcile`, {});
      const envelope = response?.data;
      if (response?.status !== 200 || envelope?.success !== true) throw Error("Payment reconciliation is not confirmed yet.");
      const payment = assertPaymentDto(envelope.data, reservationId);
      if (payment.id !== paymentId) throw Error("Payment identity did not match the requested record.");
      return payment;
    },
    listPayosPaymentsForReservation: async (reservationId, { limit, cursor, serviceType = "SELF_STORAGE" } = {}) => {
      if (!isMongoObjectId(reservationId)) throw Error("Invalid reservation ID.");
      const params = new URLSearchParams();
      if (limit !== undefined) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw Error("Invalid payment history limit.");
        params.set("limit", String(limit));
      }
      if (cursor !== undefined && cursor !== null) {
        if (typeof cursor !== "string" || !cursor || cursor.length > 128 || /[^A-Za-z0-9_\-=]/.test(cursor)) {
          throw Error("Invalid payment history cursor.");
        }
        params.set("cursor", cursor);
      }
      const suffix = params.size ? `?${params.toString()}` : "";
      if (!["SELF_STORAGE", "MANAGED_INVENTORY"].includes(serviceType)) throw Error("Unsupported payment service type.");
      const root = serviceType === "MANAGED_INVENTORY" ? `/reservations/managed/${reservationId}/payments/payos` : `/reservations/${reservationId}/payments/payos`;
      const response = await client.get(`${root}${suffix}`);
      const envelope = response?.data;
      const page = envelope?.data;
      if (response?.status !== 200 || envelope?.success !== true || !page || !Array.isArray(page.items) ||
          page.items.length > (limit ?? 10) || !(page.nextCursor === null || typeof page.nextCursor === "string") ||
          (page.nextCursor !== null && (!page.nextCursor || page.nextCursor.length > 128 || /[^A-Za-z0-9_\-=]/.test(page.nextCursor)))) {
        throw Error("The payment service returned an invalid payment history page.");
      }
      const items = page.items.map(payment => assertPaymentDto(payment, reservationId));
      if (new Set(items.map(payment => payment.id)).size !== items.length) throw Error("Payment history contains duplicate records.");
      if (items.some(payment => typeof payment.createdAt !== "string" || !Number.isFinite(Date.parse(payment.createdAt)))) {
        throw Error("Payment history contains an invalid creation timestamp.");
      }
      return { items, nextCursor: page.nextCursor };
    },
  };
}
