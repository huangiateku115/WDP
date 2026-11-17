import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, Table, Status, Button, Field, Select, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { ResourceThumb } from "@/components/bom/ResourceImages";
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
  // Cross-facility is the default; picking a facility narrows every KPI and table below to it.
  const [facility, setFacility] = useState("");

  return (
    <Screen
      title="Hoạt động kinh doanh toàn hệ thống"
      description="Cơ sở và đơn đặt thuê trên mọi cơ sở."
      action={<Button asChild variant="outline"><Link to="/bom/facilities">Quản lý cơ sở</Link></Button>}
    >
      <AsyncBoundary state={state} render={({ facilities, reservations, truncated, failedFacilities }) => {
        const scoped = facility ? reservations.filter((r) => r.facilityId === facility) : reservations;
        const byFacility = facilities.map((f) => {
          const rows = reservations.filter((r) => r.facilityId === f.id);
          return {
            id: f.id,
            name: f.name,
            cover: f.coverImage,
            status: f.status,
            total: rows.length,
            reserved: countBy(rows, "RESERVED"),
            active: countBy(rows, "ACTIVE"),
            overdue: countBy(rows, "OVERDUE"),
          };
        });
        const recent = [...scoped]
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 20);

        return (
          <>
            <Panel title="Bộ lọc">
              <div className="manager-filters">
                <Field label="Cơ sở" hint="Chọn một cơ sở để thu hẹp mọi số liệu bên dưới; để trống là toàn hệ thống.">
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
              ["Tổng số đơn", scoped.length, facility ? facilityName(facilities, facility) : "Trên mọi cơ sở"],
              ["Đơn đang thuê", countBy(scoped, "ACTIVE"), "Đơn có trạng thái Đang sử dụng"],
              ["Chờ duyệt", countBy(scoped, "RESERVED"), "Đơn có trạng thái Chờ xử lý"],
              ["Quá hạn", countBy(scoped, "OVERDUE"), "Đơn có trạng thái Quá hạn"],
              ["Đã đóng", countBy(scoped, "CLOSED"), "Đơn có trạng thái Đã đóng"],
              ["Đã hủy", countBy(scoped, "CANCELLED"), "Đơn có trạng thái Đã hủy"],
            ]} />
            {truncated && <TruncatedNotice total={facilities.length} shown={Math.min(facilities.length, MAX_FACILITY_FETCHES)} />}
            {failedFacilities?.length > 0 && (
              <p className="bom-warning">
                Không tải được đơn đặt thuê của {failedFacilities.length} cơ sở:{" "}
                {failedFacilities.slice(0, 5).join(", ")}{failedFacilities.length > 5 ? "…" : ""}. Số liệu bên dưới không bao gồm các bản ghi đó.
              </p>
            )}
            <Panel title="Số đơn theo cơ sở" subtitle={facility ? `Đang xem: ${facilityName(facilities, facility)}` : "Số lượng theo từng cơ sở."}>
              <Table
                label="Số đơn theo cơ sở"
                rows={facility ? byFacility.filter((row) => row.id === facility) : byFacility}
                columns={[
                  { key: "cover", label: "Ảnh", render: (r) => <ResourceThumb src={r.cover} alt={`Ảnh ${r.name}`} /> },
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
            <Panel title="Đơn gần đây" subtitle={`20 bản ghi mới nhất${facility ? ` của ${facilityName(facilities, facility)}` : ""}.`}>
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
