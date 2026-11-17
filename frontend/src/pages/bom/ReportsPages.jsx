import { useState } from "react";
import { Link } from "react-router-dom";
import { Screen, Panel, OpenLink, Button, Field, Input, Select, Table, money } from "@/components/manager/ManagerUI";
import { Kpis } from "@/components/bom/BomUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { loadFacilities, facilityName } from "@/lib/bomApiData";
import { defaultRevenuePeriod, loadRevenueReport, revenueSource } from "@/lib/reportSources";
import { downloadCsv } from "@/lib/csvExport";
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
  const facilities = useAsyncData(loadFacilities, []);
  const report = useAsyncData(({ signal }) => loadRevenueReport({ from, to, facilityId: facility, signal }), [from, to, facility]);
  const source = revenueSource();
  const exportCapability = capability("serverExport");
  const value = (amount) => (amount === null || amount === undefined ? "—" : money(amount));

  return (
    <Screen
      title="Doanh thu toàn hệ thống"
      description="Doanh thu đã thu, đang chờ và đã hoàn theo khoảng thời gian và cơ sở."
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button>}
    >
      <AsyncBoundary state={report} render={(data) => {
        const directory = facilities.data || [];
        const rows = data.byFacility || [];
        return (
          <>
            <Kpis items={[
              ["Đã thu", value(data.totals.paid), `${from} → ${to}`],
              ["Đang chờ", value(data.totals.pending), "Chưa ghi nhận thanh toán"],
              ["Đã hoàn", value(data.totals.refunded), "Hoàn tiền đã xử lý"],
              ["Số đơn", data.totals.orders ?? "—", "Đơn phát sinh trong kỳ"],
            ]} />
            {!data.available && <p className="bom-note">{data.reason}</p>}
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
                  disabled={!source.ready || !rows.length}
                  title={source.ready ? undefined : exportCapability.reason}
                  onClick={() => downloadCsv(
                    `doanh-thu-${from}-${to}.csv`,
                    [["facilityName", "Cơ sở"], ["orders", "Số đơn"], ["paid", "Đã thu"], ["pending", "Đang chờ"], ["refunded", "Đã hoàn"]],
                    rows,
                  )}
                >
                  Xuất CSV
                </Button>
              </div>
            </Panel>
            <Panel title="Theo cơ sở" subtitle={`${rows.length} cơ sở`}>
              <Table
                label="Doanh thu theo cơ sở"
                rows={rows}
                columns={[
                  { key: "facilityName", label: "Cơ sở", render: (r) => facilityName(directory, r.facilityId) },
                  { key: "orders", label: "Số đơn", render: (r) => r.orders ?? "—" },
                  { key: "paid", label: "Đã thu", render: (r) => value(r.paid) },
                  { key: "pending", label: "Đang chờ", render: (r) => value(r.pending) },
                  { key: "refunded", label: "Đã hoàn", render: (r) => value(r.refunded) },
                ]}
                empty="Chưa có dữ liệu doanh thu cho khoảng thời gian này."
              />
            </Panel>
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
