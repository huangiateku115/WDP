import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { CustomerScreen } from "@/components/common/CustomerScreen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import paymentApi from "@/api/paymentApi";
import { getAccessToken, useAuthSession } from "@/lib/authSession";
import {
  assessPayosEligibility,
  canStartNewPayosAttempt,
  formatPayosVnd,
  isValidObjectId,
  mergePayosPaymentHistory,
  newPayosIdempotencyKey,
  normalizePayosReferenceId,
  paymentErrorMessage,
  paymentStatusView,
  readPayosAttempts,
  unresolvedPayosPayment,
  writePayosAttempts,
} from "@/lib/selfStoragePayos";
import { canOpenPayosCheckout } from "@/api/payosPaymentClient";
import { isPayosPaymentPollable, pollPayosPaymentStatuses } from "@/lib/selfStoragePayosPolling";
import {
  LoadState,
  Message,
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
  const code = error?.response?.data?.code;
  if (code === "PAYOS_CHECKOUT_DISABLED") return "Cổng thanh toán hiện chưa sẵn sàng.";
  if (code === "PAYOS_CONFIGURATION_MISSING") return "Không thể khởi tạo thanh toán. Vui lòng liên hệ hỗ trợ.";
  if (code === "PAYOS_CHECKOUT_OUTCOME_UNKNOWN" || code === "PAYMENT_OUTCOME_UNKNOWN") return "Chưa xác định được kết quả tạo mã thanh toán. Vui lòng kiểm tra giao dịch hiện có.";
  if (code === "PAYMENT_ATTEMPT_UNRESOLVED") return "Bạn đang có một giao dịch chưa hoàn tất. Vui lòng kiểm tra trạng thái trước khi tiếp tục.";
  if (code === "RESERVATION_HOLD_EXPIRED") return "Thời hạn thanh toán đã hết.";
  const status = error?.response?.status;
  if (status === 400) return "Không thể tạo liên kết với thông tin thanh toán hiện tại. Hãy kiểm tra lại đơn thuê.";
  if (status === 502) return "PayOS chưa xác nhận kết quả. Hãy kiểm tra trạng thái trước khi tiếp tục.";
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại và kiểm tra trạng thái giao dịch.";
  if (status === 403) return "Không thể truy cập giao dịch này bằng tài khoản hiện tại.";
  if (status === 404) return "Không tìm thấy thông tin thanh toán. Hãy làm mới lịch sử giao dịch.";
  if (status === 409) return "Thông tin đặt kho hoặc giao dịch đã thay đổi. Hãy làm mới trạng thái trước khi tiếp tục.";
  if (status === 503 || error?.isAxiosError && !error.response) return "Chưa xác định được kết quả tạo mã thanh toán. Giữ nguyên lần thử hiện tại và kiểm tra trạng thái.";
  return paymentErrorMessage(error);
}

function eligibilityText(reason) {
  const messages = {
    INVALID_RESERVATION_ID: "Không xác minh được đơn thuê. Thanh toán hiện chưa khả dụng.",
    INVALID_CONTRACT_ID: "Thông tin hợp đồng chưa hợp lệ. Vui lòng liên hệ hỗ trợ.",
    CONTRACT_RESERVATION_MISMATCH: "Hợp đồng không khớp với đơn thuê này. Thanh toán tạm thời chưa khả dụng.",
    CONTRACT_CUSTOMER_MISMATCH: "Không thể xác minh quyền sở hữu hợp đồng bằng tài khoản hiện tại.",
    UNSUPPORTED_SERVICE: "PayOS chỉ hỗ trợ thanh toán đơn thuê Self-Storage tại đây.",
    INVALID_RESERVATION_STATUS: "Đơn thuê chưa ở trạng thái có thể thanh toán. Hãy làm mới trạng thái.",
    CONTRACT_NOT_DRAFT: "Khoản trả trước yêu cầu hợp đồng vẫn ở trạng thái chờ ký.",
    RESERVATION_HOLD_EXPIRED: "Thời hạn thanh toán đã hết.",
    CONTRACT_NOT_LOADED: "Chưa tìm thấy hợp đồng gắn với đơn thuê. Hãy thử tải lại hợp đồng.",
    CONTRACT_LOAD_FAILED: "Không thể xác minh hợp đồng. Hãy thử tải lại; bạn không cần đặt kho lần nữa.",
    CONTRACT_NOT_SIGNED: "Khoản thanh toán còn lại yêu cầu hợp đồng đã ký.",
    SIGNED_PROOF_NOT_VERIFIED: "Chưa xác minh được chứng từ ký hợp đồng.",
  };
  return messages[reason] || "Không thể xác minh điều kiện thanh toán. Vui lòng thử làm mới trạng thái.";
}

async function loadCompletePayosHistory(reservationId) {
  let page = await paymentApi.listPayosPaymentsForReservation(reservationId, { limit: 25 });
  let items = mergePayosPaymentHistory([], page.items, reservationId);
  let cursor = page.nextCursor;
  let pagesRead = 1;
  while (cursor) {
    if (pagesRead >= 100) throw Error("Payment history could not be fully verified. Do not start another payment yet.");
    page = await paymentApi.listPayosPaymentsForReservation(reservationId, { limit: 25, cursor });
    items = mergePayosPaymentHistory(items, page.items, reservationId);
    cursor = page.nextCursor;
    pagesRead += 1;
  }
  return { items, nextCursor: null };
}

function PaymentPanel({ payment, onRefresh, onContinue, onRetry, retrying, refreshing, purpose, reservationId }) {
  const view = paymentStatusView(payment);
  const identityMatches = payment.reservationId === reservationId && payment.purpose === purpose;
  const canContinue = identityMatches && canOpenPayosCheckout(payment);
  const canRetry = identityMatches && canStartNewPayosAttempt(payment);
  const applied = payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED";
  const message = applied
    ? "Thanh toán thành công. Đang mở lịch sử giao dịch…"
    : view.key === "MANUAL_REVIEW" || view.key === "RECONCILIATION_REQUIRED"
      ? "Giao dịch cần được kiểm tra. Không tạo thêm lần thanh toán mới."
      : view.key === "UNCERTAIN" || view.key === "CREATING"
        ? "Chưa thể xác nhận liên kết thanh toán. Vui lòng kiểm tra giao dịch hiện có."
        : view.key === "FAILED"
          ? "PayOS đã xác nhận lần thanh toán này không thành công. Có thể tạo lần mới sau khi kiểm tra trạng thái."
          : "Đang chờ PayOS xác nhận thanh toán. Trạng thái sẽ được cập nhật từ Backend.";

  return (
    <Card className="mx-auto w-full max-w-xl overflow-hidden border-slate-200 shadow-sm">
      <CardContent className="p-5 sm:p-8">
        <div className="text-center">
          <p className="text-sm font-medium text-slate-500">{purpose === "BALANCE" ? "Tiền thuê còn lại" : "Tiền thuê trả trước"}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl" aria-label="Số tiền thanh toán">{formatPayosVnd(payment.amount)} ₫</p>
        </div>
        <p className={view.tone === "warning" ? "mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-900" : applied ? "mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm text-emerald-900" : "mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-700"} role="status" aria-live="polite">{message}</p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          {canContinue && <Button className="w-full sm:w-auto" variant="orange" onClick={() => onContinue(payment)}>Tiếp tục thanh toán qua PayOS</Button>}
          {canRetry && <Button className="w-full sm:w-auto" disabled={retrying} variant="orange" onClick={onRetry}>{retrying ? "Đang tạo liên kết thanh toán…" : "Tạo lần thanh toán mới"}</Button>}
          <Button className="w-full sm:w-auto" variant="outline" disabled={refreshing} onClick={() => onRefresh(payment)}>{refreshing ? "Đang kiểm tra…" : "Làm mới trạng thái"}</Button>
          <Button asChild className="w-full sm:w-auto" variant="ghost"><RouterLink to="/portal/payments" state={{ reservationId: payment.reservationId, paymentId: payment.id }}>Xem lịch sử thanh toán</RouterLink></Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SelfStoragePayosCheckout({
  reservationId,
  initialReservation,
  loadContext,
  loadContract,
  onReservationRefresh,
}) {
  const session = useAuthSession();
  const location = useLocation();
  const navigate = useNavigate();
  const customerId = customerIdFromSession(session);
  const reservation = initialReservation || null;
  const context = { data: reservation ? { reservation } : null, loading: !reservation, error: "", retry: onReservationRefresh };
  const contractResource = useBackend(
    (config) => reservation ? loadContract(reservationId, normalizePayosReferenceId(reservation.customerId), config) : Promise.resolve(null),
    [reservationId, reservation?.status],
  );
  const [snapshot, setSnapshot] = useState(null);
  const [attemptsByPurpose, setAttemptsByPurpose] = useState({ DEPOSIT: [], BALANCE: [] });
  const [paymentsById, setPaymentsById] = useState({});
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyNextCursor, setHistoryNextCursor] = useState(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
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
  const eligibility = assessPayosEligibility(reservation, contract, Date.now(), customerId);
  const purpose = eligibility.purpose;
  const currentPayment = purpose
    ? paymentsById[attemptsByPurpose[purpose]?.at(-1)?.paymentId]
    : null;
  const paymentHistory = mergePayosPaymentHistory(Object.values(paymentsById), [], reservationId);
  const blockingPayment = purpose ? unresolvedPayosPayment(paymentHistory, purpose) : null;
  const pollingPaymentIds = paymentHistory.filter(isPayosPaymentPollable).map((payment) => payment.id);
  const pollingPaymentKey = pollingPaymentIds.join("|");
  const completionNavigated = useRef(false);
  const automaticHandoffConsumed = useRef(false);

  function goToHistory(paymentId, verifiedApplied = false) {
    if (completionNavigated.current) return;
    completionNavigated.current = true;
    navigate("/portal/payments", { replace: true, state: { reservationId, paymentId: paymentId || null, returnContext: { reservationId, verifiedApplied } } });
  }

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
          onApplied: async (appliedPayment) => {
            const refreshed = await loadContext(reservationId);
            if (active && getAccessToken() === token) {
              setSnapshot(refreshed);
              onReservationRefresh?.();
              goToHistory(appliedPayment?.id, true);
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
    void loadCompletePayosHistory(reservationId)
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
              const applied = page.items.find((payment) => payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED");
              goToHistory(applied?.id, true);
            }
          }).catch(() => { });
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
        const applied = page.items.find((payment) => payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED");
        goToHistory(applied?.id, true);
      }
    } catch (cause) {
      if (alive.current && getAccessToken() === token) setHistoryError(errorText(cause));
    } finally {
      if (alive.current && getAccessToken() === token) setHistoryLoadingMore(false);
    }
  }

  async function refreshPaymentHistory() {
    if (!customerId || !session.accessToken || historyRefreshing) return;
    const token = getAccessToken();
    setHistoryRefreshing(true);
    setHistoryError("");
    try {
      const page = await loadCompletePayosHistory(reservationId);
      if (!alive.current || getAccessToken() !== token) return;
      setPaymentsById((previous) => Object.fromEntries(
        mergePayosPaymentHistory(Object.values(previous), page.items, reservationId).map((payment) => [payment.id, payment]),
      ));
      setHistoryNextCursor(page.nextCursor);
      setHistoryLoaded(true);
    } catch (cause) {
      if (alive.current && getAccessToken() === token) setHistoryError(errorText(cause));
    } finally {
      if (alive.current && getAccessToken() === token) setHistoryRefreshing(false);
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
            const applied = Object.values(loaded).find((payment) => payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED");
            goToHistory(applied?.id, true);
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
        goToHistory(fresh.id, true);
      }
    } catch (cause) {
      if (alive.current && getAccessToken() === token) setError(errorText(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPending("");
    }
  }

  async function pay({ automatic = false } = {}) {
    if (busy.current || polling.current || !purpose || !customerId || !historyLoaded) return;
    if (blockingPayment) {
      setNotice(canOpenPayosCheckout(blockingPayment)
        ? "Đã có giao dịch đang chờ. Hãy tiếp tục tại trang thanh toán PayOS hiện có."
        : "Giao dịch hiện tại chưa được xác nhận xong. Hãy kiểm tra trạng thái trước khi tiếp tục.");
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
        assessPayosEligibility(freshReservation, freshContract, Date.now(), customerId).purpose !== purpose
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
      if (automatic && attempt) return;
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
              goToHistory(priorPayment.id, true);
            }
          }
          setNotice("Đã có kết quả cho lần thanh toán này. Hãy kiểm tra lịch sử trước khi thực hiện thao tác khác.");
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
        goToHistory(payment.id, true);
        return;
      }
      if (assessPayosEligibility(freshReservation, freshContract, Date.now(), customerId).purpose !== purpose) {
        setNotice("Giao dịch đã được tạo nhưng điều kiện thanh toán đã thay đổi. Hãy kiểm tra trạng thái trước khi tiếp tục.");
      } else if (payment.reservationId === reservationId && payment.purpose === purpose && canOpenPayosCheckout(payment)) {
        window.location.assign(payment.checkoutUrl);
        return;
      } else {
        setNotice("Liên kết thanh toán chưa sẵn sàng. Hãy kiểm tra trạng thái giao dịch hiện có.");
      }
    } catch (cause) {
      if (!alive.current || getAccessToken() !== token) return;
      setError(errorText(cause));
      if (cause.response?.status === 404 || cause.response?.status === 502 || cause.response?.status === 503 ||
          cause?.isAxiosError && !cause.response) {
        setCheckoutUnavailable(true);
        setNotice("");
        void refreshPaymentHistory();
      }
    } finally {
      busy.current = false;
      if (alive.current) setPending("");
    }
  }

  function continueExistingCheckout(payment) {
    if (payment?.reservationId === reservationId && payment?.purpose === purpose && canOpenPayosCheckout(payment)) {
      window.location.assign(payment.checkoutUrl);
    }
  }

  const returnQueryPresent = !!location.search;
  const returnedFromCancel = new URLSearchParams(location.search).get("cancel") === "true";
  const startDepositAfterBooking = location.state?.startDepositAfterBooking === true && !returnQueryPresent;
  const unmatchedReturn = returnQueryPresent && historyLoaded && !historyError && paymentHistory.length === 0;
  const visiblePayment = blockingPayment || currentPayment || (purpose ? paymentHistory.find((payment) => payment.purpose === purpose) : null) ||
    (returnQueryPresent ? paymentHistory[0] : null);
  const hasTrackedAttempt = !!purpose && (attemptsByPurpose[purpose] || []).length > 0;
  const checkoutRecoveryNeeded = (location.state?.checkoutRecoveryNeeded === true || hasTrackedAttempt) && !visiblePayment;
  const eligible = !!purpose && !contractResource.loading && !contractResource.error && historyLoaded && !historyError && !unmatchedReturn && !storageUnavailable && !trackingCorrupt && !checkoutUnavailable && !checkoutRecoveryNeeded && !context.loading && !!customerId && !blockingPayment;
  const contractLoadReason = contractResource.error ? String(contractResource.error).includes("does not match this Reservation") ? "CONTRACT_RESERVATION_MISMATCH" : String(contractResource.error).includes("ownership could not be verified") ? "CONTRACT_CUSTOMER_MISMATCH" : "CONTRACT_LOAD_FAILED" : eligibility.reason;
  const missingPrerequisite = reservation?.status === "CONTRACTED" && !purpose ? contractResource.loading ? "Đang xác minh hợp đồng trước khi mở thanh toán tiền thuê trả trước…" : eligibilityText(contractLoadReason) : reservation?.status === "CHECKIN_READY" && !purpose ? eligibilityText(contractLoadReason) : reservation && !purpose && !["DEPOSIT_PAID", "PAID"].includes(reservation.status) ? eligibilityText(eligibility.reason) : "";

  useEffect(() => {
    if (!startDepositAfterBooking || automaticHandoffConsumed.current || purpose !== "DEPOSIT" ||
        contractResource.loading || contractResource.error || !historyLoaded || historyError || busy.current || polling.current) return;
    automaticHandoffConsumed.current = true;
    navigate(location.pathname, { replace: true, state: null });
    if (blockingPayment) {
      continueExistingCheckout(blockingPayment);
    } else if (eligible && !paymentHistory.some((payment) => payment.purpose === "DEPOSIT" &&
        (payment.status === "SUCCEEDED" || payment.providerSettlementStatus === "VERIFIED"))) {
      void pay({ automatic: true });
    }
  }, [startDepositAfterBooking, purpose, contractResource.loading, contractResource.error, historyLoaded,
    historyError, eligible, blockingPayment, location.pathname, navigate]);
  const appliedPaymentId = paymentHistory.find((payment) =>
    payment.providerSettlementStatus === "VERIFIED" && payment.applicationStatus === "APPLIED")?.id;
  useEffect(() => {
    if (appliedPaymentId && historyLoaded) goToHistory(appliedPaymentId, true);
  }, [historyLoaded, appliedPaymentId]);

  return (
    <CustomerScreen title={purpose === "BALANCE" ? "Thanh toán tiền thuê còn lại" : "Thanh toán tiền thuê trả trước"} description="Thanh toán an toàn tại trang Hosted Checkout chính thức của PayOS.">
      <LoadState resource={context} />
      {reservation && <Card className="mx-auto w-full max-w-3xl border-slate-200 shadow-sm"><CardContent className="p-5 sm:p-7">
        <p className="mt-2 text-sm text-slate-600">Liên kết thanh toán được tạo bởi PayOS. WDP chỉ xác nhận kết quả sau khi Backend nhận và xác minh webhook.</p>
        {pending === "checkout" && <p className="mt-3 text-sm text-slate-600" role="status">Đang chuẩn bị thanh toán PayOS…</p>}
        {returnedFromCancel && <p className="mt-3 text-sm text-slate-600" role="status">Bạn đã quay lại từ trang hủy PayOS. Trạng thái bên dưới được xác nhận từ Backend.</p>}
        <div className="mt-5">{contractResource.loading && <p className="text-sm text-slate-600" role="status">Đang xác minh hợp đồng…</p>}{(contractResource.error || contractResource.data === null && !contractResource.loading) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>{eligibilityText(contractLoadReason)}</p><Button className="mt-3" variant="outline" onClick={contractResource.retry}>Thử tải lại hợp đồng</Button></div>}</div>
        {visiblePayment && <div className="mt-6"><PaymentPanel payment={visiblePayment} reservationId={reservationId} purpose={purpose || visiblePayment.purpose} onRefresh={refreshPayment} onContinue={continueExistingCheckout} onRetry={() => void pay()} retrying={pending === "checkout"} refreshing={pending === ("status:" + visiblePayment.id)} /></div>}
        {!visiblePayment && purpose && !checkoutRecoveryNeeded && <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm sm:p-7"><p className="text-sm leading-6 text-slate-600">{historyLoaded ? "Chưa có liên kết thanh toán cho đơn thuê này. Backend sẽ xác định số tiền và tạo liên kết PayOS khi bạn tiếp tục." : "Đang kiểm tra lịch sử thanh toán…"}</p><Button className="mt-4 w-full sm:w-auto" variant="orange" disabled={!eligible || !!pending} aria-busy={pending === "checkout"} onClick={() => void pay()}>{pending === "checkout" ? "Đang tạo liên kết thanh toán…" : "Tiếp tục thanh toán qua PayOS"}</Button></div>}
        {!purpose && reservation.status === "DEPOSIT_PAID" && <p className="mt-5 rounded-xl bg-sky-50 p-4 text-sm text-sky-900" role="status">Khoản tiền trả trước đã được ghi nhận. Hãy tiếp tục bước hợp đồng theo hướng dẫn trên trang hợp đồng.</p>}
        {!purpose && reservation.status === "PAID" && <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">Khoản thanh toán đã được ghi nhận. Việc nhận kho vẫn là một bước riêng.</p>}
        {missingPrerequisite && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900" role="status">{missingPrerequisite}</p>}
      </CardContent></Card>}
      {historyError && <Message error={"Không thể xác minh lịch sử thanh toán. Chưa nên thử tạo giao dịch khác. " + historyError} />}
      {(checkoutUnavailable || checkoutRecoveryNeeded) && !visiblePayment && <div className="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4"><Message error={error || "Chưa xác định được kết quả tạo mã thanh toán. Hãy giữ nguyên lần thử hiện tại và kiểm tra giao dịch hiện có."} /><Button className="mt-2" variant="outline" disabled={historyRefreshing} onClick={() => void refreshPaymentHistory()}>{historyRefreshing ? "Đang kiểm tra lịch sử…" : "Làm mới lịch sử thanh toán"}</Button></div>}
      {storageUnavailable && <Message error="Không thể lưu an toàn thông tin lần thanh toán trên trình duyệt này. Hãy đăng nhập lại hoặc thử trên trình duyệt khác." />}
      {trackingCorrupt && <Message error="Không xác minh được thông tin giao dịch đã lưu. Không tạo giao dịch mới; vui lòng liên hệ hỗ trợ." />}
      {!customerId && <Message error="Không xác minh được tài khoản. Vui lòng đăng nhập lại." />}
      {returnQueryPresent && historyLoaded && !historyError && !Object.keys(paymentsById).length && <Message error="Chưa tìm thấy giao dịch gắn với lần quay lại này. Thông tin trên URL không xác nhận thanh toán; vui lòng kiểm tra lịch sử hoặc liên hệ hỗ trợ." />}
      <Message error={checkoutUnavailable || checkoutRecoveryNeeded ? "" : error} /><Message success={notice} />
      <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-3">
        {historyNextCursor && <Button variant="outline" disabled={historyLoadingMore} onClick={loadOlderPayments}>{historyLoadingMore ? "Đang tải…" : "Xem giao dịch cũ hơn"}</Button>}
        <Button variant="outline" disabled={!!pending} onClick={refreshReservation}>{pending === "reservation" ? "Đang làm mới…" : "Làm mới thông tin thanh toán"}</Button>
        <Button asChild variant="outline"><RouterLink to="/portal/payments" state={{ reservationId }}>Xem lịch sử thanh toán</RouterLink></Button>
        <Button asChild variant="outline"><RouterLink to={"/portal/reservations/" + reservationId}>Quay lại đơn thuê</RouterLink></Button>
        <Button asChild variant="outline"><RouterLink to="/portal">Về kho của tôi</RouterLink></Button>
      </div>
    </CustomerScreen>
  );
}
