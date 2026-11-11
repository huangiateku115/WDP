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
          {purpose === "BALANCE" ? "Pay remaining rent with PayOS" : "Pay advance rent with PayOS"}
        </Link>
      </Button>
    );
  }

  if (reservation.status === "PAID") {
    const deadline = reservation.signingDeadline ? new Date(reservation.signingDeadline).toLocaleString("vi-VN") : null;
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
        <p className="text-sm font-semibold text-emerald-800">
          ✅ Đã thanh toán tiền thuê. Đơn đang chờ ký hợp đồng giấy tại cơ sở.
        </p>
        {deadline && (
          <p className="text-xs text-emerald-700">
            ⏰ Hạn chót đến cơ sở xem kho và ký hợp đồng: <strong>{deadline}</strong> (SLA 3 ngày). Quá thời hạn này, hệ thống sẽ tự động hủy đơn và khấu trừ 10% phí giữ kho.
          </p>
        )}
      </div>
    );
  }

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
