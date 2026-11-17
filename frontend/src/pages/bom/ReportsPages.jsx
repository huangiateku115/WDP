import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, OpenLink, Button, Field, Input, Select, Table, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName } from "@/lib/bomApiData";
import { serviceLabel } from "@/lib/bomMappers";
import { apiErrorMessage } from "@/lib/apiError";
import { defaultRevenuePeriod, exportRevenueReport, loadRevenueReport, revenueSource } from "@/lib/reportSources";
import { saveBlob } from "@/lib/csvExport";
import { capability } from "@/lib/backendCapabilities";

// Reports shared by the BOM and Admin workspaces.
// Utilization and rental reports are live (confirmed read APIs).
// Revenue aggregation still needs a payment-ledger endpoint: PayOS payment records exist per
// reservation, but there is no cross-facility payment/revenue endpoint yet, so this page
// shows the requirement instead of demo numbers.

const REPORTS = [
  {
    key: "utilization",
    title: "Mức sử dụng toàn hệ thống",
    description: "Tỷ lệ lấp đầy kho riêng và thể tích lưu trữ hàng hóa.",
    live: true,
  },
  {
    key: "rentals",
    title: "Lịch sử thuê kho",
    description: "Vòng đời đơn đặt thuê trên mọi cơ sở.",
    live: true,
  },
  {
    key: "revenue",
    title: "Doanh thu toàn hệ thống",
    description: "Doanh thu đã thu, trạng thái thanh toán và tổng hợp theo kỳ.",
    live: false,
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
            {report.live ? (
              <OpenLink to={`${basePath}/reports/${report.key}`}>Mở báo cáo</OpenLink>
            ) : (
              <p className="text-sm text-slate-500">Chưa có dữ liệu.</p>
            )}
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const facilities = useAsyncData(loadFacilities, []);
  const report = useAsyncData(({ signal }) => loadRevenueReport({ from, to, facilityId: facility, signal }), [from, to, facility]);
  const source = revenueSource();
  const exportCapability = capability("serverExport");
  const value = (amount) => (amount === null || amount === undefined ? "—" : money(amount));

  async function runExport() {
    if (exporting) return;
    setExportError("");
    setExporting(true);
    try {
      const file = await exportRevenueReport({ format: "csv", from, to, facilityId: facility });
      saveBlob(file.filename, file.blob);
    } catch (error) {
      setExportError(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen
      title="Doanh thu toàn hệ thống"
      description="Doanh thu đã thu, đang chờ và đã hoàn theo khoảng thời gian và cơ sở."
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button>}
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
                <Button variant="outline" onClick={report.reload}>Tính lại</Button>
                <Button
                  variant="outline"
                  disabled={!source.ready || exporting}
                  title={source.ready ? undefined : exportCapability.reason}
                  onClick={runExport}
                >
                  {exporting ? "Đang xuất…" : "Xuất CSV"}
                </Button>
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
              </div>
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}
