import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuthSession } from "@/lib/authSession";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Select, Input, Button, money,
} from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilityReservations } from "@/lib/bomApiData";
import { countBy } from "@/lib/bomMetrics";
import { canReviewReservations } from "@/lib/roles";

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
      title="Giám sát đơn đặt thuê"
      description="Theo dõi đơn Thuê kho riêng theo từng cơ sở và xử lý đơn Lưu trữ hàng hóa. Duyệt đơn sẽ tạo hợp đồng nháp."
      action={<Button variant="outline" disabled={list.loading} onClick={refresh}>Tải lại</Button>}
    >
      <AsyncBoundary state={directory} render={(facilities) => (
        <>
          <Kpis items={[
            ["Số đơn đã tải", list.data ? list.data.self.length : "—", "Đơn Thuê kho riêng của cơ sở đã chọn"],
            ["Chờ duyệt", countBy(list.data?.self || [], "status", "RESERVED"), "Trạng thái Chờ xử lý"],
            ["Đã lập hợp đồng", countBy(list.data?.self || [], "status", "CONTRACTED"), "Đã duyệt, đã tạo hợp đồng"],
            ["Quyền xử lý", canReview ? "Duyệt / từ chối" : "Chỉ xem", canReview ? "Có thể đổi trạng thái duyệt" : "Vai trò của bạn không được duyệt"],
          ]} />

          <Panel title="Phạm vi xem xét">
            <div className="manager-filters">
              <Field label="Cơ sở">
                <Select
                  label="Cơ sở của đơn"
                  value={facilityId}
                  onChange={selectFacility}
                  options={[["", "Select a facility"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                />
              </Field>
              <Field label="Trạng thái">
                <Select
                  label="Lọc theo trạng thái đơn"
                  value={status}
                  onChange={setStatus}
                  disabled={!facilityId}
                  options={[["", "All statuses"], ...RESERVATION_STATUSES.map((s) => [s, s.replaceAll("_", " ")])]}
                />
              </Field>
              <Field label="Tìm kiếm" hint="Mã đơn hoặc tên khách hàng.">
                <Input
                  aria-label="Tìm đơn đặt thuê"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!facilityId}
                />
              </Field>
            </div>
            {!canReview && (
              <p className="bom-warning mt-5">
                Only facility managers and admins can approve or reject reservations.
              </p>
            )}
          </Panel>

          {!facilityId && (
            <Panel title="Chọn cơ sở">
              <p className="text-sm text-slate-500">Reservations are listed facility by facility.</p>
            </Panel>
          )}

          {facilityId && (
            <AsyncBoundary state={list} render={() => (
              <Panel title="Đơn đặt thuê" subtitle={`${rows.length} / ${(list.data?.self || []).length} đơn`}>
                <Table
                  label="Đơn đặt thuê của cơ sở"
                  rows={rows}
                  columns={[
                    { key: "code", label: "Reservation", render: (r) => <OpenLink to={`${workspace}/reservations/${r.id}`}>{r.code || r.id}</OpenLink> },
                    { key: "customer", label: "Customer", render: (r) => r.customerName },
                    { key: "unit", label: "Unit", render: (r) => r.unitCode || r.unitSize || "—" },
                    { key: "window", label: "Thời gian thuê", render: (r) => `${day(r.startDate)} → ${day(r.endDate)}` },
                    { key: "rent", label: "Tiền thuê / đặt cọc", render: (r) => `${money(r.estimatedRent)} · ${money(r.depositAmount)}` },
                    { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                  ]}
                  empty="Không có đơn phù hợp bộ lọc hiện tại."
                />
              </Panel>
            )} />
          )}
        </>
      )} />
    </Screen>
  );
}
