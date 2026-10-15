import { useState } from "react";
import { useAuthSession } from "@/lib/authSession";
import {
  Screen, Panel, Table, Status, Timeline, Field, Select, Input, Button, Details, money,
} from "@/components/manager/ManagerUI";
import { AsyncBoundary, LIVE_NOTICE, ConfirmDialog } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilityReservations } from "@/lib/bomApiData";
import { bomReservationApi, bomReservationWriteApi } from "@/api/bomApi";
import { responseData } from "@/lib/bomMappers";
import { countBy } from "@/lib/bomMetrics";

// Reservation oversight shared by Admin and BOM.
// Backend contract:
//   GET   /reservations/facility/:facilityId   FACILITY_MANAGER, ADMIN, BOM
//   GET   /reservations/:id                    CUSTOMER, FACILITY_MANAGER, ADMIN, BOM
//   PATCH /reservations/:id/approve|reject     FACILITY_MANAGER, ADMIN   (BOM is read-only)
//   GET   /reservations/managed/:id            CUSTOMER, FACILITY_MANAGER, ADMIN, BOM
//   PATCH /reservations/managed/:id/approve|reject|activate  FACILITY_MANAGER, ADMIN
//   POST  /reservations/managed/:id/mock-pay   CUSTOMER, ADMIN, BOM
// The facility endpoint returns every SELF_STORAGE reservation without paging or filters, so
// the console narrows the rows client-side. There is no Managed reservation collection, which
// is why Managed records are opened by id.
const RESERVATION_STATUSES = ["RESERVED", "CONTRACTED", "PAID", "ACTIVE", "OVERDUE", "CHECKED_OUT", "CLOSED", "CANCELLED"];
const day = (value) => (value ? String(value).slice(0, 10) : "—");
const customerOf = (reservation) => {
  const customer = reservation?.customerId;
  if (customer && typeof customer === "object") return customer.fullName || customer.displayName || customer.email || "Customer";
  return "Customer";
};
const unitOf = (reservation) => {
  const unit = reservation?.storageUnitId;
  if (unit && typeof unit === "object") return unit.unitCode || "—";
  return "—";
};
const timelineOf = (reservation) => (Array.isArray(reservation?.statusHistory) ? reservation.statusHistory : [])
  .map((entry) => ({ at: entry.createdAt, status: entry.status, note: entry.reason || "Status change" }))
  .reverse();

export default function ReservationsOversightPage() {
  const { user } = useAuthSession();
  const role = user?.role;
  const canReview = role === "ADMIN";
  const canMockPay = role === "ADMIN" || role === "BOM";

  const directory = useAsyncData(loadFacilities, []);
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState("");
  const [managedId, setManagedId] = useState("");
  const [managedDraft, setManagedDraft] = useState("");
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");

  const list = useAsyncData(
    ({ signal }) => (facilityId ? loadFacilityReservations(facilityId, { signal }) : Promise.resolve(null)),
    [facilityId],
  );
  const detail = useAsyncData(
    ({ signal }) => (detailId ? bomReservationApi.get(detailId, { signal }).then(responseData) : Promise.resolve(null)),
    [detailId],
  );
  const managed = useAsyncData(
    ({ signal }) => (managedId ? bomReservationWriteApi.managedGet(managedId, { signal }).then(responseData) : Promise.resolve(null)),
    [managedId],
  );

  const rows = (list.data || []).filter((row) => {
    if (status && row.status !== status) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return row.code.toLowerCase().includes(needle) || row.customerName.toLowerCase().includes(needle);
  });

  function selectFacility(id) {
    setFacilityId(id);
    setStatus("");
    setSearch("");
    setDetailId("");
  }

  function refresh() {
    list.reload();
    if (detailId) detail.reload();
    if (managedId) managed.reload();
  }

  async function runDecision() {
    const { kind, id, managed: isManaged } = decision;
    if (kind === "approve") {
      if (isManaged) await bomReservationWriteApi.managedApprove(id);
      else await bomReservationWriteApi.approve(id);
    } else {
      const note = reason.trim();
      if (!note) throw new Error("A rejection reason is required.");
      if (isManaged) await bomReservationWriteApi.managedReject(id, note);
      else await bomReservationWriteApi.reject(id, note);
    }
    refresh();
  }

  return (
    <Screen
      title="Reservation oversight"
      description="Review SELF_STORAGE reservations per facility and act on the Managed reservation lifecycle. Approving a reservation creates the draft contract on the backend."
      notice={LIVE_NOTICE}
      action={<Button variant="outline" disabled={list.loading} onClick={refresh}>Refresh</Button>}
    >
      <AsyncBoundary state={directory} render={(facilities) => (
        <>
          <Kpis items={[
            ["Reservations loaded", list.data ? list.data.length : "—", "SELF_STORAGE reservations of the selected facility"],
            ["Awaiting review", countBy(list.data || [], "status", "RESERVED"), "Status RESERVED"],
            ["Contracted", countBy(list.data || [], "status", "CONTRACTED"), "Approved, contract drafted"],
            ["Review rights", canReview ? "Approve / reject" : "Read only", canReview ? "ADMIN may change the review status" : `${role || "This role"} cannot approve or reject`],
          ]} />

          <Panel
            title="Review scope"
            subtitle="The facility endpoint returns reservations without paging, so the status and search filters apply to the rows already loaded."
          >
            <div className="manager-filters">
              <Field label="Facility">
                <Select
                  label="Reservation facility"
                  value={facilityId}
                  onChange={selectFacility}
                  options={[["", "Select a facility"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                />
              </Field>
              <Field label="Status">
                <Select
                  label="Reservation status filter"
                  value={status}
                  onChange={setStatus}
                  disabled={!facilityId}
                  options={[["", "All statuses"], ...RESERVATION_STATUSES.map((s) => [s, s.replaceAll("_", " ")])]}
                />
              </Field>
              <Field label="Search" hint="Reservation code or customer name.">
                <Input
                  aria-label="Search reservations"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!facilityId}
                />
              </Field>
            </div>
            {!canReview && (
              <p className="bom-warning mt-5">
                {role} can read every reservation of a facility, but the backend only lets FACILITY_MANAGER and ADMIN approve or reject
                one. This console stays read-only for your role.
              </p>
            )}
          </Panel>

          {!facilityId && (
            <Panel title="Select a facility">
              <p className="text-sm text-slate-500">Reservations are listed facility by facility because the backend has no global reservation collection.</p>
            </Panel>
          )}

          {facilityId && (
            <AsyncBoundary state={list} render={() => (
              <Panel title="Reservations" subtitle={`${rows.length} of ${(list.data || []).length} reservation(s) shown`}>
                <Table
                  label="Facility reservations"
                  rows={rows}
                  columns={[
                    { key: "code", label: "Reservation" },
                    { key: "customer", label: "Customer", render: (r) => r.customerName },
                    { key: "unit", label: "Unit", render: (r) => r.unitCode || r.unitSize || "—" },
                    { key: "window", label: "Rental window", render: (r) => `${day(r.startDate)} → ${day(r.endDate)}` },
                    { key: "rent", label: "Rent / deposit", render: (r) => `${money(r.estimatedRent)} · ${money(r.depositAmount)}` },
                    { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                    {
                      key: "actions",
                      label: "Actions",
                      render: (r) => (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => setDetailId(r.id)}>Open</Button>
                          {canReview && r.status === "RESERVED" && (
                            <>
                              <Button size="sm" onClick={() => { setReason(""); setDecision({ kind: "approve", id: r.id, code: r.code, managed: false }); }}>Approve</Button>
                              <Button size="sm" variant="outline" onClick={() => { setReason(""); setDecision({ kind: "reject", id: r.id, code: r.code, managed: false }); }}>Reject</Button>
                            </>
                          )}
                        </div>
                      ),
                    },
                  ]}
                  empty="No reservation matches the current filters."
                />
              </Panel>
            )} />
          )}

          {detailId && (
            <AsyncBoundary state={detail} render={(reservation) => (reservation ? (
              <Panel
                title="Reservation detail"
                subtitle={reservation.reservationCode || "Reservation"}
                action={(
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setDetailId("")}>Close</Button>
                    {canReview && reservation.status === "RESERVED" && (
                      <>
                        <Button onClick={() => { setReason(""); setDecision({ kind: "approve", id: detailId, code: reservation.reservationCode, managed: false }); }}>Approve</Button>
                        <Button variant="outline" onClick={() => { setReason(""); setDecision({ kind: "reject", id: detailId, code: reservation.reservationCode, managed: false }); }}>Reject</Button>
                      </>
                    )}
                  </div>
                )}
              >
                <Details values={[
                  ["Customer", customerOf(reservation)],
                  ["Facility", typeof reservation.facilityId === "object" ? reservation.facilityId?.name : reservation.facilityId],
                  ["Storage unit", unitOf(reservation)],
                  ["Rental window", `${day(reservation.startDate)} → ${day(reservation.endDate)}`],
                  ["Estimated rent", money(reservation.estimatedRent)],
                  ["Deposit", money(reservation.depositAmount)],
                  ["Status", reservation.status],
                  ["Hold expires", reservation.expiresAt ? new Date(reservation.expiresAt).toLocaleString("en-GB") : "—"],
                  ["Rejection reason", reservation.rejectReason || "—"],
                  ["Created", day(reservation.createdAt)],
                ]} />
                <div className="mt-5">
                  <Timeline entries={timelineOf(reservation)} />
                </div>
                <p className="bom-warning mt-5">
                  Approving moves the reservation to CONTRACTED and creates the draft contract. The contract id is returned by the
                  approve response and can be opened from the contract lookup page.
                </p>
              </Panel>
            ) : null)} />
          )}

          <Panel
            title="Managed reservation by id"
            subtitle="The backend exposes no Managed reservation collection, so a Managed record is opened from its id (for example after a customer quote)."
          >
            <form
              className="bom-form"
              onSubmit={(event) => { event.preventDefault(); setManagedId(managedDraft.trim()); }}
            >
              <div className="manager-filters">
                <Field label="Managed reservation id" hint="24 hexadecimal characters">
                  <Input
                    aria-label="Managed reservation id"
                    value={managedDraft}
                    onChange={(e) => setManagedDraft(e.target.value)}
                    placeholder="68f1c0a2b4e9d30012ab34cd"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={!/^[a-f\d]{24}$/i.test(managedDraft.trim())}>Open managed reservation</Button>
                {managedId && <Button type="button" variant="outline" onClick={() => { setManagedId(""); setManagedDraft(""); }}>Close</Button>}
              </div>
            </form>

            {managedId && (
              <div className="mt-5">
                <AsyncBoundary state={managed} render={(reservation) => (reservation ? (
                  <>
                    <Details values={[
                      ["Reservation code", reservation.reservationCode || "—"],
                      ["Status", reservation.status],
                      ["Facility", typeof reservation.facilityId === "object" ? reservation.facilityId?.name : reservation.facilityId],
                      ["Allocated capacity", `${reservation.allocatedCapacity ?? 0} m³`],
                      ["Used capacity", `${reservation.usedCapacityM3 ?? 0} m³`],
                      ["Rental window", `${day(reservation.startDate)} → ${day(reservation.endDate)}`],
                      ["Estimated rent", money(reservation.estimatedRent)],
                      ["Deposit", money(reservation.depositAmount)],
                      ["Hold expires", reservation.expiresAt ? new Date(reservation.expiresAt).toLocaleString("en-GB") : "—"],
                      ["Simulated payment", reservation.paymentSimulation?.paidAt ? new Date(reservation.paymentSimulation.paidAt).toLocaleString("en-GB") : "—"],
                    ]} />
                    <div className="mt-5 flex flex-wrap gap-2">
                      {canReview && reservation.status === "RESERVED" && (
                        <>
                          <Button onClick={() => { setReason(""); setDecision({ kind: "approve", id: managedId, code: reservation.reservationCode, managed: true }); }}>Approve quota</Button>
                          <Button variant="outline" onClick={() => { setReason(""); setDecision({ kind: "reject", id: managedId, code: reservation.reservationCode, managed: true }); }}>Reject quota</Button>
                        </>
                      )}
                      {canMockPay && reservation.status === "CONTRACTED" && (
                        <Button
                          variant="outline"
                          onClick={async () => { await bomReservationWriteApi.managedMockPay(managedId); refresh(); }}
                        >
                          Simulate payment
                        </Button>
                      )}
                      {canReview && reservation.status === "PAID" && (
                        <Button onClick={async () => { await bomReservationWriteApi.managedActivate(managedId); refresh(); }}>Activate reservation</Button>
                      )}
                      {!canReview && <p className="text-xs text-slate-500">Your role can read this record but cannot approve, reject or activate it.</p>}
                    </div>
                    <div className="mt-5">
                      <Timeline entries={timelineOf(reservation)} />
                    </div>
                  </>
                ) : null)} />
              </div>
            )}
          </Panel>
        </>
      )} />

      {decision && (
        <ConfirmDialog
          title={decision.kind === "approve" ? `Approve ${decision.code}?` : `Reject ${decision.code}?`}
          summary={(
            <p className="text-sm text-slate-500">
              {decision.kind === "approve"
                ? "Approving moves the reservation to CONTRACTED and creates the draft contract on the backend."
                : "Rejecting cancels the reservation and stores the reason you enter."}
            </p>
          )}
          confirmLabel={decision.kind === "approve" ? "Confirm approval" : "Confirm rejection"}
          onConfirm={runDecision}
          onClose={() => setDecision(null)}
        >
          {decision.kind === "reject" && (
            <Field label="Rejection reason" hint="Required, up to 500 characters.">
              <Input aria-label="Rejection reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </ConfirmDialog>
      )}
    </Screen>
  );
}
