# Phase 3 — Customer UX polish & validation

Ngày: 19/10/2026. **Đánh giá: Customer UI sẵn sàng cho kiểm thử real-data có kiểm soát; chưa phải Live E2E / production acceptance.**

Frontend only. Không truy cập `backend/`; không sửa BE-REF, Backend, database, API, routes, auth, business helpers, config hoặc dependency. Không thực hiện mutation Backend thật.

## 1. Audit và quyết định phạm vi

Đã đối chiếu toàn bộ Customer route tree trong AppRoutes (26 route entries kể cả index) với component thực tế, default export và shared components. Không sửa preview legacy chỉ vì nhìn có vẻ không dùng. Tập trung kiểm tra browser 8 nhóm trang, Register/Item/Contract detail và các luồng được regression hiện có bao phủ.

| Nhóm | Vấn đề xác nhận / kết luận | Hành động |
| --- | --- | --- |
| My Units | Loading chỉ có dòng chữ, lỗi và Retry rời nhau | Dùng CustomerResourceState cho trạng thái loading/error; không đổi dashboard/layout/count/filter |
| Inventory | Overlay preview cũ là fixed div bên trong ExperienceContent có transform; ở viewport mobile có thể lệch khỏi vùng nhìn và không thấy Close. Thiếu Escape, focus containment/restore, browse ảnh bằng bàn phím. | Native modal riêng cho Customer, Tab/Shift+Tab, Escape, focus return, Previous/Next và arrow keys, fallback khi ảnh lỗi |
| Image picker | Mũi tên reorder và Retry/Cancel nhỏ; Retry vẫn trông bấm được khi form disabled. Remove unused upload gọi discard ngay, chưa có xác nhận | Tăng vùng bấm, bố trí nút không tràn, phản ánh disabled hiện có, xác nhận trước discard; không đổi upload lifecycle |
| Contracts / A4 | Ký/current version/hash/GET refresh và bản in A4 hiện có hoạt động; dữ liệu thiếu được ghi rõ | Giữ nguyên contract review, signing, print source, print CSS và nội dung pháp lý. Chỉ root resource state dùng component Customer mới |
| Payments | Navigation có nhãn demo nhưng page/detail/receipt vẫn dễ bị hiểu là real Backend history | Thêm notice rõ ràng cho Payment History và Refund/Charge detail; không đổi dữ liệu hoặc tích hợp endpoint |
| Warehouse Map | Đã có skeleton, error/retry, Cell status fail-closed, keyboard controls và responsive riêng | Không sửa component hoặc map rules; kiểm thử hồi quy |
| Notifications | Metadata type dài không có wrap đầy đủ; loading/error presentation còn thô | Wrap metadata, dùng resource state Customer; giữ filter/read action và collection Backend |
| Profile | Có loading/error, required fields, mismatch validation, Retry và edit/password states đúng | Không sửa ProfilePage hoặc validation/session logic; kiểm thử |
| Support | List/detail/messages dùng loading text/error/Retry rời nhau; form và confirmation nghiệp vụ hiện có hoạt động | Đổi resource presentation, giữ form/validation/create/reply/API và Phase 2 layout |

Các route booking, reservation detail, rental access/extension, payment/handover, movement history, Inbound/Outbound được rà về liên kết/component và safeguards hiện có. Không thêm tính năng hoặc đổi rule trên các route này. Không tuyên bố đã chạy browser test độc lập cho mọi nhánh của cả 26 route.

## 2. Những gì đã sửa

### Media accessibility

- `CustomerDialog` dùng native modal top layer để tránh ancestor transform, background inert và Escape; bổ sung vòng Tab/Shift+Tab ở đầu/cuối controls, trả focus khi đóng.
- `CustomerImagePreview` dùng nguyên URL/blob preview mà caller đang có. Có counter, Previous/Next và ArrowLeft/ArrowRight, giới hạn ở đầu/cuối collection, fallback ảnh không tải được. Không gọi API hoặc sửa URLs.
- Chỉ Remove **unused upload có uploadId** yêu cầu xác nhận trước khi gọi hàm remove hiện có. Keep image/Escape/Close không gửi DELETE. Double-click confirm bị khóa để không gửi trùng. Sau thao tác focus về file picker.
- Remove ảnh đã persisted vẫn chỉ thay draft collection và chờ Save, không gọi delete upload attached. Không thêm API xóa Cloudinary.
- Tăng touch target và bố trí reorder/Remove theo grid để không tràn ở 320 px. Retry/Cancel phản ánh `disabled` hiện có.
- Giữ nguyên các hàm upload/choose/remove/move, idempotency key, validation, expiry, metadata retry, POST/PATCH payload, Save/refresh và eligibility.

### Loading / feedback

`CustomerResourceState` chỉ nhận resource contract hiện có (`loading,error,retry`): skeleton trang trí aria-hidden, status announcement, error text và Retry trong cùng vùng. Không thêm fetch, không thay error mapping, không tự retry hoặc đổi trạng thái nghiệp vụ. Retry là type=button.

Form required/mismatch, pending button text, inline aria-alert/status và confirmation của reservation/Inbound/Outbound được giữ nguyên. Không thêm toast library hoặc thay shared components dùng cho role khác.

### Demo clarity

- Payment History nói rõ sample/browser records không phải proof of Backend transaction; khi mock disabled nói rõ history API chưa kết nối.
- Refund/Charge detail nói rõ browser/sample record không xác nhận refund/charge/transfer thật.
- Không gắn nhãn demo lên các trang deposit/balance/payment Backend thật. Không thêm transaction hoặc endpoint.

## 3. Files

Source có sẵn đã sửa:

1. `src/components/customer/inventory/InventoryIntegration.jsx`: preview modal và resource presentation.
2. `src/components/customer/inventory/InventoryImagePicker.jsx`: UI confirmation, preview, controls/disabled/focus; giữ các hàm API/lifecycle.
3. `src/components/customer/RentalLifecycleIntegration.jsx`: đổi import resource renderer dành riêng cho Customer; giữ các handler và business conditions.
4. `src/components/customer/CustomerNotificationsIntegration.jsx`: đổi import resource renderer.
5. `src/components/customer/CustomerSupportIntegration.jsx`: đổi import resource renderer.
6. `src/pages/customer/PaymentHistoryPage.jsx`: notice về nguồn demo/API-ready.
7. `src/pages/customer/FinancialDetailPage.jsx`: notice về demo financial detail.
8. `src/layouts/CustomerLayout.jsx`: import CSS UX scoped.

Source mới:

- `src/components/customer/CustomerMediaUI.jsx`.
- `src/components/customer/CustomerResourceState.jsx`.
- `src/layouts/customer-ux.css` — mọi selector nằm dưới `.customer-portal`; không thay Phase 2 layout hoặc animation.

Test/tài liệu/QA:

- Sửa `.design-reference/check-inventory-images.cjs`: thêm bước xác nhận discard trong regression, các assertion API/lifecycle giữ nguyên.
- Thêm `.design-reference/check-customer-ux-phase3.cjs`, `check-customer-phase3-media.cjs`.
- Thêm `.design-reference/customer-phase3-baseline.json`, before/after metrics, screenshots, `customer-phase3-comparison.html` và tài liệu này.
- Regression hiện có tạo lại screenshot; `dist/` là output build, không commit.

Hash baseline toàn bộ source xác nhận không đổi API/lib/routes/services, Public, React Bits, Profile, Map, shared UI hoặc các role layout khác. Các source có sẵn ngoài 8 file trên không thay đổi.

## 4. Validation

| Nhóm | Kết quả |
| --- | --- |
| Syntax | PASS, 218 JS/JSX/TS/TSX sources |
| Production build | PASS; cảnh báo bundle >500 KB còn tồn tại |
| npm test | PASS, 6 tests |
| managed-warehouse-booking.test.cjs | PASS, 3 tests |
| Inventory/Managed/Self Storage/Self Payment contract checks | PASS |
| Responsive/UX mới | PASS, 8 nhóm trang × 320/390/768/1024/1440/1920; Register/Item/Contract 390/1440; loading/empty/error/Retry; demo notices; profile mismatch; support detail/reply; mobile table scroll; keyboard nav; 60 notification và chuỗi rất dài không overflow; 100 GET fixture, 0 writes |
| Media UX mới | PASS, 16 request fixture; native modal bounds, Tab/Shift+Tab, Escape, focus restore, arrow keys/counter, 6 widths, ảnh 404, discard cancel không DELETE, double-click confirm chỉ 1 DELETE, focus về picker |
| IMAGE-01 → IMAGE-03 | PASS, 66 request fixture; upload/type/size/count/quota/mạng/same-key retry, failed register recovery, persisted images, add/discard/remove/reorder/PATCH/GET/refresh và 401 |
| Inventory existing | PASS, 72 request fixture; pagination/DTO/guards/history/preference/ownership/errors |
| Contract signing | PASS, 41 request fixture; DRAFT/partial/SIGNED, valid/stale/mismatched version/hash, owner, countersign GET refresh, one explicit mocked signing PATCH |
| Contract Print | PASS, 12 GET fixture; authorized ID, ownership/reservation/current version, Self/Managed HTML preview, automatic/manual print stub, 403/network/foreign rejection. Không xuất PDF mới hoặc gọi API print |
| Inbound | PASS, 106 request fixture; eligibility, fields/preference/guards, POST mocked, errors/recovery/legacy isolation |
| Outbound | PASS; eligibility, confirmation, mocked request/body/auth, pending/checked-out/history, error/network/duplicate lock |
| Map status | PASS, 14 cases, 49 GET fixture; RESERVED/YOURS, OCCUPIED, unavailable/unknown, selection fail-closed |
| Remember Me/auth | PASS; session/persistence, all roles/current GET, logout success/failure, cross-tab, invalid/offline, password never persisted |
| Public regression | PASS, 31 GET fixture; 6 routes, navigation/FAQ/images/pricing/errors/reduced-motion |

Mọi Backend request trong các test acceptance được intercept/fulfill bằng fixture; không tạo Item, upload Cloudinary, reservation, signature hoặc payment thật. Một số regression chủ động gửi mutation vào fixture để xác nhận guard/payload. **Không tuyên bố Live E2E PASS.**

Các regression cũ chỉ đổi port và, khi cần, storage fixture sang sessionStorage trong bộ nhớ để phù hợp Remember Me; không sửa auth implementation. Test ảnh lỗi dùng URL 404 mới để tránh decoded image cache, không thay URL trong ứng dụng.

## 5. Screenshots

Mở `.design-reference/customer-phase3-comparison.html` để xem trước/sau của 8 nhóm trang và preview/picker.

- `customer-phase3-{before,after}-{units,inventory,contracts,payments,warehouse,notifications,profile,support}-{320,390,768,1024,1440,1920}.png`.
- `customer-phase3-{before,after}-{register,item,contract}-{390,1440}.png`.
- `customer-phase3-media-{before,after}-390.png`, `customer-phase3-picker-{before,after}-390.png`.
- `customer-phase3-after-{empty,error,loading}-390.png`, `customer-phase3-image-error.png`.

Ảnh chỉ chứa fixture. Đã xem trực tiếp ảnh trước/sau preview mobile và picker; bản cũ có backdrop nhưng nội dung/Close lệch viewport, bản mới nằm trong viewport.

## 6. Giới hạn / readiness

- **UI ready cho controlled real-data validation**, chưa xác nhận live Backend, database/Cloudinary deployment hoặc mọi browser/device.
- Payment History/refund/charge vẫn demo/API-ready như trước; chưa có real history integration được triển khai. Deposit/balance/payment flows hiện có không thay đổi.
- A4 document/hash/clauses/pricing không đổi. Không chạy hộp thoại OS hoặc Save-as-PDF thủ công trong Phase 3; print callback được instrument bằng fixture.
- Notification/contracts giữ collection API hiện có; đã thử 60 notification dài nhưng không thêm pagination endpoint hoặc virtualization chưa được yêu cầu. Collection cực lớn cần đo thêm với real data.
- Loading skeleton không phản ánh số record Backend và không tạo metric giả. Error text vẫn theo sanitizer/mapper hiện có.
- Thông báo kỹ thuật/lifecycle còn lại được giữ để không đổi ý nghĩa nghiệp vụ. Không thay layout hoặc typography Phase 1/2.
- Bundle warning còn tồn tại; không sửa dependency/architecture ngoài phạm vi.
