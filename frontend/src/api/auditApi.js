import axiosClient from "./axiosClient";

// Confirmed Admin audit endpoints (backend routes/audit.routes.ts).
// Login History and Audit logs are scoped to a single backend user id.
const auditApi = {
  getAdminLoginHistory: (userId) => axiosClient.get(`/audit/admin/login-history/${encodeURIComponent(userId)}`),
  getAdminAuditLogs: (userId) => axiosClient.get(`/audit/admin/audit-logs/${encodeURIComponent(userId)}`),
};

export default auditApi;
