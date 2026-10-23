import axiosClient from "./axiosClient";

// Confirmed customer-profile endpoints (backend routes/customer-profile.routes.ts).
// Internal list/detail/verify require FACILITY_MANAGER, ADMIN or BOM on the backend.
// `me` routes are for the signed-in customer.
const encode = (id) => encodeURIComponent(id);

const customerProfileApi = {
  list: (config) => axiosClient.get("/customers", config),
  get: (id, config) => axiosClient.get(`/customers/${encode(id)}`, config),
  verify: (id, { status, note }) => axiosClient.patch(`/customers/${encode(id)}/verify`, { status, note }),
  getMine: (config) => axiosClient.get("/customers/me/profile", config),
  updateMine: ({ identityCard, address, taxCode }) =>
    axiosClient.put("/customers/me/profile", { identityCard, address, taxCode }),
};

export default customerProfileApi;
