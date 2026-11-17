import { statisticsApi } from "@/api/statisticsApi";
import { capability } from "@/lib/backendCapabilities";

// Revenue reporting is served by the statistics read model:
//   GET /statistics/revenue?fromDate=&toDate=&facilityId=&granularity=&comparePrevious=
// The backend reports verified PayOS captures only. Refund ledger / net cash flow / recognised
// revenue are still unavailable server-side, so they stay `null` and the screen prints "—"
// instead of inventing a number.
export const emptyRevenueReport = () => ({
  totals: { paid: null, pending: null, refunded: null, orders: null },
  byFacility: [],
  byService: [],
});

export function revenueSource() {
  return capability("revenueReport");
}

const records = (response) => response?.data?.data ?? {};

export async function loadRevenueReport({ from, to, facilityId, granularity, signal } = {}) {
  const source = revenueSource();
  if (!source.ready) return { ...emptyRevenueReport(), available: false, reason: source.reason };
  const body = records(await statisticsApi.revenue({
    fromDate: from,
    toDate: to,
    facilityId,
    granularity,
    comparePrevious: "true",
  }, { signal }));
  return {
    available: true,
    reason: "",
    totals: {
      paid: body.collectedAmount ?? null,
      // The API exposes no pending-payment aggregate; the column stays empty, never guessed.
      pending: null,
      refunded: body.refundedAmount ?? null,
      orders: body.paymentCount ?? null,
    },
    growthPercent: body.growthPercent ?? null,
    byFacility: (body.collectedByFacility || []).map((row) => ({
      facilityId: row.facilityId,
      orders: row.paymentCount ?? null,
      paid: row.collectedAmount ?? null,
      pending: null,
      refunded: null,
    })),
    byService: (body.collectedByService || []).map((row) => ({
      service: row.serviceType,
      orders: row.paymentCount ?? null,
      paid: row.collectedAmount ?? null,
    })),
  };
}

// First day of the current month and today, in the same YYYY-MM-DD form the filters use.
export function defaultRevenuePeriod(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  return { from: `${month}-01`, to: `${month}-${pad(now.getDate())}` };
}

export async function exportRevenueReport({ format = "csv", from, to, facilityId, signal } = {}) {
  const response = await statisticsApi.exportFile(format, {
    reportType: "revenue",
    fromDate: from,
    toDate: to,
    facilityId,
  }, { signal });
  return {
    blob: response?.data instanceof Blob ? response.data : new Blob([response?.data ?? ""]),
    filename: `doanh-thu-${from}-${to}.${format}`,
  };
}

// Cross-facility utilization snapshot. This replaces the client-side aggregation that used to
// stop at the first 12 facilities: GET /statistics/utilization aggregates every facility the
// caller may see (ALL for ADMIN/BOM, own facility for a Facility Manager).
export async function loadUtilizationSummary({ facilityId, signal } = {}) {
  const body = (await statisticsApi.utilization({ facilityId }, { signal }))?.data?.data ?? {};
  return {
    facilities: body.totalFacilities ?? null,
    totalUnits: body.totalStorageUnits ?? null,
    occupied: body.occupiedStorageUnits ?? null,
    reserved: body.reservedStorageUnits ?? null,
    available: body.availableStorageUnits ?? null,
    selfStorageRate: body.selfStorageUtilizationRate ?? null,
    managedVolumeRate: body.managedInventoryVolumeUtilizationRate ?? null,
    managedWeightRate: body.managedInventoryWeightUtilizationRate ?? null,
    serviceBreakdown: body.utilizationByService ?? null,
  };
}
