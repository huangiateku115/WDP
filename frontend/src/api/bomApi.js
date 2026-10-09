import axiosClient from "./axiosClient";

// Live BOM business API clients.
// Endpoints are confirmed by the backend Postman collection (WDP-Backend.postman_collection.json).
// Facility/Pricing/Policy writes require the ADMIN or BOM role on the backend.

const encode = (id) => encodeURIComponent(id);

export const bomFacilityApi = {
  list: (params) => axiosClient.get("/facilities", { params }),
  get: (id) => axiosClient.get(`/facilities/${encode(id)}`),
  create: (body) => axiosClient.post("/facilities", body),
  update: (id, body) => axiosClient.patch(`/facilities/${encode(id)}`, body),
  setStatus: (id, status) => axiosClient.patch(`/facilities/${encode(id)}/status`, { status }),
  remove: (id) => axiosClient.delete(`/facilities/${encode(id)}`),
  restore: (id) => axiosClient.post(`/facilities/${encode(id)}/restore`),
};

export const bomPricingApi = {
  list: (params) => axiosClient.get("/pricing-rules", { params }),
  get: (id) => axiosClient.get(`/pricing-rules/${encode(id)}`),
  create: (body) => axiosClient.post("/pricing-rules", body),
  update: (id, body) => axiosClient.patch(`/pricing-rules/${encode(id)}`, body),
  setActive: (id, isActive) => axiosClient.patch(`/pricing-rules/${encode(id)}/status`, { isActive }),
  resolve: (params) => axiosClient.get("/pricing-rules/resolve", { params }),
};

export const bomPolicyApi = {
  list: (params) => axiosClient.get("/policies", { params }),
  get: (id) => axiosClient.get(`/policies/${encode(id)}`),
  create: (body) => axiosClient.post("/policies", body),
  update: (id, body) => axiosClient.patch(`/policies/${encode(id)}`, body),
  setActive: (id, isActive) => axiosClient.patch(`/policies/${encode(id)}/status`, { isActive }),
  resolve: (params) => axiosClient.get("/policies/resolve", { params }),
};

export default { bomFacilityApi, bomPricingApi, bomPolicyApi };
