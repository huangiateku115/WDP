# BOM / Admin — Danh sách việc Backend cần làm (2026-11-18)

**Nguồn**: rà UI BOM/Admin đối chiếu **DTO thật** của API production (`https://wdp-m4ns.onrender.com/api/v1`) bằng tài khoản BOM + ADMIN, cộng với rà code BE. Mọi kết luận dưới đây đều có `file:dòng` hoặc payload thật.
**Nhánh FE**: `feat/BOM+Admin` (các mục FE đã sửa xong được ghi ở mục cuối).
**Quy ước chung cho BE**: chỉ **thêm** field/endpoint, **không** đổi tên, **không** đổi ý nghĩa field đang có, **không** sinh dữ liệu mới (đặc biệt `expiresAt`).

## Tổng hợp

| ID | Ưu tiên | Việc | Chạm model/endpoint | Role ảnh hưởng | Effort |
|---|---|---|---|---|---|
| A1 | **P0** | DTO lô hàng V3 trả DTO di sản (thiếu danh mục/số lượng/khối lượng/thể tích) | `GET /inventory-items`, `/:id` | ADMIN, BOM, **FM, STAFF** | 2–3h |
| A2 | **P0** | `effectiveTo` không có trong DTO đọc của bảng giá & chính sách | `GET /pricing-rules*`, `/policies*` | BOM, Admin (+FM nếu dùng) | 30' |
| A3 | P1 | `GET /reservations/:id` thiếu `allocatedCapacity`, `expiresAt`, `rejectReason` | reservation DTO | BOM, Admin, FM, Staff | 1h |
| A4 | P1 | `/customers` populate `userId` thiếu `displayName` | customer-profile list | BOM, Admin | 15' |
| A5 | P1 | `contract.pricingSnapshot` (self-storage) không có `startDate` | contract create ×4 + gia hạn | BOM, Admin, Customer reader | 1h |
| A6 | P2 | `GET /:skuId/specifications` chỉ CUSTOMER | inventory-item routes | BOM, Admin | 15' |
| A7 | P2 | `EmailService` select `fullName` (field không tồn tại) → email thiếu tên | `email.service.ts:194` | Customer (email) | 15' |
| B1 | P1 | Upload ảnh facility / storage-unit + metadata Cloudinary | 2 endpoint mới | BOM, Admin | 1–2 ngày |
| B2 | P1 | Audit toàn cục + danh sách subject cho BOM | `GET /audit/*` | BOM, Admin | 1–2 ngày |
| B3 | P1 | Notification producer + danh sách theo scope | notification | BOM, Admin | 1–2 ngày |
| B4 | P2 | Log email + log upload lỗi | endpoint mới | Admin | 1 ngày |
| B5 | P2 | Danh sách reservation cross-facility + collection Managed | `GET /reservations` | BOM, Admin | 4h |
| B6 | P2 | Bổ sung số liệu báo cáo (pending, growth, kỳ cho utilization) | `/statistics/*` | BOM, Admin | 4h |
| C1 | P2 | Quyết định: BOM có được duyệt/từ chối đơn? | `PATCH /reservations/:id/approve\|reject` | BOM | 15' (nếu mở quyền) |
| C2 | P2 | Đóng/gia hạn quy tắc giá đang hiệu lực | `rule.service.ts` | BOM, Admin | 2–3h |
| C3 | — | Ảnh cho zone/rack/cell | — | — | **Không làm** (ngoài phạm vi MI-01) |

---

## A. Field UI cần nhưng API không trả

### A1 (P0) — Lô hàng V3 hiển thị toàn số 0 vì DTO di sản

**Hiện tượng**: chi tiết lô hàng (`/bom|admin/inventory/:id`) hiện `Số lượng 0`, `Khối lượng đơn vị 0 kg`, `Thể tích 0.00 m³`, `Tổng khối lượng/thể tích 0`, `Danh mục —`, dù bảng biến động ngay dưới ghi "Nhập kho 10 Thùng · 10 kg · 0.08 m³". Danh sách + KPI ("Thể tích đang lưu 0.00 m³") cũng sai theo.

**Nguyên nhân**: `GET /inventory-items/:id` phân nhánh role — `backend/src/routes/inventory-item.routes.ts:67`:

```ts
req.user?.role === UserRole.CUSTOMER ? skuController.get(...) : controller.get(...)
```

- CUSTOMER → `ManagedSkuService.recordDto` (`managed-sku.service.ts:31`) — **có** `categoryId`, `category` (populate), `categoryCode`.
- ADMIN/BOM/FM/STAFF → `InventoryItemService.dto` (`inventory-item.service.ts:88`) — DTO V1/V2: trả `category` (string), `quantity`, `unitWeightKg`, `unitDimensionsM`, `unitVolumeM3`, `totalWeightKg`, `totalVolumeM3` — đúng những field mà model đánh dấu deprecated và **V3 không bao giờ ghi** (`inventory-item.model.ts:22-31`).

Payload thật (BOM, SKU `TEST-M4-20261117-SKU`):
```
_id, createdAt, currentCellId, customerId, description, facilityId, images,
inventorySchemaVersion, itemCode, managedReservationId, name,
receivingCustodyStatus, receivingInspection, status, updatedAt
```

**Đề xuất** (chọn 1 hoặc cả 2, đều additive):
1. Trong `dto()`: populate `categoryId` (`code name`) và trả `categoryId` + `category`/`categoryCode` cho **mọi role** (giống `recordDto`).
2. Thêm object `stock` (optional) đọc từ `ManagedV3StockProjection` khi `inventorySchemaVersion === 3`:
   ```json
   "stock": { "totalQuantity": 10, "quantityUnit": "Thùng",
              "totalWeightKg": 10, "totalVolumeM3": 0.08,
              "byCell": [{ "cellId": "...", "quantityOnHand": 10, "weightKg": 10, "volumeM3": 0.08 }] }
   ```
   (tên field lấy đúng theo `GET /:id/v3/stock` hiện có: `totalQuantity`, `totalWeightKg`, `totalVolumeM3`, `byCell`.)

**Vùng ảnh hưởng**: `itemReaders` = ADMIN, BOM, **FACILITY_MANAGER, FACILITY_STAFF** (`inventory-item.routes.ts:19`). Các trang staff dùng chung endpoint này: `pages/staff/StockBalancePage.jsx`, `MovementHistoryPage.jsx`, `ManagedReceivingQueue.jsx`, `components/facility/FacilityInventoryDetail.jsx`, `lib/facilityInventoryDetail.js` — **nhưng cả 4 đều rẽ nhánh `inventorySchemaVersion === 3` và chuyển sang màn V3**, không đọc field legacy. Vì vậy **thêm field an toàn**; **không** đổi `quantity` từ absent → `null`, **không** đổi tên field cũ.

**Acceptance**: `GET /inventory-items/:id` với token BOM trả `category.name` khác rỗng và `stock.totalQuantity` = 10 / `totalWeightKg` = 10 / `totalVolumeM3` = 0.08 cho SKU V3 có 1 movement nhập 10.

---

### A2 (P0) — `effectiveTo` bị bỏ khỏi DTO đọc (dù ghi được)

**Hiện tượng**: "Hiệu lực đến" ở Bảng giá và Chính sách **không bao giờ** có dữ liệu; form Sửa không prefill được.

**Nguyên nhân**: validator **đã nhận** `effectiveTo` khi tạo/sửa (`rule.validation.ts:105,109`), model có field, nhưng **DTO đọc không trả**:
- `GET /pricing-rules` & `/:id` → `_id, billingBasis, currency, effectiveFrom, facilityId, isActive, price, serviceType, term, version`
- `GET /policies` & `/:id` → `_id, config, effectiveFrom, facilityId, isActive, serviceType, type, version`

**Đề xuất**: thêm `effectiveTo` vào cả 4 DTO (null khi không giới hạn).

**Vùng ảnh hưởng**: additive; consumer hiện tại chỉ là BOM/Admin (`RecordPage`, `PolicyRecordsPage`). FE đã có `hasEffectiveTo` nên sẽ tự hiển thị đúng ngay khi BE trả field.

**Acceptance**: `GET /pricing-rules/:id` trả key `effectiveTo` (null hoặc ISO date).

---

### A3 (P1) — Reservation detail thiếu 3 field

**Hiện tượng**: "Công suất được cấp" luôn 0 m³ với đơn Managed; "Hết hạn giữ chỗ" luôn —; "Lý do từ chối" luôn — (lý do thật chỉ nằm trong `statusHistory[].reason`).

**Nguyên nhân**: `GET /reservations/:id` không trả `allocatedCapacity`, `expiresAt`, `rejectReason` (payload thật đã kiểm).

**Đề xuất** (additive):
- `allocatedCapacity` — trả từ document (có với Managed: `managed-reservation.service.ts:409`).
- `expiresAt` — **chỉ đọc giá trị đã lưu**, không sinh mới.
- `rejectReason` — trả field đã lưu (`reservation.rejectReason`, set bởi `reservation.controller.ts:474` và `managed-reservation.service.ts:550`).

**Vùng ảnh hưởng**: BOM/Admin/FM/Staff dùng `GET /reservations/:id`. **Cảnh báo**: Customer đang dùng `expiresAt` cho logic giữ chỗ/thanh toán (`lib/selfStoragePayos.js:64,109`, `lib/customerDeposit.js:15`, `PaymentHistoryPage.jsx:152`) qua `/reservations/me` — nếu BE bắt đầu **set** `expiresAt` cho đơn mới thì hành vi thanh toán của Customer đổi. Chỉ trả ra, đừng sinh.

**Acceptance**: đơn Managed có `allocatedCapacity` > 0; đơn bị từ chối có `rejectReason` khác rỗng.

---

### A4 (P1) — `/customers` thiếu tên khách hàng

**Hiện tượng**: cột "Khách hàng" / tiêu đề hồ sơ luôn hiện **email**.

**Nguyên nhân**: `GET /customers` populate `userId` chỉ với `{_id, email, phone}` (payload thật). FE fallback `fullName || displayName || email` → rơi xuống email.

**Đề xuất**: populate thêm `displayName` (và `fullName` nếu còn dữ liệu cũ).

**Vùng ảnh hưởng**: chỉ BOM/Admin gọi endpoint này (`CustomerProfilesPage`, `AuditLivePage`, `InventoryItemsPage`). Manager dùng `pages/manager/CustomersPage` → `CustomerApiView` (mock), không gọi.

**Acceptance**: `GET /customers` có `userId.displayName` khác rỗng.

---

### A5 (P1) — `pricingSnapshot` không có `startDate`

**Hiện tượng**: chi tiết hợp đồng Thuê kho riêng — panel "Hồ sơ hợp đồng" có khoảng thuê, panel "Giá và thanh toán" hiện `— → 2027-01-17`.

**Nguyên nhân**: không có điểm tạo snapshot nào ghi `startDate`:
`reservation.service.ts:515`, `reservation.controller.ts:198`, `:456`, `:874`. `endDate` chỉ được thêm khi gia hạn (`reservation.controller.ts:1899`, `:2075`).
(Managed không bị vì `pricingSnapshot = managedPricingSnapshot` — object này **có** `startDate`, `managed-reservation.service.ts:416`.)

**Đề xuất**: ghi `startDate`, `endDate`, `term` khi tạo `pricingSnapshot` ở cả 4 điểm; khi gia hạn cập nhật `startDate` nếu thay đổi.

**Vùng ảnh hưởng**: additive; đọc bởi chi tiết hợp đồng BOM/Admin và màn hợp đồng của Customer (`contractApi`).

**Acceptance**: hợp đồng mới có `pricingSnapshot.startDate` trùng `reservation.startDate`.

---

### A6 (P2) — BOM/Admin không đọc được Item Specification

**Hiện tượng**: cần hiển thị "Quy cách" (đơn vị tính, tải trọng, kích thước) của SKU V3 nhưng endpoint trả lỗi.

**Nguyên nhân**: `inventory-item.routes.ts:26` — `GET /:skuId/specifications` chỉ cho `CUSTOMER`.

**Đề xuất**: mở cho `itemReaders` (chỉ đọc), hoặc xác nhận dùng `GET /:id/v3/stock` → `itemSpecifications[]` là nguồn chính thức (đã trả `code, name, quantityUnit, quantityOnHand/available/held, totalWeightKg, totalVolumeM3, byCell`).

---

### A7 (P2) — Email gửi thiếu tên khách (latent bug)

`backend/src/services/email/email.service.ts:194` — `.select('email fullName')`, nhưng model `User` không có `fullName` (chỉ `displayName`). Mọi email dùng `user.fullName` sẽ rỗng.

**Đề xuất**: đổi sang `'email displayName'` và map `fullName = user.displayName || ''`.

---

## B. Thiếu endpoint

### B1 (P1) — Upload ảnh Facility / Storage Unit + metadata

**Hiện tượng**: QA yêu cầu "tải nhiều ảnh, đặt cover, xoá/thay ảnh, có preview + progress + Cloudinary record". Hiện chỉ nhập được URL; nút "Tải ảnh từ máy" bị **disable có chủ đích**.

**Nguyên nhân**: `upload.middleware.ts` chỉ phục vụ contract proof / inventory receiving / inspection; `facility.routes.ts` và `storage-unit.routes.ts` không có route upload; không có bảng metadata ảnh cho 2 entity này (model chỉ có `images: [String]`).

**Đề xuất**:
- `POST /facilities/:id/image-uploads` (ADMIN, BOM) — multipart, trả `{ url, publicId, width, height, format, expiresAt }`.
- `POST /storage-units/:id/image-uploads` (ADMIN, BOM).
- Metadata theo mẫu `managed-inventory-image.service.ts` (record UPLOADING→ATTACHED, lease + cleanup job, chống upload mồ côi).
- Giữ `images: [String]` là nguồn hiển thị (thứ tự = ảnh bìa đầu tiên).

**Vùng ảnh hưởng**: BOM/Admin (ghi); ảnh facility còn hiển thị công khai/cho Customer → chỉ đọc URL, không đổi contract hiện tại.

**FE đã sẵn**: `components/bom/ImageEditor.jsx` + cờ `backendCapabilities.facilityImageUpload / storageUnitImageUpload` — BE xong chỉ cần bật cờ.

---

### B2 (P1) — Audit toàn cục + subject cho BOM

**Hiện tượng**: Admin chỉ xem audit theo từng tài khoản, không lọc theo thời gian/hành động toàn hệ thống, không export. BOM **chỉ rà soát được khách hàng** (không chọn được STAFF/FM) vì `/users` là ADMIN-only.

**Nguyên nhân**: `audit.routes.ts` chỉ có `GET /audit/{admin,bom}/{login-history,audit-logs}/:userId`.

**Đề xuất**:
1. `GET /audit/logs?eventType&action&entityType&actorId&facilityId&from&to&page&limit` (ADMIN; BOM giới hạn theo phạm vi được xem).
2. `GET /audit/{admin|bom}/subjects` — danh sách tài khoản được phép rà soát (BOM: trừ ADMIN/BOM), để không phải gọi `/users`.
3. Export dùng lại `GET /statistics/export` hoặc `GET /audit/logs/export?format=csv|xlsx`.

**Vùng ảnh hưởng**: chỉ BOM/Admin (endpoint mới).

---

### B3 (P1) — Notification producer + danh sách theo scope

**Hiện tượng**: `/bom/notifications` và `/admin/notifications` **luôn rỗng**.

**Nguyên nhân**: không có chỗ nào tạo Notification (grep toàn BE: 0 `NotificationModel.create/insertMany`, chỉ có seed). API chỉ có `GET /notifications/me` (tài khoản đang đăng nhập).

**Đề xuất**:
1. Sinh notification cho các sự kiện: đơn quá hạn, sự cố bảo trì, upload bằng chứng thất bại, đơn chờ duyệt quá SLA, hết hạn giữ chỗ.
2. `GET /notifications?scope=facility|system&type&isRead&page&limit` cho ADMIN/BOM (kèm `facilityId` khi scope=facility).
3. Tuỳ chọn: `PATCH /notifications/read-all`.

**Vùng ảnh hưởng**: BOM/Admin; giữ nguyên `GET /notifications/me` cho Customer/Staff.

---

### B4 (P2) — Log email + log upload lỗi (màn "Admin → Hệ thống")

`EmailService` chỉ gửi, không lưu (imports chỉ User/Facility/StorageUnit). Đề xuất model `EmailLog { to, template, status, providerId, error, createdAt }` và `UploadFailureLog { actorId, entity, endpoint, status, reason }`, kèm `GET /system/email-logs`, `GET /system/upload-failures` (ADMIN) có filter thời gian + pagination.

---

### B5 (P2) — Danh sách reservation không cần chọn cơ sở

**Hiện tượng**: BOM/Admin phải chọn từng cơ sở mới thấy đơn (do FE đã bỏ fan-out 24 request); không có danh sách Managed.

**Đề xuất**: `GET /reservations?facilityId&serviceType&status&from&to&page&limit` (ADMIN/BOM) và/hoặc `GET /reservations/managed?...`.

**Lưu ý**: đây là thay đổi quyết định UX — FE hiện chấp nhận "chọn cơ sở" và không còn N+1.

---

### B6 (P2) — Số liệu báo cáo còn thiếu

- `GET /statistics/revenue` thiếu tổng **đang chờ thanh toán** (`pendingPayments`) và `growthPercent` (UI đang để trống/"—" thay vì bịa).
- `GET /statistics/utilization` không nhận `fromDate/toDate` (UI chỉ xem được tháng hiện tại).
- Sổ hoàn tiền chưa có → cột "Đã hoàn" chỉ có `refundedAmount` tổng từ payment, không chi tiết.

---

## C. Quyết định nghiệp vụ

### C1 (P2) — BOM có được duyệt/từ chối đơn?

`PATCH /reservations/:id/approve|reject` hiện chỉ `FACILITY_MANAGER, ADMIN` (`reservation.routes.ts:94-95`) ⇒ console BOM chỉ đọc (FE đã ẩn nút và ghi chú đúng).
**Cần chốt**: mở thêm `BOM` (nếu nghiệp vụ cho phép) hoặc giữ nguyên và sửa mô tả trang "Giám sát đơn đặt thuê" (đang hứa "Duyệt đơn sẽ tạo hợp đồng nháp").

### C2 (P2) — Đóng/gia hạn quy tắc giá đang hiệu lực

`rule.service.ts:240-272` không có nhánh "chỉ cập nhật `effectiveTo`": quy tắc đã hiệu lực buộc phải tạo revision mới. UI đã ẩn nút đổi trạng thái và hướng dẫn hẹn giá mới. Nếu nghiệp vụ cần "kết thúc sớm", BE phải cho PATCH `effectiveTo` trên rule đã hiệu lực (có audit + chặn `effectiveTo < now`).

### C3 — Ảnh cho zone / rack / cell

Ngoài phạm vi theo `backend/docs/MI_01_WAREHOUSE_MAP.md:199`; model không có field ảnh. **Không đề nghị làm** trừ khi có yêu cầu sản phẩm mới.

---

## Phía FE đã sẵn sàng (không cần chờ)

| Việc | Trạng thái FE |
|---|---|
| Ẩn field không có nguồn (`allocatedCapacity`, `expiresAt`, `config.rule`, `allowedStatus`, `handlingNotes`, `restrictions`) | ✅ đã ẩn/dẫn xuất từ dữ liệu thật |
| "Lý do từ chối" | ✅ suy ra từ `statusHistory[].reason` (tự chuyển sang dùng `rejectReason` khi BE trả) |
| `effectiveTo` | ✅ có cờ `hasEffectiveTo`, tự hiển thị khi BE trả field |
| Kỳ tính giá hợp đồng | ✅ fallback `reservation.startDate/endDate` |
| Danh mục chuẩn (id vs `_id`) | ✅ đã chuẩn hoá |
| Upload ảnh | ✅ UI + preview + thứ tự + cover đã xong; chờ 2 endpoint để bật cờ |
| Audit / Notification / Báo cáo | ⏸ chờ API (không dựng dữ liệu giả) |
