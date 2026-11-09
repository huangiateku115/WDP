import { Link } from "react-router-dom";
import { Screen, Panel, OpenLink, Details, Button } from "@/components/manager/ManagerUI";

// Reports shared by the BOM and Admin workspaces.
// Utilization and rental reports are live (confirmed read APIs).
// Revenue aggregation still needs a payment-ledger endpoint: PayOS payment records exist per
// reservation, but there is no cross-facility payment/revenue endpoint yet, so this page
// shows the requirement instead of demo numbers.

const REPORTS = [
  {
    key: "utilization",
    title: "Cross-facility utilization",
    description: "Private unit occupancy and Managed Inventory volume from the confirmed read APIs.",
    live: true,
  },
  {
    key: "rentals",
    title: "Rental / customer history",
    description: "Reservation lifecycle across every facility from the confirmed reservation API.",
    live: true,
  },
  {
    key: "revenue",
    title: "Cross-facility revenue",
    description: "Collected revenue, payment status and period summaries.",
    live: false,
  },
];

export function ReportsIndexPage({ basePath = "/bom" }) {
  return (
    <Screen
      title="Business reports"
      description="Compare facility performance with the correct units for each service model."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {REPORTS.map((report) => (
          <Panel key={report.key} title={report.title}>
            <p className="mb-5 text-sm text-slate-500">{report.description}</p>
            {report.live ? (
              <OpenLink to={`${basePath}/reports/${report.key}`}>Open report</OpenLink>
            ) : (
              <p className="text-sm text-slate-500">Awaiting a cross-facility payment ledger endpoint.</p>
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
      title="Cross-facility revenue"
      description="Collected revenue, payment status and period summaries."
      action={<Button asChild variant="outline"><Link to={`${basePath}/reports`}>Back to reports</Link></Button>}
    >
      <Panel title="Revenue needs a cross-facility payment ledger" subtitle="No sample numbers are shown on this page.">
        <p className="text-sm text-slate-600">
          Payment records already exist per reservation (PayOS checkout, webhook-confirmed status
          and the customer payment history), but the backend exposes them only for the owning
          customer. BOM/Admin revenue reporting needs an aggregated ledger endpoint, so this page
          stays empty instead of showing demo numbers.
        </p>
        <div className="mt-5">
          <Details
            values={[
              ["Needed", "GET /payments with facility, service and status filters plus period totals."],
              ["Also needed", "GET /reports/revenue and GET /reports/:kind/export for CSV/XLSX downloads."],
              ["Available today", "Utilization and rental reports read only confirmed APIs."],
            ]}
          />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link to={`${basePath}/reports/utilization`}>Open utilization report</Link></Button>
          <Button asChild variant="outline"><Link to={`${basePath}/reports/rentals`}>Open rental report</Link></Button>
        </div>
      </Panel>
    </Screen>
  );
}
