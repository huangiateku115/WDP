# Customer Portal Phase 2 — UI redesign

Ngày: 19/10/2026. Phạm vi: Customer Frontend UI/UX. Không truy cập `backend/`, không sửa BE-REF, Backend, database, API contract hoặc dependency.

## Các nhóm trang đã cải thiện

| Trang | Route hiện có | Cải thiện |
| --- | --- | --- |
| My Units / My Storage | `/portal` | Summary cards đếm trực tiếp dữ liệu reservation trả về; filter bar 2 cột; nhóm rental rõ trạng thái, card tự giãn theo số rental; link xem reservation. Không thêm metric doanh thu, sức chứa hay transaction giả. |
| My Inventory | `/portal/inventory`, `/portal/inventory/register`, `/portal/inventory/:id` | Cards, metadata, input, gallery/preview và khu vực chọn ảnh đồng nhất. Giữ nguyên upload, idempotency key, attachment lifecycle, eligibility, preferred Cell, Save/refresh và Inbound/Outbound. |
| Contracts | `/portal/contracts`, `/portal/contracts/:reservationId` | Contract collection dạng grid, empty state, snapshot section có phân tách, action/status đồng nhất. Giữ ký hai bên, version/hash validation và Print/Save PDF hiện có. |
| Payments | `/portal/payments` và các route payment/refund/charge hiện có | Filter/control/table/card/empty state theo theme chung; bảng vẫn cuộn ngang nội bộ trên mobile. Không thay nguồn transaction, số tiền hoặc provider. Payment History vẫn là workspace demo hiện có và giữ nhãn demo ở navigation. |
| Warehouse Map | `/portal/warehouse-map`, `/portal/warehouse-map/:facilityId` | Map nền xanh đậm, panel/control đồng nhất với Portal, focus/selection rõ, booking form nền sáng có heading tương phản, fullscreen không bị giới hạn max-width. Không đổi Cell status/availability, pan/zoom, preferred Cell hoặc allocation. |
| Notifications | `/portal/notifications` | Icon, read/unread label và border/nền khác nhau, giữ filter/read action, empty state riêng. Không thêm notification giả. |
| Profile | `/portal/profile` | Avatar/contact/security/identity cards theo theme chung, form/control rõ ràng, giữ đầy đủ edit/password/validation/session behavior. Không sửa ProfilePage, avatar helper hoặc authentication. |
| Support | `/portal/support` | Form tạo ticket nhóm 2 cột, textarea dễ dùng; card/detail/reply được thống nhất. Hướng dẫn/FAQ tái sử dụng được style chỉ trong Portal, không sửa Public support component hoặc API. |

## Thiết kế và component dùng lại

- Màu chủ đạo: `#123D2A`, `#1D7546`, `#F28C28`, `#F5F7F2`, `#202C25`.
- Giữ topbar/navigation tabs, Brand, fonts và React Bits hiện có; bổ sung breadcrumb Customer và nhãn workspace. Không tạo sidebar hay thay routing.
- Max-width khoảng 1200 px; title 24–30 px; body 14–16 px; control tiêu chuẩn khoảng 40 px; padding card 16–20 px. Không dùng zoom/scale.
- CSS mới chỉ nằm dưới `.customer-portal`. Không sửa shared Button/Card/Input/Badge/CustomerScreen hoặc style của Public/Staff/Manager/Admin/BOM.
- Tái sử dụng shadcn Card/CardContent và các badge/control hiện có, không tạo framework hay dependency mới.
- Dùng formatter hiện có cho tiền/ngày trên summary Managed V2 và thời gian notification theo Việt Nam; không sửa helper, số tiền, timestamp hoặc tính lại snapshot.

`CustomerPortalUI.jsx` thêm 4 component trình bày nhỏ:

1. `PortalBreadcrumbs`: liên kết workspace và tên nhóm trang; không thay route.
2. `PortalSummaryCards`: chỉ nhận giá trị từ response mà caller đang có. Dashboard đếm ACTIVE, PAID/CHECKIN_READY và tổng reservation trả về; không coi đây là tổng toàn hệ thống.
3. `PortalEmptyState`: icon, heading và hướng dẫn khi collection rỗng.
4. `PortalTextLink`: action link đồng nhất với icon trang trí.

Loading/error/retry dùng implementation cũ, chỉ đổi trình bày CSS. Notification read/unread không chỉ phân biệt bằng màu. Chế độ reduced-motion tiếp tục được giữ.

## Files thay đổi

Source có sẵn:

- `src/layouts/CustomerLayout.jsx`: import CSS và breadcrumb; đọc pathname chỉ để xác định nhãn trình bày. Giữ nguyên nav paths, session và Outlet.
- `src/components/customer/RentalLifecycleIntegration.jsx`: chỉ phần presentation của RentalsIntegration/ContractsIntegration: summary/filter/list layout/empty state/copy. Giữ nguyên API calls, filters, lifecycle, signature/payment handlers và contract detail.
- `src/components/customer/CustomerNotificationsIntegration.jsx`: read/unread visual hooks, icon và empty state; không đổi read API/action hoặc điều kiện filter.
- `src/components/customer/CustomerSupportIntegration.jsx`: copy và class hook compose card; không đổi submit/reply/API.

Source mới:

- `src/components/customer/CustomerPortalUI.jsx`.
- `src/layouts/customer-portal.css`.

QA/tài liệu mới:

- `.design-reference/check-customer-portal-phase2.cjs`.
- `.design-reference/customer-phase2-baseline.json`.
- `.design-reference/customer-phase2-before-metrics.json`, `customer-phase2-after-metrics.json`.
- `.design-reference/customer-phase2-comparison.html`.
- Screenshot trước/sau được liệt kê dưới đây; các screenshot regression hiện có cũng được tạo lại.
- Tài liệu này.

`dist/` được tạo bởi build, không commit. Không sửa package/config/env. Hash baseline của toàn bộ src xác nhận chỉ 4 source có sẵn trên thay đổi, cộng 2 source mới. Source API/lib/routes/services, Public, React Bits và các role layout khác giữ nguyên hash.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| Syntax parse | PASS, 216 JS/JSX/TS/TSX source |
| Production build | PASS; còn cảnh báo chunk >500 KB |
| npm test | PASS, 6 tests |
| managed-warehouse-booking.test.cjs | PASS, 3 tests |
| Inventory/Managed/Self Storage/Self Payment contract checks | PASS |
| Portal responsive mới | PASS, 8 nhóm trang × 6 widths; thêm Register/Item/Contract tại 390/1440, profile edit/password validation, support detail/reply, notification filter, empty/loading/error/retry, summary count, keyboard navigation, table scroll; 99 GET fixture, 0 live requests, 0 mutations |
| IMAGE-01 → IMAGE-03 | PASS, 66 request fixture, 0 live requests; multipart/key, type/size/count, quota/network/retry, create/refresh, add/discard/remove/reorder/save/persistence, session expiry |
| Inventory existing | PASS, 72 request fixture; create/edit DTO, guards, pagination, detail/history, preference, ownership/network/401 |
| Contract signing | PASS, 41 request fixture; DRAFT/partial/SIGNED, current version/hash, stale signatures, owner, GET refresh, single explicit mocked signature PATCH |
| Contract Print | PASS, 12 GET fixture; ownership/version, Self/Managed preview, automatic/manual print callback, denied errors. PDF export skipped for this UI regression; native print callback instrumented, no new Print API |
| Remember Me / auth | PASS; session/persistence/restart, current GET/roles, invalid/offline, logout success/failure, cross-tab, no password persistence |
| Current Cell status | PASS, 14 cases, 49 GET fixture, 0 writes; RESERVED/YOURS, OCCUPIED, unavailable/unknown fail-closed, selection restrictions |
| Digital Warehouse interactions | PASS; aggregates/coordinates, lazy GET/cache, tooltip/focus/Escape, zoom/reset/fullscreen, search, retry/stale selection, drawer/panning/session invalidation, responsive |
| Customer Inbound | PASS, 106 request fixture; eligibility, exact registration/inbound payload, pending/errors/recovery, legacy isolation |
| Customer Outbound | PASS; eligibility, mocked POST/body/auth, pending/checked-out/history, errors/network/duplicate lock, responsive |
| Public regression | PASS, 31 GET fixture; 6 routes, navigation, images, pricing/filter/FAQ/loading/errors/reduced-motion |

**Responsive widths:** 320, 390, 768, 1024, 1440, 1920 px. Không có horizontal document overflow trong các trang/fixture kiểm tra. Navigation và bảng rộng giữ scroll nội bộ; controls vẫn truy cập được bằng bàn phím. Đã xem ảnh desktop/mobile và sửa contrast heading của booking panel trên nền sáng.

Các test cũ chạy bằng cách đổi port sang Vite local trong bộ nhớ; fixture storage của một số test trước Remember Me được đổi sang sessionStorage trong bộ nhớ. Không sửa test cũ hoặc session implementation.

Test Digital Warehouse cũ lần đầu timeout vì mong `AVAILABLE` từ fixture thiếu periodStatus. Chạy lại với selector `UNKNOWN` trong bộ nhớ đã PASS, phù hợp fail-closed hiện tại; không thêm dữ liệu giả vào app hay đổi Cell rules. Bộ test Cell status hiện tại 14 cases chạy riêng và PASS.

Toàn bộ Backend traffic trong acceptance/regression được fixture intercept. Một số regression có POST/PATCH giả lập trong browser để kiểm tra handler; **không có request ghi dữ liệu tới Backend thật**. Không tuyên bố live Backend E2E PASS.

## Before / After

Mở `.design-reference/customer-phase2-comparison.html` để xem 8 nhóm trang cạnh nhau, desktop 1440 px và mobile 390 px.

Screenshot naming:

- `.design-reference/customer-phase2-{before,after}-{units,inventory,contracts,payments,warehouse,notifications,profile,support}-{320,390,768,1024,1440,1920}.png`.
- `.design-reference/customer-phase2-{before,after}-{register,item,contract}-{390,1440}.png`.
- `.design-reference/customer-phase2-after-{empty,error,loading}-390.png`.
- `.design-reference/customer-phase2-full-support-{390,1440}.png`: ảnh toàn trang Support để rà FAQ/hướng dẫn và CTA.

Ảnh dùng fixture, không chứa thông tin tài khoản/Item thật.

Visual QA phát hiện và đã sửa: heading booking panel sáng trên nền sáng, CTA Support width 100% cộng margin gây tràn mobile, contrast heading CTA nền tối, và FadeContent lồng trong help section chưa hiện ở reduced-motion trước khi scroll. Sửa reduced-motion chỉ áp dụng khi người dùng yêu cầu giảm chuyển động; giữ nguyên React Bits source và animations trong chế độ thông thường.

## Giới hạn còn lại

- Payment History/refund/charge giữ nguồn demo/API-ready hiện có; không có transaction Backend mới được tạo hoặc API payment-history mới được tích hợp trong Phase 2.
- Một số thông báo kỹ thuật/lifecycle cũ được giữ nguyên để tránh đổi ý nghĩa nghiệp vụ, đặc biệt contract snapshot, inventory/map và các demo workspace.
- Chưa chạy Live Backend E2E hoặc kiểm tra thủ công toàn bộ browser/device; kết quả ở trên là Edge headless/fixture. Không khẳng định mọi nội dung dài, số lượng ảnh/rental rất lớn hoặc trạng thái Backend chưa có fixture đều đã được kiểm tra.
- Print/Save PDF giữ browser print flow; không kiểm tra hộp thoại OS bằng thao tác thủ công trong phase này.
- Cảnh báo bundle lớn còn tồn tại; không đổi kiến trúc/dependency để xử lý ngoài phạm vi UI.
