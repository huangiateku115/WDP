# Managed Inventory V3 trên Customer Mobile

Baseline: branch Frontend, HEAD 9be013af314b432b66d580347effef4836c25ace. Worktree sạch lúc bắt đầu. Đối chiếu source, chưa có nghiệm thu giao dịch live.

| Feature | Backend | Customer Web | Mobile | Missing | Blocker |
|---|---|---|---|---|---|
| Danh sách đơn hỗn hợp | GET /reservations/me | Danh sách đơn Customer | reservationDto đã nhận version 1/2/3 và kiểm tra owner | Nghiệm thu trên tài khoản hỗn hợp thật | MATCHED ở mức source |
| Facility, map, Cell theo kỳ | GET /warehouse-map, GET /racks/:id/detail-map, GET /reservations/managed/capacity/:facilityId | Luồng ManagedReservationBooking | ManagedBooking, ManagedWarehouse và managedInventory dùng API thật; isBookable và requestedInterval đã được kiểm tra | Nghiệm thu topology/Cell tại facility test | PARTIAL |
| Quote | POST /reservations/managed/quote; publicQuote trả version 3 và payment FULL_RENT trên nhánh upfront | managedReservationApi.js; ManagedReservationBooking.jsx kiểm tra phiên bản và dữ liệu báo giá | Thêm parser V3; kiểm tra facility, kỳ thuê, term, dung tích và tập Cell IDs; giữ parser V2 | Trường hợp V3 trả cấu trúc deposit theo cờ dev bị từ chối | IMPLEMENTED_NOT_LIVE_VERIFIED |
| Terms và tạo đơn | POST /reservations/managed, yêu cầu Idempotency-Key; parseRequest nhận termsAccepted và termsVersionId | ManagedReservationBooking.jsx dùng quote và quy trình create | Màn map mới dừng ở quote | Terms, profile gate, xác nhận create, journal và phục hồi timeout | READY_TO_INTEGRATE |
| FULL_RENT PayOS | POST/GET /reservations/managed/:id/payments/payos; GET status; POST reconcile | Web có API Managed riêng | Mobile chỉ có luồng PayOS Self Storage | Managed payment UI, journal, recovery và kiểm tra settlement | READY_TO_INTEGRATE; callback native BACKEND_DEPENDENCY |
| Hợp đồng và bàn giao | POST contract/handover giới hạn Staff/Manager; FULL_RENT thành công là điều kiện handover V3 | Web đọc tiến độ và trạng thái hợp đồng | Chi tiết Managed hiển thị đúng nhãn V3, hạn ký, giá dự kiến và liên kết xem trạng thái hợp đồng | Nối chi tiết Managed, xác minh hợp đồng giấy và cập nhật bàn giao | PARTIAL |
| SKU và ảnh | POST /inventory-items, PATCH /inventory-items/:id, POST /inventory-items/image-uploads | Inventory integration Web | Danh sách/chi tiết đọc API; các màn form fixture không chứng minh runtime V3 | Tích hợp form tạo/sửa V3 và upload được cấp quyền | PARTIAL |
| Visit | POST /access/managed-v3/visits; GET me/detail; PATCH amend và POST cancel | managedAccessApi.js và ManagedAccessVisitsPage.jsx | Chưa tích hợp | Lịch, note, idempotency, If-Match và quyền Customer | READY_TO_INTEGRATE; route availability riêng chưa thấy mount |
| Access Session | GET /access/managed-v3/sessions/me và /:sessionId; Staff kích hoạt | managedAccessApi.js | Chưa tích hợp | Hiển thị trạng thái và hạn session theo server | READY_TO_INTEGRATE |
| PhysicalUnit / A1 / A2 | GET/POST physical-units; POST inbound/preview, POST inbound; GET operations?key=... | ManagedSelfInboundV3.jsx | Chưa tích hợp | Session, revision, certification, preview-confirm, idempotency, operation recovery | DEPLOYMENT_BLOCKED cho live nếu thiếu các điều kiện; Mobile chưa implement |
| Stock và movements | GET /inventory-items/:id/v3/stock và /v3/movements | ManagedSelfInboundV3.jsx | Tách API V3 theo đơn sở hữu; kiểm tra Customer, SKU, facility, reservation; hiển thị stock theo Cell/lô/kiện và event ADD/MOVE/REMOVE | Operation lookup/recovery, giới hạn 200 movements từ Backend | IMPLEMENTED_NOT_LIVE_VERIFIED |
| Outbound / relocation V3 | Không tìm thấy Customer V3 writer được mount; route relocate-canonical hiện giới hạn Staff | Không dùng legacy để suy ra V3 | Không thêm mutation | Writer V3 cần chứng minh trước khi tích hợp | UNSUPPORTED trong phạm vi đã xác minh |
| Closure | GET /reservations/managed/:id/closure-readiness; DTO readonly và có blockers | facilityManagedApi.js có helper đọc | Chưa tích hợp read diagnostic | Màn diagnostic; chưa xác minh phép kết thúc V3 của Customer | PARTIAL |

## Bằng chứng source

- Backend routes: backend/src/routes/index.ts:40,57; reservation.routes.ts:19–31; inventory-item.routes.ts:21–54; access.routes.ts:15–28.
- Quote/create: backend/src/services/reservations/managed-reservation.service.ts:34,64–92,314–327,409; controllers/reservations/managed-reservation.controller.ts:15–22.
- Managed native callback: backend/src/services/payments/payos-payment.service.ts:158–176. Kênh MOBILE bị từ chối cho Managed. Web return dùng origin cấu hình của Customer Web. Mobile chưa thêm callback hoặc gửi header này.
- Handover: backend/src/services/reservations/managed-reservation.service.ts:707–716. Controller access dùng If-Match tại backend/src/controllers/access/managed-access.controller.ts:5,13–14.
- Ledger: backend/src/controllers/inventory-items/managed-inventory-v3.controller.ts:4–15; backend/src/services/inventory-items/managed-inventory-v3.service.ts:74,109,248–265,311–314,355–361,401–433; backend/docs/MI_V3_LEDGER_CONTRACT.md:9–19.
- Closure: backend/src/services/reservations/managed-closure-readiness.service.ts:306–355. Kết quả là diagnostic, không giải phóng Cell/quota. Source này chưa chứng minh closure end-to-end cho Customer V3.
- Web: frontend/src/api/managedReservationApi.js:7, frontend/src/components/customer/ManagedReservationBooking.jsx:259–281, frontend/src/api/managedAccessApi.js:36–50, frontend/src/api/managedInventoryV3Api.js:30–32, frontend/src/components/customer/inventory/ManagedSelfInboundV3.jsx:29–87, frontend/src/api/facilityManagedApi.js:17.
- Mobile: src/api/contracts/customer.ts:20–36; src/api/contracts/booking.ts, src/api/managedInventory.ts và src/screens/ManagedWarehouse.tsx cho quote; src/api/contracts/managedV3Ledger.ts, src/api/mobileRepository.ts và src/screens/LiveAccount.tsx và src/screens/ManagedDashboard.tsx cho ledger.

## Nghiệm thu thủ công

1. Với Backend test được phê duyệt, chạy Expo Web từ thư mục Customer Mobile với EXPO_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1 và npm run web. Với Android emulator, dùng http://10.0.2.2:5000/api/v1 và npm run android. Thiết bị vật lý dùng IP LAN của máy Backend test.
2. Đăng nhập tài khoản test có đồng thời đơn Self Storage, Managed V2 và Managed V3. Kiểm tra danh sách và mở từng loại đơn.
3. Mở facility Managed, chọn kỳ thuê và nhiều Cell khả dụng, yêu cầu quote. So sánh Cell IDs, dung tích, kỳ hạn và tổng FULL_RENT với response. Đổi kỳ thuê để kiểm tra quote cũ bị vô hiệu.
4. Với SKU V3 có sẵn, mở chi tiết và lịch sử. So sánh tồn theo Cell/lô/kiện với response canonical; thử SKU cần đối soát để xác minh UI ẩn số tồn. Kiểm tra SKU V2 vẫn đọc API cũ.
5. Create, Managed PayOS, Visit, Session và Inbound Mobile chưa sẵn sàng nghiệm thu trong bản này. Để kiểm thử inbound ở phase sau cần tài khoản Customer, Staff đã kích hoạt session, Cell allocation, topology certification và MongoDB hỗ trợ transaction; không dùng production.

## Continuation V2 · phạm vi Mobile

Worktree đầu vào gồm 11 file từ task trước, branch Frontend và HEAD 9be013af314b432b66d580347effef4836c25ace. Bảng trên là baseline; phần này ghi trạng thái sau continuation.

| Phase | Source / API | Mobile |
|---|---|---|
| A | GET /public/terms/current?serviceType=MANAGED_INVENTORY; POST /reservations/managed; GET /reservations/managed/:id | Đọc Terms đã công bố, chấp nhận chủ động, báo giá lại, lưu payload và key theo account/API origin, replay cùng key sau kết quả chưa rõ, GET xác minh đơn và chuyển tới chi tiết. Backend tự tính hash của Terms và tính lại giá trong transaction. DTO create hiện thiếu quote ID hoặc expected price để khóa nguyên tử giá giữa hai request. |
| B | Managed PayOS create/history/status/reconcile tại reservation.routes.ts:28–31 | FULL_RENT trên chi tiết đơn Managed; QR và hosted từ cùng intent; không gửi MOBILE header. Retry mới chỉ khi server cho phép và lịch sử chỉ có terminal. UNKNOWN chặn key mới. Kiểm tra GET hữu hạn khi màn có focus/foreground; reconcile theo thao tác chủ động. Native callback Managed chưa có. |
| C | managed-reservation.service.ts:409,707–724; PayOS settlement và contract | Đơn mới Managed bắt đầu RESERVED. Chi tiết hiển thị giá dự kiến, hạn ký, allocation, lịch sử PayOS, hợp đồng và nhãn trạng thái; không gọi API bàn giao của Staff. Chưa nghiệm thu bản hợp đồng giấy và handover live. |
| D | inventory-item.routes.ts:34–36,54; inventory-item.service.ts:677–704,760–800 | Khai báo metadata V3 và sửa tên/danh mục/mô tả khi SKU REGISTERED chưa đặt ô. Kiểm tra lại đơn và SKU trước khi ghi. Chưa tích hợp chọn ảnh và upload multipart. |
| E | access.routes.ts:15–25; index.ts:57 | Đọc Visit và Session thuộc đơn, giờ Việt Nam; hủy lịch SCHEDULED sau xác nhận bằng If-Match. Chưa tìm thấy route GET visits/availability trong source ở HEAD này, vì vậy chưa triển khai lịch tạo/sửa dựa trên slot. Không xác minh được khác biệt deployment qua một GET không có phiên Customer. |
| F | managed-inventory-v3.service.ts:160–246 | Đọc/chuẩn bị PhysicalUnit, preview A1 một Cell hoặc A2 chia số lượng theo Cell, xác minh session/allocation và phiên bản preview. Preview DTO không nhận sessionRevision; Backend trả revision trong proof. Chưa triển khai xác nhận ghi ledger và journal replay inbound. Chưa có bằng chứng topology, index và transaction đủ điều kiện nghiệm thu live. |
| G | managed-inventory-v3.service.ts:401–433; managed-closure-readiness.service.ts:323–355 | Giữ canonical stock/movements, thêm tra cứu operation theo key và đánh giá closure read-only. Chưa có UI ghi outbound, relocation hoặc closure V3. |

Nghiệm thu với Backend test: lấy quote V3, đọc và chấp nhận Terms, tạo RESERVED, kiểm tra ID và Cell allocation, mở PayOS test đã được duyệt, kiểm tra settlement từ server, xác minh hợp đồng và handover qua Staff, khai báo SKU, mở lịch và phiên hiện có, thử preview A1/A2 với Cell đã chứng nhận. Dừng ở preview trong bản này. Không sử dụng production để nghiệm thu ghi.
