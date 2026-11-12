import { Link } from "react-router-dom";
import { eligiblePayosPurpose } from "@/lib/selfStoragePayos";
import { Button, recordId } from "./RentalBackendUI";

export function SelfPaymentNavigation({ contract, reservation }) {
  if (reservation?.serviceType !== "SELF_STORAGE") return null;
  const purpose = eligiblePayosPurpose(reservation, contract);

  if (purpose) {
    return (
      <Button asChild className="mt-4">
        <Link to={`/portal/payments/${recordId(reservation)}`}>
          {purpose === "BALANCE" ? "Pay remaining rent with PayOS" : "Thanh Toán Qua PayOS"}
        </Link>
      </Button>
    );
  }

  if (reservation.rentalPaymentFlow === "FULL_UPFRONT_V1" && ["PAID", "CHECKIN_READY", "ACTIVE"].includes(reservation.status)) {
    const deadline = reservation.signingDeadline ? new Date(reservation.signingDeadline).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : null;
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-emerald-800">
          {reservation.status === "PAID" ? "Đã thanh toán 100% — Chờ ký hợp đồng tại cơ sở" : reservation.status === "CHECKIN_READY" ? "Hợp đồng đã được xác minh — Sẵn sàng thực hiện thủ tục nhận kho" : "Đã hoàn tất bàn giao kho"}
        </p>
        {reservation.status === "PAID" && deadline && (
          <p className="text-xs text-emerald-700">
            Hạn ký hợp đồng tại cơ sở: <strong>{deadline}</strong>. Nếu quá hạn, hồ sơ cần được Facility xem xét thủ công; hệ thống không tự hủy hoặc tự hoàn tiền.
          </p>
        )}
        {reservation.status === "ACTIVE" && <p className="text-xs text-emerald-700">Trạng thái thuê đã kích hoạt sau bàn giao. Quyền truy cập chỉ khả dụng khi hệ thống cấp credential an toàn.</p>}
      </div>
    );
  }

  if (reservation.status === "PAID") return <p className="mt-4 text-sm text-emerald-800">Đã thanh toán. Reservation đang chờ hoàn tất hợp đồng theo luồng hiện hành.</p>;

  if (reservation.status === "DEPOSIT_PAID") {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-sm text-slate-600">Advance rent is recorded. Continue with the existing contract step.</p>
        <Button asChild variant="outline"><Link to={`/portal/contracts/${recordId(reservation)}`}>Review contract next steps</Link></Button>
      </div>
    );
  }

  return null;
}
