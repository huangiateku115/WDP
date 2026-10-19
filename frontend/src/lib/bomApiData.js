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

// Bounded server-side paging: fetches at most MAX_PAGES pages and flattens the rows.
// `list` is an API list method accepting (params, config) (config carries the abort signal).
export async function fetchPaged(list, params = {}, { signal, maxPages = MAX_PAGES } = {}) {
  const first = responseList(await list({ page: 1, limit: PAGE_LIMIT, ...params }, { signal }));
  let rows = first.rows;
  const totalPages = first.pagination?.totalPages || 1;
  const pages = Math.min(totalPages, maxPages);
  for (let page = 2; page <= pages; page += 1) {
    rows = rows.concat(responseList(await list({ page, limit: PAGE_LIMIT, ...params }, { signal })).rows);
  }
  return { rows, total: first.pagination?.total ?? rows.length, truncated: totalPages > pages };
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

// Cross-facility reservations. The backend only exposes reservations per facility,
// so we fetch the facilities in parallel and bound the number of calls.
const MAX_FACILITY_FETCHES = 12;

export async function loadReservations(facilities, { signal } = {}) {
  const targets = facilities.slice(0, MAX_FACILITY_FETCHES);
  const chunks = await Promise.all(
    targets.map((facility) =>
      bomReservationApi
        .listByFacility(facility.id, { signal })
        .then((response) => responseList(response).rows.map((row) => ({ ...reservationFromDto(row), facilityId: facility.id })))
        .catch(() => []), // one failing facility must not blank the whole dashboard
    ),
  );
  return { rows: chunks.flat(), truncated: facilities.length > targets.length };
}

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

export async function loadFacilityUnits(facilityId, { signal, ...params } = {}) {
  const list = (query, config) => bomUnitApi.listByFacility(facilityId, query, config);
  const { rows, total, truncated } = await fetchPaged(list, params, { signal });
  return { rows: rows.map(unitFromDto), total, truncated };
}

export async function loadFacilityInventory(facilityId, { signal, ...params } = {}) {
  const { rows, total, truncated } = await fetchPaged(bomInventoryApi.list, { facilityId, ...params }, { signal });
  return { rows: rows.map(inventoryItemFromDto), total, truncated };
}

// Cross-facility inventory read. The list endpoint accepts facilityId/customerId/category/
// status/search plus page+limit, so the console filters server-side and bounds the paging.
export async function loadInventoryItems(params = {}, { signal } = {}) {
  const { rows, total, truncated } = await fetchPaged(bomInventoryApi.list, params, { signal });
  return { rows: rows.map(inventoryItemFromDto), total, truncated };
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

export async function loadZones(facilityId, { signal } = {}) {
  const { rows, total, truncated } = await fetchPaged(bomWarehouseApi.zones, { facilityId }, { signal });
  return { rows: rows.map(zoneFromDto), total, truncated };
}

export async function loadRacks(facilityId, { signal } = {}) {
  const { rows, total, truncated } = await fetchPaged(bomWarehouseApi.racks, { facilityId }, { signal });
  return { rows: rows.map(rackFromDto), total, truncated };
}

export async function loadCells(facilityId, rackId, { signal } = {}) {
  const { rows, total, truncated } = await fetchPaged(bomWarehouseApi.cells, { facilityId, rackId }, { signal });
  return { rows: rows.map(cellFromDto), total, truncated };
}
