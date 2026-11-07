import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import reservationApi from "@/api/reservationApi";
import paymentApi from "@/api/paymentApi";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatPayosVnd } from "@/lib/selfStoragePayos";
import { SELF_STORAGE, serviceType } from "@/lib/customerReservationService";
import { customerPaymentStatus, selectOwnedSelfStorageReservation } from "@/lib/selfStoragePaymentHistory";
import { BackendScreen, LoadState, Message, recordId, rows, useBackend } from "@/components/customer/RentalBackendUI";

function ReservationHistory({ reservationId, returnContext, requestedPaymentId }) {
  const session = useAuthSession();
  const resource = useBackend(
    () => paymentApi.listPayosPaymentsForReservation(reservationId),
    [reservationId],
  );
  const [page, setPage] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const autoPageCount = useRef(0);

  useEffect(() => {
    setPage(null);
    setError("");
    autoPageCount.current = 0;
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
      const next = await paymentApi.listPayosPaymentsForReservation(reservationId, { cursor: page.nextCursor });
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

  useEffect(() => {
    if (!requestedPaymentId || relevantPayment || !page?.nextCursor || loadingMore || autoPageCount.current >= 10) return;
    autoPageCount.current += 1;
    void loadOlder();
  }, [requestedPaymentId, relevantPayment?.id, page?.nextCursor, loadingMore]);
  const applied = relevantPayment?.providerSettlementStatus === "VERIFIED" && relevantPayment?.applicationStatus === "APPLIED";
  const matchingReturnContext = returnContext?.reservationId === reservationId;
  const hasSuccessContext = matchingReturnContext && returnContext?.verifiedApplied === true && relevantPayment?.providerSettlementStatus === "VERIFIED" && relevantPayment?.applicationStatus === "APPLIED";

  return (
    <>
      {(hasSuccessContext || applied) && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status" aria-live="polite">Thanh toán đã được xác minh và ghi nhận thành công.</div>}
      {matchingReturnContext && !applied && <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" role="status" aria-live="polite">PayOS đã chuyển bạn trở lại. Giao dịch vẫn đang được Backend xác nhận; trang này hiển thị trạng thái mới nhất.</div>}
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
            const purpose = payment.purpose === "DEPOSIT" ? "Tiền thuê trả trước" : "Tiền thuê còn lại";
            const date = new Date(payment.createdAt);
            return <article key={payment.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-semibold text-slate-900">{purpose}</h3><p className="mt-1 text-sm text-slate-500">{Number.isFinite(date.getTime()) ? date.toLocaleString("vi-VN") : "Ngày giao dịch chưa có"}</p></div>
              <p className="text-lg font-bold text-slate-900">{formatPayosVnd(payment.amount)} ₫</p>
              </div>
              <p className={`mt-3 text-sm font-medium ${status.tone}`} role="status">{status.label}</p>
              <Link className="mt-3 inline-flex text-sm font-medium text-brand underline" to={`/portal/payments/${reservationId}`}>Xem trạng thái thanh toán</Link>
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
  const location = useLocation();
  const reservations = useBackend((config) => reservationApi.mineReal(config).then(rows));
  const [selectedId, setSelectedId] = useState("");
  const ownedSelfStorage = useMemo(() => (reservations.data || []).filter((reservation) => serviceType(reservation) === SELF_STORAGE && recordId(reservation)), [reservations.data]);
  const requestedId = location.state?.reservationId;

  useEffect(() => {
    setSelectedId("");
  }, [session.accessToken]);

  useEffect(() => {
    if (reservations.loading || reservations.error) return;
    setSelectedId(selectOwnedSelfStorageReservation(ownedSelfStorage, requestedId));
  }, [reservations.loading, reservations.error, requestedId, ownedSelfStorage]);

  return (
    <BackendScreen title="Lịch sử thanh toán" description="Theo dõi các giao dịch PayOS đã được Backend xác nhận." notice="Chỉ trạng thái do Backend xác minh mới được xem là thanh toán thành công.">
      <LoadState resource={reservations} />
      {!reservations.loading && !reservations.error && ownedSelfStorage.length > 1 && <label className="block max-w-xl text-sm font-medium">
        Chọn đơn thuê Self-Storage
        <select className="customer-select mt-2 w-full" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {ownedSelfStorage.map((reservation, index) => <option key={recordId(reservation)} value={recordId(reservation)}>{reservation.reservationCode || `Đơn thuê ${index + 1}`}</option>)}
        </select>
      </label>}
      {!reservations.loading && !reservations.error && !ownedSelfStorage.length && <p className="text-sm text-slate-600">Tài khoản chưa có đơn thuê Self-Storage.</p>}
      {selectedId && ownedSelfStorage.some((reservation) => recordId(reservation) === selectedId) && <ReservationHistory key={`${session.accessToken}:${selectedId}`} reservationId={selectedId} returnContext={location.state?.returnContext} requestedPaymentId={location.state?.paymentId} />}
      <Card><CardContent><h2 className="text-lg font-semibold">Hoàn tiền và điều chỉnh</h2><p className="mt-2 text-sm text-slate-600">Chưa có dữ liệu hoàn tiền hoặc điều chỉnh trên trang này.</p></CardContent></Card>
    </BackendScreen>
  );
}
