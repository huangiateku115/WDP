# Kiểm thử chẩn đoán PayOS

| Chạy | Kết quả |
| --- | --- |
| Website `node --test tests/payos-checkout.test.mjs tests/customer-payment-load.test.mjs` | **41/41**, exit 0. Fake client, fixture component và test QR local. |
| Backend snapshot `9149930`, `node --require <temp>/no-network.cjs --import tsx --test tests/payos-payment.test.cjs` | **68/68** (53 top-level), exit 0. Mongoose query/session, controller và provider mocks. Exact SDK 2.0.5 test dùng fake `fetch`. |
| Render owner status/history, PayOS lookup live, MongoDB indexes/transaction live, webhook live | **SKIPPED** vì thiếu quyền đã xác minh và vì GET status có tác dụng phụ. Không gửi checkout hoặc chạy local probe. |

Backend fixture tạo bằng `git --git-dir=../.git --work-tree=. archive --format=tar --output=<temp>/reference.tar origin/dev backend/src backend/tests/payos-payment.test.cjs backend/package.json backend/package-lock.json backend/tsconfig.json`, rồi `tar.exe -xf <temp>/reference.tar -C <temp>` và `npm.cmd ci --ignore-scripts --no-audit --no-fund` ở bản sao tạm. Npm cài 292 package, cảnh báo deprecated inflight/rimraf/glob. Không chạy app server hoặc lifecycle scripts. Preload xóa các biến môi trường PAYOS_/MONGO/KEYCLOAK khỏi process test và chặn fetch thật, socket, TLS, HTTP/HTTPS. SDK test chỉ thay fetch bằng fixture tạm. Thư mục tạm giữ log `backend-fixtures.log`, source tree và lockfile dự án không đổi.

| Kịch bản | Evidence |
| --- | --- |
| Timeout / known rejection / SDK fail | Backend test `:676–794` xác nhận UNKNOWN, log allowlist, HTTP error taxonomy và một lần mock provider create dù 503. |
| Provider success nhưng lỗi persist/readback | `:661–675,795–828` giữ attempt/order gốc, chưa trả URL khi chưa xác nhận. |
| CREATING concurrency, replay READY/UNKNOWN, key conflict | `:350–370,513–649,880–916` bao gồm concurrent claim, cùng key/sai amount hoặc facility, completed replay không lộ link. |
| Original-order lookup và scope | `:917–1053` mismatch, thiếu URL, owner/reservation, URL gating. |
| Signed webhook và applied payment | `:1054–1403` duplicate, wrong identity, late capture, wrong amount, rollback khi persistence fail, unknown transaction commit. |
| Website history/503 recovery | `tests/customer-payment-load.test.mjs` kiểm refresh history khi checkout unknown, hiển thị payment gốc và chặn POST tiếp. `tests/payos-checkout.test.mjs:91+,192+,322+,355+` kiểm exact contract, READY-only poll, VERIFIED/APPLIED, FAILED gate và sessionStorage. |

Khoảng trống đề xuất fixture riêng gồm lost HTTP response sau READY, provider đã nhận rồi disconnect, webhook chen đúng giữa claim và persist, và stale GET đọc lại sau webhook. Suite có mock từng nhánh liên quan. Các test này không đo production network, tiền, Render logs, Mongo index deploy hay webhook thực.
