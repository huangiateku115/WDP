import { Link } from "react-router-dom";
import { Screen, Panel, OpenLink, Button } from "@/components/manager/ManagerUI";

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
  return (
    <Screen
      title="Doanh thu toàn hệ thống"
      description="Doanh thu đã thu, trạng thái thanh toán và tổng hợp theo kỳ."
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Quay lại báo cáo</Link></Button>}
    >
      <Panel title="Doanh thu toàn hệ thống">
        <p className="text-sm text-slate-600">Chưa có dữ liệu.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link to={`${basePath}/reports/utilization`}>Mở báo cáo sử dụng</Link></Button>
          <Button asChild variant="outline"><Link to={`${basePath}/reports/rentals`}>Mở báo cáo thuê kho</Link></Button>
        </div>
      </Panel>
    </Screen>
  );
}
