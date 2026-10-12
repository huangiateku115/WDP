import axiosClient from "./axiosClient";

// Confirmed maintenance-ticket endpoints (backend routes/maintenance-ticket.routes.ts).
// ADMIN/BOM/FACILITY_MANAGER/FACILITY_STAFF may read these.
const maintenanceApi = {
  list: (config) => axiosClient.get("/maintenance-tickets", config),
  get: (id, config) => axiosClient.get(`/maintenance-tickets/${encodeURIComponent(id)}`, config),
};

export default maintenanceApi;
