// Endpoints the BOM/Admin console is already able to call, but the API does not expose yet.
//
// The UI is built against these capabilities: every screen renders its final shape, and the
// parts that need a missing endpoint are disabled instead of pretending to work. When the
// backend ships one of them:
//   1. implement the request in `src/api/pendingApi.js`
//   2. add the path to the allowlist in `src/api/confirmedContract.js`
//   3. flip the matching flag below to `true`
// and the screen starts using it without any other change.
export const BACKEND_CAPABILITIES = {
  // POST /facilities/:id/image-uploads  → { url, publicId } (Cloudinary)
  facilityImageUpload: false,
  // POST /storage-units/:id/image-uploads → { url, publicId } (Cloudinary)
  storageUnitImageUpload: false,
  // GET  /reports/revenue?facilityId=&from=&to=  +  /reports/revenue/export
  // Delivered by the statistics read model: GET /statistics/revenue (+ /statistics/export).
  revenueReport: true,
  // GET  /audit?entityType=&action=&actorId=&facilityId=&from=&to=&page=
  globalAuditSearch: false,
  // GET  /reports/:kind/export?format=csv|xlsx  (server-side export for large ranges)
  // Delivered by GET /statistics/export/{csv|xlsx|pdf}?reportType=…
  serverExport: true,
  // Backend creates Notification rows from reservation / support / maintenance flows.
  notificationProducer: false,
};

// Plain business wording only: this text is rendered next to a disabled control.
const pendingReason = {
  facilityImageUpload: "Tải ảnh trực tiếp chưa khả dụng · hiện nhập URL ảnh đã tải lên.",
  storageUnitImageUpload: "Tải ảnh trực tiếp chưa khả dụng · hiện nhập URL ảnh đã tải lên.",
  revenueReport: "Chưa có nguồn dữ liệu thanh toán cho báo cáo doanh thu.",
  globalAuditSearch: "Chưa tra cứu được nhật ký toàn hệ thống · hiện xem theo từng tài khoản.",
  serverExport: "Xuất tệp phía máy chủ chưa khả dụng · hiện xuất theo dữ liệu đang hiển thị.",
  notificationProducer: "Hệ thống chưa tạo thông báo tự động cho sự kiện nghiệp vụ.",
};

export function capability(key) {
  return {
    ready: Boolean(BACKEND_CAPABILITIES[key]),
    reason: BACKEND_CAPABILITIES[key] ? "" : pendingReason[key] || "",
  };
}
