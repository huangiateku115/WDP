import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuthSession } from "@/lib/authSession";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Select, Input, Button, money,
} from "@/components/manager/ManagerUI";
import { AsyncBoundary, LIVE_NOTICE } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilityReservations } from "@/lib/bomApiData";
import { countBy } from "@/lib/bomMetrics";
import { canMockPayReservations, canReviewReservations } from "@/lib/roles";

// Reservation oversight shared by Admin and BOM.
// Backend contract:
//   GET   /reservations/facility/:facilityId   FACILITY_MANAGER, ADMIN, BOM
//   GET   /reservations/:id                    CUSTOMER, FACILITY_MANAGER, ADMIN, BOM
//   PATCH /reservations/:id/approve|reject     FACILITY_MANAGER, ADMIN   (BOM is read-only)
//   GET   /reservations/managed/:id          CUSTOMER, FACILITY_MANAGER, ADMIN, BOM
//   PATCH /reservations/managed/:id/approve|reject|activate  FACILITY_MANAGER, ADMIN
//   POST  /reservations/managed/:id/mock-pay   CUSTOMER, ADMIN, BOM
// The collection endpoint returns SELF_STORAGE reservations only. The backend has no Managed
// reservation collection, so this page never fans out per-record detail requests; Managed rows
// are listed here only after the backend exposes a list endpoint.
const RESERVATION_STATUSES = ["RESERVED", "DEPOSIT_PAID", "CHECKIN_READY", "CONTRACTED", "PAID", "ACTIVE", "OVERDUE", "CHECKED_OUT", "CLOSED", "CANCELLED"];
const day = (value) => (value ? String(value).slice(0, 10) : "—");

export default function ReservationsOversightPage() {
  const { user } = useAuthSession();
  const role = user?.role;
  const canReview = canReviewReservations(role);
  const canMockPay = canMockPayReservations(role);

  const directory = useAsyncData(loadFacilities, []);
  const { pathname } = useLocation();
  const workspace = pathname.startsWith("/bom") ? "/bom" : "/admin";
  const [facilityId, setFacilityId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  // The facility collection is the only reservation list the backend exposes. One request
  // per selected facility; no second parallel request and no per-reservation detail fan-out.
  const list = useAsyncData(async ({ signal }) => {
    if (!facilityId) return null;
    return { self: await loadFacilityReservations(facilityId, { signal }) };
  }, [facilityId]);

  const rows = (list.data?.self || []).filter((row) => {
    if (status && row.status !== status) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return row.code.toLowerCase().includes(needle) || row.customerName.toLowerCase().includes(needle);
  });

  function selectFacility(id) {
    setFacilityId(id);
    setStatus("");
    setSearch("");
  }

  function refresh() {
    list.reload();
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
            ["Reservations loaded", list.data ? list.data.self.length : "—", "SELF_STORAGE reservations of the selected facility"],
            ["Awaiting review", countBy(list.data?.self || [], "status", "RESERVED"), "Status RESERVED"],
            ["Contracted", countBy(list.data?.self || [], "status", "CONTRACTED"), "Approved, contract drafted"],
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
              <Panel title="Reservations" subtitle={`${rows.length} of ${(list.data?.self || []).length} reservation(s) shown`}>
                <Table
                  label="Facility reservations"
                  rows={rows}
                  columns={[
                    { key: "code", label: "Reservation", render: (r) => <OpenLink to={`${workspace}/reservations/${r.id}`}>{r.code || r.id}</OpenLink> },
                    { key: "customer", label: "Customer", render: (r) => r.customerName },
                    { key: "unit", label: "Unit", render: (r) => r.unitCode || r.unitSize || "—" },
                    { key: "window", label: "Rental window", render: (r) => `${day(r.startDate)} → ${day(r.endDate)}` },
                    { key: "rent", label: "Rent / deposit", render: (r) => `${money(r.estimatedRent)} · ${money(r.depositAmount)}` },
                    { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                  ]}
                  empty="No reservation matches the current filters."
                />
              </Panel>
            )} />
          )}

          <Panel
            title="Managed reservations"
            subtitle="Backend chưa có endpoint danh sách Managed reservations."
          >
            <p className="text-sm text-slate-500">
              Trang này chỉ liệt kê reservation SELF_STORAGE từ <code>GET /reservations/facility/:facilityId</code>.
              Chưa thể hiển thị danh sách Managed Inventory vì backend không có collection endpoint và frontend
              không gọi chi tiết từng bản ghi (tránh N+1, tránh bắt người dùng nhập ID).
              Cần bổ sung <code>GET /reservations/managed</code> để hiển thị danh sách này.
            </p>
          </Panel>
        </>
      )} />
    </Screen>
  );
}
