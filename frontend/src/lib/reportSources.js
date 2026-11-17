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
  return exportStatistics({ reportType: "revenue", format, from, to, facilityId, signal });
}

// Any report the statistics export router supports:
// GET /statistics/export/{csv|xlsx|pdf}?reportType=revenue|facilities-kpi|financial-analytics|…
export async function exportStatistics({ reportType, format = "csv", from, to, facilityId, signal } = {}) {
  const response = await statisticsApi.exportFile(format, {
    reportType,
    fromDate: from,
    toDate: to,
    facilityId,
  }, { signal });
  return {
    blob: response?.data instanceof Blob ? response.data : new Blob([response?.data ?? ""]),
    filename: `${reportType}-${from}-${to}.${format}`,
  };
}

// Facility ranking: GET /statistics/facilities-ranking?sortBy&sortOrder&page&limit
export async function loadFacilityRanking({ from, to, facilityId, sortBy = "collectedAmount", sortOrder = "desc", page = 1, limit = 20, signal } = {}) {
  const body = (await statisticsApi.facilitiesRanking({ fromDate: from, toDate: to, facilityId, sortBy, sortOrder, page, limit }, { signal }))?.data?.data ?? {};
  const items = (body.items || []).map((row) => ({
    id: row.facilityId,
    code: row.code || "",
    name: row.name || row.code || row.facilityId,
    services: row.serviceTypes || [],
    reservations: row.reservationCount ?? 0,
    paidReservations: row.paidReservationCount ?? 0,
    customers: row.uniqueCustomers ?? 0,
    collected: row.collectedAmount ?? 0,
  }));
  return { items, total: body.total ?? items.length, page: body.page ?? page, limit: body.limit ?? limit };
}

// Rental trends: GET /statistics/rental-trends?granularity=day|week|month
export async function loadRentalTrends({ from, to, facilityId, granularity = "month", signal } = {}) {
  const body = (await statisticsApi.rentalTrends({ fromDate: from, toDate: to, facilityId, granularity }, { signal }))?.data?.data ?? {};
  return {
    granularity: body.granularity || granularity,
    items: (body.items || []).map((row) => ({
      bucketStart: String(row.bucketStart || "").slice(0, 10),
      reservations: row.reservationCount ?? 0,
      paidReservations: row.paidReservationCount ?? 0,
      selfStorage: row.paidSelfStorageRentalCount ?? 0,
      managedInventory: row.paidManagedInventoryRentalCount ?? 0,
      customers: row.uniquePaidCustomers ?? 0,
    })),
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
