import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import paymentApi, { reconcilePayosPayment } from "@/api/paymentApi";
import { Button } from "@/components/ui/button";
import { CustomerScreen } from "@/components/common/CustomerScreen";
import { getAccessToken } from "@/lib/authSession";
import { isValidObjectId } from "@/lib/selfStoragePayos";
import { Message } from "@/components/customer/RentalBackendUI";

export default function PayosPaymentReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reservationId = params.get("reservationId") || "";
  const paymentId = params.get("paymentId") || "";
  const cancelReturn = params.get("cancel") === "true";
  const serviceType = params.get("serviceType");
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
      await reconcilePayosPayment(reservationId, paymentId, serviceType);
      if (getAccessToken() !== token) return;
    } catch {
      // Provider lookup can be temporarily unavailable after the hosted checkout
      // returns. Keep the callback identity and let Payment History retry; URL
      // parameters alone never establish a payment status.
    } finally {
      if (getAccessToken() === token) {
        const query = new URLSearchParams({ reservationId, paymentId });
        if (cancelReturn) query.set("cancel", "true");
        navigate(`/portal/payments?${query}`, { replace: true });
      }
      setBusy(false);
    }
  }, [cancelReturn, navigate, paymentId, reservationId, serviceType]);

  useEffect(() => { void verify(); }, [verify]);
  return <CustomerScreen title="Xác minh kết quả PayOS" description="Kết quả chỉ được hiển thị sau khi Backend kiểm tra giao dịch với PayOS.">
    {cancelReturn && <p role="status" aria-live="polite">Đang xác minh trạng thái hủy…</p>}
    {!cancelReturn && <p role="status" aria-live="polite">Đang xác minh trạng thái thanh toán…</p>}
    <Message error={error}/>
    {error && <Button variant="outline" disabled={busy} onClick={() => void verify()}>{busy ? "Đang xác minh…" : "Thử xác minh lại"}</Button>}
    <Button className="mt-3" variant="outline" onClick={() => navigate(`/portal/payments?reservationId=${encodeURIComponent(reservationId)}&paymentId=${encodeURIComponent(paymentId)}`, { replace: true })}>Mở lịch sử thanh toán</Button>
  </CustomerScreen>;
}
