import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, Table, Status, Field, Input, Select, Button, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary, TruncatedNotice } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadReservations, facilityName } from "@/lib/bomApiData";
import { BOM_RESERVATION_STATUSES, serviceLabel } from "@/lib/bomMappers";
import { downloadCsv } from "@/lib/csvExport";
import { defaultRevenuePeriod, loadRentalTrends } from "@/lib/reportSources";

const countBy = (rows, status) => rows.filter((row) => row.status === status).length;
const MAX_FACILITY_FETCHES = 12;

// Rental lifecycle report driven by the confirmed reservation API.
// Payment/revenue totals still need a cross-facility payment ledger endpoint.
export default function RentalReportLivePage({ basePath = "/bom" }) {
  const state = useAsyncData(async ({ signal }) => {
    const facilities = await loadFacilities();
    const { rows, truncated, failedFacilities } = await loadReservations(facilities, { signal });
    return { facilities, reservations: rows, truncated, failedFacilities };
  }, []);
  const [facility, setFacility] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const initialPeriod = defaultRevenuePeriod();
  const [granularity, setGranularity] = useState("month");
  const trends = useAsyncData(
    ({ signal }) => loadRentalTrends({
      from: from || initialPeriod.from,
      to: to || initialPeriod.to,
      facilityId: facility,
      granularity,
      signal,
    }),
    [from, to, facility, granularity],
  );

  return (
    <Screen
      title="Lịch sử thuê kho"
      description="Đơn đặt thuê trên mọi cơ sở, lọc theo cơ sở, trạng thái và tìm kiếm."
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button>}
    >
      <AsyncBoundary state={state} render={({ facilities, reservations, truncated, failedFacilities }) => {
        const rows = reservations.filter((r) =>
          (!facility || r.facilityId === facility) &&
          (!status || r.status === status) &&
          (!from || (r.startDate && r.startDate >= from)) &&
          (!to || (r.startDate && r.startDate <= to)) &&
          (!search || `${r.code} ${r.customerName}`.toLowerCase().includes(search.toLowerCase())));
        return (
          <>
            <Kpis items={[
              ["Đơn đặt thuê", reservations.length, "Trên mọi cơ sở"],
              ["Đang thuê", countBy(reservations, "ACTIVE"), "Trạng thái Đang sử dụng"],
              ["Quá hạn", countBy(reservations, "OVERDUE"), "Trạng thái Quá hạn"],
              ["Đã đóng", countBy(reservations, "CLOSED"), "Trạng thái Đã đóng"],
            ]} />
            {failedFacilities?.length > 0 && (
              <p className="bom-warning">
                Không tải được đơn đặt thuê của {failedFacilities.length} cơ sở:{" "}
                {failedFacilities.slice(0, 5).join(", ")}{failedFacilities.length > 5 ? "…" : ""}. Báo cáo bên dưới không bao gồm các bản ghi đó.
              </p>
            )}
            <Panel title="Bộ lọc">
              <div className="manager-filters">
                <Field label="Cơ sở">
                  <Select label="Lọc theo cơ sở" value={facility} onChange={setFacility}
                    options={[["", "Tất cả cơ sở"], ...facilities.map((f) => [f.id, f.name])]} />
                </Field>
                <Field label="Trạng thái">
                  <Select label="Lọc theo trạng thái" value={status} onChange={setStatus}
                    options={[["", "Tất cả trạng thái"], ...BOM_RESERVATION_STATUSES]} />
                </Field>
                <Field label="Tìm kiếm">
                  <Input aria-label="Tìm đơn đặt thuê" value={search} onChange={(e) => setSearch(e.target.value)} />
                </Field>
                <Field label="Bắt đầu từ ngày">
                  <Input aria-label="Bắt đầu từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="Đến ngày">
                  <Input aria-label="Đến ngày" type="date" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
            </Panel>
            <Panel
              title="Đơn đặt thuê"
              subtitle={`${rows.length} / ${reservations.length} bản ghi`}
              action={
                <Button
                  variant="outline"
                  disabled={!rows.length}
                  onClick={() => downloadCsv(
                    `don-dat-thue${from ? `-${from}` : ""}${to ? `-${to}` : ""}.csv`,
                    [["code", "Mã đơn"], ["facility", "Cơ sở"], ["customer", "Khách hàng"], ["service", "Dịch vụ"], ["resource", "Kho / công suất"], ["period", "Thời gian thuê"], ["status", "Trạng thái"], ["rent", "Tiền thuê tạm tính"]],
                    rows.map((r) => ({
                      code: r.code || r.id,
                      facility: facilityName(facilities, r.facilityId),
                      customer: r.customerName,
                      service: serviceLabel(r.service),
                      resource: r.unitCode || (r.allocatedCapacity != null ? `${r.allocatedCapacity} m³` : ""),
                      period: `${r.startDate} → ${r.endDate}`,
                      status: r.status,
                      rent: r.estimatedRent,
                    })),
                  )}
                >
                  Xuất CSV
                </Button>
              }
            >
              {truncated && <TruncatedNotice total={facilities.length} shown={Math.min(facilities.length, MAX_FACILITY_FETCHES)} />}
              <Table
                label="Vòng đời đơn đặt thuê"
                rows={rows}
                columns={[
                  {
                    key: "code",
                    label: "Mã đơn",
                    render: (r) => (
                      <Link className="manager-link" to={`${basePath}/reservations/${r.isManaged ? "managed/" : ""}${r.id}`}>
                        {r.code || r.id}
                      </Link>
                    ),
                  },
                  { key: "facility", label: "Cơ sở", render: (r) => facilityName(facilities, r.facilityId) },
                  { key: "customer", label: "Khách hàng", render: (r) => r.customerName },
                  { key: "service", label: "Dịch vụ", render: (r) => serviceLabel(r.service) },
                  { key: "resource", label: "Kho / công suất", render: (r) => r.unitCode || (r.allocatedCapacity != null ? `${r.allocatedCapacity} m³` : "—") },
                  { key: "period", label: "Thời gian thuê", render: (r) => `${r.startDate} → ${r.endDate}` },
                  { key: "status", label: "Trạng thái", render: (r) => <Status value={r.status} /> },
                  { key: "rent", label: "Tiền thuê tạm tính", render: (r) => money(r.estimatedRent) },
                ]}
                empty="Không có đơn phù hợp bộ lọc."
              />
            </Panel>

            <Panel
              title="Xu hướng theo kỳ"
              subtitle={`${trends.data?.items?.length ?? 0} mốc thời gian`}
              action={
                <Field label="Cách gộp">
                  <Select label="Gộp theo" value={granularity} onChange={setGranularity}
                    options={[["day", "Theo ngày"], ["week", "Theo tuần"], ["month", "Theo tháng"]]} />
                </Field>
              }
            >
              {trends.error
                ? <p className="bom-note">{trends.error}</p>
                : trends.loading
                  ? <p role="status" className="text-sm text-slate-500">Đang tải xu hướng…</p>
                  : (
                    <Table
                      label="Xu hướng đơn đặt thuê"
                      rows={trends.data?.items || []}
                      columns={[
                        { key: "bucketStart", label: "Kỳ" },
                        { key: "reservations", label: "Đơn đặt thuê" },
                        { key: "paidReservations", label: "Đơn đã thanh toán" },
                        { key: "selfStorage", label: "Thuê kho riêng" },
                        { key: "managedInventory", label: "Lưu trữ hàng hóa" },
                        { key: "customers", label: "Khách đã thanh toán" },
                      ]}
                      empty="Chưa có dữ liệu xu hướng cho khoảng thời gian này."
                    />
                  )}
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}
