import { bomFacilityApi, bomInventoryApi, bomReservationApi, bomUnitApi, bomWarehouseApi } from "@/api/bomApi";
import {
  facilityFromDto, inventoryItemFromDto, reservationFromDto, responseData, responseList, unitFromDto, warehouseFromDto,
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
  const dto = responseData(await bomWarehouseApi.map(facilityId, { signal }));
  return warehouseFromDto(dto);
}

export async function loadFacilityUnits(facilityId, { signal } = {}) {
  const list = (params, config) => bomUnitApi.listByFacility(facilityId, params, config);
  const { rows, total, truncated } = await fetchPaged(list, {}, { signal });
  return { rows: rows.map(unitFromDto), total, truncated };
}

export async function loadFacilityInventory(facilityId, { signal } = {}) {
  const { rows, total, truncated } = await fetchPaged(bomInventoryApi.list, { facilityId }, { signal });
  return { rows: rows.map(inventoryItemFromDto), total, truncated };
}

export async function loadFacilityReservations(facilityId, { signal } = {}) {
  const response = await bomReservationApi.listByFacility(facilityId, { signal });
  return responseList(response).rows.map((row) => ({ ...reservationFromDto(row), facilityId }));
}
