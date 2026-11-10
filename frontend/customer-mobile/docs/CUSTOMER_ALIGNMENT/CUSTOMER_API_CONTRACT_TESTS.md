# Kiểm thử contract và hồi quy

| Kiểm tra | Kết quả | Phạm vi thực tế |
| --- | --- | --- |
| Mobile baseline `npm test` trước sửa | PASS 375/375, 8 suites | Fixture, không live. |
| Mobile `npm run typecheck` | PASS | TypeScript gồm contract mới. |
| Mobile `npm test -- --silent` | PASS 447/447, 10 suites | 375 cũ + 68 contract fixtures + 4 Web render/handler fixtures. |
| Mobile `npm run export:native` | PASS | Expo offline, Hermes bytecode iOS 3,9 MB và Android 4,2 MB, dùng TEMP/TMP trong workspace. Lần đầu thất bại do quyền thư mục tạm mặc định; lần chạy lại và export cuối thành công. |
| Mobile `node scripts/verify-ui-completeness.cjs` | PASS 23/23 | Kiểm kê design, route và source; không đánh giá pixel perfect. |
| Web/Mobile parse | PASS 438/438 | Babel parser đã cài trong Mobile; JS/JSX/TS/TSX/MJS/CJS ở source, routes, tests, Mobile scripts. |
| Website `node --test tests/managed-warehouse-booking.test.cjs tests/customer-alignment-policy.test.mjs` | PASS 8/8 | 3 Warehouse + 5 policy/customer độc lập. |
| Website `npm test` | PASS 158/158 | Sau khi khôi phục dependencies, lượt đầu có hai lỗi nạp module trong fixture Review và Repeated Inbound. Cập nhật fixture để nạp đúng dependency rồi chạy lại toàn bộ. [Log](website-tests.log). |
| Website `npm run build` | PASS | Vite 7.3.6 xử lý 2.139 module. Build có cảnh báo chunk lớn hơn 500 kB sau minify. |
| Native device và Backend E2E | NOT RUN | Không có test thiết bị hoặc live Backend/provider mutation. |

**Contract fixtures.** Role Customer/active, auth DTO và owner, session epoch/401; Unit/date UTC và availability UNKNOWN, Self create/lifecycle/suggestions và pricing, Managed Cell/quote/term; itemCode/stock/batch/closure/custody, idempotency và version, movements; ký stale/current và paper evidence; Self PayOS và Managed zero/mock, notification/support; toàn bộ 7 phương thức Axios Mobile fail closed. Bốn fixture Web kiểm tra Customer không ký được, Facility Staff/Manager vẫn thấy đường ký khi đủ điều kiện, và 409 Inventory giữ form/tải lại hai context mà chỉ gọi create một lần. Đây là test code/handler với transport giả, không phải browser Website.

**Bảy smoke scripts** chạy trên Expo React Native Web tại localhost với Playwright/Edge, không gọi Backend và không mutation; các bề rộng được kiểm trong khoảng 320–768 px tùy script:

| Script | Kết quả và log |
| --- | --- |
| `smoke-preview.cjs` | [PASS](smoke-preview.log) — auth demo, 5 tab, stack/Back, viewport. |
| `smoke-booking.cjs` | [PASS](smoke-booking.log) — Self, draft, rental và điều hướng. |
| `smoke-managed.cjs` | [PASS](smoke-managed.log) — map/zone/rack/Cell, basket/draft. |
| `smoke-inventory.cjs` | [PASS](smoke-inventory.log) — inventory, itemCode, history/form, ảnh demo. |
| `smoke-requests.cjs` | [PASS](smoke-requests.log) — repeated inbound/outbound previews, conflict, cleanup UI. |
| `smoke-financial.cjs` | [PASS](smoke-financial.log) — contract/signing disabled và các trạng thái payment fixture. |
| `smoke-care.cjs` | [PASS](smoke-care.log) — register, notifications, support và auth guard. |
