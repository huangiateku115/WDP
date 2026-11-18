// BOM/Admin-only capability switches. They live here instead of lib/backendCapabilities.js so a
// BOM screen never changes behaviour for the Manager or Staff workspaces.
export const BOM_CAPABILITIES = {
  // POST /policies + PATCH /policies/:id (close by effectiveTo) + PATCH /policies/:id/status.
  // The backend still rejects policy writes (rule.service.ts: "Business policies are
  // system-controlled and read-only"), so the console renders the write controls inert.
  // To connect it once the backend ships:
  //   1. add `bomPolicyApi.create/close/setActive` in src/api/bomApi.js
  //   2. allowlist POST policies + PATCH policies/:id(/status) in api/confirmedContract.js
  //   3. add lib/bomMappers.policyBody / policyCloseBody and the policies/new route
  //   4. flip this flag to `true`
  policyWrite: false,
};

// Business wording only: rendered next to a disabled control.
export const POLICY_WRITE_REASON =
  "Chính sách kinh doanh hiện do hệ thống quản lý · chưa tạo hoặc đóng từ màn hình này.";

export function bomCapability(key) {
  return Boolean(BOM_CAPABILITIES[key]);
}
