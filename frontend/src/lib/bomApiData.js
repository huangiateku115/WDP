import { bomContractApi, bomFacilityApi, bomInventoryApi, bomReservationApi, bomUnitApi, bomWarehouseApi } from "@/api/bomApi";
import { apiErrorMessage } from "@/lib/apiError";
import {
  cellFromDto, facilityFromDto, inventoryItemFromDto, itemMovementFromDto, rackFromDto, reservationFromDto,
  responseData, responseList, unitFromDto, warehouseFromDto, zoneFromDto,
} from "@/lib/bomMappers";

const PAGE_LIMIT = 100;
// Hard bound on sequential page round-trips so a large collection never stalls the client.
const MAX_PAGES = 3;
const FACILITIES_TTL_MS = 30000;
// Page size used when a screen renders its own pager and asks the backend for ONE page.
export const PAGE_SIZE = 20;

// Two modes, both server-side:
//   • `page` given → a real paged read: one request for that page, `pagination` returned untouched
//     so the screen can render previous/next. This is the mode every paged list should use.
//   • `page` omitted → the legacy bounded read: at most MAX_PAGES pages flattened, with
//     `truncated` telling the screen that narrowing the filters is required.
// `list` is an API list method accepting (params, config) (config carries the abort signal).
export async function fetchPaged(list, params = {}, { signal, maxPages = MAX_PAGES, page, pageSize = PAGE_SIZE } = {}) {
  if (page !== undefined) {
    const single = responseList(await list({ page, limit: pageSize, ...params }, { signal }));
    const pagination = single.pagination ?? null;
    return {
      rows: single.rows,
      total: pagination?.total ?? single.rows.length,
      truncated: false,
      pagination: pagination ?? { page, limit: pageSize, total: single.rows.length, totalPages: 1 },
    };
  }
  const first = responseList(await list({ page: 1, limit: PAGE_LIMIT, ...params }, { signal }));
  let rows = first.rows;
  const totalPages = first.pagination?.totalPages || 1;
  const pages = Math.min(totalPages, maxPages);
  for (let page = 2; page <= pages; page += 1) {
    rows = rows.concat(responseList(await list({ page, limit: PAGE_LIMIT, ...params }, { signal })).rows);
  }
  return { rows, total: first.pagination?.total ?? rows.length, truncated: totalPages > pages, pagination: first.pagination ?? null };
}

// Facilities are shared across the BOM pages, so cache them briefly and de-duplicate
// concurrent callers. The shared fetch is intentionally NOT bound to a caller signal,
// otherwise one unmounting page would cancel the request for everyone.
let facilitiesCache = { at: 0, data: null, promise: null };

export function invalidateFacilities() {
  facilitiesCache = { at: 0, data: null, promise: null };
}

export async function loadFacilities() {
  if (facilitiesCache.data && Date.now() - facilitiesCache.at < FACILITIES_TTL_MS) return facilitiesCache.data;
  if (facilitiesCache.promise) return facilitiesCache.promise;
  const promise = fetchPaged(bomFacilityApi.list, {}, {})
    .then(({ rows }) => {
      const data = rows.map(facilityFromDto);
      facilitiesCache = { at: Date.now(), data, promise: null };
      return data;
    })
    .catch((error) => {
      facilitiesCache.promise = null;
      throw error;
    });
  facilitiesCache.promise = promise;
  return promise;
}

export const facilityName = (facilities, id) =>
  facilities.find((f) => f.id === id)?.name || "Unknown facility";

// Soft-deleted facilities are hidden from every list unless ADMIN/BOM ask for them
// (facility.service.ts requires a management role for includeDeleted=true).
export async function loadFacilitiesIncludingDeleted({ signal } = {}) {
  const { rows } = await fetchPaged(bomFacilityApi.list, { includeDeleted: "true" }, { signal });
  return rows.map(facilityFromDto).filter((facility) => facility.deleted);
}

// Reservation rows are read for ONE facility at a time. The backend exposes reservations per
// facility only and defaults `GET /reservations/facility/:id` to SELF_STORAGE
// (reservation.controller.ts), so both scopes are requested explicitly — sequentially, never as a
// cross-facility fan-out. Cross-facility counts come from `/statistics/reservations` instead.
const RESERVATION_SERVICE_TYPES = ["SELF_STORAGE", "MANAGED_INVENTORY"];
const RESERVATION_SCOPE_LABELS = { SELF_STORAGE: "private storage", MANAGED_INVENTORY: "Managed Inventory" };
const isCanceled = (error) => error?.code === "ERR_CANCELED" || error?.name === "CanceledError" || error?.name === "AbortError";

// A failing scope is reported to the caller instead of being swallowed (a silent zero understates
// every reservation KPI). The two reads run one after another so the console never opens two
// parallel request streams for the same facility.
async function facilityReservations(facilityId, { signal } = {}) {
  const rows = [];
  const failedServiceTypes = [];
  for (const serviceType of RESERVATION_SERVICE_TYPES) {
    try {
      const response = await bomReservationApi.listByFacility(facilityId, { signal, params: { serviceType } });
      rows.push(...responseList(response).rows.map((row) => ({ ...reservationFromDto(row), facilityId })));
    } catch (error) {
      if (isCanceled(error)) throw error;
      failedServiceTypes.push(serviceType);
    }
  }
  return { rows, failedServiceTypes };
}

export const reservationScopeLabel = (failedServiceTypes = []) =>
  failedServiceTypes.map((serviceType) => RESERVATION_SCOPE_LABELS[serviceType] || serviceType).join(" and ");

/* ---------------------- Facility-scoped oversight reads ---------------------- */
// The backend exposes no cross-facility aggregate endpoint, so oversight loads one
// facility at a time and fires its four scoped reads in parallel (no N+1 fan-out).

export async function loadWarehouseStructure(facilityId, { signal } = {}) {
  try {
    const dto = responseData(await bomWarehouseApi.map(facilityId, { signal }));
    return { ...warehouseFromDto(dto), available: true, reason: "" };
  } catch (error) {
    if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") throw error;
    // 404/409 mean the facility is outside the warehouse map (not ACTIVE, or it does not
    // offer MANAGED_INVENTORY). That is a valid facility state, not a page failure, so the
    // caller receives an empty structure plus the backend reason.
    const status = error?.response?.status;
    if (status === 404 || status === 409) {
      return { zones: [], racks: [], available: false, reason: apiErrorMessage(error) };
    }
    throw error;
  }
}

export async function loadFacilityUnits(facilityId, { signal, page, pageSize, ...params } = {}) {
  const list = (query, config) => bomUnitApi.listByFacility(facilityId, query, config);
  const { rows, total, truncated, pagination } = await fetchPaged(list, params, { signal, page, pageSize });
  return { rows: rows.map(unitFromDto), total, truncated, pagination };
}

export async function loadFacilityInventory(facilityId, { signal, page, pageSize, ...params } = {}) {
  const { rows, total, truncated, pagination } = await fetchPaged(bomInventoryApi.list, { facilityId, ...params }, { signal, page, pageSize });
  return { rows: rows.map(inventoryItemFromDto), total, truncated, pagination };
}

// Cross-facility inventory read. The list endpoint accepts facilityId/customerId/category/
// status/search plus page+limit, so the console filters server-side and pages what it reads.
export async function loadInventoryItems(params = {}, { signal, page, pageSize } = {}) {
  const { rows, total, truncated, pagination } = await fetchPaged(bomInventoryApi.list, params, { signal, page, pageSize });
  return { rows: rows.map(inventoryItemFromDto), total, truncated, pagination };
}

export async function loadInventoryItem(id, { signal } = {}) {
  return inventoryItemFromDto(responseData(await bomInventoryApi.get(id, { signal })));
}

export async function loadItemMovements(id, { signal } = {}) {
  const response = await bomInventoryApi.movements(id, { signal });
  const rows = Array.isArray(response?.data?.data) ? response.data.data : [];
  return rows.map(itemMovementFromDto);
}

export async function loadFacilityReservations(facilityId, { signal } = {}) {
  const response = await bomReservationApi.listByFacility(facilityId, { signal });
  return responseList(response).rows.map((row) => ({ ...reservationFromDto(row), facilityId }));
}

// Cross-service read used by the oversight console: private storage AND Managed inventory,
// with the failed scopes surfaced so the page can label incomplete counts.
export async function loadFacilityReservationsAll(facilityId, { signal } = {}) {
  return facilityReservations(facilityId, { signal });
}

// Paged collection read (GET /reservations/admin-list). It is the only reservation list that
// accepts page/limit, so consoles browse one page at a time instead of downloading a whole
// facility history. Facility roles are scoped to their assignment by the backend itself.
export async function loadAdminReservations(params = {}, { signal, page, pageSize = PAGE_SIZE } = {}) {
  const query = { ...params };
  if (page !== undefined) { query.page = page; query.limit = pageSize; }
  const body = (await bomReservationApi.adminList(query, { signal }))?.data?.data;
  const items = Array.isArray(body?.items) ? body.items : [];
  const pagination = body?.pagination ?? null;
  return { rows: items.map((row) => reservationFromDto(row)), total: pagination?.total ?? items.length, pagination };
}

// A contract can only be discovered through its reservation with the current backend surface.
// GET /contracts/:id and GET /contracts/reservation/:reservationId are the only reads; there is
// no collection endpoint, so a contract list must never fan out one request per reservation.
export async function loadContractForReservation(reservationId, { signal } = {}) {
  const dto = responseData(await bomContractApi.byReservation(reservationId, { signal }));
  if (!dto) throw new Error("No contract is attached to this reservation yet.");
  return { id: dto._id || dto.id, code: dto.contractCode || "" };
}

// Managed capacity configuration. The endpoint answers 404 for facilities that are not
// active Managed Inventory or have no capacity configured, which is a valid "not
// configured" state rather than an error.
export async function loadManagedCapacity(facilityId, { startDate, endDate, signal } = {}) {
  try {
    return responseData(await bomReservationApi.managedCapacity(facilityId, { startDate, endDate }, { signal }));
  } catch (error) {
    if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") throw error;
    return null;
  }
}

/* --------------------- Warehouse structure collections --------------------- */
// The list endpoints require an explicit facilityId for BOM/ADMIN, otherwise the backend
// narrows the query to ACTIVE MANAGED_INVENTORY facilities only. Each endpoint also
// validates the facility, so a non-managed facility answers 409 instead of an empty list.

export async function loadZones(facilityId, { signal, page, pageSize } = {}) {
  const { rows, total, truncated, pagination } = await fetchPaged(bomWarehouseApi.zones, { facilityId }, { signal, page, pageSize });
  return { rows: rows.map(zoneFromDto), total, truncated, pagination };
}

export async function loadRacks(facilityId, { signal, page, pageSize } = {}) {
  const { rows, total, truncated, pagination } = await fetchPaged(bomWarehouseApi.racks, { facilityId }, { signal, page, pageSize });
  return { rows: rows.map(rackFromDto), total, truncated, pagination };
}

export async function loadCells(facilityId, rackId, { signal, page, pageSize } = {}) {
  const { rows, total, truncated, pagination } = await fetchPaged(bomWarehouseApi.cells, { facilityId, rackId }, { signal, page, pageSize });
  return { rows: rows.map(cellFromDto), total, truncated, pagination };
}
