export function isPayosPaymentPollable(payment) {
  return payment?.provider === "PAYOS" &&
    payment?.status === "PENDING" &&
    payment?.checkoutStatus === "READY" &&
    payment?.applicationStatus !== "MANUAL_REVIEW" &&
    payment?.providerSettlementStatus !== "VERIFIED" &&
    payment?.reconciliationRequired === false;
}

export async function pollPayosPaymentStatuses({
  payments,
  reservationId,
  paymentApi,
  getAccessToken,
  isCurrent,
  onPayment,
  onApplied,
}) {
  const token = getAccessToken();
  for (const candidate of payments) {
    if (!isPayosPaymentPollable(candidate)) continue;
    if (!isCurrent() || getAccessToken() !== token) return;
    const payment = await paymentApi.getPayosPaymentStatus(reservationId, candidate.id);
    if (!isCurrent() || getAccessToken() !== token) return;
    onPayment(payment);
    if (payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED") {
      await onApplied(payment);
      if (!isCurrent() || getAccessToken() !== token) return;
    }
  }
}
