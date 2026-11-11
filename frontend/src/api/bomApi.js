import axiosClient from "./axiosClient";

// Live BOM business API clients.
// Endpoints are confirmed by the backend Postman collection (WDP-Backend.postman_collection.json).
// Facility and Pricing Rule writes retain the backend ADMIN/BOM permissions. Policy APIs are read-only.

const encode = (id) => encodeURIComponent(id);

export const bomFacilityApi = {
  list: (params, config) => axiosClient.get("/facilities", { ...config, params }),
  get: (id, config) => axiosClient.get(`/facilities/${encode(id)}`, config),
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
  resolve: (params) => axiosClient.get("/policies/resolve", { params }),
};

export const bomReservationApi = {
  listByFacility: (facilityId, config) => axiosClient.get(`/reservations/facility/${encode(facilityId)}`, config),
  get: (id, config) => axiosClient.get(`/reservations/${encode(id)}`, config),
  managedCapacity: (facilityId, params, config) =>
    axiosClient.get(`/reservations/managed/capacity/${encode(facilityId)}`, { ...config, params }),
  // Quota configuration is writable by FACILITY_MANAGER, ADMIN and BOM.
  configureCapacity: (facilityId, body) =>
    axiosClient.put(`/reservations/managed/capacity/${encode(facilityId)}`, body),
};

// Warehouse structure. ADMIN/BOM/FACILITY_MANAGER can write zones and racks; rack cells
// only accept a limited PATCH (maxWeightKg, dimensions, operationalStatus).
export const bomWarehouseApi = {
  map: (facilityId, config) => axiosClient.get("/warehouse-map", { ...config, params: { facilityId } }),
  zones: (params, config) => axiosClient.get("/warehouse-zones", { ...config, params }),
  zone: (id, config) => axiosClient.get(`/warehouse-zones/${encode(id)}`, config),
  createZone: (body) => axiosClient.post("/warehouse-zones", body),
  updateZone: (id, body) => axiosClient.patch(`/warehouse-zones/${encode(id)}`, body),
  deleteZone: (id) => axiosClient.delete(`/warehouse-zones/${encode(id)}`),
  racks: (params, config) => axiosClient.get("/racks", { ...config, params }),
  rack: (id, config) => axiosClient.get(`/racks/${encode(id)}`, config),
  rackDetail: (id, config) => axiosClient.get(`/racks/${encode(id)}/detail-map`, config),
  createRack: (body) => axiosClient.post("/racks", body),
  updateRack: (id, body) => axiosClient.patch(`/racks/${encode(id)}`, body),
  deleteRack: (id) => axiosClient.delete(`/racks/${encode(id)}`),
  cells: (params, config) => axiosClient.get("/rack-cells", { ...config, params }),
  cell: (id, config) => axiosClient.get(`/rack-cells/${encode(id)}`, config),
  updateCell: (id, body) => axiosClient.patch(`/rack-cells/${encode(id)}`, body),
};

// Reservation review. SELF_STORAGE approval/rejection belongs to FACILITY_MANAGER and ADMIN;
// Managed approval/rejection/activation belongs to FACILITY_MANAGER and ADMIN as well.
// The Managed mock payment accepts CUSTOMER (owner), ADMIN and BOM.
export const bomReservationWriteApi = {
  approve: (id) => axiosClient.patch(`/reservations/${encode(id)}/approve`),
  reject: (id, reason) => axiosClient.patch(`/reservations/${encode(id)}/reject`, { reason }),
  managedGet: (id, config) => axiosClient.get(`/reservations/managed/${encode(id)}`, config),
  managedApprove: (id) => axiosClient.patch(`/reservations/managed/${encode(id)}/approve`),
  managedReject: (id, reason) => axiosClient.patch(`/reservations/managed/${encode(id)}/reject`, { reason }),
  managedActivate: (id) => axiosClient.patch(`/reservations/managed/${encode(id)}/activate`),
  managedMockPay: (id) => axiosClient.post(`/reservations/managed/${encode(id)}/mock-pay`),
};

export const bomContractApi = {
  byReservation: (reservationId, config) => axiosClient.get(`/contracts/reservation/${encode(reservationId)}`, config),
  get: (id, config) => axiosClient.get(`/contracts/${encode(id)}`, config),
};

export const bomInventoryApi = {
  list: (params, config) => axiosClient.get("/inventory-items", { ...config, params }),
  get: (id, config) => axiosClient.get(`/inventory-items/${encode(id)}`, config),
  // Immutable ledger written by Staff-confirmed inbounds (ADMIN/BOM/FM/STAFF may read it).
  movements: (id, config) => axiosClient.get(`/inventory-items/${encode(id)}/movements`, config),
};

export const bomUnitApi = {
  listByFacility: (facilityId, params, config) =>
    axiosClient.get(`/facilities/${encode(facilityId)}/storage-units`, { ...config, params }),
  get: (id, config) => axiosClient.get(`/storage-units/${encode(id)}`, config),
  create: (facilityId, body) => axiosClient.post(`/facilities/${encode(facilityId)}/storage-units`, body),
  update: (id, body) => axiosClient.patch(`/storage-units/${encode(id)}`, body),
  setStatus: (id, status) => axiosClient.patch(`/storage-units/${encode(id)}/status`, { status }),
  remove: (id) => axiosClient.delete(`/storage-units/${encode(id)}`),
  restore: (id) => axiosClient.post(`/storage-units/${encode(id)}/restore`),
};

export default {
  bomFacilityApi, bomPricingApi, bomPolicyApi, bomReservationApi, bomReservationWriteApi,
  bomWarehouseApi, bomInventoryApi, bomUnitApi, bomContractApi,
};
