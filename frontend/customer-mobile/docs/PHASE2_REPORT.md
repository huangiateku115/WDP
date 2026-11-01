# Customer Mobile · Phase 2 — Self Storage Booking & Rental Detail UI

## Phạm vi và bảo toàn

Triển khai trong customer-mobile, trên Expo SDK 57 / RN 0.86.3 / React 19.2.3 hiện có. Không thêm hoặc đổi dependency, package manifest/lockfile, cấu hình website hay shared API client. Không truy cập backend/ hoặc BE-REF/; phase này không cần contract Backend. Không gửi API thật. Không viết database. Phase 1 Axios transport blocker giữ nguyên.

Đã đọc frontend/AGENTS.md, README, ARCHITECTURE, PHASE1_REPORT, design-map và 5 HTML nguồn. Không copy HTML scripts/DOM/CDN. Dùng React Native ScrollView, StyleSheet, Inter, Ionicons, artwork SVG cục bộ và primitives cũ. Không thêm claims climate, insurance, courier, NFC, smart lock hay chữ ký được chứng nhận từ handoff.

Sáu UI Phase 1 giữ nguyên: Login, Home, Explore, My Rentals, Inventory, Profile. 24 tests cũ không bị sửa/xóa. Generic Facility/Rental branches được thay bằng màn hình đầy đủ tại URL cũ; Item Detail vẫn là shell Phase 1. Logout chỉ bổ sung xóa draft/preview lock trong bộ nhớ.

Git status không đọc được metadata worktree cha trong môi trường hiện tại (fatal cannot change to WDP); không thực hiện git reset/checkout/clean. Bảo toàn website được xác minh bằng SHA-256 baseline 1.074 file: changed=[], missing=[]. Không đọc .env. Mọi thao tác ghi source/docs/tests đều nằm trong customer-mobile.

## Năm màn hình hoàn chỉnh ở phạm vi UI/fixture

| Design | Route thực tế | Triển khai | Dữ liệu |
| --- | --- | --- | --- |
| 03 Facility Detail | /preview/facility/:id | FacilityDetailScreen; artwork, thông tin/giờ/tiện ích/dịch vụ, CTA kho riêng, loading/missing | customer + booking fixtures |
| 04 Unit Selection | /booking/:facilityId/units | UnitSelectionScreen; size filter, interval, UnitCard, một lựa chọn, disabled unavailable | StorageUnit + occupied intervals mẫu |
| 05 Period/Pricing | /booking/:facilityId/review | BookingReviewScreen; RHF/Zod, ngày/kỳ thuê, giá/cọc/số dư, đồng ý phạm vi prototype | typed draft + derived demo quote |
| 06 Confirmation | /booking/:facilityId/confirmation | BookingConfirmationScreen; summary, next steps, links Explore/My Rentals | chỉ draft preview hợp lệ |
| 10 Rental Detail | /preview/rental/:id | RentalDetailScreen; hai dịch vụ, status, finance, signing, bàn giao/timeline riêng | Rental + RentalFacts mẫu |

Các màn hình này hoàn chỉnh ở phạm vi prototype; không phải hoàn tất tích hợp nghiệp vụ thật. Mỗi mapping trong design-map ghi source/hash/route/components/tests/Backend dependency. Cả 5 dùng FixtureNotice.

## Luồng đặt kho

Explore → Facility Detail → chọn kho tự quản → Unit Selection → kỳ thuê & báo giá → xác nhận đã hiểu prototype → bản xem trước. Managed-only facility không có CTA Self Storage. Không dùng Cell cho kho tự quản.

useBookingStore giữ facilityId, đúng một unitId, start, months, previewed; end/quote là giá trị derive. Unit Selection và Review dùng chung kỳ thuê; quay lại giữ ngày và Unit. Chuyển cơ sở khởi tạo draft mới; các Unit đã preview trong phiên vẫn khóa. Logout xóa toàn bộ draft/locks.

Chỗ trống mẫu = operational AVAILABLE + kỳ thuê hợp lệ + không overlap occupied intervals [start,end) + chưa dùng trong preview phiên. Kiểm tra lại tại selection, review và trước preview. Kho không khả dụng không tương tác. Không có live HOLD. Lock ở bộ nhớ chỉ ngăn lặp UI; không phải cơ chế chống trùng Backend.

Ngày mặc định theo Asia/Ho_Chi_Minh; input ngày lịch YYYY-MM-DD, manual validation, không UTC-shift ngày do người dùng nhập. Không cho ngày quá khứ/không tồn tại. 1/3/6/12 tháng là lựa chọn mẫu; cộng tháng lịch, clamp cuối tháng, ngày kết thúc exclusive. Đây không phải khẳng định pricing/term policy Backend.

Đơn giá mẫu × số tháng = tổng. Cọc minh họa bằng một tháng tiền thuê, được cấn trừ vào tổng; remaining = total − deposit. Không thêm cọc bảo đảm, chiết khấu, bảo hiểm hoặc hoàn hủy giả định. Thiếu/không hợp lệ giá thì báo chưa có quote và chặn preview. Starting price Facility Self Storage lấy từ Unit fixtures để thống nhất với danh sách.

Confirmation ghi rõ “Bản xem trước đặt chỗ — chưa tạo đơn thuê thực tế”. Không tạo ID/reservation/payment/ACTIVE/access, không thêm bản ghi vào My Rentals. Direct deep link không có draft/preview phù hợp fail safely.

## Rental Detail và lifecycle

Rental status, contract status, deposit credit, balancePaid và handover là các dữ kiện fixture độc lập. Không suy ra tất cả từ ACTIVE. Timeline gồm: khởi tạo đặt chỗ → xác nhận tiền thuê trả trước → kiểm tra/tiếp nhận → hai bên ký → thanh toán số dư → nhân viên kích hoạt. Mỗi bước ghi minh họa hoàn tất/chưa hoàn tất; không thao tác Staff.

Self Storage chỉ mô tả đủ điều kiện sử dụng mẫu khi ACTIVE và handover=true; CLOSED không có quyền sử dụng hiện tại. Không PIN/QR/NFC/unlock. Managed hiển thị danh sách ô đã phân bổ và giải thích không có mã ra vào kho chung. Không có signing, payment, intake/activation controls.

## Thành phần và navigation

Tái sử dụng Screen/safe-area/keyboard ScrollView, AppText, Card, Button, Input, Chip, Filter, FixtureNotice, StateCard và WarehouseArt. Bổ sung BackAction, BookingSteps, UnitCard, UnitSizeFilter, PricingSummary, Value, RentalPeriodSelector, RentalLifecycleTimeline. Controls mới dùng min 44–50dp, labels/state và nội dung cuộn.

Giữ 5 tabs, auth group và detail paths cũ. Thêm booking native stack dưới cùng demo guard; không tạo tab navigator thứ hai. Back dùng Expo Router back/canGoBack và fallback Explore/My Rentals. Không dùng browser history trong app. Android hardware Back dựa native stack, chưa xác minh thiết bị.

## Kiểm thử

| Lệnh/kiểm tra | Kết quả |
| --- | --- |
| npm run typecheck | PASS sau khi Expo sinh typed routes mới |
| npm test -- --silent | 3 suites, 57/57 PASS; gồm 24 tests Phase 1 + 33 Phase 2 |
| npm run check:versions | map SDK cục bộ báo dependencies up to date; offline endpoint không truy cập, không claim online Doctor PASS |
| npm run export:native | PASS Android + iOS Hermes bundles; không phải APK/IPA |
| npm run verify:website | PASS 1.074 SHA-256, không thay đổi/mất file |
| Metro startup offline port 8091 | PASS |
| scripts/smoke-preview.cjs | PASS sáu màn Phase 1, tabs/auth/detail/back/logout/empty search tại 320,390,768 |
| scripts/smoke-booking.cjs | PASS RN Web 5 màn/luồng tại 320,390,430,768; draft back restoration, không document overflow |

Tests mới: Facility loading/missing/managed-only; size filter; một Unit; unavailable; interval overlaps/end boundary; calendar/manual past/invalid date và UTC/Vietnam boundary; 4 durations/quote arithmetic; missing quote; review consent; draft/back; double-preview prevention; confirmation safety; invalid routes; hai service types/timeline/access; CLOSED restriction; logout clear; Axios GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS đều bị chặn trước custom adapter.

Browser smoke chặn origin ngoài localhost, xác nhận 0 Backend requests/0 mutations/0 page errors. Screenshots bổ trợ ở artifacts/phase2/{facility,units,review,confirmation,rental}-{320,390,430,768}.png; đã xem ảnh 390/320 cho cả 5 màn. Badge Expo dev tooling trong preview không phải production UI. Artifacts không commit.

Lần export/browser đầu trong sandbox thất bại do quyền ghi Hermes temp/browser launch và giới hạn kết nối Metro. Chạy lại lệnh local với quyền phù hợp đã PASS; không sửa dependencies để che lỗi. Một test ban đầu phát hiện date validation message chưa hiển thị ổn định; đã sửa selector đọc schema của draft hiện tại, rerun PASS.

Chưa có simulator/device E2E, chưa kiểm tra native keyboard/font scaling/safe-area/TalkBack/VoiceOver/hardware Back hoặc tạo binary cài đặt. RN Web layout checks không chứng minh mọi clipping trên OS native. Không claim live E2E.

## Dependency audit: còn tồn tại, chưa remediation

Giữ nguyên package/lock và SDK-compatible graph. Dùng báo cáo Phase 1 docs/dependency-audit.json: 19 findings (13 low, 6 high, 0 critical). Không chạy audit fix/force; chưa lấy audit database mới trong phase này. npm ls kiểm tra chain hiện có:

| High entry | Chain/bản đã cài | Phạm vi |
| --- | --- | --- |
| zod | expo@57.0.31 → @expo/cli@57.0.32 → zod@3.25.76 | CLI/dev/build tooling; app forms dùng zod@4.6.7 riêng |
| @expo/cli | propagated từ nested Zod và các dependency | tooling/build, không được coi là app form runtime |
| expo | propagated qua CLI/config/Metro | package tổng hợp; không có nghĩa mọi module runtime đều chịu cùng advisory |
| decode-uri-component | expo-router@57.0.29 → query-string@7.1.3 → decode-uri-component@0.2.2 | đường parsing URL/query có thể thuộc runtime navigation; không phân loại thành dev-only |
| query-string | qua decode-uri-component | runtime dependency của Router |
| expo-router | propagated qua query-string và testing-related dependencies | runtime navigation; cần review exposure deep links/malformed input trước release |

Advisories gốc: Zod constrained-collection memory exhaustion (GHSA-mrhx-c7xc-m3w5); decode-uri-component percent-encoded DoS (GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f). Chưa exploit/reproduce; số 6 high gồm propagated packages, không phải 6 lỗi độc lập. Đây là release dependency, cần task remediation/compatibility assessment riêng. Không tự nâng major Expo/Router hoặc sửa website deps.

## Files thay đổi

Danh sách đầy đủ 24 source/test/script/docs files trong docs/phase2-changed-files.txt (đều tương đối với customer-mobile):

- app/_layout.tsx
- app/booking/_layout.tsx
- app/booking/[facilityId]/units.tsx
- app/booking/[facilityId]/review.tsx
- app/booking/[facilityId]/confirmation.tsx
- src/domain/booking.ts
- src/fixtures/booking.ts
- src/state/useBookingStore.ts
- src/state/useCustomerStore.ts
- src/components/booking.tsx
- src/components/RentalPeriodSelector.tsx
- src/screens/FacilityDetailScreen.tsx
- src/screens/UnitSelectionScreen.tsx
- src/screens/BookingReviewScreen.tsx
- src/screens/BookingConfirmationScreen.tsx
- src/screens/RentalDetailScreen.tsx
- src/screens/PreviewDetailScreen.tsx
- tests/booking.test.tsx
- scripts/smoke-booking.cjs
- README.md
- docs/ARCHITECTURE.md
- docs/design-map.json
- docs/PHASE2_REPORT.md
- docs/phase2-changed-files.txt

Không sửa package.json/package-lock, client.ts, tokens hoặc các màn tab/Auth hiện có. .expo typed routes/cache và artifacts/native/screenshots được sinh bởi tooling và gitignored.

## 12 thiết kế còn lại

07 Warehouse Map; 08 Managed Booking Review; 11 Contract Review; 12 Payment Detail; 14 Inventory Detail; 15 Inventory Registration/Edit; 16 Repeated Inbound; 17 Canonical Outbound; 18 Movement History; 19 Notifications; 20 Support; 23 Registration đầy đủ. Item/Registration vẫn là scaffold.

## Giới hạn và Backend dependencies

Không live Backend integration, không reservation creation, không payment mutation hoặc contract signing. Chưa xác minh chỗ trống/quote/các gate/role/ownership/lifecycle từ Backend cho mobile; cần audit contract trước phase integration. Prototype hiện sẵn sàng review UX bằng fixture, chưa sẵn sàng production. Không triển khai các thiết kế còn lại hay Phase 3 tự động.
