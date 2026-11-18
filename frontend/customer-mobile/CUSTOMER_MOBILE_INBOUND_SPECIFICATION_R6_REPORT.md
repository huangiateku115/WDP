# Customer Mobile — Inbound & Item Specification R6

**Checkpoint:** `WDP_MOBILE_INBOUND_SPECIFICATION_FIX_R6`

## Kết quả

- Đã sửa Mobile để đọc đúng DTO danh mục đơn vị tính của Backend.
- Item Specification có màn hình riêng để tạo và sửa; khi lưu thành công, Mobile trở về SKU Detail, thông báo và tải lại danh sách khi màn hình được focus.
- Kiểm tra nhập kho có màn hình riêng. Luồng chọn Specification, Access Session, phân bổ số lượng, xem trước, idempotency, revision check và xác nhận vẫn đi qua các adapter hiện tại.
- Cell được tra tên/mã qua sơ đồ kho và chi tiết kệ. Khi chưa xác minh được tên, giao diện ghi “Cell chưa xác định”, không dùng ObjectId thay tên.
- Không gọi API ghi tồn kho, không chạy IT01–IT10, không sửa Backend/Web/.env hoặc dữ liệu MongoDB.

## 1. Vì sao nút “Thêm loại hàng” bị khóa?

Điều kiện disable phụ thuộc vào request tải đơn vị tính: nút bị khóa khi request loading, có lỗi, hoặc không có đơn vị đang hoạt động. Backend trả DTO đơn vị tính với khóa `quantityUnitId` và `id`; Mobile trước đây chỉ chấp nhận `_id`. Zod từ chối response hợp lệ, `useResource` ghi nhận lỗi và nút bị khóa như thể danh mục không tải được.

Đã sửa parser để chuẩn hóa `quantityUnitId` thành định danh nội bộ `_id`. Nếu API thật trả rỗng, lỗi hoặc SKU không phải V3 đang hoạt động, nút tiếp tục bị vô hiệu hóa và hiển thị nguyên nhân tương ứng. Mã/tên đơn vị và form tạo tuân theo giới hạn Backend: mã tối đa 48, tên 160, mô tả 2.000 ký tự, đơn vị đang hoạt động, kích thước và khối lượng dương. Backend tự xác minh lại quyền sở hữu và điều kiện Reservation khi ghi.

## 2. API tạo Item Specification có hoạt động cho Customer không?

Có theo source hiện tại: `GET /inventory-items/:skuId/specifications`, `POST /inventory-items/:skuId/specifications`, `PATCH .../:specId` được gắn role `CUSTOMER`. Backend kiểm tra SKU thuộc Customer và Reservation Managed V3 đủ điều kiện đăng ký; đơn vị tính phải còn active. Customer cũng được phép đọc `GET /managed-inventory-catalog/quantity-units/active`. Đây là xác minh source, không phải xác nhận live request cho tài khoản MIR-261117-0F1A8C.

## 3. API nào gây “Không tải được dữ liệu”?

Source hiện tại dùng chung thông báo đó cho nhiều tài nguyên, nên ảnh chụp không đủ để xác định HTTP response cụ thể đã xảy ra. Với vùng tồn kho ở cuối SKU Detail, Mobile tải Reservation bằng `GET /reservations/me`, sau đó tải tồn V3 bằng `GET /inventory-items/:skuId/v3/stock`. Lỗi đơn vị tính trước đây xảy ra ở `GET /managed-inventory-catalog/quantity-units/active` khi parse sai DTO. Các request này hiện được gắn tên tài nguyên/endpoint riêng; lỗi HTTP hiển thị cả status và `code` nếu Backend trả code. Không có phiên/token và response mạng của lần lỗi thực tế trong phiên kiểm tra này, nên status/code live được ghi là **NOT_VERIFIED**.

## 4. Màn hình nhập kho và giới hạn nghiệp vụ

Màn hình riêng là `/inventory/:id/inbound`. Access Session lấy từ `GET /access/managed-v3/sessions/me`; ngữ cảnh/specifications từ `GET /inventory-items/:skuId/v3/inbound/context`; Cell labels đọc từ `GET /warehouse-map` và `GET /racks/:rackId/detail-map`; preview dùng `POST /inventory-items/:skuId/v3/inbound/preview`.

- **A1 Item Instance:** chưa khả dụng. Backend physical-unit routes trả HTTP `410 STOCK_WORKFLOW_NOT_AVAILABLE`; Mobile chỉ thông báo đúng trạng thái và không bypass.
- **A2 quantity/batch:** đọc context và preview được hỗ trợ theo source. Confirm gọi adapter hiện hành nhưng Backend production chặn HTTP `503 INBOUND_CONFIRM_ENVIRONMENT_BLOCKED`. Không xác nhận nhập thành công trong production và không thử ghi trong kiểm thử.
- Confirm chỉ hiện kết quả đã ghi nhận sau khi Backend confirm và operation reconciliation trả về bằng chứng movement. Các idempotency journal và revision fences được giữ nguyên.

## Files changed

| File | Nội dung |
|---|---|
| `src/api/managedSpecifications.ts` | Chuẩn hóa DTO quantity-unit Backend; giữ validation và response checks. |
| `src/api/client.ts` | Thêm thông tin HTTP status/error code vào lỗi của các luồng R6. |
| `src/api/managedInventory.ts` | Đọc mã Cell thật từ warehouse map/rack detail theo Facility. |
| `src/components/liveUI.tsx` | `useResource` lưu error code; lỗi có thể ghi rõ tài nguyên, HTTP status và code. |
| `src/components/ManagedSpecifications.tsx` | Bỏ form inline; điều hướng sang create/edit riêng và giải thích trạng thái đơn vị tính. |
| `src/screens/ManagedSpecificationFormScreen.tsx` | Màn hình tạo/sửa Item Specification, validation theo contract, trạng thái lưu và điều hướng sau xác nhận. |
| `app/inventory/[id]/specifications/new.tsx` | Expo route tạo Item Specification. |
| `app/inventory/[id]/specifications/[specId].tsx` | Expo route sửa Item Specification. |
| `src/components/ManagedInboundPreviewCard.tsx` | Thêm chế độ màn hình độc lập, phân biệt lỗi nguồn dữ liệu, hiển thị nhãn Cell và giữ nguyên luồng preview/confirm. |
| `src/components/ManagedSkuEditor.tsx` | Nút “Kiểm tra nhập kho” điều hướng thay cho form inbound inline. |
| `src/screens/ManagedInboundScreen.tsx` | Màn hình riêng tải SKU/Reservation và hiển thị inbound workflow. |
| `app/inventory/[id]/inbound.tsx` | Route inbound render màn hình mới. |
| `src/screens/LiveAccount.tsx` | Gắn endpoint/resource cho lỗi tải stock; hiển thị mã Cell thay ObjectId ở stock-by-cell. |
| `tests/managed-inbound-specification-r6.test.ts` | Contract DTO, adapter đọc/tạo (mocked offline), route và guard regressions. |
| `CUSTOMER_MOBILE_INBOUND_SPECIFICATION_R6_REPORT.md` | Báo cáo Phase R6. |

## Verification

| Kiểm tra | Kết quả |
|---|---|
| `npm run typecheck` | **PASS** |
| Focused Jest (7 suites: R6, Managed V3 ledger, inventory, booking, form navigation, visit regression) | **PASS — 90/90 tests** |
| Expo Web export | **PASS** |
| Expo Android + iOS export | **PASS** |
| Full Jest suite | **NOT_RUN** — chỉ chạy các suite liên quan theo phạm vi yêu cầu. |
| Live API cho Reservation/SKU của khách | **NOT_RUN** — không có session/response để kiểm chứng quyền và status thực tế. |
| MongoDB/inventory write/E2E | **NOT_RUN** |
| Kiểm tra trên thiết bị thật | **NOT_RUN** — export bundle không thay cho device acceptance. |

## Giới hạn còn lại

- Chưa biết status/error code của request gây thông báo cũ cho lần dùng thật; Mobile mới sẽ hiển thị cụ thể endpoint/status/code để chẩn đoán lần kế tiếp.
- Mã Cell được đọc qua map/rack endpoints; nếu API sơ đồ không trả Cell thuộc session, giao diện yêu cầu tải lại và không suy diễn mã từ ObjectId.
- A1 đang bị HTTP 410; A2 Confirm production bị HTTP 503. Chỉ Backend thay đổi có phê duyệt mới có thể mở các thao tác đó.
- Chưa xác minh được thao tác trên iOS/Android thực và response API live.
