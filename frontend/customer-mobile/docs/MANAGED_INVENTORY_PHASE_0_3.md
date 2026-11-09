# Kho ký gửi trên Mobile · Phase 0–3

## Audit khả năng Backend

Các endpoint dưới đây dùng prefix `/api/v1`. Version trong bảng là version nghiệp vụ, độc lập với prefix HTTP.

| Chức năng | Endpoint và khả năng | Version | Mobile | Bằng chứng source |
| --- | --- | --- | --- | --- |
| Dashboard và đơn thuộc Customer | GET `/reservations/me`, GET `/reservations/managed/:id` | Legacy/V2 có phân biệt | Đọc | `backend/src/controllers/reservations/reservation.controller.ts:283`, `backend/src/services/reservations/managed-reservation.service.ts:415` |
| Facility, tìm kiếm và phân trang | GET `/public/facilities?serviceType=MANAGED_INVENTORY`, GET `/public/facilities/:id` | Chung | Đọc | `backend/src/routes/public.routes.ts:5`, `backend/src/services/public/public-catalog.service.ts:36` |
| Giá và kỳ hạn | GET `/pricing-rules` với `MANAGED_INVENTORY/PER_M3` | Chung | Đọc và lọc kỳ hạn hiệu lực tại ngày bắt đầu | `backend/src/routes/pricing-policy.routes.ts:9`, `backend/src/services/reservations/managed-reservation.service.ts:153` |
| Sức chứa | GET `/reservations/managed/capacity/:facilityId` | Chung | Đọc theo kỳ | `backend/src/services/reservations/managed-reservation.service.ts:397` |
| Quote và kiểm tra ô | POST `/reservations/managed/quote`, chỉ tính và đọc | V2 nếu response có `bookingFlowVersion: 2` | Kết nối, khóa khi không có V2 | `backend/src/controllers/reservations/managed-reservation.controller.ts:15`, `backend/src/services/reservations/managed-reservation.service.ts:267`, dòng 284 |
| Tạo đơn và HOLD | POST `/reservations/managed` | Dùng chung, version do môi trường quyết định | Khóa ghi | `backend/src/services/reservations/managed-reservation.service.ts:29`, dòng 59, dòng 313 |
| Topology và ô | GET `/warehouse-map`, GET `/racks/:id/detail-map` | Projection chung | Đọc, chọn nhiều ô cho báo giá thuê | `backend/src/routes/warehouse-map.routes.ts:12`, `backend/src/services/warehouse-map/warehouse-map.service.ts:191`, dòng 656, dòng 730 |
| Hồ sơ hàng và lịch sử | GET `/inventory-items/me`, GET `/inventory-items/:id`, GET `/inventory-items/:id/movements` | InventoryItem có thể liên kết đơn V2 | Đọc, phân trang danh sách và kiểm quyền | `backend/src/routes/inventory-item.routes.ts:27`, dòng 42, `backend/src/services/inventory-items/inventory-item.service.ts:684` |
| Tồn theo lô | GET `/inventory-items/:itemId/stock-balance` | Schema 1, source `LEDGER_V2` hoặc `LEGACY_RECONCILED` | Đọc, hiển thị nguồn; không suy ra available khi response thiếu | `backend/src/services/inventory-items/repeated-inbound-operations.service.ts:205`, `backend/src/models/inventory-items/inventory-stock-balance.model.ts:38` |
| SKU và PhysicalUnit canonical | Chưa tìm thấy route Customer hoặc model tương ứng trong source hiện tại | Chưa có | Hiển thị hồ sơ InventoryItem đúng ngữ nghĩa, không gắn số liệu SKU/PhysicalUnit | `backend/src/routes/index.ts`, `backend/src/routes/inventory-item.routes.ts:26` |
| Placement preview | GET `/inventory-items/:id/placement-preview?cellId=…` nhận một ô cho một Item đã có | Một ô | Không dùng cho quote/booking | `backend/src/routes/inventory-item.routes.ts:29`, `backend/src/services/inventory-items/inventory-item.service.ts:1429` |
| Footprint nhiều ô, support, obstacle, certification, revision fence | Chưa tìm thấy read model hoặc preview Customer tương ứng | Chưa có | Không cấp vị trí vật lý và không mô phỏng preview | `backend/src/services/inventory-items/inventory-item.service.ts:1429`, `backend/src/services/warehouse-map/warehouse-map.service.ts:730` |

## Đối chiếu Web và Mobile

Customer Web lấy kỳ hạn theo Pricing Rules, tính ngày kết thúc theo lịch UTC, gọi warehouse/rack map với khoảng thuê và lấy giá từ quote. Web có route tạo đơn dùng chung Managed. Mobile tái sử dụng API client, session và lịch, nhưng chỉ chấp nhận quote V2. Nguồn Web gồm `frontend/src/components/customer/ManagedReservationBooking.jsx:108`, `frontend/src/api/managedReservationApi.js:6`, `frontend/src/api/warehouseMapApi.js:17`.

Backend quote kiểm ô theo trạng thái vận hành, bộ đếm vật lý rỗng, Zone/Rack hoạt động, overlap HOLD/RESERVED/OCCUPIED và dung tích cấu hình. Báo giá không tạo HOLD. Map gắn trạng thái kỳ thuê qua `periodStatus` và khả dụng qua `isBookable`. Mobile yêu cầu Backend trả lại đúng Facility, Rack, Zone và kỳ thuê. Lưới đọc theo số vị trí do Backend trả về, không dựng hình học 3D hoặc suy luận chứng nhận.

## Backend dependencies

- **Tạo Reservation V2.** Backend chỉ gắn version 2 khi `NODE_ENV=development` và `MI_MANAGED_DEPOSIT_FLOW_ENABLED=true`. Create có transaction nhưng request không ràng buộc phải V2, không mang token quote/version giá và controller không đọc `Idempotency-Key`. Cần create chỉ dành cho V2 hoặc điều kiện bắt buộc V2 được xác minh trước khi ghi, kèm khóa idempotency và khả năng tra cứu lần gửi. Xem `managed-reservation.service.ts:29,59,313` và `managed-reservation.controller.ts:16`.
- **Read models tồn và vị trí.** Customer cần API read-only có scope cho SKU, PhysicalUnit, footprints và ô theo lô nếu nghiệp vụ cần đếm hoặc đánh dấu chính xác trên map. Cần trường available authoritative nếu muốn công bố số lượng khả dụng. API stock hiện trả document tồn và không xuất availableQuantity trong schema.
- **Placement preview.** Cần contract preview nhiều ô cho PhysicalUnit có revision fence và kiểm định hình học ở Backend. Quote hiện chỉ xác nhận ô thuê và dung tích, không xác nhận nơi đặt hàng.
- **Gates ngoài phạm vi.** Canonical relocation có gate riêng và bị khóa production trong source. Outbound canonical có gate yêu cầu/xác nhận riêng và yêu cầu quyền ghi ledger. Không tích hợp các mutation đó trong Phase 0–3. Xem `managed-canonical-relocation.service.ts:45` và `managed-outbound-request.service.ts:47,152`.

## Xác minh

GET công khai trên Render với bộ lọc `serviceType=MANAGED_INVENTORY` trả 4 cơ sở và cả 4 khớp dịch vụ. GET `/inventory-items/me` không token trả 401. Chưa có xác minh đọc đã đăng nhập, ghi Reservation hoặc chạy trên thiết bị thật. Kiểm thử tự động dùng HTTP fixtures và không gửi yêu cầu ghi dữ liệu thật.
