# VaultSpace Customer Mobile — Phase 5B

Ngày kiểm tra: 30/10/2026. Kết quả: **23/23 thiết kế Customer UI/fixture**, chưa production-ready. Phạm vi chỉ customer-mobile, không live API hoặc database.

## A. Preservation

Đã đọc AGENTS.md, README/ARCHITECTURE, báo cáo Phase 1/2/3/4A/4B/5A, design-map, target HTML 19/20/23, source liên quan, models/fixtures/stores/guard/tests/smokes. Đã tạo SHA-256 baseline **137 file trước khi sửa source** (docs/phase5b-mobile-baseline.json). Sau task: **126 file cũ không đổi, 11 file cũ sửa đúng phạm vi, 0 missing, 0 unexpected**. Toàn bộ 291 tests cũ không đổi và PASS. Không đổi package.json/lock/config, Axios blocker, tabs, Login component/schema hoặc fixtures cũ. 20 designs cũ vẫn qua regression và sáu smoke scripts.

File cũ sửa:

| File | Thay đổi giới hạn |
|---|---|
| app/_layout.tsx | Đăng ký notifications/support dưới cùng demo guard, không router/tab mới |
| src/components/customer.tsx | Header có prop showNotifications, bell tùy chọn và wrap nhóm controls trên màn hẹp |
| src/components/booking.tsx | Chỉ mở rộng kiểu fallback BackAction sang Expo Href, không đổi runtime Back behavior |
| src/screens/DashboardScreen.tsx | Bật bell trong CustomerHeader, không đổi nội dung Dashboard khác |
| src/screens/ProfileScreen.tsx | Thay support placeholder bằng Support/Notification entry points, giữ profile/preference/logout |
| src/screens/RegisterScreen.tsx | Mở rộng scaffold tại chỗ thành đầy đủ Registration UI, không auth/API behavior |
| src/forms/auth.ts | Chỉ tăng validation Registration/normalization/consent; loginSchema không đổi |
| src/state/useCustomerStore.ts | Logout clear thêm care session read/draft state cùng các stores cũ |
| README.md | Cập nhật scope 23/23, routes/scripts/limits và phân biệt historical phase counts |
| docs/ARCHITECTURE.md | Mô tả care domain/session/validation/security/routing |
| docs/design-map.json | Hoàn tất 19/20/23 và bổ sung metadata/entry/source/tests/backend/limits cho đủ 23 |

Danh sách toàn bộ file mới/sửa trong phase5b-changed-files.txt. Source baseline loại generated artifacts/.expo/node_modules/.git/.env; không đọc secrets. Không destructive git. Không truy cập backend/ hoặc BE-REF; cả hai không có thay đổi do task. Không tuyên bố git working tree sạch dựa vào metadata cha; dùng hashes và manifest bảo toàn.

## B. New Screens

| Design | Expo Router path / URL | Implementation |
|---|---|---|
| 19 Notification Center | /notifications | NotificationsScreen.tsx + NotificationCard/Bell/CareList |
| 20 Customer Support | /support; /support/new; /support/:requestId | SupportScreen.tsx, SupportFormScreen.tsx, SupportDetailScreen.tsx |
| 23 Customer Registration | /(auth)/register, URL /register (route cũ) | RegisterScreen.tsx, RegistrationPasswordField, PasswordStrengthHint |

Support form/detail là supporting experience của design 20, không tính thêm design. App dùng cùng Expo Router root/native stacks, năm tabs cũ, cùng demo/auth guard; không duplicate Login/Registration. Chỉ dùng HTML làm reference, không paste DOM/script/CDN, không WebView hoặc browser history.

Giữ token/Inter/Ionicons/primitives cũ. Các brand values có sắc độ hiện hữu của app, không đổi token toàn cục để gây lệch 20 screens cũ. Tất cả nội dung mới tiếng Việt, card xanh/mint/cam, touch targets 44–50dp, safe area và Screen keyboard wrapper cũ. Lists dài dùng FlatList, không nested long ScrollView.

## C. Notification Center

Typed CustomerNotification/CareDestination trong domain/customerCare.ts. customerCare.ts fixtures deep-frozen có 12 notifications cùng owner: reservation/deposit/contract/balance/inventory/request/expiry/support, read/unread, missing target, unknown category và incomplete metadata. Không delivery evidence, SMS/email/push token hoặc timestamps giao nhận giả.

Read state là owner-scoped overlays trong useCareSessionStore, tách fixture. Mark one/all chỉ sửa overlays, unread count derive từ source + overrides, All/Unread filter tức thì, logout clear. Date sort giảm dần, stable ID ties, invalid dates xuống cuối; grouping/times theo Việt Nam.

resolveNotificationTarget dùng literal typed Href, không concat path từ metadata. Kiểm owner notification, rentalScenarios owner/service/actual rental, own Item metadata, request phải cùng owner+Item, support owner và Payment purpose hợp lệ. Missing/unknown/foreign target trả null, hiển thị unavailable, không mở record thay thế. Đây là prototype check, không production access control.

Không Backend mark-read, push subscription/token/Expo push/WebSocket/polling/SMS/email. Không sửa payment/rental/inventory states khi đọc hoặc mở thông báo.

## D. Support Center

Fixture 6 requests thuộc demo Customer: open/processing/resolved/closed, unknown status, missing references. Có no-message và hội thoại dài 28 messages dựng sẵn. Chỉ Customer-visible messages, không internal notes/assignments/admin controls. Status labels *_DEMO không coi là Backend enums. Không hotline/SLA/response-time hoặc dịch vụ Smart Key/nhiệt độ/IoT được tự khẳng định từ HTML.

List virtualized có category shortcuts/status filters, timestamps, cards và detail navigation. Detail virtualizes conversation, hiển thị source references/ownership/missing links/resolution. Chưa verified reply API nên composer và Send disabled, không fabricated Staff replies hoặc message-send success.

Form RHF/Zod: category required; subject 5–120 chars; description 10–2.000 chars; optional rental/item phải tồn tại và owned; khi chọn cả hai phải cùng inventoryDetail.rentalId. Thresholds UI-only. Owned rental options gồm My Rentals có explicit owner snapshot và inventory form rental contexts đã có; không thêm inventory contexts vào My Rentals hoặc bịa detail route. Context inventory chỉ show label nếu chưa có My Rentals route thật.

Draft chỉ trong session, một record theo owner; save revalidates current fixtures và source binding. Binding là JSON owner/resource identities/relationships, không Backend hash/version token. Compatible draft restore khi navigate; stale/foreign/missing references fail closed tới explicit removal. Native usePreventRemove xử lý dirty Back/gesture, keep/discard; xóa saved draft cần xác nhận. Logout xóa. Không sinh Backend ticket number/reference, không append draft vào requests list.

Copy sau save local thành công: “Đã lưu bản nháp yêu cầu hỗ trợ trong phiên — chưa gửi lên hệ thống.” Không claim đã gửi hoặc nhận phản hồi. Native guard được test qua unit mock và RN Web navigation; OS hardware Back/gesture chưa device-tested.

## E. Registration

Mở rộng screen cũ, giữ headline và Login link/demo path. Fields: name/email/phone (đã có scaffold và Stitch)/password/confirmation/terms acknowledgement. Phone 10 chữ số bắt đầu 0 giữ validation fixture cũ. Email trim/lowercase, name trim/collapse spaces; password 8–128 có chữ/số, không tự trim khoảng trắng đầu/cuối, confirmation exact. Tất cả là UI rules, không Backend DTO requirements.

Independent show/hide controls; strength guidance chỉ informational, không chứng nhận security. Inline errors/submit busy, safe-area/keyboard scrolling cũ. Terms copy ghi rõ minh họa, văn bản chính thức chưa kết nối; không fake policy page/OTP/provider/certification/ISO/PCCC/encryption claims.

Valid submit chỉ hiển thị: “Biểu mẫu hợp lệ. Chức năng tạo tài khoản sẽ khả dụng sau khi kết nối hệ thống.” Sau đó reset password/confirmation về rỗng. Không store/password log/persist/device storage/nav params/network/JWT/session/account/email verification. Form unmount bỏ local values. Không tự authenticate; Login vẫn demoSession cũ sau local Login validation. Actual production credentials handling chưa được nghiệm thu.

## F. Navigation

14 major journeys đã kiểm kê trong UI_COMPLETENESS_AUDIT.md: Login/Home; Explore/Self booking/preview; Explore/Managed map/multi-Cell review/preview; Rentals/detail; Detail/Contract; Detail/Payment; Inventory/detail; register/edit; history; repeated inbound; canonical outbound; Home/Notifications/targets; Profile/Support/draft/detail; Login/Registration/Login.

Native Back hoặc valid fallback; auth guard cũ áp dụng cả notifications/support. Unknown IDs, category/purpose/destinations, missing/foreign resources được chặn bằng UI states. Registration không cho truy cập authenticated Customer routes vì submit không đổi demoSession. Không rename old URLs, không browser history, không tab/router thứ hai.

## G. Tests

| Lệnh | Kết quả thực tế |
|---|---|
| npm run typecheck | PASS |
| npm test -- --silent | PASS: 8 suites, **375/375 tests** = 291 cũ + 84 mới |
| npm run check:versions | PASS local SDK dependency map; offline compatibility endpoint không truy cập được, không claim online validation |
| npm run export:native | PASS Android/iOS Hermes + local assets, không APK/IPA/device startup |
| npm run verify:website | PASS 1.074 checked; 0 changed, 0 missing |
| node scripts/verify-phase5b-preservation.cjs | PASS 137 checked; 126 unchanged; 11 allowed changed; 0 missing/unexpected |
| node scripts/verify-ui-completeness.cjs | PASS 23 unique designs; 0 missing mapped source/routes/metadata |
| node scripts/smoke-preview.cjs | PASS: auth/register/five tabs/native stack; 320/390/768 |
| node scripts/smoke-booking.cjs | PASS: Self Storage booking/draft/Back/detail; 320/390/430/768 |
| node scripts/smoke-managed.cjs | PASS: multi-Cell/map/review/preview; 320/375/390/430/768 |
| node scripts/smoke-inventory.cjs | PASS: item/register/edit/history/draft guard; 320/375/390/430/768 |
| node scripts/smoke-requests.cjs | PASS: inbound/outbound/detail/amend/cancel previews; 320/375/390/430/768 |
| node scripts/smoke-financial.cjs | PASS: contracts/payment/Back/independent statuses; 320/375/390/430/768 |
| node scripts/smoke-care.cjs | PASS: all Phase 5B journeys/invalid references/logout; 320/375/390/430/768; 0 page/console errors, 0 Backend requests, 0 mutations |

New tests/customer-care.test.tsx covers notifications/read/date/unknown/targets/owner; support status/list/refs/schema/draft restore/native dirty guard/remove/stale/long conversation/disabled reply; Registration validation/normalization/visibility/consent/no session/password clearing; navigation, immutable fixtures và Axios GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS fail before adapter. Không sửa tests cũ.

Smoke dùng Playwright có sẵn, Edge headless, Metro offline localhost:8091; block mọi origin khác, assert không Backend URL/request hoặc HTTP mutation. Script mới có bounded retries cho virtualized row detach trong RN Web, không force click hoặc bỏ checks. Browser phát hiện warning invalid onLayout trên Fragment empty state; đã sửa CareList wrapper thành View và rerun PASS. Không ignore lỗi đó.

Ảnh/kết quả: artifacts/phase5b/{registration,registration-valid,home-bell,notifications,notifications-read,support,support-detail,support-draft,support-discard}-{320,375,390,430,768}.png và smoke-result.json. Đã xem ảnh 320 registration/support/detail và kiểm tra wrap/cards/readability; overflow assertions chạy đủ widths. Không screenshot before cho Notifications/Support chưa tồn tại; Registration ban đầu là scaffold. Không claim keyboard/font scaling/OS gesture/TalkBack/VoiceOver trên native.

Native export có NO_COLOR/FORCE_COLOR tooling warning, không chặn bundle. Version validation offline, dependency advisories chưa remediation. Không install/upgrade dependencies.

## H. Website Integrity

Website baseline **1.074 files: 0 changed, 0 missing**. Không sửa website source/dependencies/config/API/routes, không Staff/Manager/BOM changes. Không đọc secrets/.env hoặc truy cập backend/. BE-REF không cần dùng và không thay đổi. Tất cả writes nằm trong customer-mobile; generated .expo/artifacts/node_modules không nằm baseline source. Website build không chạy vì không sửa website; task validation dùng native export.

## I. Design Completion

**23/23 completed UI/fixture designs**. 19/20/23 có full presentation/interaction, không generic shell. Supporting screens không được tính hai lần. docs/design-map.json có Design ID/name/path/component paths/route files/fixtures/entry/tests/status/Backend/limits cho từng design. UI_COMPLETENESS_AUDIT.md chứa bảng 23 screens và 14 journeys.

Backend của cả 23 là NOT INTEGRATED, fixture interaction chỉ đúng phạm vi đã mô tả. Native device testing và security review còn PENDING. Không tuyên bố production release readiness hoặc live E2E.

## J. Remaining Limitations

- No live Backend integration, real auth/account registration hoặc server-side ownership enforcement.
- No real notification updates, push/email/SMS, support request submission/reply hoặc Staff handling.
- No real payments/QR/provider/mock-confirm, contract signing/certification/PDF/email, authoritative settlement.
- No real Inventory operations, stock/capacity/occupancy/physical inbound/outbound/activation, reservations hoặc HOLD.
- Memory-only drafts/read state mất khi logout/restart; không offline sync queue hoặc production persistence.
- No native Android/iOS simulator/device E2E, APK/IPA hoặc device startup. Hermes export và RN Web không thay thế việc đó. Keyboard/safe area/performance/font scaling/assistive tech native còn phải kiểm.
- Recorded dependency audit còn **19 findings: 13 Low, 6 High, 0 Critical**; chưa refresh online DB/remediation. CLI/nested Zod là tooling chain; Router/query-string/decode-uri-component có thể ảnh hưởng runtime URL parsing, không gọi toàn bộ dev-only. Các advisory và runtime compatibility review là release blockers. Không audit fix --force hoặc major upgrade.
- Official terms/privacy/security/product claims và API enum/validation/contracts chưa verified cho mobile; không tự suy từ handoff.

## K. Recommended Next Phase

Đề xuất task riêng **Phase 6 — Customer Mobile API Contract Audit & Integration Planning**: đối chiếu từng screen với BE-REF/collections được phép, auth/owner/roles/gates/DTOs/envelopes/errors/version/idempotency/lifecycle, map gaps và kế hoạch integration/test theo ưu tiên. Đồng thời lập dependency/native runtime review riêng trước release. **Chưa thực hiện Phase 6**, không mở transport hoặc gọi APIs trong Phase 5B.
