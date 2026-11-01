# Customer Mobile — Phase 3: Managed Warehouse Map & Multi-Cell Booking

## A. Bảo toàn Phase 1/2

Triển khai trong frontend/customer-mobile trên Expo 57 / RN 0.86.3 / React 19.2.3 hiện có. Đã đọc AGENTS, README, Architecture, báo cáo Phase 1/2, design-map và HTML thiết kế 07/08. HTML chỉ dùng tham khảo; không copy markup/scripts/DOM/CDN. Không tạo project, API client hoặc tab navigator mới; không thêm dependency.

Giữ 11 thiết kế Phase 1/2 và 57 tests gốc; không sửa/xóa tests cũ. Self Storage useBookingStore, single-Unit selection, calendar utilities, routes booking, payments/auth infrastructure không đổi. Facility Detail chỉ thêm CTA Managed; Self Storage confirmation chỉ dùng lại cùng header thông báo prototype qua component chung, nội dung và flow giữ nguyên.

Đã chụp baseline SHA-256 69 file mobile trước Phase 3. verify-phase3-preservation xác nhận chỉ 9 file có sẵn thay đổi đúng phạm vi; không file mất, không unexpected change. package.json/package-lock/client.ts và toàn bộ 57 tests cũ giữ nguyên hash. Website: đối chiếu 1.074 file, changed=[], missing=[]. Không đọc .env. Git status không đọc được metadata worktree cha (fatal cannot change to WDP), không dùng reset/checkout/clean.

## B. Hai thiết kế mới và routes

| Design | Route | Màn hình/nguồn |
| --- | --- | --- |
| 07 Warehouse Map & Cell Selection | /managed/:facilityId/map | WarehouseMapScreen; screens/07_warehouse_map.html |
| 08 Managed Booking Review | /managed/:facilityId/review | ManagedBookingReviewScreen; screens/08_managed_booking_review.html |
| Reuse 06 Confirmation | /managed/:facilityId/confirmation | ManagedConfirmationScreen + PrototypeConfirmationHeader/PricingSummary; không tính thành design mới |

Entry: Explore → Facility Detail → “Chọn ô trên bản đồ kho”. Native managed stack dùng cùng demo guard. Self Storage stack và năm tabs không thay thế. Auth/demo guard vẫn là trải nghiệm bộ nhớ, không phải xác thực Backend.

## C. Warehouse interaction và components

Domain typed Facility → Zone → Rack → Cell. Hai cơ sở fictional Managed, 4 Zone mỗi cơ sở; kệ có 1/2/3/4/5 tầng, khác dimensions/volumes, max weight có thể null. Có Zone inactive, Rack inactive, Zone empty, RESERVED/HOLD/YOURS, OCCUPIED, MAINTENANCE, missing geometry/usage và trạng thái UNKNOWN. Fixture sinh theo cấu hình rõ ràng, không fake API response.

Zone selector ngang. Floorplan bằng native View/Pressable có tọa độ fixture và aisle, chạm từng Rack được; không decorative map. Zoom 75–175% chỉ đổi tỷ lệ trình bày, không sửa position/geometry. Cuộn/pan trong hai ScrollView lồng; reset đưa zoom/scroll về gốc. Tầng/ô đọc từ cấu hình, không hardcode ba/sáu tầng. Cells giữ thứ tự số ô theo tầng, touch buttons 44–50dp trở lên, dense Rack cuộn nội bộ.

Rack detail thay floorplan trong cùng panel; Back to floorplan giữ component mounted/zoom/pan trong Zone khi có thể. Chuyển Zone đặt lại panel và góc nhìn Zone, giữ basket; có tabs chuyển Rack trực tiếp. Details là contextual Card (không giả bottom sheet), hiển thị dimensions, volume, physical usage/weight riêng và lý do eligibility. Inactive Zone/Rack được xem để hiểu cấu trúc nhưng không chọn ô.

Thành phần mới: WarehouseFloorplan, RackElevation, CellDetail, AvailabilityLegend, CellStatusChip, ManagedBookingSummary, PrototypeConfirmationHeader. Tái sử dụng Card/Button/Input/Filter/Text/StateCard/PricingSummary/BackAction và RentalPeriodSelector. Screen có prop footer tùy chọn, nằm ngoài nội dung cuộn và trong safe-area/keyboard container; màn cũ không truyền footer giữ nguyên layout. Sticky summary có count, sum capacity, mã ô cuộn trong vùng giới hạn, giá và CTA; không overlay che nội dung body.

Trạng thái hiển thị: Còn trống, Đang chọn, Đã giữ chỗ, Đã giữ · Của bạn, Đang sử dụng, Bảo trì, Chưa đủ điều kiện. Selected là presentation riêng, không thay đổi eligibility. Unknown không có style Available.

## D. Draft, interval và eligibility

useManagedBookingStore tách hoàn toàn khỏi Self Storage. Draft giữ facilityId, cellIds duy nhất, start/months và metadata preview; không giữ redundant totals. Chọn/bỏ nhiều ô giữa các kệ/khu trong cùng facility; Back và begin cùng facility giữ draft. Đổi facility khởi tạo draft mới, không mang Cell cũ sang. Logout/restart xóa bộ nhớ. Không tự chọn Cell.

Dùng lại periodSchema/endDay/vietnamToday: YYYY-MM-DD theo lịch Asia/Ho_Chi_Minh, chặn quá khứ/invalid day, tháng lịch clamp cuối tháng, [start,end) half-open. 1/3/6/12 tháng vẫn là lựa chọn fixture, không Backend policy.

Thứ tự đánh giá:

1. Kỳ thuê hợp lệ, parent links/levels và intervals nhất quán.
2. period OCCUPIED hoặc occupied interval overlap → OCCUPIED, không chọn.
3. RESERVED/HOLD overlap → RESERVED hoặc RESERVED_YOURS, không chọn. Ownership không cấp ngoại lệ; không suy OCCUPIED từ RESERVED.
4. Operational MAINTENANCE → bảo trì, không chọn.
5. Facility/Zone/Rack phải ACTIVE; cell operational và period đều AVAILABLE.
6. Dimensions/usable volume phải đầy đủ, dương, khớp và phù hợp độ chính xác fixture. Max weight null không tự gán giới hạn.
7. Physical usage phải được biết và hợp lệ; volume/weight khác 0 mà period nói trống → UNKNOWN conflict. Null counters không coi là 0.

Chỉ kết quả eligible=true mới cho thêm Cell. Các ô đã chọn mất điều kiện vẫn được giữ kèm lý do và nút bỏ rõ ràng. Không tự xóa, không vẫn gọi là Available. Đổi kỳ/độ dài kiểm tra lại tất cả, chặn Review/Preview cho tới khi giải quyết. Critical steps re-evaluate từ fixture hiện tại: chọn, Map CTA, Review CTA, store preview và Confirmation.

## E. Dung tích, giá và prototype confirmation

Allocated capacity = tổng usableVolumeM3 từng Cell, không phải physical usage/stock/registered quantity. Cộng theo micro-m³ nguyên (1e-6) để tránh 0,12 + 0,16 lệch số thực. Giá mẫu = capacity × rate VND/m³/tháng qua tử số nguyên rồi chia 1e6; nếu không tạo được giá nguyên VND an toàn thì không quote, không âm thầm làm tròn. Total = monthly × months; advance-rent deposit = monthly; remaining = total − deposit. Không bảo đảm hoàn lại, insurance, chiết khấu, thuế/phí hoặc giữ chỗ độc quyền suy đoán.

Ví dụ fixture test: 0,28 m³ × 400.000 ₫/m³/tháng × 3 tháng = 336.000 ₫; cọc 112.000 ₫ được cấn trừ, còn 224.000 ₫. Đây là ví dụ tính nhất quán, không báo giá Backend.

Review hiển thị per-Cell Zone/Rack/level/volume/weight/giá và tổng. Thiếu quote ghi “Chưa có báo giá” và disable. Terms nói rõ thuê dung tích, không có direct warehouse access; nhân viên thực hiện tiếp nhận/di chuyển; hàng khai báo chưa phải hàng đã lưu; cần xác nhận tiền thuê trả trước cho các bước tiếp theo. Checkbox chỉ xác nhận hiểu prototype, không ký/đồng ý điều khoản pháp lý mới.

Confirmation dùng cùng PrototypeConfirmationHeader/PricingSummary với Self Storage và thông báo “Bản xem trước đặt chỗ — chưa tạo đơn thuê thực tế”. Đòi draft đã preview, đúng facility, có quote, Cells còn eligible và fingerprint của dữ kiện đã review khớp hiện tại. Fingerprint JSON chỉ là local review binding; không chữ ký bảo mật/token concurrency Backend. Đổi price/geometry/usage/period có thể làm confirmation mất hiệu lực. Không tự fabricate success.

UX sau preview: giữ draft trong phiên để xem lại; cùng draft đã preview không submit lần hai. Sửa kỳ/Cell xóa marker/fingerprint; đổi facility tạo draft mới; logout/restart xóa. Không tạo ID, HOLD hay insert vào My Rentals. Nút “Chỉnh sửa ô” quay về Map hiện có, fallback replace Map nếu không có history; không push Map trùng.

## F. Safety và bảo toàn website

- Không Backend HTTP requests, live availability, reservation creation hoặc HOLD.
- Không payment mutations, contract signing, actual registration/intake/movement hoặc Staff APIs.
- Không đổi occupancy/stock counters/intervals khi chọn hay preview.
- Không token/base URL/hidden unlock flags; Axios client nguyên vẹn, ném PHASE1_OFFLINE trước adapter cho mọi method.
- Không truy cập backend/ hoặc BE-REF/; không đọc hay ghi database/Postman.
- Mọi thay đổi source/test/docs/script trong customer-mobile; website/dependencies/config ngoài mobile không đổi.

## G. Verification

| Lệnh/kiểm tra | Kết quả |
| --- | --- |
| npm run typecheck | PASS |
| npm test -- --silent | 4 suites, 107/107 PASS: 57 cũ + 50 mới |
| npm run check:versions | local SDK map báo dependencies up to date; offline endpoint không truy cập được, không claim online Expo Doctor |
| npm run export:native | PASS Android/iOS Hermes HBC, 39 assets; không phải APK/IPA |
| npm run verify:website | PASS 1.074 file SHA-256, không thay đổi/mất file |
| node scripts/verify-phase3-preservation.cjs | PASS 69 baseline mobile files, chỉ 9 thay đổi được phép, missing/unexpected rỗng |
| Metro expo start --offline --port 8091 --max-workers 2 | PASS startup |
| node scripts/smoke-preview.cjs | PASS Phase 1 six screens/tabs/auth/back/search/logout, 320/390/768 |
| node scripts/smoke-booking.cjs | PASS Phase 2 Self Storage/rental flow, 320/390/430/768 |
| node scripts/smoke-managed.cjs | PASS Phase 3 320/375/390/430/768, 0 Backend requests/mutations/page errors |

50 tests mới phủ hierarchy, variable levels/dimensions/volumes/weight null, parent mismatch; active/inactive scopes; interval overlap/exclusive boundary; RESERVED_YOURS; physical unknown/conflict; multi-Rack/Zone, duplicate/deselect, facility switch, date/duration invalidation, retained invalid selection; summed capacity/integer pricing/deposit; missing quote; immutable occupancy/rentals/Self Storage draft; invalid facility/rack; loading/error/empty; zoom/reset geometry; details/selection/navigation; review Back/edit; consent; no direct/stale confirmation, price-change binding; logout; GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS transport blocking.

Browser fixture smoke có allowlist chỉ localhost. Kiểm tra document overflow, thao tác cell/rack, zoom/reset, back draft restoration, sticky controls và auth guard. Screenshot RN Web bổ trợ: artifacts/phase3/{map,rack,review,confirmation}-{320,375,390,430,768}.png. Đã xem ảnh map/rack/review 320px; badge Expo tooling trong ảnh không phải production UI. Artifacts/cache không commit.

Test mới đã bắt floating point 0,28 × rate không ra safe integer; đã đổi phép tính micro-m³ nguyên và PASS. Browser smoke lần đầu phát hiện edit push Map trùng; đổi thành native Back/fallback, bổ sung regression và rerun. Không bỏ safety checks để làm tests qua.

## H. Remaining scope

13/23 thiết kế hoàn chỉnh ở mức UI/fixture, gồm hai thiết kế mới 07/08; reuse Confirmation không tính thêm design. Còn 10: 11 Contract Review, 12 Payment Detail, 14 Inventory Detail, 15 Register/Edit, 16 Repeated Inbound, 17 Canonical Outbound, 18 Movement History, 19 Notifications, 20 Support, 23 Registration đầy đủ. 14/23 vẫn là scaffold. Không tự triển khai phase tiếp theo.

## I. Giới hạn và dependency

Chưa chạy simulator/thiết bị Android/iOS; adb/xcrun không có trong PATH. Không claim native device E2E. Chưa xác minh keyboard/font scaling/VoiceOver/TalkBack/hardware Back/performance native. RN Web không thay thế safe-area/OS-device acceptance; dense map dùng cuộn và zoom bằng nút, không pinch gesture. Coordinates chỉ là floorplan fictional, chưa real warehouse data. Missing fixture phải fail closed.

Chưa có Backend integration, live availability/quote/HOLD/concurrency protection. Các gates/DTO/role/ownership/state transitions phải audit trước integration. Local fingerprint/locks không bảo vệ concurrency Backend. Không sẵn sàng release production.

Dependency graph/lock giữ nguyên. Audit baseline đã ghi nhận 19 findings (13 low, 6 High, 0 Critical), chưa lấy database audit mới hoặc remediation. Zod nested trong Expo CLI là tooling chain; Router → query-string → decode-uri-component có thể ở runtime URL parsing, không gọi là dev-only. Xem chi tiết các chain/advisories trong PHASE2_REPORT và dependency-audit.json. Không audit fix --force, không upgrade majors hoặc deps website.

## Danh sách file

28 file source/test/script/docs trong phạm vi customer-mobile, gồm 9 file cũ thay đổi và 19 file mới. Danh sách máy đọc: phase3-changed-files.txt.

- app/managed/[facilityId]/confirmation.tsx
- app/managed/[facilityId]/map.tsx
- app/managed/[facilityId]/review.tsx
- app/managed/_layout.tsx
- app/_layout.tsx
- docs/ARCHITECTURE.md
- docs/design-map.json
- docs/phase3-changed-files.txt
- docs/phase3-mobile-baseline.json
- docs/PHASE3_REPORT.md
- README.md
- scripts/smoke-managed.cjs
- scripts/verify-phase3-preservation.cjs
- src/components/ManagedBookingSummary.tsx
- src/components/managedWarehouse.tsx
- src/components/PrototypeConfirmation.tsx
- src/components/RentalPeriodSelector.tsx
- src/components/ui.tsx
- src/domain/managedBooking.ts
- src/fixtures/managedWarehouse.ts
- src/screens/BookingConfirmationScreen.tsx
- src/screens/FacilityDetailScreen.tsx
- src/screens/ManagedBookingReviewScreen.tsx
- src/screens/ManagedConfirmationScreen.tsx
- src/screens/WarehouseMapScreen.tsx
- src/state/useCustomerStore.ts
- src/state/useManagedBookingStore.ts
- tests/managed-booking.test.tsx
