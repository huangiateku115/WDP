import axiosClient from "./axiosClient";

// Confirmed Admin/BOM audit endpoints (backend routes/audit.routes.ts).
// Login History and Audit logs are scoped to a single backend user id.
// BOM calls additionally require the target account to be below BOM level (not ADMIN/BOM).
const auditApi = {
  getAdminLoginHistory: (userId) => axiosClient.get(`/audit/admin/login-history/${encodeURIComponent(userId)}`),
  getAdminAuditLogs: (userId) => axiosClient.get(`/audit/admin/audit-logs/${encodeURIComponent(userId)}`),
  getBomLoginHistory: (userId, config) => axiosClient.get(`/audit/bom/login-history/${encodeURIComponent(userId)}`, config),
  getBomAuditLogs: (userId, config) => axiosClient.get(`/audit/bom/audit-logs/${encodeURIComponent(userId)}`, config),
};

export default auditApi;
