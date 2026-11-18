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

// Any report the statistics export router supports:
// GET /statistics/export/{csv|xlsx|pdf}?reportType=revenue|facilities-kpi|reservations|…
// `filters` carries the report-specific query keys the backend allowlists (granularity,
// serviceType, unitSize…); unknown keys are rejected with 400, so they are never guessed here.
export async function exportStatistics({ reportType, format = "csv", from, to, facilityId, filters = {}, signal } = {}) {
  const response = await statisticsApi.exportFile(format, {
    reportType,
    fromDate: from,
    toDate: to,
    facilityId,
    ...filters,
  }, { signal });
  return {
    blob: response?.data instanceof Blob ? response.data : new Blob([response?.data ?? ""]),
    filename: `${reportType}${from ? `-${from}` : ""}${to ? `-${to}` : ""}.${format}`,
  };
}

// Reservation lifecycle report: GET /statistics/reservations?fromDate&toDate&facilityId&granularity
// The backend counts every reservation created in the requested period, across every facility the
// caller may see, so the console no longer stops at the first 12 facilities.
export async function loadReservationReport({ from, to, facilityId, granularity = "month", signal } = {}) {
  const body = (await statisticsApi.reservations({ fromDate: from, toDate: to, facilityId, granularity }, { signal }))?.data?.data ?? {};
  return {
    granularity: body.granularity || granularity,
    totals: {
      total: body.totalReservations ?? null,
      paid: body.paidReservations ?? null,
      pendingPayment: body.pendingPaymentReservations ?? null,
      awaitingContract: body.awaitingContractReservations ?? null,
      active: body.activeReservations ?? null,
      cancelled: body.cancelledReservations ?? null,
      completed: body.completedReservations ?? null,
      overdue: body.overdueReservations ?? null,
      cancellationRate: body.cancellationRate ?? null,
    },
    byStatus: Object.entries(body.reservationsByStatus || {})
      .map(([status, count]) => ({ status, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count),
    byService: (body.reservationsByService || []).map((row) => ({
      service: row.serviceType,
      total: row.total ?? 0,
      active: row.active ?? 0,
      cancelled: row.cancelled ?? 0,
    })),
    byFacility: (body.reservationsByFacility || []).map((row) => ({
      facilityId: row.facilityId,
      total: row.total ?? 0,
      active: row.active ?? 0,
      cancelled: row.cancelled ?? 0,
    })),
    items: (body.reservationTrend || []).map((row) => ({
      bucketStart: String(row.bucketStart || "").slice(0, 10),
      service: row.serviceType,
      total: row.total ?? 0,
      paid: row.paid ?? 0,
      active: row.active ?? 0,
      cancelled: row.cancelled ?? 0,
    })),
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
