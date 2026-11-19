import axiosClient from "./axiosClient";

// Confirmed Admin/BOM audit endpoints (backend routes/audit.routes.ts).
// Login History and the per-account audit detail stay scoped to a single backend user id.
// BOM calls additionally require the target account to be below BOM level (not ADMIN/BOM).
const auditApi = {
  // Paged, light collection read: returns the list DTO (action/entity/actor/facility/createdAt)
  // plus pagination, so browsing a long history never downloads every before/after snapshot.
  // BOM is scoped to sub-accounts by the backend itself.
  listLogs: (params, config) => axiosClient.get("/audit/logs", { ...config, params }),
  // Paged account picker. `scope` is "admin" or "bom" (backend enforces the role split).
  listSubjects: (scope, params, config) => axiosClient.get(`/audit/${scope}/subjects`, { ...config, params }),
  getAdminLoginHistory: (userId) => axiosClient.get(`/audit/admin/login-history/${encodeURIComponent(userId)}`),
  getAdminAuditLogs: (userId) => axiosClient.get(`/audit/admin/audit-logs/${encodeURIComponent(userId)}`),
  getBomLoginHistory: (userId, config) => axiosClient.get(`/audit/bom/login-history/${encodeURIComponent(userId)}`, config),
  getBomAuditLogs: (userId, config) => axiosClient.get(`/audit/bom/audit-logs/${encodeURIComponent(userId)}`, config),
};

export default auditApi;
