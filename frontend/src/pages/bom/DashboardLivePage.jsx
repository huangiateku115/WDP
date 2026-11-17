import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, Table, Status, Button, Field, Select, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { ResourceThumb } from "@/components/bom/ResourceImages";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilityReservationsAll, facilityName, reservationScopeLabel } from "@/lib/bomApiData";
import { serviceLabel } from "@/lib/bomMappers";
import { defaultRevenuePeriod, loadReservationReport } from "@/lib/reportSources";

// Cross-facility dashboard. Counts come from the statistics read model
// (`GET /statistics/reservations`) so the console never fans out one request per facility; the
// per-reservation rows are read only for the facility the operator selects.
export default function DashboardLivePage() {
  const period = defaultRevenuePeriod();
  const [facility, setFacility] = useState("");

  const directory = useAsyncData(loadFacilities, []);
  const summary = useAsyncData(
    ({ signal }) => loadReservationReport({ from: period.from, to: period.to, facilityId: facility, signal }),
    [facility, period.from, period.to],
  );
  const rows = useAsyncData(
    ({ signal }) => (facility ? loadFacilityReservationsAll(facility, { signal }) : Promise.resolve(null)),
    [facility],
  );

  const facilities = directory.data || [];
  const totals = summary.data?.totals || {};
  const statusCounts = Object.fromEntries((summary.data?.byStatus || []).map((row) => [row.status, row.count]));
  const number = (value) => (value === null || value === undefined ? "—" : value);
  const byFacility = (summary.data?.byFacility || []).map((row) => {
    const meta = facilities.find((f) => f.id === row.facilityId);
    return {
      id: row.facilityId,
      name: meta?.name || facilityName(facilities, row.facilityId),
      cover: meta?.coverImage || "",
      status: meta?.status || "",
      total: row.total,
      active: row.active,
      cancelled: row.cancelled,
    };
  });
  const recent = [...(rows.data?.rows || [])]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20);

  return (
    <Screen
      title="Hoạt động kinh doanh toàn hệ thống"
      description="Cơ sở và đơn đặt thuê trên mọi cơ sở."
      action={<Button asChild variant="outline"><Link to="/bom/facilities">Quản lý cơ sở</Link></Button>}
    >
      <Panel title="Bộ lọc">
        <div className="manager-filters">
          <Field label="Cơ sở" hint="Để trống là toàn hệ thống; chọn một cơ sở để xem thêm danh sách đơn gần đây.">
            <Select
              label="Lọc theo cơ sở"
              value={facility}
              onChange={setFacility}
              options={[["", "Toàn hệ thống"], ...facilities.map((f) => [f.id, `${f.name} (${f.code})`])]}
            />
          </Field>
        </div>
      </Panel>
      <Kpis items={[
        ["Tổng số cơ sở", facilities.length, "Bản ghi cơ sở trên hệ thống"],
        ["Cơ sở đang hoạt động", facilities.filter((f) => f.status === "ACTIVE").length, "Đang nhận đơn mới"],
        ["Tổng số đơn", number(totals.total), `Đơn tạo ${period.from} → ${period.to}`],
        ["Đơn đang thuê", number(totals.active), "Trạng thái hiện tại: Đang sử dụng"],
        ["Chờ duyệt", statusCounts.RESERVED ?? 0, "Trạng thái hiện tại: Chờ xử lý"],
        ["Quá hạn", number(totals.overdue), "Trạng thái hiện tại: Quá hạn"],
        ["Đã đóng", statusCounts.CLOSED ?? 0, "Trạng thái hiện tại: Đã đóng"],
        ["Đã hủy", number(totals.cancelled), "Trạng thái hiện tại: Đã hủy"],
      ]} />
      <p className="bom-note">
        Số đơn do máy chủ tổng hợp theo <b>ngày tạo đơn</b> trong kỳ {period.from} → {period.to}, trên mọi cơ sở bạn có quyền xem.
        Trạng thái là trạng thái hiện tại của các đơn đó.
      </p>

      <AsyncBoundary state={summary} render={() => (
        <Panel title="Số đơn theo cơ sở" subtitle="Tổng hợp theo ngày tạo đơn trong kỳ đang xem.">
          <Table
            label="Số đơn theo cơ sở"
            rows={facility ? byFacility.filter((row) => row.id === facility) : byFacility}
            columns={[
              { key: "cover", label: "Ảnh", render: (r) => <ResourceThumb src={r.cover} alt={`Ảnh ${r.name}`} /> },
              { key: "name", label: "Facility", render: (r) => <Link className="manager-link" to={`/bom/facilities/${r.id}`} state={{ from: "/bom/dashboard" }}>{r.name}</Link> },
              { key: "status", label: "Business status", render: (r) => <Status value={r.status} /> },
              { key: "total", label: "Tổng đơn" },
              { key: "active", label: "Đang thuê" },
              { key: "cancelled", label: "Đã hủy" },
            ]}
            empty="Chưa có cơ sở để hiển thị."
          />
        </Panel>
      )} />

      {facility ? (
        <Panel title="Đơn gần đây" subtitle={`20 bản ghi mới nhất của ${facilityName(facilities, facility)}.`}>
          {rows.data?.failedServiceTypes?.length > 0 && (
            <p className="bom-warning mb-4">
              Không tải được đơn thuộc phạm vi {reservationScopeLabel(rows.data.failedServiceTypes)}; danh sách bên dưới chưa đầy đủ.
            </p>
          )}
          <AsyncBoundary state={rows} render={() => (
            <Table
              label="Đơn gần đây"
              rows={recent}
              columns={[
                { key: "code", label: "Reservation" },
                { key: "customer", label: "Customer", render: (r) => r.customerName },
                { key: "service", label: "Service", render: (r) => serviceLabel(r.service) },
                { key: "resource", label: "Unit / capacity", render: (r) => r.unitCode || (r.allocatedCapacity != null ? `${r.allocatedCapacity} m³` : "—") },
                { key: "period", label: "Period", render: (r) => `${r.startDate} → ${r.endDate}` },
                { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                { key: "rent", label: "Estimated rent", render: (r) => money(r.estimatedRent) },
              ]}
              empty="Cơ sở này chưa có đơn đặt thuê nào."
            />
          )} />
        </Panel>
      ) : (
        <Panel title="Đơn gần đây">
          <p className="text-sm text-slate-500">Chọn một cơ sở ở bộ lọc trên để xem 20 đơn mới nhất của cơ sở đó.</p>
        </Panel>
      )}
    </Screen>
  );
}
