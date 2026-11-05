import { useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { CustomerScreen } from "@/components/common/CustomerScreen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import paymentApi from "@/api/paymentApi";
import { getAccessToken, useAuthSession } from "@/lib/authSession";
import { formatMoney } from "@/lib/booking";
import {
  canStartNewPayosAttempt,
  eligiblePayosPurpose,
  isValidObjectId,
  mergePayosPaymentHistory,
  newPayosIdempotencyKey,
  paymentErrorMessage,
  paymentStatusView,
  readPayosAttempts,
  unresolvedPayosPayment,
  writePayosAttempts,
} from "@/lib/selfStoragePayos";
import { canOpenPayosCheckout, canShowPayosQr } from "@/api/payosPaymentClient";
import { createPayosQrDataUrl } from "@/lib/selfStoragePayosQr";
import { isPayosPaymentPollable, pollPayosPaymentStatuses } from "@/lib/selfStoragePayosPolling";
import {
  Details,
  LoadState,
  Message,
  RentalSummary,
  RentalStatus,
  useBackend,
  recordId,
} from "./RentalBackendUI";

function safeStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function customerIdFromSession(session) {
  const value = session?.user?.id || session?.user?._id;
  return isValidObjectId(value) ? value : null;
}

function errorText(error) {
  return paymentErrorMessage(error);
}

function estimatedRentalAmounts(reservation, estimate) {
  const rent = estimate?.estimatedRent ?? reservation?.estimatedRent;
  const tax = estimate?.taxAmount ?? reservation?.taxAmount ?? 0;
  const discount = estimate?.discountAmount ?? reservation?.discountAmount ?? 0;
  const deposit = estimate?.depositAmount ?? reservation?.depositAmount;
  if (![rent, tax, discount, deposit].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) return null;
  const totalDue = rent + tax - discount;
  if (!Number.isFinite(totalDue) || totalDue < 0 || deposit > totalDue) return null;
  return { rent, tax, discount, deposit, totalDue, remainingBalance: totalDue - deposit };
}

function PaymentRecord({ payment, onRefresh, onContinue, refreshing }) {
  const view = paymentStatusView(payment);
  const variant = view.tone === "success" ? "green" : view.tone === "danger" ? "dark" : "orange";
  const showQr = canShowPayosQr(payment);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    let active = true;
    setQrDataUrl("");
    setQrError(false);
    if (showQr) {
      createPayosQrDataUrl(payment).then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl || "");
      }).catch(() => {
        if (active) setQrError(true);
      });
    }
    return () => { active = false; };
  }, [payment.id, payment.qrCode, showQr]);

  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Payment status</h2>
            <p className="mt-1 text-sm text-slate-600">{view.label}</p>
          </div>
          <Badge variant={variant}>{payment.status.replaceAll("_", " ")}</Badge>
        </div>
        <div className="mt-5">
          <Details values={[
            ["Purpose", payment.purpose === "DEPOSIT" ? "Advance rent" : "Remaining rent"],
            ["Amount", `${formatMoney(payment.amount)} ${payment.currency}`],
            ["Provider settlement", payment.providerSettlementStatus],
            ["Reservation application", payment.applicationStatus],
            ["Payment reference", payment.id],
          ]} />
        </div>
        {showQr && (
          <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4" aria-label="PayOS QR payment">
            <h3 className="font-semibold">Scan the PayOS payment QR</h3>
            <p className="mt-1 text-sm text-slate-600">
              Pay {formatMoney(payment.amount)} {payment.currency} for {payment.purpose === "DEPOSIT" ? "Deposit" : "Remaining Balance"}.
              The Backend will confirm when payment is verified.
            </p>
            {qrDataUrl ? (
              <img
                className="mx-auto mt-4 h-80 w-80 max-w-full rounded bg-white"
                src={qrDataUrl}
                alt={`Scannable PayOS QR for ${payment.purpose === "DEPOSIT" ? "Deposit" : "Remaining Balance"}, ${formatMoney(payment.amount)} ${payment.currency}`}
                width="320"
                height="320"
              />
            ) : (
              <p className="mt-3 text-sm" role={qrError ? "alert" : "status"}>
                {qrError ? "The QR could not be rendered. Use the secure PayOS checkout button below." : "Preparing secure payment QR…"}
              </p>
            )}
            <p className="mt-3 text-sm text-slate-600">On this device? Open PayOS Checkout below to complete payment.</p>
          </section>
        )}
        {payment.reconciliationRequired && (
          <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Funds or payment status require manual reconciliation. Do not create another payment or assume the reservation is paid.
          </p>
        )}
        {payment.status === "SUCCEEDED" && payment.applicationStatus !== "APPLIED" && (
          <p className="mt-4 text-sm text-amber-800">
            Provider success alone does not mean the payment has been applied to this reservation.
          </p>
        )}
        <Button className="mt-5" variant="outline" disabled={refreshing} onClick={() => onRefresh(payment)}>
          {refreshing ? "Refreshing…" : "Refresh payment status"}
        </Button>
        {canOpenPayosCheckout(payment) && (
          <Button className="ml-2 mt-5" onClick={() => onContinue(payment)}>Open PayOS Checkout</Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function SelfStoragePayosCheckout({
  reservationId,
  initialReservation,
  loadContext,
  loadContract,
  loadOverview,
  onReservationRefresh,
}) {
  const session = useAuthSession();
  const customerId = customerIdFromSession(session);
  const reservation = initialReservation || null;
  const context = { data: reservation ? { reservation } : null, loading: !reservation, error: "", retry: onReservationRefresh };
  const contractResource = useBackend(
    (config) => reservation ? loadContract(reservationId, recordId(reservation.customerId), config) : Promise.resolve(null),
    [reservationId, reservation?.status],
  );
  const overviewResource = useBackend(
    (config) => reservation ? loadOverview(reservation, config) : Promise.resolve(null),
    [reservationId, recordId(reservation?.facilityId), recordId(reservation?.storageUnitId)],
  );
  const [snapshot, setSnapshot] = useState(null);
  const [attemptsByPurpose, setAttemptsByPurpose] = useState({ DEPOSIT: [], BALANCE: [] });
  const [paymentsById, setPaymentsById] = useState({});
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyNextCursor, setHistoryNextCursor] = useState(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [trackingCorrupt, setTrackingCorrupt] = useState(false);
  const [checkoutUnavailable, setCheckoutUnavailable] = useState(false);
  const busy = useRef(false);
  const polling = useRef(false);
  const alive = useRef(true);
  const contract = snapshot?.contract || contractResource.data;
  const overview = snapshot?.rentalOverview || overviewResource.data;
  const estimatedAmounts = estimatedRentalAmounts(reservation, overview?.estimate);
  const purpose = eligiblePayosPurpose(reservation, contract);
  const currentPayment = purpose
    ? paymentsById[attemptsByPurpose[purpose]?.at(-1)?.paymentId]
    : null;
  const paymentHistory = mergePayosPaymentHistory(Object.values(paymentsById), [], reservationId);
  const blockingPayment = purpose ? unresolvedPayosPayment(paymentHistory, purpose) : null;
  const pollingPaymentIds = paymentHistory.filter(isPayosPaymentPollable).map((payment) => payment.id);
  const pollingPaymentKey = pollingPaymentIds.join("|");

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const storage = safeStorage();
    if (!storage || !customerId || !isValidObjectId(reservationId)) {
      setStorageUnavailable(!storage);
      setAttemptsByPurpose({ DEPOSIT: [], BALANCE: [] });
      return;
    }
    const deposit = readPayosAttempts(storage, customerId, reservationId, "DEPOSIT");
    const balance = readPayosAttempts(storage, customerId, reservationId, "BALANCE");
    setStorageUnavailable(deposit.unavailable || balance.unavailable);
    setTrackingCorrupt(deposit.corrupt || balance.corrupt);
    setAttemptsByPurpose({ DEPOSIT: deposit.attempts, BALANCE: balance.attempts });
    setPaymentsById({});
  }, [customerId, reservationId, session.accessToken]);

  useEffect(() => {
    if (!customerId || !session.accessToken || !pollingPaymentKey) return undefined;
    const token = getAccessToken();
    let active = true;
    const tick = async () => {
      if (!active || document.hidden || busy.current || polling.current || getAccessToken() !== token) return;
      polling.current = true;
      try {
        const candidates = pollingPaymentIds
          .map((id) => paymentHistory.find((payment) => payment.id === id))
          .filter(Boolean);
        await pollPayosPaymentStatuses({
          payments: candidates,
          reservationId,
          paymentApi,
          getAccessToken,
          isCurrent: () => active,
          onPayment: (payment) => setPaymentsById((previous) => ({ ...previous, [payment.id]: payment })),
          onApplied: async () => {
            const refreshed = await loadContext(reservationId);
            if (active && getAccessToken() === token) {
              setSnapshot(refreshed);
              onReservationRefresh?.();
              setNotice("Payment was verified and applied by the Backend. Reservation status has been refreshed.");
            }
          },
        });
      } catch {
        // A polling error never changes payment status or creates another attempt.
      } finally {
        polling.current = false;
      }
    };
    const interval = window.setInterval(tick, 5000);
    const onVisibilityChange = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [customerId, reservationId, session.accessToken, pollingPaymentKey]);

  useEffect(() => {
    if (!customerId || !session.accessToken || !isValidObjectId(reservationId)) {
      setHistoryLoaded(false);
      setHistoryNextCursor(null);
      return undefined;
    }
    const token = getAccessToken();
    let active = true;
    setHistoryLoaded(false);
    setHistoryError("");
    void paymentApi.listPayosPaymentsForReservation(reservationId)
      .then((page) => {
        if (!active || getAccessToken() !== token) return;
        setPaymentsById((previous) => Object.fromEntries(
          mergePayosPaymentHistory(Object.values(previous), page.items, reservationId).map((payment) => [payment.id, payment]),
        ));
        setHistoryNextCursor(page.nextCursor);
        if (page.items.some((payment) => payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED")) {
          void loadContext(reservationId).then((refreshed) => {
            if (active && getAccessToken() === token) {
              setSnapshot(refreshed);
              onReservationRefresh?.();
            }
          }).catch(() => {});
        }
      })
      .catch((cause) => {
        if (active && getAccessToken() === token) setHistoryError(errorText(cause));
      })
      .finally(() => { if (active && getAccessToken() === token) setHistoryLoaded(true); });
    return () => { active = false; };
  }, [customerId, reservationId, session.accessToken]);

  async function loadOlderPayments() {
    if (!historyNextCursor || historyLoadingMore || !customerId) return;
    const token = getAccessToken();
    setHistoryLoadingMore(true);
    setHistoryError("");
    try {
      const page = await paymentApi.listPayosPaymentsForReservation(reservationId, { cursor: historyNextCursor });
      if (!alive.current || getAccessToken() !== token) return;
      setPaymentsById((previous) => Object.fromEntries(
        mergePayosPaymentHistory(Object.values(previous), page.items, reservationId).map((payment) => [payment.id, payment]),
      ));
      setHistoryNextCursor(page.nextCursor);
      if (page.items.some((payment) => payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED")) {
        const refreshed = await loadContext(reservationId);
        if (!alive.current || getAccessToken() !== token) return;
        setSnapshot(refreshed);
        onReservationRefresh?.();
      }
    } catch (cause) {
      if (alive.current && getAccessToken() === token) setHistoryError(errorText(cause));
    } finally {
      if (alive.current && getAccessToken() === token) setHistoryLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!context.data || !customerId || !session.accessToken) return undefined;
    const storage = safeStorage();
    if (!storage) return undefined;
    const token = getAccessToken();
    let active = true;
    const loadStatuses = async () => {
      const loaded = {};
      const purposes = ["DEPOSIT", "BALANCE"];
      for (const itemPurpose of purposes) {
        const stored = readPayosAttempts(storage, customerId, reservationId, itemPurpose);
        if (stored.unavailable || stored.corrupt) continue;
        for (const attempt of stored.attempts) {
          if (!attempt.paymentId) continue;
          try {
            const payment = await paymentApi.getPayosPaymentStatus(
              reservationId,
              attempt.paymentId,
            );
            if (getAccessToken() !== token || !active) return;
            loaded[payment.id] = payment;
          } catch {
            // Keep the original attempt and key. A status read failure never creates a replacement.
          }
        }
      }
      if (getAccessToken() !== token || !active) return;
      setPaymentsById((previous) => ({ ...previous, ...loaded }));
      if (Object.values(loaded).some((payment) =>
        payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED"
      )) {
        try {
          const refreshed = await loadContext(reservationId);
          if (getAccessToken() === token && active) {
            setSnapshot(refreshed);
            onReservationRefresh?.();
          }
        } catch {
          // The verified payment status remains visible; reservation refresh is still available to the user.
        }
      }
    };
    void loadStatuses();
    return () => { active = false; };
  }, [context.data?.reservation?.status, customerId, reservationId, session.accessToken]);

  function persistAttempts(itemPurpose, nextAttempts) {
    const storage = safeStorage();
    if (!storage || !customerId) throw Error("Payment tracking is unavailable. Sign in again before checkout.");
    writePayosAttempts(storage, customerId, reservationId, itemPurpose, nextAttempts);
    setAttemptsByPurpose((previous) => ({ ...previous, [itemPurpose]: nextAttempts }));
  }

  async function refreshReservation() {
    if (busy.current) return null;
    busy.current = true;
    setPending("reservation");
    setError("");
    try {
      const token = getAccessToken();
      const fresh = await loadContext(reservationId);
      if (!alive.current || getAccessToken() !== token) return null;
      if (recordId(fresh?.reservation) !== reservationId || fresh?.reservation?.serviceType !== "SELF_STORAGE") {
        throw Error("Reservation could not be verified for this payment.");
      }
      setSnapshot(fresh);
      onReservationRefresh?.();
      return fresh;
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
      return null;
    } finally {
      busy.current = false;
      if (alive.current) setPending("");
    }
  }

  async function refreshPayment(payment) {
    if (busy.current || polling.current || !customerId) return;
    busy.current = true;
    setPending(`status:${payment.id}`);
    setError("");
    setNotice("");
    const token = getAccessToken();
    try {
      const fresh = await paymentApi.getPayosPaymentStatus(reservationId, payment.id);
      if (!alive.current || getAccessToken() !== token) return;
      setPaymentsById((previous) => ({ ...previous, [fresh.id]: fresh }));
      if (fresh.providerSettlementStatus === "VERIFIED" && fresh.applicationStatus === "APPLIED") {
        const updated = await loadContext(reservationId);
        if (!alive.current || getAccessToken() !== token) return;
        setSnapshot(updated);
        onReservationRefresh?.();
        setNotice("Payment was verified and applied by the Backend. Reservation status has been refreshed.");
      }
    } catch (cause) {
      if (alive.current && getAccessToken() === token) setError(errorText(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPending("");
    }
  }

  async function pay() {
    if (busy.current || polling.current || !purpose || !customerId || !historyLoaded) return;
    if (blockingPayment) {
      setNotice(canOpenPayosCheckout(blockingPayment)
        ? "An existing payment is ready. Use its explicit Open PayOS Checkout button or scan its QR; no new payment was created."
        : "An existing payment attempt is unresolved. Check its status before starting another payment.");
      return;
    }
    if (storageUnavailable || trackingCorrupt) return;
    busy.current = true;
    setPending("checkout");
    setError("");
    setNotice("");
    const token = getAccessToken();
    try {
      const freshContext = await loadContext(reservationId);
      if (!alive.current || getAccessToken() !== token) return;
      const freshReservation = freshContext?.reservation;
      const freshContract = freshContext?.contract;
      if (
        recordId(freshReservation) !== reservationId ||
        eligiblePayosPurpose(freshReservation, freshContract) !== purpose
      ) {
        setSnapshot(freshContext);
        throw Error("Reservation, contract or payment eligibility changed. Refresh before continuing.");
      }
      setSnapshot(freshContext);

      const storage = safeStorage();
      if (!storage) throw Error("This browser cannot preserve a stable payment attempt. No checkout was opened.");
      const stored = readPayosAttempts(storage, customerId, reservationId, purpose);
      if (stored.unavailable || stored.corrupt) {
        setStorageUnavailable(stored.unavailable);
        setTrackingCorrupt(stored.corrupt);
        throw Error("Payment attempt tracking could not be verified. Do not start another payment.");
      }
      let attempts = stored.attempts;
      let attempt = attempts.at(-1);
      let priorPayment = null;
      if (attempt?.paymentId) {
        priorPayment = await paymentApi.getPayosPaymentStatus(reservationId, attempt.paymentId);
        if (!alive.current || getAccessToken() !== token) return;
        setPaymentsById((previous) => ({ ...previous, [priorPayment.id]: priorPayment }));
        if (
          priorPayment.providerSettlementStatus === "VERIFIED" ||
          priorPayment.applicationStatus === "MANUAL_REVIEW" ||
          priorPayment.status === "SUCCEEDED" ||
          priorPayment.status === "RECONCILIATION_REQUIRED"
        ) {
          if (priorPayment.providerSettlementStatus === "VERIFIED" && priorPayment.applicationStatus === "APPLIED") {
            const updated = await loadContext(reservationId);
            if (getAccessToken() === token && alive.current) {
              setSnapshot(updated);
              onReservationRefresh?.();
            }
          }
          setNotice("This payment attempt already has a provider result. Review its status before taking another action.");
          return;
        }
        if (canStartNewPayosAttempt(priorPayment)) {
          attempt = { idempotencyKey: newPayosIdempotencyKey(), paymentId: null };
          attempts = [...attempts, attempt];
          persistAttempts(purpose, attempts);
        }
      }
      if (!attempt) {
        attempt = { idempotencyKey: newPayosIdempotencyKey(), paymentId: null };
        attempts = [...attempts, attempt];
        persistAttempts(purpose, attempts);
      }

      const result = await paymentApi.createPayosCheckout(
        reservationId,
        purpose,
        attempt.idempotencyKey,
      );
      if (!alive.current || getAccessToken() !== token) return;
      const payment = result.payment;
      attempts = attempts.map((entry) => entry.idempotencyKey === attempt.idempotencyKey
        ? { ...entry, paymentId: payment.id }
        : entry);
      persistAttempts(purpose, attempts);
      setPaymentsById((previous) => ({ ...previous, [payment.id]: payment }));

      if (payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED") {
        const updated = await loadContext(reservationId);
        if (!alive.current || getAccessToken() !== token) return;
        setSnapshot(updated);
        onReservationRefresh?.();
        setNotice("Payment was verified and applied by the Backend. Reservation status has been refreshed.");
        return;
      }
      if (eligiblePayosPurpose(freshReservation, freshContract) !== purpose) {
        setNotice("Payment was created, but reservation eligibility changed. Review its status before continuing.");
      } else if (canShowPayosQr(payment)) {
        setNotice("Your PayOS QR is ready. Scan it with your banking app or choose Open PayOS Checkout.");
      } else if (canOpenPayosCheckout(payment)) {
        setNotice("Secure PayOS Checkout is ready. Choose Open PayOS Checkout to continue.");
      } else {
        setNotice(paymentStatusView(payment).label);
      }
    } catch (cause) {
      if (!alive.current || getAccessToken() !== token) return;
      if (cause.response?.status === 404 || cause.response?.status === 503) {
        setCheckoutUnavailable(true);
        setNotice("");
        setError("");
      } else setError(errorText(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPending("");
    }
  }

  function continueExistingCheckout(payment) {
    if (canOpenPayosCheckout(payment)) window.location.assign(payment.checkoutUrl);
  }

  const contractNextStep = reservation?.status === "DEPOSIT_PAID";
  const returnQueryPresent = typeof window !== "undefined" && !!window.location.search;
  const unmatchedReturn = returnQueryPresent && historyLoaded && !historyError && paymentHistory.length === 0;
  const eligible = !!purpose && !contractResource.loading && !contractResource.error && historyLoaded && !historyError && !unmatchedReturn && !storageUnavailable && !trackingCorrupt && !checkoutUnavailable && !context.loading && !!customerId && !blockingPayment;
  const durationMs = Date.parse(reservation?.endDate || "") - Date.parse(reservation?.startDate || "");
  const durationDays = overview?.estimate?.durationDays || (Number.isFinite(durationMs) && durationMs > 0 ? Math.ceil(durationMs / 86_400_000) : null);
  const visiblePayment = blockingPayment || currentPayment;
  const missingPrerequisite = reservation?.status === "CONTRACTED"
    ? contractResource.loading
      ? "Verifying the linked DRAFT contract before enabling the advance-rent Deposit…"
      : !contract
        ? "A linked DRAFT contract is required before Deposit checkout. The Reservation is already saved; do not book it again."
        : contract.status !== "DRAFT"
          ? `Deposit requires a DRAFT contract; the current contract status is ${contract.status}.`
          : !Number.isFinite(Date.parse(reservation.expiresAt || "")) || Date.parse(reservation.expiresAt) <= Date.now()
            ? "The CONTRACTED Reservation payment eligibility window has expired."
            : "Deposit checkout is unavailable because Reservation eligibility could not be verified."
    : reservation?.status === "CHECKIN_READY" && !purpose
      ? "Balance requires CHECKIN_READY and a verified SIGNED contract with signed-paper proof."
      : reservation && !purpose && !["DEPOSIT_PAID", "PAID"].includes(reservation.status)
        ? `Payment is unavailable while the Reservation is ${reservation.status}.`
        : "";

  return (
    <CustomerScreen
      title="Self Storage payment"
      description="Pay through the Backend-created PayOS Hosted Checkout. Reservation and payment status always come from the Backend."
      notice="The amount and payment result are confirmed by the Backend. Returning from PayOS does not itself prove payment."
    >
      <LoadState resource={context} />
      {reservation && <RentalSummary item={reservation} />}
      {reservation && (
        <Card>
          <CardContent>
            {reservation.status === "CONTRACTED" && <p className="mb-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900" role="status">Your Self Storage booking is confirmed. No Manager approval is pending. Create the PayOS advance-rent Deposit below when ready.</p>}
            <h2 className="text-xl font-bold">{purpose === "BALANCE" ? "Thanh toán số tiền thuê còn lại" : "Thanh toán tiền thuê trả trước"}</h2>
            <>
              <LoadState resource={contractResource} />
              {contractResource.data === null && !contractResource.loading && !contractResource.error && <><Message error="The reservation was created, but its linked contract was not found. No new reservation was created. Retry contract lookup before attempting a Deposit." /><Button className="mt-3" variant="outline" onClick={contractResource.retry}>Retry contract lookup</Button></>}
              {overviewResource.loading && !overview?.facility && !overview?.unit && <p className="mt-4 text-sm text-slate-600" role="status">Loading Facility and StorageUnit details…</p>}
            </>
            <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Rental overview">
              <h3 className="font-semibold">Rental overview</h3>
              <div className="mt-3"><Details values={[
                ["Facility", overview?.facility?.name || reservation.facilityName || "Details unavailable"],
                ["Unit", overview?.unit?.unitCode || reservation.storageUnitCode || "Details unavailable"],
                ["Unit size", overview?.unit?.size || reservation.unitSize || "Not returned"],
                ["Volume", typeof overview?.unit?.volumeM3 === "number" ? `${overview.unit.volumeM3} m³` : "Not returned"],
                ["Start date", reservation.startDate || "Not returned"],
                ["End date", reservation.endDate || "Not returned"],
                ["Rental duration", durationDays ? `${durationDays} days` : "Not available"],
                ["Estimated rent", estimatedAmounts ? `${formatMoney(estimatedAmounts.rent)} VND` : "Not available"],
                ["Estimated Deposit", estimatedAmounts ? `${formatMoney(estimatedAmounts.deposit)} VND` : "Not available"],
                ["Estimated total due", estimatedAmounts ? `${formatMoney(estimatedAmounts.totalDue)} VND` : "Not available"],
                ["Estimated remaining balance", estimatedAmounts ? `${formatMoney(estimatedAmounts.remainingBalance)} VND` : "Not available"],
              ]} /></div>
              <p className="mt-3 text-xs text-slate-600">Amounts shown before Payment creation are Backend Reservation estimates. The immutable PayOS Payment amount shown separately is returned by Backend and is the amount to pay.</p>
            </section>
            {overview?.error && <p className="mt-4 text-sm text-amber-800" role="status">{overview.error}</p>}
            <div className="mt-4">
              <Details values={[
                ["Reservation reference", reservation.reservationCode || recordId(reservation)],
                ["Reservation status", <RentalStatus key="status" status={reservation.status} reservation={reservation} />],
                ["Payment purpose", purpose === "BALANCE" ? "Remaining rent" : "Advance rent credited toward rent"],
                ["Amount", visiblePayment ? `${formatMoney(visiblePayment.amount)} ${visiblePayment.currency}` : "Estimated; exact payable amount comes from Backend checkout"],
                ["Contract status", contract?.status || (contractResource.loading ? "Loading contract…" : contractResource.error ? "Unavailable" : "Not found")],
                ["Payment status", visiblePayment ? paymentStatusView(visiblePayment).label : historyError ? "Unavailable" : historyLoaded ? "No PayOS Payment yet" : "Loading payment history…"],
              ]} />
            </div>
            {purpose === "DEPOSIT" && <p className="mt-4 text-sm text-slate-600">This is advance rent credited toward the rental amount. It is not described as a refundable security deposit.</p>}
            {purpose === "BALANCE" && <p className="mt-4 text-sm text-slate-600">Balance checkout requires the Backend to confirm an applied PayOS advance-rent payment.</p>}
            {!purpose && reservation.status === "DEPOSIT_PAID" && (
              <div className="mt-5 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">
                Advance rent is recorded. Review the existing contract and complete the required contract step before continuing.
                <Button asChild className="mt-4"><RouterLink to={`/portal/contracts/${reservationId}`}>Review contract next steps</RouterLink></Button>
              </div>
            )}
            {!purpose && !contractNextStep && reservation.status === "PAID" && (
              <p className="mt-5 text-sm text-slate-600">Payment does not activate the rental. Facility handover remains a separate process.</p>
            )}
            {purpose && (
              <Button className="mt-5" disabled={!eligible || !!pending} aria-busy={pending === "checkout"} onClick={pay}>
                {pending === "checkout" ? "Preparing secure checkout…" : purpose === "DEPOSIT" ? "Thanh toán tiền thuê trả trước với PayOS" : "Thanh toán số tiền thuê còn lại với PayOS"}
              </Button>
            )}
            {missingPrerequisite && <p className="mt-5 text-sm text-amber-800" role="status">{missingPrerequisite}</p>}
          </CardContent>
        </Card>
      )}
      {Object.values(paymentsById).map((payment) => (
        <PaymentRecord
          key={payment.id}
          payment={payment}
          onRefresh={refreshPayment}
          onContinue={continueExistingCheckout}
          refreshing={pending === `status:${payment.id}`}
        />
      ))}
      {historyError && <Message error={`Payment history could not be verified. Do not start another payment yet. ${historyError}`} />}
      {checkoutUnavailable && <Message error="PayOS checkout is unavailable or its result is uncertain. The Reservation remains saved; no successful payment is assumed. Refresh payment history before trying again." />}
      {historyLoaded && !historyError && historyNextCursor && (
        <Button variant="outline" disabled={historyLoadingMore} onClick={loadOlderPayments}>
          {historyLoadingMore ? "Loading older payments…" : "Load older payments"}
        </Button>
      )}
      {storageUnavailable && <Message error="This browser cannot safely preserve the payment attempt. Checkout is unavailable until session storage works." />}
      {trackingCorrupt && <Message error="Stored payment tracking could not be verified. Do not start another payment; contact support or sign in again." />}
      {!customerId && <Message error="Customer identity is unavailable. Sign in again before starting a payment." />}
      {returnQueryPresent && historyLoaded && !historyError && !Object.keys(paymentsById).length && (
        <Message error="No payment record was found for this return. Redirect details do not confirm payment; check with support before retrying." />
      )}
      <Message error={error} />
      <Message success={notice} />
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={!!pending} onClick={refreshReservation}>
          {pending === "reservation" ? "Refreshing…" : "Refresh reservation and contract"}
        </Button>
        <Button asChild variant="outline"><RouterLink to={`/portal/reservations/${reservationId}`}>Back to reservation</RouterLink></Button>
        <Button asChild variant="outline"><RouterLink to="/portal">Back to My Units</RouterLink></Button>
      </div>
    </CustomerScreen>
  );
}
