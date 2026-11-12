import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import reservationApi from "@/api/reservationApi";
import paymentApi from "@/api/paymentApi";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatPayosVnd } from "@/lib/selfStoragePayos";
import { MANAGED_INVENTORY, SELF_STORAGE, serviceType } from "@/lib/customerReservationService";
import { customerPaymentStatus, selectOwnedSelfStorageReservation } from "@/lib/selfStoragePaymentHistory";
import { BackendScreen, LoadState, Message, recordId, rows, useBackend } from "@/components/customer/RentalBackendUI";

function ReservationHistory({ reservation, reservationId, requestedPaymentId, cancelReturn }) {
  const session = useAuthSession();
  const service = serviceType(reservation);
  const resource = useBackend(
    () => paymentApi.listPayosPaymentsForReservation(reservationId, { serviceType: service }),
    [reservationId, service],
  );
  const [page, setPage] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState("");
  const autoPageCount = useRef(0);
  const autoReconcileKey = useRef("");

  useEffect(() => {
    setPage(null);
    setError("");
    autoPageCount.current = 0;
    autoReconcileKey.current = "";
    setReconcileError("");
  }, [reservationId, session.accessToken]);

  useEffect(() => {
    if (!resource.data) return;
    setPage({ ...resource.data, items: [...resource.data.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) });
  }, [resource.data]);

  async function loadOlder() {
    if (!page?.nextCursor || loadingMore) return;
    const token = getAccessToken();
    setLoadingMore(true);
    setError("");
    try {
      const next = await paymentApi.listPayosPaymentsForReservation(reservationId, { cursor: page.nextCursor, serviceType: service });
      if (getAccessToken() !== token) return;
      const ids = new Set(page.items.map((payment) => payment.id));
      setPage({ items: [...page.items, ...next.items.filter((payment) => !ids.has(payment.id))].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), nextCursor: next.nextCursor });
    } catch {
      if (getAccessToken() === token) setError("Không tải được giao dịch cũ hơn. Vui lòng thử lại.");
    } finally {
      if (getAccessToken() === token) setLoadingMore(false);
    }
  }

  const payments = page?.items || [];
  const relevantPayment = requestedPaymentId ? payments.find((payment) => payment.id === requestedPaymentId) : payments[0];

  const selfStorageUpfront = service === "SELF_STORAGE" && reservation.rentalPaymentFlow === "FULL_UPFRONT_V1";

  const cancellationInFlight = useRef(false);

  async function verifyCancellation() {
    if (!requestedPaymentId || cancellationInFlight.current) return;
    cancellationInFlight.current = true;
    const token = getAccessToken();
    setReconcileBusy(true);
    setReconcileError("");
    try {
      await paymentApi.reconcilePayosPayment(reservationId, requestedPaymentId, service);
      if (getAccessToken() === token) resource.retry();
    } catch {
      if (getAccessToken() === token) setReconcileError("Chưa xác minh được trạng thái hủy. Bạn có thể thử kiểm tra lại sau.");
    } finally {
      cancellationInFlight.current = false;
      if (getAccessToken() === token) setReconcileBusy(false);
    }
  }

  useEffect(() => {
    if (selfStorageUpfront || !cancelReturn || !requestedPaymentId || !relevantPayment) return;
    if (relevantPayment.status === "SUCCEEDED" || relevantPayment.providerSettlementStatus === "VERIFIED" || relevantPayment.applicationStatus === "APPLIED") return;
    if (relevantPayment.status === "CANCELLED" && relevantPayment.cancelVerifiedAt) return;
    const key = `${session.accessToken}:${reservationId}:${requestedPaymentId}`;
    if (autoReconcileKey.current === key) return;
    autoReconcileKey.current = key;
    void verifyCancellation();
  }, [cancelReturn, relevantPayment?.id, relevantPayment?.status, relevantPayment?.cancelVerifiedAt,
    relevantPayment?.providerSettlementStatus, relevantPayment?.applicationStatus, requestedPaymentId,
    reservationId, session.accessToken, selfStorageUpfront]);

  useEffect(() => {
    if (!requestedPaymentId || relevantPayment || !page?.nextCursor || loadingMore || autoPageCount.current >= 10) return;
    autoPageCount.current += 1;
    void loadOlder();
  }, [requestedPaymentId, relevantPayment?.id, page?.nextCursor, loadingMore]);
  const applied = relevantPayment?.providerSettlementStatus === "VERIFIED" && relevantPayment?.applicationStatus === "APPLIED";
  const confirmedCancel = cancelReturn && relevantPayment?.status === "CANCELLED" && !!relevantPayment?.cancelVerifiedAt;
  const awaitingCancelCheck = cancelReturn && !confirmedCancel && !applied;
  const retryStageValid = selfStorageUpfront && relevantPayment?.purpose !== "FULL_RENT" ? false : relevantPayment?.purpose === "FULL_RENT"
    ? reservation.rentalPaymentFlow === "FULL_UPFRONT_V1" && (service === MANAGED_INVENTORY
      ? reservation.status === "RESERVED" && Date.parse(reservation.expiresAt || "") > Date.now()
      : reservation.status === "CONTRACTED" && Date.parse(reservation.expiresAt || "") > Date.now())
    : relevantPayment?.purpose === "DEPOSIT"
    ? reservation.status === "CONTRACTED" && Date.parse(reservation.expiresAt || "") > Date.now() || service === MANAGED_INVENTORY && reservation.status === "RESERVED" && Date.parse(reservation.expiresAt || "") > Date.now()
    : service === MANAGED_INVENTORY ? reservation.status === "DEPOSIT_PAID" : reservation.status === "CHECKIN_READY";

  return (
    <>
      {applied && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status" aria-live="polite">{reservation.rentalPaymentFlow === "FULL_UPFRONT_V1" && reservation.status === "PAID" ? "Đã thanh toán — Chờ ký hợp đồng và bàn giao. Quyền sử dụng kho chưa được kích hoạt." : "Thanh toán đã được xác minh và ghi nhận thành công."}</div>}
      {applied && reservation.serviceType === "SELF_STORAGE" && reservation.rentalPaymentFlow === "FULL_UPFRONT_V1" &&
        <Button asChild variant="outline"><Link to={`/portal/contracts/${reservationId}`}>Xem tiến độ hợp đồng</Link></Button>}
      {confirmedCancel && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status" aria-live="polite">Đã hủy thanh toán. Reservation không bị hủy.</div>}
      {awaitingCancelCheck && <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" role="status" aria-live="polite">Đang xác minh trạng thái hủy với Backend. Chưa xác nhận hủy.</div>}
      {cancelReturn && awaitingCancelCheck && <div className="mt-3"><Message error={reconcileError}/><Button variant="outline" disabled={reconcileBusy} onClick={() => void verifyCancellation()}>{reconcileBusy ? "Đang kiểm tra…" : "Kiểm tra trạng thái hủy"}</Button></div>}
      <Card><CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Giao dịch gần đây</h2>
          <Button variant="outline" disabled={resource.loading} onClick={resource.retry}>Làm mới lịch sử</Button>
        </div>
        <LoadState resource={resource} />
        {error && <Message error={error} />}
        {payments.length > 0 && <div className="mt-4 space-y-3">
          {payments.map((payment) => {
            const status = customerPaymentStatus(payment);
            const purpose = payment.purpose === "FULL_RENT" ? "Thanh toán 100% tiền thuê" : payment.purpose === "DEPOSIT" ? "Tiền thuê trả trước" : "Tiền thuê còn lại";
            const date = new Date(payment.createdAt);
            return <article key={payment.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold text-slate-900">{purpose}</h3><p className="mt-1 text-sm text-slate-500">{Number.isFinite(date.getTime()) ? date.toLocaleString("vi-VN") : "Ngày giao dịch chưa có"}</p></div>
              <p className="text-lg font-bold text-slate-900">{formatPayosVnd(payment.amount)} ₫</p>
              </div>
              <p className={`mt-3 text-sm font-medium ${status.tone}`} role="status">{status.label}</p>
              {(!selfStorageUpfront || payment.id === relevantPayment?.id) && payment.retryAllowed && retryStageValid && <Link className="mt-3 inline-flex text-sm font-medium text-brand underline" to={`/portal/payments/${reservationId}`}>Thử thanh toán lại</Link>}
            </article>;
          })}
        </div>}
        {!resource.loading && !resource.error && !payments.length && <p className="mt-4 text-sm text-slate-600">Chưa có giao dịch PayOS cho đơn thuê này.</p>}
        {requestedPaymentId && !relevantPayment && !page?.nextCursor && <p className="mt-4 text-sm text-amber-800" role="status">Chưa tìm thấy giao dịch được liên kết với lần quay lại này. Trạng thái URL không xác nhận thanh toán.</p>}
        {page?.nextCursor && <Button className="mt-5" variant="outline" disabled={loadingMore} onClick={loadOlder}>{loadingMore ? "Đang tải…" : "Xem giao dịch cũ hơn"}</Button>}
      </CardContent></Card>
    </>
  );
}

export default function PaymentHistoryPage() {
  const session = useAuthSession();
  const [params, setParams] = useSearchParams();
  const reservations = useBackend((config) => reservationApi.mineReal(config).then(rows));
  const [selectedId, setSelectedId] = useState("");
  const ownedSelfStorage = useMemo(() => (reservations.data || []).filter((reservation) => [SELF_STORAGE, MANAGED_INVENTORY].includes(serviceType(reservation)) && recordId(reservation)), [reservations.data]);
  const requestedId = params.get("reservationId") || "";
  const requestedPaymentId = params.get("paymentId") || "";
  const cancelReturn = params.get("cancel") === "true";
  const selectedReservation = ownedSelfStorage.find((reservation) => recordId(reservation) === selectedId);

  useEffect(() => {
    setSelectedId("");
  }, [session.accessToken]);

  useEffect(() => {
    if (reservations.loading || reservations.error) return;
    const selected = selectOwnedSelfStorageReservation(ownedSelfStorage, requestedId);
    setSelectedId(selected);
    if (selected && selected !== requestedId) setParams(current => { const next = new URLSearchParams(current); next.set("reservationId", selected); return next; }, { replace: true });
  }, [reservations.loading, reservations.error, requestedId, ownedSelfStorage, setParams]);

  return (
    <BackendScreen title="Lịch sử thanh toán" description="Theo dõi các giao dịch PayOS đã được Backend xác nhận." notice="Chỉ trạng thái do Backend xác minh mới được xem là thanh toán thành công.">
      <LoadState resource={reservations} />
      {!reservations.loading && !reservations.error && !ownedSelfStorage.length && <p className="text-sm text-slate-600">Tài khoản chưa có giao dịch thuê được hỗ trợ.</p>}
      {ownedSelfStorage.length > 1 && <label className="mt-4 block max-w-xl text-sm font-medium">Đơn thuê
        <select className="customer-select mt-2 w-full" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setParams(current => { const next = new URLSearchParams(current); next.set("reservationId", event.target.value); next.delete("paymentId"); next.delete("cancel"); return next; }); }}>
          {ownedSelfStorage.map((reservation, index) => <option key={recordId(reservation)} value={recordId(reservation)}>{reservation.reservationCode || `Đơn thuê ${index + 1}`}</option>)}
        </select>
      </label>}
      {selectedReservation && <ReservationHistory key={`${session.accessToken}:${selectedId}`} reservation={selectedReservation} reservationId={selectedId} requestedPaymentId={requestedPaymentId} cancelReturn={cancelReturn} />}
      <Card><CardContent><h2 className="text-lg font-semibold">Hoàn tiền và điều chỉnh</h2><p className="mt-2 text-sm text-slate-600">Chưa có dữ liệu hoàn tiền hoặc điều chỉnh trên trang này.</p></CardContent></Card>
    </BackendScreen>
  );
}
