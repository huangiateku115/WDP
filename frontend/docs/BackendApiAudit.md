# Frontend integration check — 13/10/2026

Integrated Staff/Manager changes onto origin/Frontend e10a702, which already includes dev 1b1dbbd. Preserved upstream Customer UI, Cloudinary settings and Customer/warehouse/inventory API permissions. Resolved overlaps in .env.example, confirmedContract.js and CustomersPage.jsx; no backend source changes.

Validation: Staff/Manager review and inspection browser fixtures PASS; Self Storage, Inventory and Managed contract checks PASS. Customer login/logout/pricing regression PASS (local runtime/port and missing profile response adapted in memory; 15 responsive checks). These tests use synthetic API responses, not live business writes. Maintenance/Support adapters remain preparatory; their live UI is not complete.

The shared allowlist test now includes Manager approve/reject and existing Customer inventory registration; backend remains responsible for role authorization. Local environment files and secrets are excluded from Git.

---

# Phase 2 — Inspection + Check-in (12/10/2026)

Chỉ triển khai React Web P030/P025 trên các route nghiệp vụ hiện có. Không sửa backend, không seed, không chạy API ghi database thật, không commit/push/merge/deploy. Các thay đổi Iteration 1–2 chưa commit từ lượt trước được giữ nguyên.

| Iteration | Task ID | Feature | Frontend | Backend | API | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | P030 | Unit Inspection Checklist | List/detail theo facility; lọc reservation/unit; tạo CHECK_IN DRAFT; checklist lưu trong notes, condition enum thật, URL ảnh; loading/error/empty và khóa gửi | Có list/create/complete, thiếu scope/validation server, thiếu GET detail và PATCH sửa draft; không có field checklist/upload | GET/POST /inspections, PATCH /inspections/:inspectionId/complete | PASS fixture và responsive; live NOT TESTED | PARTIAL: frontend Manager triển khai; Staff tạo/hoàn tất chờ quyền kiểm tra dữ liệu |
| 3 | P025 | Check-in Rental | Kiểm tra lại PAID, hợp đồng SIGNED đúng đơn/khách, đúng unit/facility, biên bản DRAFT; confirm; đọc lại ACTIVE/OCCUPIED; chặn trùng và lỗi 400/401/403/404/409 | complete CHECK_IN tự kích hoạt đơn/tủ, thiếu kiểm tra trạng thái/thanh toán/hợp đồng/scope và transaction server | GET reservation/contract/unit và inspections; PATCH complete | PASS fixture, gồm response hoàn tất nhưng đơn/tủ chưa đổi; live NOT TESTED | PARTIAL: tích hợp frontend sẵn, blocker backend còn High |

## Files và endpoint

Thêm `src/api/inspectionApi.js`, `src/lib/inspectionReview.js`, `src/pages/staff/InspectionApiView.jsx`, `.design-reference/check-inspection-api.cjs`. Sửa tối thiểu `StaffPages.jsx` để dùng live view cho INSPECTION/CHECK_IN; mở allowlist GET/POST inspections, PATCH complete, GET contracts/:id; thêm link Inspection/Check-in vào Manager sidebar ở chế độ API thật. Không thay route cũ và không đổi luồng demo.

Endpoint đã nối: GET `/inspections?reservationId=...&storageUnitId=...`; POST `/inspections`; PATCH `/inspections/:inspectionId/complete`; GET `/reservations/facility/:facilityId`, `/reservations/:id`, `/contracts/:id`, `/storage-units/:id`.

Không có GET `/inspections/:id`: detail được tìm từ danh sách API rồi giới hạn facility. Không có endpoint check-in riêng: hoàn tất CHECK_IN là thao tác check-in. CHECK_OUT chỉ hiển thị read-only trong phase này.

## Blocker và bảo vệ phía frontend

- Staff được route inspections cho phép, nhưng reservation detail/list và contract detail không cho Staff. UI không gọi các API bị cấm và không tạo/hoàn tất khi chưa xác minh điều kiện.
- Manager cần assignedFacilityId thật. Không hiển thị biên bản ngoài facility; backend phải bổ sung scope server vì GET inspections hiện có thể trả dữ liệu toàn hệ thống.
- Backend cần kiểm tra PAID, hợp đồng SIGNED, liên kết unit/facility, điều kiện unit, chống nhiều inspection check-in trùng và transaction khi complete. Frontend preflight không khắc phục được race hoặc người gọi API trực tiếp.
- Checklist hiện lưu bằng nội dung notes trong POST, ảnh là URL HTTP/HTTPS. Không invent trường checklist, API upload hoặc audit; inspectedBy do backend ghi.
- Hợp đồng Manager mở bằng Contract ID thật; chưa có lookup contract theo reservation. Không dùng /contracts/me của Customer. Chưa có sửa draft, nên biên bản DAMAGED/NEEDS_CLEANING không thể check-in và cần backend hỗ trợ xử lý tiếp.
- Các mã P034/P035/P038... ở Iteration 4 trong prompt được dùng như mô tả đề xuất; chưa xác nhận chúng là mã/owner Excel tương ứng. Chưa triển khai các task này trong Phase 2.

## Kiểm thử và thao tác thủ công

`node .design-reference/check-inspection-api.cjs`: PASS với API fixture, không ghi DB thật. Kiểm tra payload đúng ID, điều kiện/checklist/URL, PAID/SIGNED, duplicate, lỗi HTTP, sai facility, Staff read-only, phản hồi không nhất quán, desktop/mobile. Build frontend PASS; lint chưa có script/config. Backend local/Keycloak/MongoDB và authenticated E2E: NOT TESTED. Không sửa hoặc build backend trong phase frontend này.

1. Chạy backend do nhóm backend chuẩn bị; frontend dùng VITE_USE_MOCK=false và API base /api/v1.
2. Đăng nhập FACILITY_MANAGER có assignedFacilityId. Mở `/manager/work/INSPECTION` hoặc link Inspection trên sidebar. Chọn đơn Self Storage PAID trong cơ sở; nhập Contract ID SIGNED đúng đơn/khách.
3. Chọn condition GOOD/EXCELLENT, tick checklist, ghi notes, URL ảnh nếu có; Lưu biên bản nháp. Sau response thật, trang chuyển đến `/manager/work/INSPECTION/<InspectionID>`.
4. Nhập lại Contract ID khi mở detail; tick xác nhận, Kiểm tra và nhận kho → Xác nhận nhận kho. Mỗi lần hoàn tất frontend đọc lại điều kiện. Chỉ thông báo thành công khi backend trả COMPLETED và GET xác nhận ACTIVE/OCCUPIED.
5. `/manager/work/CHECK_IN` dùng cùng biên bản/lifecycle. `/staff/inspections` và `/staff/check-ins` cho Staff xem dữ liệu trong cơ sở, ghi rõ blocker quyền.
6. Postman trên bản ghi test được phép: đọc reservation PAID, contract SIGNED, unit cùng facility; GET inspections; POST inspection với reservationId/facilityId/storageUnitId/type CHECK_IN/condition/notes/images; lấy inspection._id và PATCH `/inspections/<InspectionID>/complete`; GET lại reservation/unit để xác nhận. Không truyền Reservation ID vào đường dẫn complete. Không thực hiện trên dữ liệu thật khi chưa được phép.

Dừng sau Phase 2 và chờ người dùng xác nhận trước Phase 3 — Maintenance + Support. Không tự đánh dấu toàn bộ Phase 2 DONE khi blocker backend còn tồn tại.

---

# Staff / Facility Manager — cập nhật 12/10/2026

Đã fast-forward nhánh dev tới `1b1dbbd`. Chỉ sửa frontend; không thay đổi backend, seed, database, commit, push hay merge. Những nhận định cũ về role khách hàng/Managed Reservation bên dưới cần đọc cùng cập nhật này.

## Chế độ chạy

- `VITE_USE_MOCK=false`: API thật, dùng `.env.example` với base `http://localhost:5000/api/v1`. File `.env.local` trên máy chọn cấu hình này và được Git ignore. Không đưa MongoDB, JWT secret hoặc Keycloak client secret vào frontend.
- `VITE_USE_MOCK=true`: dữ liệu browser demo riêng vẫn được giữ. Các kết quả fixture không phải giao dịch backend.
- Staff/Manager trong chế độ API thật được xác minh qua GET `/users/me/`, kiểm tra role trước khi mở workspace. Giữ `assignedFacilityId` từ response, không dùng FAC001 làm cơ sở thật.

## Iteration 1–2

| Task | Frontend đã triển khai | Phần chờ backend / kiểm chứng |
| --- | --- | --- |
| P010 | GET `/customers`, GET `/customers/:profileId`; mapping userId/profileId, tìm tên/email/SĐT, loading/empty/error/retry; không hiển thị CCCD/tài liệu định danh | Customer API chưa có scope cơ sở và dùng fullName thay vì displayName. Lịch sử thuê chỉ đọc được Self Storage trong cơ sở Manager qua GET `/reservations/facility/:facilityId`; lịch sử đầy đủ và lịch sử cho Staff chưa có API |
| P011 | PATCH `/customers/:profileId/verify` với status/note, ghi chú bắt buộc, khóa gửi trùng, đọc lại dữ liệu sau response xác nhận và báo thay đổi giữa các tab; Staff đã được route backend mới cho phép | Backend chưa có lịch sử đầy đủ, validation/scope vẫn còn thiếu. UI chỉ ghi lần xác minh gần nhất có trong response, không dựng audit giả |
| P013 | Manager đọc danh sách/chi tiết Self Storage, approve/reject, dùng RESERVED/CONTRACTED/CANCELLED, reason bắt buộc; response Managed approve `{data:{reservation,contract}}` được map riêng; xử lý 400/401/403/404/409, khóa gửi, refetch | Staff chưa có quyền reservation. Chưa có Managed list theo facility, nên Managed dùng mở theo ID thật. Thông báo khách, tính nhất quán approve/contract và phạm vi backend cần backend xác nhận/sửa; frontend không sửa backend |
| P064/P065 | Giữ giao diện demo riêng; chế độ API thật hiển thị chờ backend, chặn cả đường dẫn refund legacy, không gửi API đoán tên và không đổi Payment thành REFUNDED | Chưa có model/route/service/API refund hoặc policy được chốt trong source/collection hiện tại |

API allowlist được mở đúng các endpoint đọc/xác minh khách, đọc danh sách đặt chỗ theo cơ sở và đọc/duyệt/từ chối Self/Managed Reservation. Không mở wildcard cho refund/payment.

## Kiểm thử

**PASS:** `node .design-reference/check-facility-review-api.cjs` dùng Playwright với response API giả lập, không gọi hoặc ghi vào database thật. Kiểm tra: search/empty, verification, ID/assignment mapping, refetch hai tab, contract response, gửi trùng, reason, 400/401/403/404/409, response không xác nhận chuyển trạng thái, retry, thiếu facility, sai role, chưa đăng nhập, thiếu API Staff/refund, Managed theo ID và responsive.

Kiểm tra hồi quy demo dùng server riêng `VITE_USE_MOCK=true` ở cổng 5174, bỏ bước ghi screenshot và cung cấp phiên Customer giả lập trong bộ nhớ cho receipt. Không chỉnh sửa backend hoặc dùng secret để chạy database/Keycloak.

API end-to-end, phiên Keycloak thật và persistence MongoDB: **NOT TESTED** vì backend local chưa chạy. Không đánh dấu DONE toàn bộ Iteration 1–2 chỉ từ fixture. **Chưa bắt đầu phát triển Iteration 3–4 trong lượt này**; chờ các phụ thuộc Iteration 1–2 nêu trên. Các màn hình Iteration 3 đã có từ trước vẫn giữ nguyên.

---

# Priority 1 + Priority 2 backend API audit

## Contract and scope

Source: `C:/Users/laptop/Downloads/WDP.postman_collection.json`, supplied by the backend team, plus the login token response nesting explicitly confirmed in the task. Request methods and JSON body keys were inspected without copying collection credentials or Bearer tokens.

Backend: `http://localhost:5000`; base API: `http://localhost:5000/api/v1`.

Only authentication, customer registration and current-user profile/password features are integrated. Existing Customer/Manager screens, routes, business demos, green/orange theme and components are preserved. No Priority 3 Staff or Admin workspace was created.

## Audit findings and changes

| Area | Before | After |
|---|---|---|
| Login/Register | UI buttons navigated without calling an API | Existing forms call the confirmed login/register APIs, with pending/success/error handling and duplicate-submit guards |
| Auth API | Mock login tokens; old `/auth/register` and `/auth/me` paths | Auth/profile always use the confirmed real API, independently of business-demo mode |
| Login response | Old adapter expected `data.token` | Access/refresh tokens read strictly from `response.data.data.accessToken` and `.refreshToken`; malformed responses do not create a session |
| Axios base | `/api` default and example | Existing environment base is reused; `/api` is normalized to `/api/v1`. Origin and explicit `/api/v1` values also work |
| Token storage | `SelfStorage_token`, `SelfStorage_user`; no refresh-token handling | Existing access/user keys retained; `SelfStorage_refreshToken` added. One shared session helper, no duplicate Axios client or auth provider |
| Protected requests | Access token interceptor existed | Confirmed protected requests use `Authorization: Bearer <accessToken>`. Login/registration bypass stale authorization headers |
| Profile | Priority 1 browser demo by default; live edit disabled | Signed-in account loaded via real GET, supported fields updated via PUT, then refreshed via GET. No mock profile fallback |
| Unsupported fields | Email/address/company could be edited in the demo | Profile edits send only `displayName` and `phone`; email/address/company stay display-only and are never written to the API |
| Password | Unavailable placeholder | Current/new/confirmation inputs; only `oldPassword` and `newPassword` sent; confirmation and duplicate checks; secret inputs cleared after success |
| Logout | No implementation/UI | Confirmed logout with stored refresh token; success clears auth state/tokens/user and navigates to existing `/login`; non-401 server failure leaves the session intact for retry |
| 401 handling | Cleared access/user keys only | Clears access, refresh and cached identity together. A late response for an older token does not invalidate a different current session |
| Role handling | Mock CUSTOMER value, no authenticated role routing | Known `FACILITY_MANAGER` from the returned user profile routes to existing Manager dashboard. Other roles retain existing `/portal` fallback. No new role names or Staff routes are invented |
| Route guards | No authentication/role guards | Existing route structure and accessible demo pages preserved. Frontend role redirects are not authorization; protected APIs must enforce backend authorization |
| Missing business APIs | Legacy modules had unconfirmed network branches | Existing mock implementations are unchanged. A central contract check rejects unconfirmed Axios requests before network dispatch; no fake backend endpoints are substituted |

The Postman collection also contains Admin user-management requests, a Keycloak token request and an auth-sync request. These are not needed for the requested direct API-login/current-profile flow. Admin users are not a confirmed facility-scoped Customer/Staff API, so Manager tables remain demos instead of incorrectly reading the global Admin user list. No unused Admin UI or Keycloak/sync flow was added.

The collection contains no saved response examples for the current-user DTO. The adapter accepts a user object either under `response.data.data` or directly under `response.data`; real-backend DTO verification remains necessary when the server is running. Login token nesting follows the explicit confirmed task contract.

## Files modified (8)

- `src/api/axiosClient.js` — environment-based v1 base normalization, confirmed-request check, shared token access and complete 401 session cleanup.
- `src/api/authApi.js` — corrected real login/register/me methods; real logout; existing method names retained.
- `src/pages/auth/LoginPage.jsx` — real form submission, nested token parsing, existing-route navigation, backend error/pending states. Unsupported social/OTP providers remain disabled; login is email-based according to Postman. The 30-day remember-device promise was replaced with an accurate existing-localStorage description.
- `src/pages/auth/RegisterPage.jsx` — supported registration body, consent and pending states; successful creation leads to existing sign-in route without inventing registration tokens.
- `src/pages/customer/ProfilePage.jsx` — real loading/edit/password/security interactions with unchanged card layout and styles.
- `src/components/common/CustomerScreen.jsx` — optional notice override so the real Profile screen is not incorrectly labeled a demo; other pages keep their existing notice behavior.
- `src/layouts/CustomerLayout.jsx` — authenticated cached display name in existing header.
- `src/layouts/ManagerLayout.jsx` — authenticated display name and compact logout control in existing header; business data/layout/navigation remain unchanged.

## Files created (5 production source)

- `src/api/userApi.js` — confirmed current-user profile/password methods, using the existing Axios instance.
- `src/api/confirmedContract.js` — base normalization and confirmed-request guard. The guard is a network integration constraint, not a security/role permission guard.
- `src/lib/authSession.js` — access/refresh/cached identity management and same-tab/cross-tab subscription using the existing token/user keys. Only identity fields are cached, not credentials or an arbitrary full backend DTO.
- `src/lib/apiError.js` — safe textual backend messages (including validation message arrays), connection errors and bounded output; no raw response serialization or HTML injection.
- `src/components/common/LogoutButton.jsx` — shared pending/error-aware real logout control.

Documentation: `docs/BackendApiAudit.md`.

Validation helpers/artifacts are retained under `.design-reference/`: `inspect-postman-contract.py`, `check-backend-reachability.py`, `check-confirmed-auth.cjs`, `check-auth-responsive.cjs`, responsive auth screenshots and implementation helpers. No Postman credentials/tokens were copied to project source.

No changes to AppRoutes, configuration files, package.json, dependencies, existing business API methods, Customer/Manager mock stores or business routes.

## APIs actually integrated

| Method | Endpoint | JSON request body |
|---|---|---|
| POST | `/api/v1/auth/login` | `email`, `password` |
| POST | `/api/v1/auth/logout` | `refreshToken` |
| POST | `/api/v1/users/register` | `email`, `password`, `displayName`, `phone` |
| GET | `/api/v1/users/me/` | None |
| PUT | `/api/v1/users/me/profile` | `displayName`, `phone` |
| PUT | `/api/v1/users/me/password` | `oldPassword`, `newPassword` |

Six endpoints are integrated. The central request check also recognizes the four confirmed Admin user-management endpoints, but no Customer/Manager screen calls them and no Admin feature was implemented.

## Real data and remaining demo/API-ready pages

Real API features: `/login`, `/register`, `/portal/profile` (load/update/password), authenticated identity labels, and logout from Profile/Manager header. Profile always requires actual authentication; business mock mode never substitutes a fake identity or fake successful profile/password operation.

Priority 1 business features still use the existing isolated `customerData.js` / `customerDemoStore.js`: rentals/access/extensions, inventory registration/detail/movement requests/history, payment history/refunds/charges and notifications. Existing reservation/contract demo adapters and workflows are preserved. Support, booking/public facility/pricing displays remain existing UI/demo or API-ready functionality.

Priority 2 Manager business features still use `managerData.js` / `managerDemoStore.js`: facility dashboard, reservations, customers/verification, private units, Zone/Rack/Shelf, operations, staff assignments, extensions, operational detail/checklists, maintenance, support, refunds/charges and reports. Current auth identity does not turn demo facility assignments or business approvals into real backend data. Report exports remain disabled without an export API.

`VITE_USE_MOCK=true` keeps business demos usable while authentication/profile continue to call the real confirmed API. `VITE_USE_MOCK=false` keeps unavailable business actions/data in their existing API-ready/disabled states; legacy network branches are blocked before any unconfirmed endpoint is sent.

Required future backend contracts: facilities/assigned-facility scope, storage units/locations, reservations/contracts, pricing/policies, rentals/extensions/access, payments/history, managed inventory/movements, notifications, support, maintenance, staff/tasks, check-in/checkout/inspection/handover, refunds/extra charges and reports/exports. Audit/login-history APIs are also not confirmed and were not added.

## Validation and practical limits

- Local backend reachability: GET `/api/v1/users/me/` without any collection credentials could not connect to localhost:5000. No live-user account was created, no real password changed and no real logout was attempted.
- Contract browser tests use intercepted responses solely in `.design-reference/check-confirmed-auth.cjs`. Production code calls the real confirmed endpoints; there is no mock auth/profile fallback.
- Contract checks cover registration body/consent/duplicate guard/success redirect; login error rendering without executing HTML, nested tokens, actual token keys; loading, editable-field restrictions, exact profile body, Bearer header and refreshed profile; password confirmation/body/array error/pending/secret-input clearing; failed/successful logout and refresh-token body; confirmed Manager-role redirect/header identity; protected 401 cleanup; rejection of unconfirmed paths before network dispatch.
- Regression checks cover existing Customer reservation/contract persistence and Manager demo interactions. Responsive checks cover retained Manager screens and auth/profile forms at 1440px and 390px with no document-wide horizontal overflow. Flat/unconfirmed login-token responses are rejected without creating a session; logout synchronizes between tabs.
- `npm run build`: passed. Vite’s main-chunk >500 kB warning remains non-fatal; no dependency/configuration changes were made to address an unrelated bundle refactor.

Live end-to-end verification is still required once the backend is running with an authorized test account. API integration is complete against the supplied request contracts; unavailable business APIs remain intentionally unintegrated.

## Priority 5 Admin addendum — 2026-10-05

This addendum updates current usage; earlier sections describe the historical Priority 1/2 audit. Priority 3 Staff and Priority 4 BOM demos subsequently exist, and Priority 5 now integrates confirmed Admin User APIs.

Real operations added to the existing `src/api/userApi.js`:

| Method | Confirmed endpoint | Body |
| --- | --- | --- |
| GET | `/api/v1/users` | None |
| POST | `/api/v1/users` | `email`, `password`, `displayName`, `phone`, `role` |
| PATCH | `/api/v1/users/:id/role` | `role` |
| DELETE | `/api/v1/users/:id` | None; account deactivation per Postman naming |

There are now ten used confirmed endpoint contracts including the original six Auth/Profile operations. Admin functions always use the existing Axios/Bearer/baseURL infrastructure, independently of business mock mode. No token/interceptor/baseURL changes or additional Axios instance were made. The existing confirmed-request guard already permitted these Admin operations.

`/admin/users` uses the real collection only. User detail resolves from that collection; no GET-by-id is invented. User creation/change/deactivation refresh GET Users after success. Passwords are cleared and never persisted/logged; returned account fields are sanitized into an in-memory session-scoped cache. Failed/offline/403/unsupported DTO responses never fall back to fixtures. Existing 401 session cleanup is reused.

Admin Login History/Audit/Facility Oversight remain explicitly isolated demo/API-ready modules; no missing endpoint is sent. Static audit examples do not claim to record actual User API mutations. Manager/Staff/BOM state remains separate and existing business rules are preserved.

Current Postman literal role examples are FACILITY_MANAGER and FACILITY_STAFF. Default Admin role options use these plus values actually observed in a backend collection. ADMIN/BOM role enums are not confirmed by saved contracts; login redirects remain unchanged pending confirmation. Frontend navigation is not a backend permission check.

The collection has no saved User-list response DTO example. The adapter supports common array/user collection wrappers and fails visibly for others; actual DTO, pagination, authorization and deactivation semantics need live verification. Backend probe to localhost:5000 without credentials was unavailable. No real Admin mutation was performed.

Validation: intercepted four-method contract tests, loading/errors/empty/retry/duplicate/password/401 behavior, session isolation/late response tests, VITE_USE_MOCK=false behavior and 28 Admin desktop/mobile route checks passed. Public/Customer/Manager/Staff/BOM/Auth regressions and npm run build passed. Existing non-fatal main-bundle >500 kB warning remains.

Full report: `docs/AdminPriority5.md`.

## Auth recovery / registration consent addendum — 2026-10-06

User-supplied Auth controller contract confirms POST `/api/v1/auth/forgot-password` with `{email}` and POST `/api/v1/auth/reset-password` with `{email,otp,newPassword}`. Both public methods now use the existing Axios client with skipAuth; confirmed-request allowlist extended only for these paths. No OTP/password/token storage changes and no invented endpoints.

Registration still sends only email/password/displayName/phone to `/users/register`. Terms/Privacy agreement is explicit frontend dialog consent only; server persistence/versioning requires a future contract. Existing Login/Profile/Logout integrations preserved.

Recovery/consent responsive tests and existing Auth/Profile contract regression passed; build passed. Backend localhost:5000 responds (unauthenticated Users probe: 401); real email delivery and password mutation were not performed. Full scope, gaps and validation: `docs/AuthRecoveryConsent.md`.

## Customer Core Rental addendum — 2026-10-08

Source: supplied Customer integration request, WDP.postman_collectionV2.json and docs_rental_workflow.md; local storage/pricing/facility backend source inspected read-only. Existing Auth/User integrations are preserved. Customer core reads and identity/access writes use the existing client/session without mock fallback. Existing Customer URLs are unchanged and now have an authenticated Customer gate.

Public facilities/options/pricing, authenticated units, pricing/policy resolve, reservations/me/detail, contracts/me, support list/detail, identity PUT and simulated-access POST are wired. Exact create-reservation and mock-pay request methods are API-ready but production UI remains disabled pending amount/policy and payment-eligibility contracts. Signing is not allowlisted or sent because V2 POST/body conflicts with workflow PATCH/no-body. Support creation/reply and message visibility remain contract-blocked. No Manager/Staff approval/inspection actions or invented payment/extension/cancellation APIs.

Strict new response reading requires success:true and data; unsupported envelopes fail visibly. Actual newer DTOs, DRAFT contracts, unlock outcome mapping, Customer verification retrieval and pricingPolicyId/deposit semantics still require backend confirmation. Existing checkout source lacks these new controllers; localhost:5000 public/health probes were unreachable. No real authenticated E2E/mutations were performed.

Executed: synthetic Customer contract/guard/lifecycle/security tests, 36 responsive views, other-role route smoke tests and Auth/Profile regression. Build passed. Full implementation matrix, changed files and blockers: docs/CustomerCoreRentalIntegration.md.
