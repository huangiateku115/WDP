import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, Table, Status, Field, Input, Select, Button, Details, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, loadFacilityReservationsAll, facilityName, reservationScopeLabel } from "@/lib/bomApiData";
import { BOM_RESERVATION_STATUSES, serviceLabel } from "@/lib/bomMappers";
import { apiErrorMessage } from "@/lib/apiError";
import { downloadCsv, saveBlob } from "@/lib/csvExport";
import { defaultRevenuePeriod, exportStatistics, loadRentalTrends, loadReservationReport } from "@/lib/reportSources";

const EXPORT_FORMATS = ["csv", "xlsx", "pdf"];

// Two sources, both bounded:
//   • GET /statistics/reservations + /statistics/rental-trends — server aggregates for the period
//     across every facility the caller may see (no per-facility fan-out).
//   • GET /reservations/facility/:id — the per-reservation rows, read for the ONE facility the
//     operator selects (the backend has no cross-facility reservation list).
export default function RentalReportLivePage({ basePath = "/bom" }) {
  const directory = useAsyncData(loadFacilities, []);
  const [facility, setFacility] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const initialPeriod = defaultRevenuePeriod();
  const periodFrom = from || initialPeriod.from;
  const periodTo = to || initialPeriod.to;
  const [granularity, setGranularity] = useState("month");
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const summary = useAsyncData(
    ({ signal }) => loadReservationReport({ from: periodFrom, to: periodTo, facilityId: facility, granularity, signal }),
    [periodFrom, periodTo, facility, granularity],
  );
  const trends = useAsyncData(
    ({ signal }) => loadRentalTrends({ from: periodFrom, to: periodTo, facilityId: facility, granularity, signal }),
    [periodFrom, periodTo, facility, granularity],
  );
  // Rows are only requested for a chosen facility, so the page never opens one request per facility.
  const rowSet = useAsyncData(
    ({ signal }) => (facility ? loadFacilityReservationsAll(facility, { signal }) : Promise.resolve(null)),
    [facility],
  );

  async function runExport(format) {
    if (exporting) return;
    setExportError("");
    setExporting(format);
    try {
      // reportType=reservations accepts fromDate/toDate/facilityId + serviceType/granularity/unitSize.
      const file = await exportStatistics({
        reportType: "reservations",
        format,
        from: periodFrom,
        to: periodTo,
        facilityId: facility,
        filters: { granularity },
      });
      saveBlob(file.filename, file.blob);
    } catch (error) {
      setExportError(apiErrorMessage(error));
    } finally {
      setExporting("");
    }
  }

  const totals = summary.data?.totals || {};
  const number = (value) => (value === null || value === undefined ? "—" : value);

  return (
    <Screen
      title="Lịch sử thuê kho"
      description="Đơn đặt thuê trên mọi cơ sở, lọc theo cơ sở, trạng thái và tìm kiếm."
      action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={summary.reload} disabled={summary.loading}>Tính lại</Button><Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button></div>}
    >
      <AsyncBoundary state={directory} render={(facilities) => {
        const reservations = rowSet.data?.rows || [];
        const rows = reservations.filter((r) =>
          (!status || r.status === status) &&
          (!from || (r.startDate && r.startDate >= from)) &&
          (!to || (r.startDate && r.startDate <= to)) &&
          (!search || `${r.code} ${r.customerName}`.toLowerCase().includes(search.toLowerCase())));
        return (
          <>
            <Kpis items={[
              ["Tổng đơn trong kỳ", number(totals.total), `Đơn tạo từ ${periodFrom} đến ${periodTo}`],
              ["Đã thanh toán", number(totals.paid), "Thanh toán PayOS đã xác minh"],
              ["Đang thuê", number(totals.active), "Trạng thái hiện tại: Đang sử dụng"],
              ["Quá hạn", number(totals.overdue), "Trạng thái hiện tại: Quá hạn"],
              ["Đã hủy", number(totals.cancelled), "Tỷ lệ hủy tính trên tổng đơn trong kỳ"],
              ["Đã hoàn tất", number(totals.completed), "Đã trả kho hoặc đã đóng"],
              ["Chờ thanh toán", number(totals.pendingPayment), "Chưa thanh toán, còn trong hạn"],
              ["Chờ ký hợp đồng", number(totals.awaitingContract), "Đã thanh toán nhưng chưa có hợp đồng đã ký"],
            ]} />
            {summary.error && <p className="bom-warning">Không tải được số liệu tổng hợp: {summary.error}</p>}
            {rowSet.data?.failedServiceTypes?.length > 0 && (
              <p className="bom-warning">
                Không tải được đơn thuộc phạm vi {reservationScopeLabel(rowSet.data.failedServiceTypes)}; danh sách đơn bên dưới chưa đầy đủ.
              </p>
            )}
            <Panel title="Bộ lọc">
              <div className="manager-filters">
                <Field label="Cơ sở" hint="Danh sách đơn chi tiết chỉ tải cho cơ sở được chọn.">
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
                <Field label="Cách gộp kỳ">
                  <Select label="Gộp theo" value={granularity} onChange={setGranularity}
                    options={[["day", "Theo ngày"], ["week", "Theo tuần"], ["month", "Theo tháng"]]} />
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {EXPORT_FORMATS.map((format) => (
                  <Button key={format} variant="outline" disabled={Boolean(exporting)} onClick={() => runExport(format)}>
                    {exporting === format ? "Đang xuất…" : `Xuất báo cáo ${format.toUpperCase()}`}
                  </Button>
                ))}
              </div>
              {exportError && <p role="alert" className="bom-error mt-4">{exportError}</p>}
            </Panel>

            <Panel title="Tổng hợp theo trạng thái" subtitle={`Đơn tạo trong kỳ ${periodFrom} → ${periodTo}`}>
              <AsyncBoundary state={summary} render={() => (
                <>
                  <Details values={[
                    ["Tổng đơn", number(totals.total)],
                    ["Tỷ lệ hủy", totals.cancellationRate === null || totals.cancellationRate === undefined ? "—" : `${totals.cancellationRate}%`],
                    ...(summary.data?.byStatus || []).map((row) => [row.status, row.count]),
                  ]} />
                  <div className="mt-5">
                    <Table
                      label="Đơn theo mô hình dịch vụ"
                      rows={(summary.data?.byService || []).map((row) => ({ ...row, id: row.service }))}
                      columns={[
                        { key: "service", label: "Mô hình dịch vụ", render: (r) => serviceLabel(r.service) },
                        { key: "total", label: "Tổng đơn" },
                        { key: "active", label: "Đang thuê" },
                        { key: "cancelled", label: "Đã hủy" },
                      ]}
                      empty="Chưa có đơn nào trong kỳ đã chọn."
                    />
                  </div>
                  <p className="bom-note mt-4">
                    Số liệu tổng hợp do máy chủ tính trên toàn bộ cơ sở bạn có quyền xem. Trạng thái là trạng thái hiện tại của các đơn được tạo trong kỳ, không phải số lần chuyển trạng thái.
                  </p>
                </>
              )} />
            </Panel>

            <Panel
              title="Đơn đặt thuê"
              subtitle={facility ? `${rows.length} / ${reservations.length} bản ghi của ${facilityName(facilities, facility)}` : "Chọn một cơ sở để xem danh sách đơn chi tiết."}
              action={facility ? (
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
                  Xuất bảng đang xem (CSV)
                </Button>
              ) : undefined}
            >
              {!facility ? (
                <p className="text-sm text-slate-500">Máy chủ chỉ có API đơn thuê theo từng cơ sở, nên danh sách chi tiết chỉ tải khi bạn chọn một cơ sở. Số liệu tổng hợp ở trên đã tính trên mọi cơ sở.</p>
              ) : (
                <AsyncBoundary state={rowSet} render={() => (
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
                )} />
              )}
            </Panel>

            <Panel
              title="Xu hướng theo kỳ"
              subtitle={`${trends.data?.items?.length ?? 0} mốc thời gian · gộp theo ${{ day: "ngày", week: "tuần", month: "tháng" }[granularity] || "tháng"}`}
            >
              <AsyncBoundary state={trends} render={() => (
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
              )} />
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}
