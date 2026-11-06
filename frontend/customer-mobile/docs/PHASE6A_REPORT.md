# Phase 6A — Báo cáo audit API Customer Mobile

Ngày audit: 30/10/2026. Phạm vi: đối chiếu source, tài liệu và fixture; chỉ tạo tài liệu. **Không triển khai Phase 6B. Không bật Axios transport. Không gọi API live.**

## A. Source Coverage

Đã đọc quy tắc `frontend/AGENTS.md`, README, ARCHITECTURE, các báo cáo Phase 1–5B, UI_COMPLETENESS_AUDIT và design-map; đối chiếu routes, screens, domain, forms, stores, fixtures và API guard của mobile. Website Customer được đọc để so sánh cách gọi API, không được coi là bằng chứng hợp đồng Backend.

Đã kiểm tra route/controller, validator, service, model, gate và các test liên quan trong `BE-REF`. Bằng chứng đường dẫn/dòng/symbol tập trung trong [CONTRACT_EVIDENCE](PHASE6A_CONTRACT_EVIDENCE.md). Các nhãn `VERIFIED_BY_BACKEND_TEST` chỉ nói rằng đã đọc assertion trong source test; **không có Backend test nào được chạy**.

Không xác định được branch/commit từ bản BE-REF: không có metadata `.git` ở thư mục reference. Không tìm thấy OpenAPI gắn với revision đủ để thay thế source. Fingerprint của 221 file src/tests/docs được kiểm tra: `5645f40a8e30dd6d31dfc2bfe7875f145e09c46bac9c3aaa750e1c40d757ad21`. Đây là fingerprint phạm vi audit, không phải commit hay chứng nhận deployment. Không đọc `.env` hoặc secret; không truy cập `backend/`.

## B. API Inventory

[CSV operation-level](PHASE6A_API_CONTRACT_MATRIX.csv) có **108 dòng, 28 cột**, liên kết đủ 23 thiết kế. Có **86 tổ hợp method/path khác nhau trong source**. Con số này bao gồm API phụ thuộc Staff và API bị loại khỏi Customer; không phải 86 API an toàn để mở cho mobile.

| Phân loại chính của dòng | Số dòng |
| --- | ---: |
| VERIFIED_FROM_BACKEND_SOURCE | 86 |
| UNSUPPORTED | 20 |
| MOBILE_FIXTURE_ONLY | 2 |

Mỗi dòng ghi request/response, role/ownership, lifecycle, gate, pagination/filter, lỗi, idempotency/version, retry và evidence. Các khả năng không có route không được thay bằng endpoint suy đoán. File summary JSON lưu số liệu máy đọc; checker xác nhận 0 method/path lệch với route source đã đối chiếu.

## C. Screen Coverage

**23/23 design ID có mapping**, lấy từ `docs/design-map.json`, gồm native route và screen component thực tế. Bảng 23 màn hình trong [API_AUDIT](PHASE6A_API_AUDIT.md) và các operation riêng trong CSV phân biệt rõ: chức năng local, API đọc, lệnh Customer, dependency Staff và chức năng chưa được hỗ trợ.

Luồng 5 tab và tất cả màn hình vẫn ở chế độ fixture. Không thay slug fixture thành Mongo ID thật; không trộn stock demo vào dữ liệu Backend. Mapping đủ không có nghĩa mọi thiết kế có Backend tương ứng.

## D. Auth & Ownership

Backend nhận Bearer access token và trả token trong JSON; native không cần dựa vào cookie website. Login sử dụng Keycloak phía server, middleware xác minh JWT rồi kiểm tra Mongo User/isActive. Registration buộc role CUSTOMER. Có current-user, profile, logout và password reset/change; **không có refresh endpoint của ứng dụng**. Không được nhúng confidential client secret vào native hoặc giả định có silent refresh.

Thiết kế 6B cần secure native storage cho refresh credential nếu sau này có contract, access token trong bộ nhớ, session epoch để loại response cũ, dọn cache theo Customer, xử lý 401 một lần và re-login khi chưa có refresh contract. Chưa triển khai storage/session.

Owner checks được audit riêng với authentication trong [SECURITY_AND_OWNERSHIP](PHASE6A_SECURITY_AND_OWNERSHIP.md). Phát hiện quan trọng:

- `GET /contracts/:id/print` thiếu kiểm tra owner/facility ở controller: **SECURITY_BLOCKED**, không đưa vào tích hợp mobile.
- Sign Managed chưa ràng buộc request với version/hash mà Customer đã review; service có thể bảo đảm/tạo version hiện tại trong lúc ký. Không thể coi frozen-review consent đã an toàn chỉ vì hai chữ ký cuối cùng cùng version/hash.
- GET Self reservation có so sánh owner sau populate đáng ngờ, cần test Backend để xác định runtime; không khẳng định đã tái hiện 403 live.
- Support related private entity chưa xác thực ownership/existence đầy đủ. Ticket/message có owner scope; chưa chứng minh đây là API đọc lộ resource liên kết.
- OTP/reset và logout/JWT revocation có các giới hạn source đã ghi; không chứng nhận production auth readiness.

## E. Booking & Lifecycle

**Self Storage** chọn đúng một Storage Unit; **Managed Inventory** chọn một hoặc nhiều Cell. API và DTO hai luồng khác nhau, không thay thế ID cho nhau.

Self create yêu cầu thời điểm bắt đầu tương lai, dùng lock/transaction và hold 24 giờ, không có idempotency contract. Source overlap bỏ qua DEPOSIT_PAID/CHECKIN_READY; pricing và binding rule cũng cần Backend xác nhận/sửa trước khi mở tạo booking an toàn. Storage Unit list không cung cấp availability theo interval và từ chối startDate/endDate.

Managed quote/create dùng UTC, term DAY/MONTH/YEAR, Cell IDs, capacity và giá server. Create V2 yêu cầu Cell đủ điều kiện và profile đã xác minh, transaction/lock/overlap; không tự dựng capacity. V2 deposit flow chỉ hoạt động khi `NODE_ENV === development` và `MI_MANAGED_DEPOSIT_FLOW_ENABLED === true` theo source; deployment chưa xác minh. Quote/create không có idempotency chung cho phép retry mù.

Chuỗi V2 chính: RESERVED → deposit được Backend xác nhận → DEPOSIT_PAID → Staff inspection/contract → hai chữ ký hợp lệ → balance được xác nhận hoặc nhánh zero balance → CHECKIN_READY → Staff first inbound → ACTIVE. Không coi thanh toán hoặc Customer ký là physical handover.

Source có các enum Reservation: RESERVED, DEPOSIT_PAID, CHECKIN_READY, CONTRACTED, PAID, ACTIVE, OVERDUE, CHECKED_OUT, CLOSED, CANCELLED. Eligibility dựa vào service/version/gate/owner và dữ liệu thực, không chỉ nhãn status của fixture.

Map có Rack position/orientation/dimensions và Cell structure, nhưng thiếu hình học Zone/floorplan đủ metadata. Không được gán tọa độ minh họa là vật lý thật. Giữ `periodStatus`, operational/physical usage và `isBookable` riêng; ownership không làm Cell RESERVED thành bookable.

## F. Inventory

Có API thật cho list/detail/register/edit, stock balance, movements, image upload, first inbound, repeated inbound và canonical outbound. Form mobile còn thiếu `itemCode` bắt buộc, enum/status/eligibility và các field cũng có drift. Danh sách parser nhận search/status/category nhưng service listMine chưa áp dụng các filter đó; cần trình bày đúng phạm vi trang thay vì giả search toàn bộ.

Registered quantity không phải on-hand. Stock balance là nguồn cho onHand/held/batches/version/source; thiếu projection phải báo chưa có dữ liệu, không fallback quantity hoặc zero. Không cộng movement để tự dựng stock. Cần giữ actual/declared measurement, unit và arithmetic policy COMPATIBILITY/CANONICAL_V1 riêng; đơn vị/độ chính xác fixture không phải policy Backend.

Repeated inbound create/amend có `MI06_REPEATED_INBOUND_ENABLED`, production forced off; header Idempotency-Key, If-Match cho amend/cancel và custody/inspection checks. List/detail/cancel không dùng cùng creation gate. First inbound là API khác, không hoán đổi.

Canonical outbound create cần `MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED` và ledger-write gate; production forced off cho request capability. Create chỉ nhận requestedQuantity, tạo holds chứ chưa lấy hàng vật lý. Có list/detail/cancel, không có amend. Cleanup/read không bị khóa giống create. Staff confirmation riêng; tuyệt đối không fallback legacy outbound khi canonical bị tắt.

Retry phải giữ đúng key/payload/version khi outcome unknown; không tạo intent/key mới để né conflict. Các thao tác Staff chỉ được ghi như dependency, không cho Customer gọi.

## G. Payments & Contracts

Source đang dùng **MOCK** cho các flow đã thấy; enum PAYOS không chứng minh đã tích hợp provider. Không tìm thấy mounted payment history/status/checkout/webhook/refund hay mobile checkout-return contract đầy đủ. Không có cơ sở triển khai deep-link payment success hoặc production checkout.

DEPOSIT và BALANCE là hai purpose. Deposit được credit vào total; Backend quyết định số tiền và trạng thái, mobile không tính lại rồi tuyên bố đã trả. Managed initiation tạo/replay PENDING theo body idempotencyKey, mock-confirm dùng lại key đúng intent; zero-balance là nhánh server riêng. Confirmation không đồng nghĩa ACTIVE.

Self initiation hiện trả breakdown; mock-confirm thiếu environment gate đã xác nhận trong source, các vấn đề transaction/service guard đã ghi. **Giữ fail closed**, không dùng Vite/Expo development flag để thay điều kiện Backend.

Managed contract có snapshot/version/hash và hai signature cùng nội dung hiện tại, Customer trước Facility. DRAFT có thể đã có Customer signature; không tự thêm Backend PARTIALLY_SIGNED enum. Sign vẫn bị chặn bởi review/version issue nêu trên. Safe owner-scoped reads có thể lập kế hoạch; print endpoint không được mở. Không có bằng chứng CA/OTP-certified signing/PDF sealing.

## H. Notifications & Support

Notifications có owner-scoped GET `/notifications/me` và PATCH `/:id/read`; không có bulk read/count/detail/delete riêng, typed destination metadata, push/WebSocket đã xác minh. Chỉ tính unread từ tập trả về theo đúng contract; không dựng route từ title/content tùy ý.

Support có list/create/detail, Customer edit OPEN và conversation GET/POST thực. Internal messages bị lọc/Customer không được gửi internal. Có category/status/priority enums; không có attachment contract. Form mobile hai liên kết optional chưa khớp `relatedEntity` đơn. Không đưa assignment/escalation/internal field thành Customer controls.

## I. Contract Drift

[CONTRACT_DRIFT](PHASE6A_CONTRACT_DRIFT.md) ghi 28 nhóm khác biệt, gồm evidence ba lớp và remediation. Các drift lớn: token refresh không tồn tại; fixture ID/quantity/pricing không authoritative; exact Unit availability thiếu; geometry không đủ; Managed V2 gates development-only; registration thiếu itemCode; repeated inbound/outbound DTO khác fixture; partial signature không phải status enum; payment timeline/checkout không có API; notification target/bulk và support relatedEntity khác design.

Không sửa domain, form, fixture hoặc website để che drift trong Phase 6A.

## J. Integration Readiness

| Support level | Dòng |
| --- | ---: |
| READY_FOR_INTEGRATION | 17 |
| READ_ONLY_READY | 30 |
| PARTIALLY_SUPPORTED | 18 |
| BACKEND_BLOCKED | 17 |
| SECURITY_BLOCKED | 7 |
| NOT_SUPPORTED | 19 |

17 READY gồm **2 thao tác local không có HTTP**, không phải 17 live endpoints. Mức READY là đủ evidence để lập kế hoạch, không phải deployment/API test PASS. 47 dòng ready/read-only, 18 partial, 24 backend/security blocked và 19 unsupported/excluded; không suy ra phần trăm production readiness. [GAP_REGISTER](PHASE6A_GAP_REGISTER.md) có độ ưu tiên, dependency và điều kiện đóng.

## K. Phase 6B Plan

[PHASE6B_INTEGRATION_PLAN](PHASE6B_INTEGRATION_PLAN.md) là kế hoạch, chưa thực thi:

1. 6B.0: xác minh deployment/revision/gates, đóng blocker security, chuẩn bị môi trường/test accounts được phê duyệt.
2. 6B.1: auth/session/profile; không giả refresh, kiểm thử owner/session/cache.
3. 6B.2: catalogue và Customer read-only rentals/dashboard.
4. 6B.3: discovery/availability/pricing; dữ liệu map thật, xử lý geometry gap.
5. 6B.4: reservation commands sau khi đáp ứng blocker, lock/conflict/unknown outcome.
6. 6B.5: inventory reads/stock/batches/movements trước mutations.
7. 6B.6: register/edit/images và request inbound/outbound theo capability đã xác nhận.
8. 6B.7: safe contract reads trước; signing/payment chỉ sau khi giải quyết security/provider/gate dependencies.
9. 6B.8: owner-scoped notifications/support theo capabilities có thật.

Mỗi batch có dự kiến file thay đổi, DTO/adapters, failure handling, test/device acceptance, rollback và fail-closed conditions. Feature cutover phải tách hoàn toàn fixture và real data; không có global flag bỏ qua security. Secure storage/dependency remediation chỉ là đề xuất cho phase sau.

## L. Preservation và kiểm tra

Chỉ tạo **11 file tài liệu/metadata** trong `customer-mobile/docs/`:

- PHASE6A_API_AUDIT.md
- PHASE6A_API_CONTRACT_MATRIX.csv
- PHASE6A_CONTRACT_EVIDENCE.md
- PHASE6A_SECURITY_AND_OWNERSHIP.md
- PHASE6A_CONTRACT_DRIFT.md
- PHASE6A_GAP_REGISTER.md
- PHASE6B_INTEGRATION_PLAN.md
- PHASE6A_REPORT.md
- PHASE6A_SOURCE_BASELINE.json
- PHASE6A_MATRIX_SUMMARY.json
- PHASE6A_PRESERVATION.json

README không thay đổi. Không sửa application source, screens, tests, fixtures, domain, forms, stores, routes, dependencies/config hoặc website. Không cài package. Không thay API client/guard.

| Kiểm tra thực hiện trong Phase 6A | Kết quả |
| --- | --- |
| `npm run typecheck` trong customer-mobile | PASS |
| `npm test -- --silent` | PASS — 375 tests, 8 suites |
| `npm run verify:website` | PASS — 1074 checked, 0 changed, 0 missing |
| `node scripts/verify-ui-completeness.cjs` | PASS — 23 unique designs, 0 missing source/routes |
| CSV structural/source-route checker | PASS — 108 rows × 28 columns, 23 designs, 86 source method/path, 0 mismatch |
| Hash baseline existing mobile files | PASS — 152 checked, 0 changed/missing |
| Hash baseline BE-REF src/tests/docs | PASS — 221 checked, 0 changed/missing |
| Axios fail-closed guard SHA-256 | Unchanged — `cfc5016fd0b5cd0e60183f7a73adf1ca30e2de6ff97ebbedfdbfdcb1b500d774` |
| Backend tests/live API | NOT RUN — source-only audit; no requests or Backend execution |
| Native exports / 7 RN Web smoke scripts | SKIPPED this phase — documentation-only changes; previous Phase 5B results are historical |
| Android/iOS device E2E | NOT VERIFIED — not performed |

Baseline metadata scopes extensions/files explicitly; it does not assert a full filesystem or database snapshot. `BE-REF` unchanged within all 221 source/test/doc files checked; no writes were performed anywhere in that directory. Existing unrelated working-tree changes were preserved.

## M. Limitations và kết luận

Không biết BE-REF có trùng deployed revision không; chưa xác minh environment gates, TLS/API URL policy, native identity-provider settings, database transaction capability, Cloudinary deployment policy hay provider configuration. Không có live connectivity, ownership attack test, payment E2E hay mutation test. Backend assertion source không thay thế kết quả chạy integration test.

Dependency baseline **19 findings: 13 Low, 6 High, 0 Critical** là lịch sử từ phase trước, không phải scan mới. Kế hoạch tách native runtime/development-tooling và xác minh lockfile/advisory/reachability nằm trong integration plan; không tự audit-fix/upgrade. Native gaps còn gồm device/simulator, keyboard/hardware Back, deep links, safe areas/font scaling/screen reader, secure session persistence, network loss/resume/background, memory/performance và checkout return chưa có contract.

**Phase 6A hoàn tất ở mức audit source và kế hoạch. Mobile vẫn offline fixture, Axios vẫn fail closed. Chưa đủ điều kiện tuyên bố production ready hoặc mở toàn bộ API. Phase 6B không được triển khai trong tác vụ này.**
