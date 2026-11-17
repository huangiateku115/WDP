import { Link } from "react-router-dom";
import { Screen, Panel, Table, Status, Button, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadReservations, facilityName } from "@/lib/bomApiData";
import { serviceLabel } from "@/lib/bomMappers";

const countBy = (rows, status) => rows.filter((row) => row.status === status).length;
const MAX_FACILITY_FETCHES = 12;

// Live BOM dashboard: facility inventory + cross-facility reservations from the confirmed APIs.
// Revenue aggregation still needs a cross-facility payment ledger endpoint (see reports).
export default function DashboardLivePage() {
  const state = useAsyncData(async ({ signal }) => {
    const facilities = await loadFacilities();
    const { rows, truncated, failedFacilities } = await loadReservations(facilities, { signal });
    return { facilities, reservations: rows, truncated, failedFacilities };
  }, []);

  return (
    <Screen
      title="Hoạt động kinh doanh toàn hệ thống"
      description="Cơ sở và đơn đặt thuê trên mọi cơ sở."
      action={<Button asChild variant="outline"><Link to="/bom/facilities">Quản lý cơ sở</Link></Button>}
    >
      <AsyncBoundary state={state} render={({ facilities, reservations, truncated, failedFacilities }) => {
        const byFacility = facilities.map((f) => {
          const rows = reservations.filter((r) => r.facilityId === f.id);
          return {
            id: f.id,
            name: f.name,
            status: f.status,
            total: rows.length,
            reserved: countBy(rows, "RESERVED"),
            active: countBy(rows, "ACTIVE"),
            overdue: countBy(rows, "OVERDUE"),
          };
        });
        const recent = [...reservations]
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 20);

        return (
          <>
            <Kpis items={[
              ["Tổng số cơ sở", facilities.length, "Bản ghi cơ sở"],
              ["Cơ sở đang hoạt động", facilities.filter((f) => f.status === "ACTIVE").length, "Đang nhận đơn mới"],
              ["Tổng số đơn", reservations.length, "Trên mọi cơ sở"],
              ["Đơn đang thuê", countBy(reservations, "ACTIVE"), "Đơn có trạng thái Đang sử dụng"],
              ["Chờ duyệt", countBy(reservations, "RESERVED"), "Đơn có trạng thái Chờ xử lý"],
              ["Quá hạn", countBy(reservations, "OVERDUE"), "Đơn có trạng thái Quá hạn"],
              ["Đã đóng", countBy(reservations, "CLOSED"), "Đơn có trạng thái Đã đóng"],
              ["Đã hủy", countBy(reservations, "CANCELLED"), "Đơn có trạng thái Đã hủy"],
            ]} />
            {truncated && <TruncatedNotice total={facilities.length} shown={Math.min(facilities.length, MAX_FACILITY_FETCHES)} />}
            {failedFacilities?.length > 0 && (
              <p className="bom-warning">
                Không tải được đơn đặt thuê của {failedFacilities.length} cơ sở:{" "}
                {failedFacilities.slice(0, 5).join(", ")}{failedFacilities.length > 5 ? "…" : ""}. Số liệu bên dưới không bao gồm các bản ghi đó.
              </p>
            )}
            <Panel title="Số đơn theo cơ sở" subtitle="Số lượng theo từng cơ sở.">
              <Table
                label="Số đơn theo cơ sở"
                rows={byFacility}
                columns={[
                  { key: "name", label: "Facility", render: (r) => <Link className="manager-link" to={`/bom/facilities/${r.id}`} state={{ from: "/bom/dashboard" }}>{r.name}</Link> },
                  { key: "status", label: "Business status", render: (r) => <Status value={r.status} /> },
                  { key: "total", label: "Tổng đơn" },
                  { key: "reserved", label: "Chờ xử lý" },
                  { key: "active", label: "Đang thuê" },
                  { key: "overdue", label: "Quá hạn" },
                ]}
                empty="Chưa có cơ sở để hiển thị."
              />
            </Panel>
            <Panel title="Đơn gần đây" subtitle="20 bản ghi mới nhất.">
              <Table
                label="Đơn gần đây"
                rows={recent}
                columns={[
                  { key: "code", label: "Reservation" },
                  { key: "facility", label: "Facility", render: (r) => facilityName(facilities, r.facilityId) },
                  { key: "customer", label: "Customer", render: (r) => r.customerName },
                  { key: "service", label: "Service", render: (r) => serviceLabel(r.service) },
                  { key: "resource", label: "Unit / capacity", render: (r) => r.unitCode || (r.allocatedCapacity != null ? `${r.allocatedCapacity} m³` : "—") },
                  { key: "period", label: "Period", render: (r) => `${r.startDate} → ${r.endDate}` },
                  { key: "status", label: "Status", render: (r) => <Status value={r.status} /> },
                  { key: "rent", label: "Estimated rent", render: (r) => money(r.estimatedRent) },
                ]}
                empty="Không có đơn đặt thuê nào."
              />
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}
