import { bomFacilityApi } from "@/api/bomApi";
import { facilityFromDto, responseList } from "@/lib/bomMappers";

// Reads every Facility page from the backend (limit 100 per page) and maps it to the BOM view model.
export async function loadFacilities() {
  const first = responseList(await bomFacilityApi.list({ page: 1, limit: 100 }));
  let rows = first.rows;
  const totalPages = first.pagination?.totalPages || 1;
  for (let page = 2; page <= totalPages; page += 1) {
    rows = rows.concat(responseList(await bomFacilityApi.list({ page, limit: 100 })).rows);
  }
  return rows.map(facilityFromDto);
}

export const facilityName = (facilities, id) =>
  facilities.find((f) => f.id === id)?.name || "Unknown facility";
