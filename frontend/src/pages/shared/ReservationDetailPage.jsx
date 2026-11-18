import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthSession } from "@/lib/authSession";
import {
  Screen, Panel, Details, Timeline, Status, Button, Field, Input, Message, money,
} from "@/components/manager/ManagerUI";
import { AsyncBoundary, ConfirmDialog } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { bomReservationApi, bomReservationWriteApi } from "@/api/bomApi";
import { responseData } from "@/lib/bomMappers";
import { canReviewReservations } from "@/lib/roles";

// Dedicated detail page for a reservation. The list pages link here instead of expanding
// detail/actions inline, matching /facilities/:id and /inventory/:id.
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const customerName = (reservation) => {
  const customer = reservation?.customerId;
  if (customer && typeof customer === "object") return customer.fullName || customer.displayName || customer.email || "Khách hàng";
  return "Khách hàng";
};
const facilityName = (reservation) => {
  const facility = reservation?.facilityId;
  return (facility && typeof facility === "object" ? facility.name : facility) || "—";
};
const unitLabel = (reservation) => {
  const unit = reservation?.storageUnitId;
  return (unit && typeof unit === "object" ? unit.unitCode : unit) || "—";
};
const timelineOf = (reservation) => (Array.isArray(reservation?.statusHistory) ? reservation.statusHistory : [])
  .map((entry) => ({ at: entry.createdAt, status: entry.status, note: entry.reason || "Đổi trạng thái" }))
  .reverse();

export default function ReservationDetailPage({ managed = false, basePath = "/admin/reservations" }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuthSession();
  const canReview = canReviewReservations(user?.role);
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({});
  const resource = useAsyncData(
    ({ signal }) => (managed
      ? bomReservationWriteApi.managedGet(id, { signal })
      : bomReservationApi.get(id, { signal })).then(responseData),
    [id, managed],
  );

  async function apply(action) {
    if (busy) return;
    setBusy(true);
    setFeedback({});
    try {
      // Only Self Storage reservations have an approve/reject transition: the backend
      // approves `serviceType: SELF_STORAGE` and rejects others as not found. Managed
      // reservations move through contract + handover at the facility instead.
      if (action === "approve") {
        await bomReservationWriteApi.approve(id);
      } else if (action === "reject") {
        const note = reason.trim();
        if (!note) throw new Error("Hãy nhập lý do từ chối.");
        await bomReservationWriteApi.reject(id, note);
      }
      setDecision(null);
      setReason("");
      setFeedback({ success: "Đã cập nhật đơn đặt thuê." });
      resource.reload();
    } catch (error) {
      setFeedback({ error: error?.response?.data?.message || error?.message || "Không cập nhật được đơn đặt thuê." });
      if ([404, 409].includes(error?.response?.status)) resource.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={managed ? "Chi tiết đơn lưu trữ hàng hóa" : "Chi tiết đơn đặt thuê"}
      description="Thông tin đơn đặt thuê. Các thao tác thực hiện tại trang này."
      action={<Button variant="outline" onClick={() => nav(basePath)}>Quay lại danh sách đơn</Button>}
    >
      <AsyncBoundary state={resource} render={(reservation) => (reservation ? (
        <>
          <Panel
            title={reservation.reservationCode || "Đơn đặt thuê"}
            subtitle={managed ? "Lưu trữ hàng hóa" : "Thuê kho riêng"}
            action={<Status value={reservation.status} />}
          >
            <Details values={[
              ["Khách hàng", customerName(reservation)],
              ["Cơ sở", facilityName(reservation)],
              ["Kho", unitLabel(reservation)],
              ...(managed ? [
                ["Công suất được cấp", `${reservation.allocatedCapacity ?? 0} m³`],
                ["Công suất đã dùng", `${reservation.usedCapacityM3 ?? 0} m³`],
              ] : []),
              ["Thời gian thuê", `${day(reservation.startDate)} → ${day(reservation.endDate)}`],
              ...(managed ? [
                ["Tiền thuê tạm tính", money(reservation.estimatedRent)],
                ["Tiền đặt cọc", money(reservation.depositAmount)],
              ] : [
                ["Tổng tiền thanh toán", money(reservation.estimatedRent)],
              ]),
              ["Hết hạn giữ chỗ", reservation.expiresAt ? new Date(reservation.expiresAt).toLocaleString("vi-VN") : "—"],
              ["Lý do từ chối", reservation.rejectReason || "—"],
              ...(reservation.actualCheckoutDate || reservation.status === "CHECKED_OUT" ? [
                ["Ngày trả kho", reservation.actualCheckoutDate ? new Date(reservation.actualCheckoutDate).toLocaleString("vi-VN") : "—"],
              ] : []),
              ["Ngày tạo", day(reservation.createdAt)],
            ]} />
            <Message {...feedback} />
            <div className="mt-5 flex flex-wrap gap-2">
              {!managed && canReview && reservation.status === "RESERVED" && (
                <>
                  <Button onClick={() => { setReason(""); setDecision({ kind: "approve", code: reservation.reservationCode }); }}>Duyệt</Button>
                  <Button variant="outline" onClick={() => { setReason(""); setDecision({ kind: "reject", code: reservation.reservationCode }); }}>Từ chối</Button>
                </>
              )}
              {managed && (
                <p className="bom-note">
                  Đơn lưu trữ hàng hóa được duyệt theo luồng hợp đồng và bàn giao tại cơ sở.
                </p>
              )}
              {!managed && !canReview && <p className="text-xs text-slate-500">Vai trò của bạn chỉ được xem, không được duyệt hay từ chối đơn.</p>}
            </div>
          </Panel>

          <Panel title="Lịch sử trạng thái">
            <Timeline entries={timelineOf(reservation)} />
          </Panel>
        </>
      ) : null)} />

      {decision && (
        <ConfirmDialog
          title={decision.kind === "approve" ? `Duyệt ${decision.code}?` : `Từ chối ${decision.code}?`}
          summary={(
            <p className="text-sm text-slate-500">
              {decision.kind === "approve"
                ? "Duyệt sẽ chuyển đơn sang bước lập hợp đồng và tạo hợp đồng nháp."
                : "Từ chối sẽ hủy đơn và lưu lý do bạn nhập."}
            </p>
          )}
          confirmLabel={decision.kind === "approve" ? "Xác nhận duyệt" : "Xác nhận từ chối"}
          onConfirm={() => apply(decision.kind)}
          onClose={() => setDecision(null)}
        >
          {decision.kind === "reject" && (
            <Field label="Lý do từ chối" hint="Bắt buộc, tối đa 500 ký tự.">
              <Input aria-label="Lý do từ chối" required value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          )}
        </ConfirmDialog>
      )}
    </Screen>
  );
}
