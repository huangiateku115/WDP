import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, OpenLink, Button, Field, Input, Select, Table, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName } from "@/lib/bomApiData";
import { serviceLabel } from "@/lib/bomMappers";
import { apiErrorMessage } from "@/lib/apiError";
import { defaultRevenuePeriod, exportStatistics, loadFacilityRanking, loadRevenueReport, revenueSource } from "@/lib/reportSources";
import { saveBlob } from "@/lib/csvExport";
import { capability } from "@/lib/backendCapabilities";

// Reports shared by the BOM and Admin workspaces. Every card is served by the statistics read
// model (backend/src/routes/statistics.routes.ts): revenue, utilization, rental trends and the
// cross-facility ranking. Only refunds / recognised revenue stay unavailable server-side.

const REPORTS = [
  {
    key: "utilization",
    title: "Mức sử dụng toàn hệ thống",
    description: "Tỷ lệ lấp đầy kho riêng và thể tích lưu trữ hàng hóa.",
  },
  {
    key: "rentals",
    title: "Lịch sử thuê kho",
    description: "Vòng đời đơn đặt thuê trên mọi cơ sở.",
  },
  {
    key: "revenue",
    title: "Doanh thu toàn hệ thống",
    description: "Doanh thu đã thu, trạng thái thanh toán và tổng hợp theo kỳ.",
  },
  {
    key: "facilities-ranking",
    title: "Xếp hạng cơ sở",
    description: "So sánh đơn đặt thuê, khách hàng và doanh thu giữa các cơ sở.",
  },
];

export function ReportsIndexPage({ basePath = "/bom" }) {
  return (
    <Screen
      title="Báo cáo kinh doanh"
      description="So sánh hiệu quả cơ sở theo đúng đơn vị của từng mô hình dịch vụ."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {REPORTS.map((report) => (
          <Panel key={report.key} title={report.title}>
            <p className="mb-5 text-sm text-slate-500">{report.description}</p>
            <OpenLink to={`${basePath}/reports/${report.key}`}>Mở báo cáo</OpenLink>
          </Panel>
        ))}
      </div>
    </Screen>
  );
}

export function RevenueReportPendingPage({ basePath = "/bom" }) {
  const initial = defaultRevenuePeriod();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [facility, setFacility] = useState("");
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const facilities = useAsyncData(loadFacilities, []);
  const report = useAsyncData(({ signal }) => loadRevenueReport({ from, to, facilityId: facility, signal }), [from, to, facility]);
  const source = revenueSource();
  const exportCapability = capability("serverExport");
  const value = (amount) => (amount === null || amount === undefined ? "—" : money(amount));

  async function runExport(format) {
    if (exporting) return;
    setExportError("");
    setExporting(format);
    try {
      const file = await exportStatistics({ reportType: "revenue", format, from, to, facilityId: facility });
      saveBlob(file.filename, file.blob);
    } catch (error) {
      setExportError(apiErrorMessage(error));
    } finally {
      setExporting("");
    }
  }

  return (
    <Screen
      title="Doanh thu toàn hệ thống"
      description="Doanh thu đã thu, đang chờ và đã hoàn theo khoảng thời gian và cơ sở."
      action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={report.reload} disabled={report.loading}>Tính lại</Button><Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button></div>}
    >
      <AsyncBoundary state={report} render={(data) => {
        const directory = facilities.data || [];
        const rows = data.byFacility || [];
        const services = data.byService || [];
        return (
          <>
            <Kpis items={[
              ["Đã thu", value(data.totals.paid), `${from} → ${to}`],
              ["Đang chờ", value(data.totals.pending), "Chưa có nguồn tổng hợp"],
              ["Đã hoàn", value(data.totals.refunded), "Chưa có sổ hoàn tiền"],
              ["Số thanh toán", data.totals.orders ?? "—", "Giao dịch đã xác minh trong kỳ"],
            ]} />
            {!data.available && <p className="bom-note">{data.reason}</p>}
            {data.available && <p className="bom-note">Chỉ tính các giao dịch PayOS đã xác minh. Hoàn tiền và ghi nhận doanh thu chưa có nguồn dữ liệu nên để trống.</p>}
            <Panel title="Bộ lọc">
              <div className="manager-filters">
                <Field label="Từ ngày">
                  <Input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </Field>
                <Field label="Đến ngày">
                  <Input aria-label="Đến ngày" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
                </Field>
                <Field label="Cơ sở">
                  <Select label="Lọc theo cơ sở" value={facility} onChange={setFacility}
                    options={[["", "Tất cả cơ sở"], ...directory.map((f) => [f.id, f.name])]} />
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">

                {["csv", "xlsx", "pdf"].map((format) => (
                  <Button
                    key={format}
                    variant="outline"
                    disabled={!source.ready || Boolean(exporting)}
                    title={source.ready ? undefined : exportCapability.reason}
                    onClick={() => runExport(format)}
                  >
                    {exporting === format ? "Đang xuất…" : `Xuất ${format.toUpperCase()}`}
                  </Button>
                ))}
              </div>
              {exportError && <p role="alert" className="bom-error mt-4">{exportError}</p>}
            </Panel>
            <Panel title="Theo cơ sở" subtitle={`${rows.length} cơ sở`}>
              <Table
                label="Doanh thu theo cơ sở"
                rows={rows}
                columns={[
                  { key: "facilityName", label: "Cơ sở", render: (r) => facilityName(directory, r.facilityId) },
                  { key: "orders", label: "Số thanh toán", render: (r) => r.orders ?? "—" },
                  { key: "paid", label: "Đã thu", render: (r) => value(r.paid) },
                  { key: "pending", label: "Đang chờ", render: (r) => value(r.pending) },
                  { key: "refunded", label: "Đã hoàn", render: (r) => value(r.refunded) },
                ]}
                empty="Chưa có dữ liệu doanh thu cho khoảng thời gian này."
              />
            </Panel>
            {services.length > 0 && (
              <Panel title="Theo dịch vụ" subtitle={`${services.length} mô hình dịch vụ`}>
                <Table
                  label="Doanh thu theo dịch vụ"
                  rows={services}
                  columns={[
                    { key: "service", label: "Dịch vụ", render: (r) => serviceLabel(r.service) },
                    { key: "orders", label: "Số thanh toán", render: (r) => r.orders ?? "—" },
                    { key: "paid", label: "Đã thu", render: (r) => value(r.paid) },
                  ]}
                  empty="Chưa có dữ liệu."
                />
              </Panel>
            )}
            <Panel title="Báo cáo khác">
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline"><Link to={`${basePath}/reports/utilization`}>Báo cáo mức sử dụng</Link></Button>
                <Button asChild variant="outline"><Link to={`${basePath}/reports/rentals`}>Lịch sử thuê kho</Link></Button>
                <Button asChild variant="outline"><Link to={`${basePath}/reports/facilities-ranking`}>Xếp hạng cơ sở</Link></Button>
              </div>
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}

// Cross-facility comparison from GET /statistics/facilities-ranking. PayOS captures are the only
// revenue source, so "Đã thu" is verified money and the paid count excludes unpaid reservations.
const RANKING_SORTS = [
  ["collectedAmount", "Doanh thu đã thu"],
  ["paidReservationCount", "Đơn đã thanh toán"],
  ["reservationCount", "Số đơn"],
  ["uniqueCustomers", "Khách hàng"],
];

export function FacilityRankingPage({ basePath = "/bom" }) {
  const initial = defaultRevenuePeriod();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [sortBy, setSortBy] = useState("collectedAmount");
  const [sortOrder, setSortOrder] = useState("desc");
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const ranking = useAsyncData(
    ({ signal }) => loadFacilityRanking({ from, to, sortBy, sortOrder, signal }),
    [from, to, sortBy, sortOrder],
  );

  async function runExport(format) {
    if (exporting) return;
    setExportError("");
    setExporting(format);
    try {
      const file = await exportStatistics({ reportType: "facilities-kpi", format, from, to });
      saveBlob(file.filename, file.blob);
    } catch (error) {
      setExportError(apiErrorMessage(error));
    } finally {
      setExporting("");
    }
  }

  return (
    <Screen
      title="Xếp hạng cơ sở"
      description="So sánh số đơn, khách hàng và doanh thu đã thu giữa các cơ sở trong kỳ."
      action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={ranking.reload} disabled={ranking.loading}>Tính lại</Button><Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button></div>}
    >
      <AsyncBoundary state={ranking} render={(data) => (
        <>
          <Kpis items={[
            ["Cơ sở", data.items.length, "Trong phạm vi được xem"],
            ["Đơn đặt thuê", data.items.reduce((sum, row) => sum + row.reservations, 0), `${from} → ${to}`],
            ["Đơn đã thanh toán", data.items.reduce((sum, row) => sum + row.paidReservations, 0), "Giao dịch đã xác minh"],
            ["Đã thu", money(data.items.reduce((sum, row) => sum + row.collected, 0)), "Tổng theo bảng bên dưới"],
          ]} />
          <Panel title="Bộ lọc">
            <div className="manager-filters">
              <Field label="Từ ngày">
                <Input aria-label="Từ ngày" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </Field>
              <Field label="Đến ngày">
                <Input aria-label="Đến ngày" type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} />
              </Field>
              <Field label="Sắp xếp theo">
                <Select label="Sắp xếp theo" value={sortBy} onChange={setSortBy} options={RANKING_SORTS} />
              </Field>
              <Field label="Thứ tự">
                <Select label="Thứ tự sắp xếp" value={sortOrder} onChange={setSortOrder}
                  options={[["desc", "Cao đến thấp"], ["asc", "Thấp đến cao"]]} />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {["csv", "xlsx", "pdf"].map((format) => (
                <Button key={format} variant="outline" disabled={Boolean(exporting)} onClick={() => runExport(format)}>
                  {exporting === format ? "Đang xuất…" : `Xuất ${format.toUpperCase()}`}
                </Button>
              ))}
            </div>
            {exportError && <p role="alert" className="bom-error mt-4">{exportError}</p>}
          </Panel>
          <Panel title="Bảng xếp hạng" subtitle={`${data.items.length} cơ sở`}>
            <Table
              label="Xếp hạng cơ sở"
              rows={data.items}
              columns={[
                { key: "name", label: "Cơ sở", render: (r) => `${r.name}${r.code ? ` (${r.code})` : ""}` },
                { key: "services", label: "Dịch vụ", render: (r) => (r.services.length ? r.services.map(serviceLabel).join(", ") : "—") },
                { key: "reservations", label: "Đơn đặt thuê" },
                { key: "paidReservations", label: "Đơn đã thanh toán" },
                { key: "customers", label: "Khách hàng" },
                { key: "collected", label: "Đã thu", render: (r) => money(r.collected) },
              ]}
              empty="Chưa có dữ liệu cho khoảng thời gian này."
            />
          </Panel>
        </>
      )} />
    </Screen>
  );
}
