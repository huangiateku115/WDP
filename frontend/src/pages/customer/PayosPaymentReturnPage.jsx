import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import paymentApi, { reconcilePayosPayment } from "@/api/paymentApi";
import { Button } from "@/components/ui/button";
import { CustomerScreen } from "@/components/common/CustomerScreen";
import { getAccessToken } from "@/lib/authSession";
import { isValidObjectId, paymentStatusView } from "@/lib/selfStoragePayos";
import { Message } from "@/components/customer/RentalBackendUI";

export default function PayosPaymentReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reservationId = params.get("reservationId") || "";
  const paymentId = params.get("paymentId") || "";
  const cancelReturn = params.get("cancel") === "true";
  const serviceType = params.get("serviceType");
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async () => {
    if (!isValidObjectId(reservationId) || !isValidObjectId(paymentId) || !["SELF_STORAGE", "MANAGED_INVENTORY"].includes(serviceType)) {
      setError("Thiếu mã đơn thuê hoặc giao dịch hợp lệ. Không thể xác minh kết quả trả về.");
      return;
    }
    const token = getAccessToken();
    setBusy(true);
    setError("");
    try {
      const result = await reconcilePayosPayment(reservationId, paymentId, serviceType);
      if (getAccessToken() !== token) return;
      setPayment(result);
      const query = new URLSearchParams({ reservationId, paymentId });
      if (cancelReturn) query.set("cancel", "true");
      navigate(`/portal/payments?${query}`, { replace: true });
    } catch (cause) {
      if (getAccessToken() === token) setError(cause?.response?.status === 401
        ? "Phiên đăng nhập đã hết hạn. Đăng nhập lại để xác minh giao dịch này."
        : "Chưa xác minh được trạng thái giao dịch. Hãy thử lại; thông tin trên URL không xác nhận thanh toán.");
    } finally { setBusy(false); }
  }, [navigate, paymentId, reservationId, serviceType]);

  useEffect(() => { void verify(); }, [verify]);
  const status = payment ? paymentStatusView(payment) : null;
  return <CustomerScreen title="Xác minh kết quả PayOS" description="Kết quả chỉ được hiển thị sau khi Backend kiểm tra giao dịch với PayOS.">
    {cancelReturn && !payment && <p role="status" aria-live="polite">Đang xác minh trạng thái hủy…</p>}
    {!cancelReturn && !payment && <p role="status" aria-live="polite">Đang xác minh trạng thái thanh toán…</p>}
    {payment && <p role="status" aria-live="polite">{payment.status === "CANCELLED" ? "Đã hủy thanh toán" : status?.label}</p>}
    <Message error={error}/>
    {error && <Button variant="outline" disabled={busy} onClick={() => void verify()}>{busy ? "Đang xác minh…" : "Thử xác minh lại"}</Button>}
    <Button className="mt-3" variant="outline" onClick={() => navigate(`/portal/payments?reservationId=${encodeURIComponent(reservationId)}&paymentId=${encodeURIComponent(paymentId)}`, { replace: true })}>Mở lịch sử thanh toán</Button>
  </CustomerScreen>;
}
