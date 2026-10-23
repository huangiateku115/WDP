import axiosClient from "./axiosClient";

// Confirmed maintenance-ticket endpoints (backend routes/maintenance-ticket.routes.ts).
// ADMIN/BOM/FACILITY_MANAGER/FACILITY_STAFF may read; assign/unassign/update are manager-only.
const maintenanceApi = {
  list: (config) => axiosClient.get("/maintenance-tickets", config),
  get: (id, config) => axiosClient.get(`/maintenance-tickets/${encodeURIComponent(id)}`, config),
  assign: (id, assignedTo) => axiosClient.post(`/maintenance-tickets/${encodeURIComponent(id)}/assign`, { assignedTo }),
  unassign: (id) => axiosClient.post(`/maintenance-tickets/${encodeURIComponent(id)}/unassign`),
  setStatus: (id, payload) => axiosClient.patch(`/maintenance-tickets/${encodeURIComponent(id)}/status`, payload),
};

export default maintenanceApi;
