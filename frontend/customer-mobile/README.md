# VaultSpace Customer Mobile

Ứng dụng **Expo / React Native iOS–Android**, TypeScript, chỉ dành cho khách hàng. Toàn bộ source nằm trong thư mục này; không chia sẻ dependencies, router, CSS hoặc API client với website ở thư mục cha.

## Chạy ứng dụng

Customer Mobile dùng Expo SDK 58 và API WDP. Mặc định dùng Render. Đặt EXPO_PUBLIC_API_BASE_URL trong .env nếu cần Backend test riêng. Xem [cấu hình, API và giới hạn hiện tại](docs/REAL_API_INTEGRATION.md).

```powershell
cd C:\Users\laptop\Desktop\WDP\frontend\customer-mobile
npm ci
npm start
```

Dùng Expo Go tương thích SDK 58 hoặc development client đã build với SecureStore. Không dùng tài khoản hoặc mật khẩu trong các tài liệu lịch sử. Khi test giao dịch, chỉ dùng môi trường và kênh PayOS đã được phê duyệt.

## Tài liệu lịch sử

Các mục phía dưới mô tả các phase giao diện trước khi tích hợp API. Các smoke test cũ sử dụng phiên ngoại tuyến và không còn là hướng dẫn chạy runtime hiện tại.

## Phạm vi giao diện

Sáu màn hình nền tảng ban đầu (tổng hiện tại 23/23 thiết kế UI/fixture; xem audit phía dưới):

1. Đăng nhập.
2. Trang chủ khách hàng.
3. Khám phá cơ sở — tìm kiếm, lọc loại dịch vụ.
4. Kho thuê của tôi — nhóm đang thuê/cần theo dõi/lịch sử.
5. Hàng hóa ký gửi — tìm kiếm, lọc, tồn kho mẫu tách khỏi số lượng khai báo.
6. Tài khoản — hồ sơ mẫu, tùy chọn cục bộ, logout.

Phase 2 bổ sung Facility Detail → Unit Selection → Kỳ thuê & giá → Bản xem trước đặt chỗ, cùng Rental Detail cho hai loại dịch vụ. Giữ URL detail Phase 1. Đây là phạm vi lịch sử Phase 2; Registration đã hoàn chỉnh UI ở Phase 5B. Không có đặt chỗ hoặc thanh toán thật.

Đọc [báo cáo Phase 2](docs/PHASE2_REPORT.md) để xem routes, giới hạn fixture, kết quả kiểm thử và danh sách file.

## Kiểm tra

```text
npm run typecheck
npm test
npm run check:versions
npm run export:native
npm run verify:website
```

- `npm test`: Jest Expo + React Native Testing Library, không gọi máy chủ.
- `check:versions`: so sánh SDK dependency map cục bộ; endpoint compatibility online không truy cập được trong phiên kiểm thử.
- `verify:website`: đối chiếu SHA-256 1.074 file website với baseline trước task. `.env` không được đọc; `node_modules`, `dist`, `.git` và mobile được loại khỏi baseline.
- `scripts/smoke-preview.cjs`: smoke test bổ trợ **React Native Web**, không thay thế device testing. Cần Playwright có sẵn; có thể chỉ định `PLAYWRIGHT_MODULE` tới module cục bộ. Khởi động Metro ở port 8091 (`npx expo start --offline --port 8091 --max-workers 2`) rồi chạy `npm run smoke:preview`. Mọi origin ngoài localhost bị chặn. Script chỉ kiểm tra các native components được render qua web, ghi ảnh vào `artifacts/screenshots`.

## Thiết kế và dữ liệu

Tham chiếu: `VaultSpace_Stitch_23_Screens_Handoff` (23 HTML + manifest). `docs/design-map.json` ghi các màn hình được dùng và hash nguồn. HTML chỉ là reference; không copy script, CDN Tailwind, DOM hoặc `history.back()` vào app.

- Emerald `#005f3a`, nền mint `#ecfef2`, điểm nhấn cam; Inter đóng gói cục bộ.
- StyleSheet native + token, UI primitives và cards tái sử dụng; safe-area và keyboard handling.
- Artwork kho là SVG gốc viết bằng native SVG; không sao chép ảnh/logo từ URL chưa xác minh quyền sử dụng.
- Không NFC/Smart Pass, climate control, chứng nhận ký số, bảo hiểm, provider payment hoặc thông báo giao dịch thật.
- Mọi giá, cơ sở, kỳ thuê và stock đều ghi rõ dữ liệu mẫu. Không cộng stock khác đơn vị hoặc thay tồn kho bằng registered quantity.
- Axios client chặn **mọi request trước transport**, kể cả custom adapter. Chưa có base URL, token, API endpoint hoặc real mutation.

Đọc [kiến trúc](docs/ARCHITECTURE.md) và [báo cáo Phase 1](docs/PHASE1_REPORT.md) trước khi phát triển tiếp. Dependency audit hiện còn cảnh báo trong chuỗi SDK/tooling; không coi foundation này là bản production đã sẵn sàng phát hành.

## Kiểm thử luồng đặt kho bản mẫu

Metro port 8091 như trên, sau đó `node scripts/smoke-booking.cjs` (dùng PLAYWRIGHT_MODULE nếu cần). Script chạy toàn luồng tại 320/390/430/768 px và lưu screenshot vào `artifacts/phase2/`. Đây chỉ là RN Web preview bổ trợ. Dữ liệu ngày khởi tạo lấy ngày Việt Nam hiện tại; chọn kỳ thuê khác sẽ kiểm tra lại chỗ trống fixture.

## Phase 3 · Bản đồ kho ký gửi

Đã bổ sung thiết kế 07/08: Explore → Facility → Chọn ô trên bản đồ kho → Review → Confirmation ngoại tuyến. Tổng 13/23 thiết kế hoàn chỉnh ở phạm vi UI/fixture. Chọn nhiều ô qua nhiều Zone/Rack, đổi kỳ thuê kiểm tra lại các lựa chọn; không có live booking/HOLD. Draft Managed tách Self Storage.

Metro port 8091; chạy `node scripts/smoke-managed.cjs` để kiểm tra RN Web bổ trợ ở 320/375/390/430/768 px. Screenshots: artifacts/phase3. Đọc [báo cáo Phase 3](docs/PHASE3_REPORT.md) và `docs/phase3-changed-files.txt` để xem thay đổi/test/giới hạn. Không Backend integration; dependency advisories vẫn mở.

## Phase 4A · Hàng hóa

Đã hoàn thành thiết kế 14/15/18 ở phạm vi fixture: chi tiết hàng tại URL cũ, đăng ký/chỉnh sửa bản nháp, và lịch sử legacy/canonical theo từng lô. Tổng 16/23 thiết kế; không triển khai nhập/xuất hay di chuyển thật. Bản nháp chỉ trong bộ nhớ phiên, mất khi logout/restart và không xuất hiện như Item mới trong danh mục. Hình dựng sẵn cục bộ, không upload ảnh.

Chạy `node scripts/smoke-inventory.cjs` với Metro 8091 để kiểm tra RN Web bổ trợ tại 320/375/390/430/768 px. Ảnh ở artifacts/phase4a. Đọc [báo cáo Phase 4A](docs/PHASE4A_REPORT.md) và danh sách file trong docs/phase4a-changed-files.txt. Các báo cáo phase cũ ghi lịch sử tại thời điểm hoàn tất, không phải tổng screen count hiện tại.

## Phase 4B · Yêu cầu nhập thêm/xuất kho

Đã hoàn thành design 16/17 ở UI/fixture level, tổng 18/23. Từ Item Detail của Hộp giấy Kraft (PKG-0102) có thể thử nhập thêm, xuất một phần, xem request detail, chuẩn bị điều chỉnh hoặc nháp hủy. Coffee minh họa feature bị khóa; hàng mới Registered không dùng nhập thêm. Tất cả confirm chỉ lưu nháp trong bộ nhớ, không gửi request/headers hoặc cập nhật stock.

Chạy `node scripts/smoke-requests.cjs` với Metro 8091 để kiểm tra 320/375/390/430/768 px; ảnh trong artifacts/phase4b. Đọc [báo cáo Phase 4B](docs/PHASE4B_REPORT.md) và docs/phase4b-changed-files.txt. Không dùng Expo env flag để bật transport hoặc Backend features; dependency remediation vẫn tách riêng.

## Phase 5A · Hợp đồng và thanh toán

Đã hoàn thành design 11/12 ở UI/fixture level; tổng ở thời điểm Phase 5A **20/23**. Từ Kho thuê → Chi tiết kỳ thuê có thể mở `/rentals/:id/contract` và `/rentals/:id/payment`, quay lại bằng native stack; giữ route Rental Detail cũ. Chữ ký hai bên/phiên bản và DEPOSIT/BALANCE tách riêng; chỉ khoản trả trước đã xác nhận mới cấn trừ. Hợp đồng và tài chính là ảnh chụp dữ liệu mẫu bất biến.

Các tình huống bổ sung của kỳ thuê ký gửi là ví dụ độc lập, không đổi kỳ thuê gốc. Checkbox chỉ ghi nhận đã đọc trên màn hình. Ký/PDF/email/thanh toán/refresh trực tuyến bị vô hiệu hóa; không QR, chứng thư, provider hoặc tự kích hoạt. Không gọi Backend, transport vẫn khóa mọi HTTP method.

Chạy `node scripts/smoke-financial.cjs` với Metro 8091 và PLAYWRIGHT_MODULE như các phase cũ. Ảnh và kết quả ở `artifacts/phase5a/`; RN Web chỉ bổ trợ, chưa native device E2E. Kiểm tra bảo toàn: `node scripts/verify-phase5a-preservation.cjs`. Đọc [báo cáo Phase 5A](docs/PHASE5A_REPORT.md), [danh sách file](docs/phase5a-changed-files.txt) và [kết quả bảo toàn](docs/phase5a-preservation-result.json). Ở thời điểm Phase 5A còn design 19, 20 và 23; Phase 5B bên dưới đã hoàn tất UI. Baseline dependency còn 19 cảnh báo (13 Low, 6 High), chưa khắc phục, là blocker trước phát hành.

## Phase 5B · Hoàn tất 23 thiết kế UI

Đã hoàn tất design 19 Thông báo, 20 Trung tâm hỗ trợ và 23 Đăng ký khách hàng trong ứng dụng hiện có. Đọc [23-screen completeness audit](docs/UI_COMPLETENESS_AUDIT.md) và [báo cáo Phase 5B](docs/PHASE5B_REPORT.md). Đây là **23/23 UI/fixture designs, không phải production-ready**.

Home bell/Profile → `/notifications`: local read/all-read, unread count/filter, nhóm theo ngày Việt Nam, chỉ mở target typed đã xác minh owner/resource. Profile → `/support`, `/support/new`, `/support/:requestId`: fixture list/status/conversation, RHF/Zod memory draft, native unsaved guard và xác nhận xóa. Logout xóa read overrides/draft, không sửa dữ liệu gốc.

Route `/register` (auth group cũ) có form đủ trường theo reference, show/hide passwords, consent minh họa và lỗi inline. Submit hợp lệ chỉ thông báo chưa kết nối và xóa password fields; không tạo account/session/OTP/email hoặc lưu mật khẩu. Login demo giữ nguyên. Không push/SMS/email/support submit/reply/payment/signing/inventory operations hoặc HTTP calls.

Metro offline 8091: chạy sáu smoke cũ và `node scripts/smoke-care.cjs`; Playwright có sẵn, không thêm dependency. Ảnh/kết quả trong `artifacts/phase5b`. Kiểm kê `node scripts/verify-ui-completeness.cjs`; bảo toàn `node scripts/verify-phase5b-preservation.cjs`; [changed-files](docs/phase5b-changed-files.txt). Chưa native device E2E, API integration hoặc remediation 19 dependency findings (6 High). Phase 6 API Contract Audit & Integration Planning cần task riêng, chưa thực hiện.
