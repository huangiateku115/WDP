import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuthSession } from "@/lib/authSession";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Select, Input, Button, money,
} from "@/components/manager/ManagerUI";
import ListPager from "@/components/manager/ListPager";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { Kpis } from "@/components/bom/BomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { usePageIndex } from "@/lib/usePageIndex";
import { loadAdminReservations, loadFacilities } from "@/lib/bomApiData";
import { countBy } from "@/lib/bomMetrics";
import { canReviewReservations } from "@/lib/roles";

// Reservation oversight shared by Admin and BOM.
// Backend contract:
//   GET   /reservations/admin-list?facilityId&serviceType&status&reservationCode&page&limit
//         ADMIN/BOM read across facilities; FACILITY_MANAGER/STAFF are scoped to their assignment.
//   GET   /reservations/:id                    CUSTOMER, FACILITY_MANAGER, ADMIN, BOM
//   PATCH /reservations/:id/approve|reject     FACILITY_MANAGER, ADMIN   (BOM is read-only)
//   GET   /reservations/managed/:id            CUSTOMER, FACILITY_MANAGER, ADMIN, BOM
//   PATCH /reservations/managed/:id/approve|reject|activate  FACILITY_MANAGER, ADMIN
//   POST  /reservations/managed/:id/mock-pay   CUSTOMER, ADMIN, BOM
// The list read covers both service models and is paged, so the screen browses one page at a
// time instead of downloading the whole facility history. It projects no pricing amounts, so the
// rent column states that instead of printing 0 ₫.
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
  // One debounced, server-side search over the reservation code (the only text filter the
  // collection read accepts).
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = usePageIndex(`${facilityId}|${status}|${debouncedSearch}`);

  // GET /reservations/admin-list is the paged collection read for both service models.
  const list = useAsyncData(({ signal }) => (facilityId
    ? loadAdminReservations({
        facilityId,
        ...(status ? { status } : {}),
        ...(debouncedSearch.trim() ? { reservationCode: debouncedSearch.trim() } : {}),
      }, { signal, page })
    : Promise.resolve(null)),
  [facilityId, status, debouncedSearch, page]);

  const rows = list.data?.rows || [];
  const pagination = list.data?.pagination ?? null;
  const total = list.data?.total ?? 0;

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
            ["Đơn trong phạm vi", total, "Theo bộ lọc hiện tại của cơ sở đã chọn"],
            ["Trang đang xem", rows.length, "Số đơn hiển thị trên trang này"],
            ["Chờ duyệt (trang này)", countBy(rows, "status", "RESERVED"), "Trạng thái Chờ xử lý"],
            ["Quyền xử lý", canReview ? "Duyệt / từ chối" : "Chỉ xem", canReview ? "Có thể đổi trạng thái duyệt" : "Vai trò của bạn không được duyệt"],
          ]} />

          <Panel title="Phạm vi xem xét">
            <div className="manager-filters">
              <Field label="Cơ sở">
                <Select
                  label="Cơ sở của đơn"
                  value={facilityId}
                  onChange={selectFacility}
                  options={[["", "Chọn cơ sở"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
                />
              </Field>
              <Field label="Trạng thái">
                <Select
                  label="Lọc theo trạng thái đơn"
                  value={status}
                  onChange={setStatus}
                  disabled={!facilityId}
                  options={[["", "Tất cả trạng thái"], ...RESERVATION_STATUSES]}
                />
              </Field>
              <Field label="Tìm kiếm" hint="Mã đơn đặt thuê.">
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
                Chỉ quản lý cơ sở và quản trị viên mới được duyệt hoặc từ chối đơn đặt thuê.
              </p>
            )}
          </Panel>

          {!facilityId && (
            <Panel title="Chọn cơ sở">
              <p className="text-sm text-slate-500">Đơn đặt thuê được liệt kê theo từng cơ sở.</p>
            </Panel>
          )}

          {facilityId && (
            <AsyncBoundary state={list} render={() => (
              <Panel title="Đơn đặt thuê" subtitle={`${total} đơn theo bộ lọc hiện tại`}>
                <Table
                  label="Đơn đặt thuê của cơ sở"
                  rows={rows}
                  columns={[
                    { key: "code", label: "Reservation", render: (r) => <OpenLink to={`${workspace}/reservations/${r.id}`}>{r.code || r.id}</OpenLink> },
                    { key: "customer", label: "Customer", render: (r) => r.customerName },
                    { key: "unit", label: "Unit", render: (r) => r.unitCode || r.unitSize || "—" },
                    { key: "window", label: "Thời gian thuê", render: (r) => `${day(r.startDate)} → ${day(r.endDate)}` },
                    // The paged list read projects no pricing amounts; say so instead of showing 0 ₫.
                    { key: "rent", label: "Tiền thuê / đặt cọc", render: (r) => (r.amountsKnown ? `${money(r.estimatedRent)} · ${money(r.depositAmount)}` : "—") },
                    { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                  ]}
                  empty="Không có đơn phù hợp bộ lọc hiện tại."
                />
                <ListPager
                  page={pagination?.page ?? page}
                  totalPages={pagination?.totalPages ?? 1}
                  total={total}
                  loading={list.loading}
                  onPageChange={setPage}
                  unit="đơn"
                />
              </Panel>
            )} />
          )}
        </>
      )} />
    </Screen>
  );
}
