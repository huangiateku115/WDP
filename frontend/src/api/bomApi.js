import axiosClient from "./axiosClient";

// Live BOM business API clients.
// Endpoints are confirmed by the backend Postman collection (WDP-Backend.postman_collection.json).
// Facility/Pricing/Policy writes require the ADMIN or BOM role on the backend.

const encode = (id) => encodeURIComponent(id);

export const bomFacilityApi = {
  list: (params, config) => axiosClient.get("/facilities", { ...config, params }),
  get: (id) => axiosClient.get(`/facilities/${encode(id)}`),
  create: (body) => axiosClient.post("/facilities", body),
  update: (id, body) => axiosClient.patch(`/facilities/${encode(id)}`, body),
  setStatus: (id, status) => axiosClient.patch(`/facilities/${encode(id)}/status`, { status }),
  remove: (id) => axiosClient.delete(`/facilities/${encode(id)}`),
  restore: (id) => axiosClient.post(`/facilities/${encode(id)}/restore`),
};

export const bomPricingApi = {
  list: (params, config) => axiosClient.get("/pricing-rules", { ...config, params }),
  get: (id) => axiosClient.get(`/pricing-rules/${encode(id)}`),
  create: (body) => axiosClient.post("/pricing-rules", body),
  update: (id, body) => axiosClient.patch(`/pricing-rules/${encode(id)}`, body),
  setActive: (id, isActive) => axiosClient.patch(`/pricing-rules/${encode(id)}/status`, { isActive }),
  resolve: (params) => axiosClient.get("/pricing-rules/resolve", { params }),
};

export const bomPolicyApi = {
  list: (params, config) => axiosClient.get("/policies", { ...config, params }),
  get: (id) => axiosClient.get(`/policies/${encode(id)}`),
  create: (body) => axiosClient.post("/policies", body),
  update: (id, body) => axiosClient.patch(`/policies/${encode(id)}`, body),
  setActive: (id, isActive) => axiosClient.patch(`/policies/${encode(id)}/status`, { isActive }),
  resolve: (params) => axiosClient.get("/policies/resolve", { params }),
};

export const bomReservationApi = {
  listByFacility: (facilityId, config) => axiosClient.get(`/reservations/facility/${encode(facilityId)}`, config),
  get: (id, config) => axiosClient.get(`/reservations/${encode(id)}`, config),
  managedCapacity: (facilityId, params, config) =>
    axiosClient.get(`/reservations/managed/capacity/${encode(facilityId)}`, { ...config, params }),
};

// Read-only cross-facility oversight. Warehouse map / racks / cells accept the BOM
// role as a reader; inventory items are readable by ADMIN/BOM/MANAGER/STAFF.
export const bomWarehouseApi = {
  map: (facilityId, config) => axiosClient.get("/warehouse-map", { ...config, params: { facilityId } }),
  zones: (params, config) => axiosClient.get("/warehouse-zones", { ...config, params }),
  racks: (params, config) => axiosClient.get("/racks", { ...config, params }),
  rackDetail: (id, config) => axiosClient.get(`/racks/${encode(id)}/detail-map`, config),
  cells: (params, config) => axiosClient.get("/rack-cells", { ...config, params }),
};

export const bomInventoryApi = {
  list: (params, config) => axiosClient.get("/inventory-items", { ...config, params }),
  get: (id, config) => axiosClient.get(`/inventory-items/${encode(id)}`, config),
};

export const bomUnitApi = {
  listByFacility: (facilityId, params, config) =>
    axiosClient.get(`/facilities/${encode(facilityId)}/storage-units`, { ...config, params }),
  get: (id, config) => axiosClient.get(`/storage-units/${encode(id)}`, config),
};

export default {
  bomFacilityApi, bomPricingApi, bomPolicyApi, bomReservationApi, bomWarehouseApi, bomInventoryApi, bomUnitApi,
};
