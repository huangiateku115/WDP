import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import paymentApi, { reconcilePayosPayment } from "@/api/paymentApi";
import { Button } from "@/components/ui/button";
import { CustomerScreen } from "@/components/common/CustomerScreen";
import { getAccessToken } from "@/lib/authSession";
import { isValidObjectId } from "@/lib/selfStoragePayos";
import { Message } from "@/components/customer/RentalBackendUI";

function paymentReturnState(payment) {
  if (payment?.providerSettlementStatus === "VERIFIED" && payment?.applicationStatus === "APPLIED") {
    return { title: "Đã xác minh thanh toán", detail: "Thanh toán đã được ghi nhận. Bạn có thể tiếp tục xem trạng thái đơn thuê.", tone: "text-emerald-800" };
  }
  if (payment?.applicationStatus === "MANUAL_REVIEW") {
    return { title: "Giao dịch cần nhân viên hỗ trợ", detail: "Backend đã ghi nhận giao dịch cần đối soát. Vui lòng không thanh toán lại.", tone: "text-amber-900" };
  }
  if (payment?.status === "RECONCILIATION_REQUIRED" || payment?.checkoutStatus === "RECONCILIATION_REQUIRED" || payment?.reconciliationRequired) {
    return { title: "Giao dịch đang cần đối soát", detail: "Chưa thể xác nhận thanh toán. Vui lòng không tạo giao dịch mới và thử kiểm tra lại sau.", tone: "text-amber-900" };
  }
  if (payment?.status === "FAILED") return { title: "Thanh toán không thành công", detail: "Backend đã xác minh giao dịch không thành công.", tone: "text-rose-800" };
  if (payment?.status === "CANCELLED" && payment?.cancelVerifiedAt) return { title: "Đã xác minh hủy thanh toán", detail: "Đơn thuê không bị hủy theo trạng thái này.", tone: "text-amber-900" };
  return { title: "Đang chờ xác nhận từ PayOS", detail: "Kết quả chỉ được xác nhận sau khi Backend nhận webhook hợp lệ hoặc hoàn tất đối soát.", tone: "text-sky-900" };
}

export default function PayosPaymentReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reservationId = params.get("reservationId") || "";
  const paymentId = params.get("paymentId") || "";
  const cancelReturn = params.get("cancel") === "true";
  const serviceType = params.get("serviceType");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const verifying = useRef(false);
  const [payment, setPayment] = useState(null);

  const verify = useCallback(async () => {
    if (!isValidObjectId(reservationId) || !isValidObjectId(paymentId) || !["SELF_STORAGE", "MANAGED_INVENTORY"].includes(serviceType)) {
      setError("Thiếu mã đơn thuê hoặc giao dịch hợp lệ. Không thể xác minh kết quả trả về.");
      return;
    }
    if (verifying.current) return;
    verifying.current = true;
    const token = getAccessToken();
    setBusy(true);
    setError("");
    try {
      const payment = !cancelReturn && serviceType === "SELF_STORAGE"
        ? await paymentApi.getPayosPaymentStatus(reservationId, paymentId, serviceType)
        : null;
      if (getAccessToken() !== token) return;
      if (cancelReturn || payment?.purpose !== "FULL_RENT") await reconcilePayosPayment(reservationId, paymentId, serviceType);
      const result = await reconcilePayosPayment(reservationId, paymentId, serviceType);
      if (getAccessToken() === token) setPayment(result);
    } catch {
      if (getAccessToken() !== token) return;
      try {
        const current = await paymentApi.getPayosPaymentStatus(reservationId, paymentId, serviceType);
        if (getAccessToken() === token) setPayment(current);
        setError("Chưa hoàn tất được đối soát. Trạng thái hiện tại lấy từ Backend; bạn có thể thử kiểm tra lại.");
      } catch {
        if (getAccessToken() === token) setError("Không kết nối được với dịch vụ xác minh. Kết quả trên URL không xác nhận thanh toán; vui lòng thử lại sau.");
      }
    } finally {
      verifying.current = false;
      if (getAccessToken() === token) {
        const query = new URLSearchParams({ reservationId, paymentId });
        if (cancelReturn) query.set("cancel", "true");
        navigate(`/portal/payments?${query}`, { replace: true });
      }
      setBusy(false);
      if (getAccessToken() === token) setBusy(false);
    }
  }, [paymentId, reservationId, serviceType]);

  useEffect(() => { void verify(); }, [verify]);
  const state = paymentReturnState(payment);
  const applied = payment?.providerSettlementStatus === "VERIFIED" && payment?.applicationStatus === "APPLIED";

  return <CustomerScreen title="Kết quả thanh toán PayOS" description="Backend xác minh giao dịch; thông tin trên đường dẫn quay về không được dùng làm bằng chứng thanh toán.">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite" role="status">
      <h2 className={`text-lg font-semibold ${state.tone}`}>{state.title}</h2>
      <p className="mt-2 text-sm text-slate-700">{state.detail}</p>
      {cancelReturn && !payment?.cancelVerifiedAt && <p className="mt-2 text-sm text-slate-600">Yêu cầu quay về từ nút hủy chưa được xem là xác nhận giao dịch đã hủy.</p>}
    </section>
    <Message error={error} />
    <div className="mt-4 flex flex-wrap gap-3">
      {!applied && payment?.applicationStatus !== "MANUAL_REVIEW" && payment?.status !== "FAILED" &&
        <Button variant="outline" disabled={busy} onClick={() => void verify()}>{busy ? "Đang xác minh…" : "Thử xác minh lại"}</Button>}
      <Button variant="outline" onClick={() => navigate(`/portal/payments?reservationId=${encodeURIComponent(reservationId)}&paymentId=${encodeURIComponent(paymentId)}${cancelReturn ? "&cancel=true" : ""}`)}>
        Mở lịch sử thanh toán
      </Button>
      {applied && <Button onClick={() => navigate("/portal/reservations")}>Xem đơn thuê</Button>}
    </div>
  </CustomerScreen>;
}
