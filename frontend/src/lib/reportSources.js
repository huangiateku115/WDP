import { capability } from "@/lib/backendCapabilities";

// Revenue reporting is the one BOM/Admin report with no backend source yet: PayOS payments are
// exposed per reservation to CUSTOMER accounts only, and there is no cross-facility ledger.
// The page is already built against this adapter, so wiring the endpoint later is one file:
//   GET /reports/revenue?facilityId=&from=&to=
//     → { totals:{paid,pending,refunded,orders}, byFacility:[{facilityId,orders,paid,pending,refunded}] }
//   1. add the path to `src/api/confirmedContract.js`
//   2. call it below and return { ...report, available: true }
//   3. flip BACKEND_CAPABILITIES.revenueReport
export const emptyRevenueReport = () => ({
  totals: { paid: null, pending: null, refunded: null, orders: null },
  byFacility: [],
});

export function revenueSource() {
  return capability("revenueReport");
}

export async function loadRevenueReport() {
  const source = revenueSource();
  return { ...emptyRevenueReport(), available: false, reason: source.reason };
}

// First day of the current month and today, in the same YYYY-MM-DD form the filters use.
export function defaultRevenuePeriod(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  return { from: `${month}-01`, to: `${month}-${pad(now.getDate())}` };
}
