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
import { canMockPayReservations, canReviewReservations } from "@/lib/roles";

// Dedicated detail page for a reservation. The list pages link here instead of expanding
// detail/actions inline, matching /facilities/:id and /inventory/:id.
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const customerName = (reservation) => {
  const customer = reservation?.customerId;
  if (customer && typeof customer === "object") return customer.fullName || customer.displayName || customer.email || "Customer";
  return "Customer";
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
  .map((entry) => ({ at: entry.createdAt, status: entry.status, note: entry.reason || "Status change" }))
  .reverse();

export default function ReservationDetailPage({ managed = false, basePath = "/admin/reservations" }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuthSession();
  const canReview = canReviewReservations(user?.role);
  const canMockPay = canMockPayReservations(user?.role);
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
      if (action === "approve") {
        if (managed) await bomReservationWriteApi.managedApprove(id);
        else await bomReservationWriteApi.approve(id);
      } else if (action === "reject") {
        const note = reason.trim();
        if (!note) throw new Error("A rejection reason is required.");
        if (managed) await bomReservationWriteApi.managedReject(id, note);
        else await bomReservationWriteApi.reject(id, note);
      } else if (action === "mock-pay") {
        await bomReservationWriteApi.managedMockPay(id);
      } else if (action === "activate") {
        await bomReservationWriteApi.managedActivate(id);
      }
      setDecision(null);
      setReason("");
      setFeedback({ success: "Action completed." });
      resource.reload();
    } catch (error) {
      setFeedback({ error: error?.response?.data?.message || error?.message || "Unable to update the reservation." });
      if ([404, 409].includes(error?.response?.status)) resource.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={managed ? "Managed reservation detail" : "Reservation detail"}
      description="Reservation record. Actions run from this page, not from the list."
      action={<Button variant="outline" onClick={() => nav(basePath)}>Back to reservations</Button>}
    >
      <AsyncBoundary state={resource} render={(reservation) => (reservation ? (
        <>
          <Panel
            title={reservation.reservationCode || "Reservation"}
            subtitle={managed ? "Managed Inventory" : "Self Storage"}
            action={<Status value={reservation.status} />}
          >
            <Details values={[
              ["Customer", customerName(reservation)],
              ["Facility", facilityName(reservation)],
              ["Storage unit", unitLabel(reservation)],
              ...(managed ? [
                ["Allocated capacity", `${reservation.allocatedCapacity ?? 0} m³`],
                ["Used capacity", `${reservation.usedCapacityM3 ?? 0} m³`],
              ] : []),
              ["Rental window", `${day(reservation.startDate)} → ${day(reservation.endDate)}`],
              ...(managed ? [
                ["Estimated rent", money(reservation.estimatedRent)],
                ["Deposit", money(reservation.depositAmount)],
              ] : [
                ["Tổng tiền thanh toán", money(reservation.estimatedRent)],
              ]),
              ["Hold expires", reservation.expiresAt ? new Date(reservation.expiresAt).toLocaleString("en-GB") : "—"],
              ["Rejection reason", reservation.rejectReason || "—"],
              ...(reservation.actualCheckoutDate || reservation.status === "CHECKED_OUT" ? [
                ["Ngày trả kho", reservation.actualCheckoutDate ? new Date(reservation.actualCheckoutDate).toLocaleString("vi-VN") : "—"],
              ] : []),
              ["Created", day(reservation.createdAt)],
            ]} />
            <Message {...feedback} />
            <div className="mt-5 flex flex-wrap gap-2">
              {canReview && reservation.status === "RESERVED" && (
                <>
                  <Button onClick={() => { setReason(""); setDecision({ kind: "approve", code: reservation.reservationCode }); }}>Approve</Button>
                  <Button variant="outline" onClick={() => { setReason(""); setDecision({ kind: "reject", code: reservation.reservationCode }); }}>Reject</Button>
                </>
              )}
              {managed && canMockPay && reservation.status === "CONTRACTED" && (
                <Button variant="outline" onClick={() => apply("mock-pay")} disabled={busy}>Simulate payment</Button>
              )}
              {managed && canReview && reservation.status === "PAID" && (
                <Button onClick={() => apply("activate")} disabled={busy}>Activate reservation</Button>
              )}
              {!canReview && <p className="text-xs text-slate-500">Your role can read this record but cannot approve, reject or activate it.</p>}
            </div>
          </Panel>

          <Panel title="Status history">
            <Timeline entries={timelineOf(reservation)} />
          </Panel>
        </>
      ) : null)} />

      {decision && (
        <ConfirmDialog
          title={decision.kind === "approve" ? `Approve ${decision.code}?` : `Reject ${decision.code}?`}
          summary={(
            <p className="text-sm text-slate-500">
              {decision.kind === "approve"
                ? "Approving moves the reservation to the contracted stage and creates the draft contract."
                : "Rejecting cancels the reservation and stores the reason you enter."}
            </p>
          )}
          confirmLabel={decision.kind === "approve" ? "Confirm approval" : "Confirm rejection"}
          onConfirm={() => apply(decision.kind)}
          onClose={() => setDecision(null)}
        >
          {decision.kind === "reject" && (
            <Field label="Rejection reason" hint="Required, up to 500 characters.">
              <Input aria-label="Rejection reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          )}
        </ConfirmDialog>
      )}
    </Screen>
  );
}
