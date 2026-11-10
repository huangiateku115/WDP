# Phase 6B.1A — Kết quả kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run typecheck` | PASS. |
| `npm test -- --silent` | PASS 468/468 trên 11 suites. Toàn bộ 447 test trước đó và 21 test mới đều qua. |
| `npm run export:native` | PASS. Hermes bytecode Android 4.169.841 byte và iOS 3.874.482 byte. Expo chạy offline và dùng thư mục tạm thuộc artifacts. |
| `node scripts/verify-ui-completeness.cjs` | PASS 23/23. Đủ màn hình và route trong mapping. |
| Bảy script RN Web smoke | PASS 7/7 trên Edge headless. Mỗi script ghi 0 request Backend và 0 mutation. |
| Native device E2E, Backend integration, Website rebuild/retest | Bỏ qua vì ngoài phạm vi. Hermes export xác minh bundle. RN Web kiểm tra điều hướng và giao diện demo. |

`tests/fixture-auth-session.test.ts` kiểm tra method, path, body và Bearer header bằng transport giả. Test bao gồm phản hồi login sai shape hoặc thiếu identity/token, non-Customer và inactive, ID không khớp khi đọc current-user, lỗi credential được chuẩn hóa, registration allowlist và không auto-login, 401 expiration và không refresh, logout khi login hoặc đọc đang chờ, A → B với response hoặc lỗi 401 đến muộn, demo isolation, snapshot không chứa credential và không dùng ambient fetch hay web storage. Suite contract có sẵn tiếp tục kiểm tra Axios chặn GET, POST, PUT, PATCH, DELETE, HEAD và OPTIONS trước adapter.

Smoke ban đầu gặp lỗi khởi động Edge trong sandbox. Lượt chạy Edge tách khỏi Metro timeout ở loopback. Lượt chạy cùng môi trường vẫn chưa đạt readiness khi Metro dùng binding mặc định. Lượt xác minh cuối dùng Edge headless và Metro offline cùng môi trường với Node ưu tiên IPv4, khớp địa chỉ `127.0.0.1:8091` của các script. Lần thử CLI có cả `--offline` và `--localhost` bị Expo từ chối do hai cờ loại trừ nhau.

| Script | Kết quả | Artifact |
| --- | --- | --- |
| `smoke-preview.cjs` | PASS | Kết quả JSON qua stdout và ảnh trong `artifacts/screenshots/`. |
| `smoke-booking.cjs` | PASS | `artifacts/phase2/smoke-result.json` |
| `smoke-managed.cjs` | PASS | `artifacts/phase3/smoke-result.json` |
| `smoke-inventory.cjs` | PASS | `artifacts/phase4a/smoke-result.json` |
| `smoke-requests.cjs` | PASS | `artifacts/phase4b/smoke-result.json` |
| `smoke-financial.cjs` | PASS | `artifacts/phase5a/smoke-result.json` |
| `smoke-care.cjs` | PASS | `artifacts/phase5b/smoke-result.json` |
