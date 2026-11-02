# Customer Mobile — Phase 4A: Inventory Detail, Registration & Movement History

## A. Preservation

Hoàn thành UI/fixture trong customer-mobile trên Expo 57 / React Native 0.86.3 / React 19.2.3 hiện có. Đã đọc AGENTS, README, Architecture, Phase 1–3 reports, design-map; kiểm tra source/routes/fixtures/stores/tests, đọc HTML 14/15/18 làm visual reference. Không copy markup/DOM/scripts/CDN, không WebView. Dùng mint/emerald/orange, Inter, Ionicons, native Card/Input/Button/Filter/Screen/StateCard và safe-area hiện có.

Giữ 13 thiết kế trước và năm tabs. Không thay Self Storage/Managed booking stores/routes/geometry/selection/status interpretation, không thay API client/authentication foundations. Logout chỉ bổ sung xóa Inventory draft theo yêu cầu. 107 tests gốc không chỉnh sửa/xóa, vẫn PASS.

Baseline mobile trước Phase 4A gồm 88 file: chỉ 7 file cũ thay đổi đúng phạm vi; missing/unexpected rỗng. Manifest/lockfile, SDK/Metro/Babel/Jest config, tokens, customer item/stock fixtures và tất cả tests cũ giữ nguyên SHA-256. Git status không đọc được metadata worktree cha (fatal cannot change to WDP); không reset/checkout/clean. Không truy cập backend/, BE-REF/, database hoặc Postman. Không đọc .env.

## B. Ba thiết kế mới

| Design | Route | Triển khai | Data source |
| --- | --- | --- | --- |
| 14 Inventory Item Detail | /preview/item/:id | InventoryItemDetailScreen; thay Item shell tại URL cũ | customer.ts base item + inventory.ts owned detail/ledger certainty/batches |
| 15 Register/Edit | /inventory/register và /inventory/edit/:id | InventoryFormScreen, RHF/Zod, image draft và native discard dialog | inventory.ts explicit rental eligibility + original item prefill + memory draft |
| 18 Movement History | /inventory/:id/history | InventoryHistoryScreen + FlatList + InventoryMovementCard | inventory.ts legacy/canonical movements |

Mapping ghi hash HTML gốc, route/components/tests/Backend dependencies. Không generic shell nào được tính hoàn thành. Không triển khai inbound/outbound request workflows hoặc Staff operations.

## C. Item Detail và stock semantics

Audit đầu: model Item cũ có id/code/name/category/unit/registeredQuantity/status/cell/stock; stock đã tách onHand/held/available nhưng chưa có stock certainty/unit riêng, description, managed rental, preferred Cell, batch/source, measurements/images hay movement history đầy đủ. Giữ nguyên model/fixtures cũ và bổ sung domain/inventory.ts + fixtures/inventory.ts, không đổi các số dư để phục vụ UI.

ownItem cần item tồn tại + detail metadata thuộc customer fixture hiện tại. Inventory tab cũng lọc metadata owner trước search/category; Detail/History/Editor kiểm tra riêng. Đây chỉ là local presentation boundary, không thay Backend ownership authorization. Không đưa dữ liệu riêng của khách hàng thật khác vào fixture.

StockBalance hiển thị riêng Số lượng đăng ký / Tồn thực tế / Đang giữ / Có thể xuất. Ví dụ packaging: 99 kiện đăng ký, 60 tồn, 15 giữ, 45 khả dụng. Stock lấy từ stock fixture đã kiểm tra arithmetic và stockUnit khớp Item.unit, không derive từ registeredQuantity/movements. Missing/inconsistent ledger hiển thị “Chưa có dữ liệu tồn kho đã xác minh”, không 0, không suy available. Verified zero được phép giữ nguyên 0. Không cộng quantity khác đơn vị.

Preferred Cell là nguyện vọng, Current Cell chỉ hiển thị vị trí thực trong fixture khi status IN_STORAGE; Item mới đăng ký ghi chưa xác nhận nhập kho. Declared measurements khác actual per-batch measurements. Batch overview expandable: reference, quantity/unit, receipt, location, số đo đơn vị riêng; null không được đổi thành số đo/batch ID giả.

Gallery dùng SVG gốc cục bộ theo Illustration IDs; không remote photos, climate/QR/RFID/seal/certification claims. Quick actions Edit chỉ khi fixture editable và Item REGISTERED; IN_STORAGE bị khóa. History hoạt động. Inbound/Outbound buttons disabled và giải thích chưa khả dụng; không physical/Staff controls.

## D. Register/Edit, validation và draft

Một screen dùng hai modes. Edit prefill đúng name/description/category/registered quantity/unit/declared measurements/rental/preferred Cell/images. Gate tách khỏi Editor để không dereference missing Item hoặc đổi hook order. Unknown IDs, owner mismatch hoặc stored-item restrictions fail safely. Không sửa trực tiếp stored-item fixtures.

RHF + Zod: name 2–120 ký tự, description tùy chọn tối đa 1.000, category/unit thuộc các lựa chọn minh họa. Quantity nguyên dương/safe integer cho các đơn vị đếm túi/kiện/thùng/hộp. Dimensions và unit weight dương, tối đa 3 decimals, chấp nhận dot/comma. Inline errors, keyboard-aware ScrollView, invalid/processing submit disabled. Validation này là quy ước UI fixture, chưa phải Backend DTO hoặc volume/capacity policy. Không lấy registered quantity để tăng stock/capacity.

Rental contexts chỉ dành cho form: DEPOSIT_PAID trước activation và ACTIVE được cho phép rõ ràng; AWAITING_DEPOSIT/CLOSED không được chọn/lưu. Schema kiểm tra owner + canRegister + stage; không mặc định mọi Managed rental đều eligible. Preferred Cell tùy chọn nhưng nếu có phải nằm trong danh sách của context được chọn; đổi rental xóa preferred selection cũ. Không tự phân ô.

Các context/Cell codes này là fixture riêng cho Inventory, không được thêm vào My Rentals hoặc dùng để mô tả một reservation Backend mới. Chưa liên kết với Backend allocation/warehouse APIs; fixture Cell codes cũ được giữ để không sửa stock/location của Phase 1.

Image section: empty state, thêm hình dựng sẵn, preview, remove, đưa lên trước bằng native buttons. Không có native image-picker/camera capability mới, không cài dependency, mở tệp, xin quyền hoặc upload. Không coi hình minh họa là ảnh hàng thực tế.

useInventoryDraftStore là memory-only theo owner + register/edit:itemId, lưu form values/time/source fingerprint. Không tạo Item/SKU IDs, real records, receipt hoặc actual stock. Save kiểm tra key/owner/schema/eligible rental và edit restriction. Không ghi customerFixtures hoặc managedWarehouses. Saved draft tách hoàn toàn authoritative fixture records.

Copy chỉ khi save thật trong memory store: “Đã lưu bản nháp trong phiên — chưa gửi lên hệ thống. Bản nháp mất khi đăng xuất hoặc khởi động lại.” Không claim persistent device storage. Saved draft phục hồi khi quay lại form; source mismatch không tự restore, muốn bỏ nháp cũ phải xác nhận riêng. Logout xóa toàn bộ drafts.

Unsaved changes: usePreventRemove từ public expo-router/react-navigation, useNavigation và native Modal. Bảo vệ stack removal/native Back; có giữ chỉnh sửa hoặc bỏ thay đổi. Phần chưa lưu bị bỏ sau xác nhận; bản nháp đã save trước đó được giữ. Save reset dirty để Back bình thường. RN Web smoke đã kiểm tra chính luồng native navigation guard này; chưa kiểm tra hardware Back/gesture thật trên OS.

## E. Movement History: canonical + legacy

History là FlatList độc lập trong SafeAreaView, không lồng vertical ScrollView. initialNumToRender/maxToRenderPerBatch=8, windowSize=7; sort thời gian giảm dần, stable ties, invalid date xuống cuối. Search và type filters local. Không cộng tổng nhập/xuất để dựng ledger hiện tại. Dataset dài dùng virtualization; test sorting 300 records, chưa benchmark device performance.

INBOUND/OUTBOUND/RELOCATION có icon và nhãn Việt; type lạ/null hiển thị chưa xác định, không suy diễn nghiệp vụ. Parent giữ nguyên event quantity/unit/time/source/destination. Thời gian theo Asia/Ho_Chi_Minh; invalid/missing time có thông báo, không crash.

Canonical batch lines mở rộng từng lô: reference, quantity/unit, actual unit dimensions/weight và receipt/location nếu có. Hai coffee batches có số đo khác nhau được render riêng; không promote số đo lô đầu lên parent movement. Nếu unit batch khác parent có cảnh báo và không cộng. Số đo âm/null/NaN không trình bày như số đo hợp lệ. Arithmetic policy chỉ đọc nếu được fixture khai báo; thiếu thì ghi không có thông tin, không tự áp dụng policy.

Legacy record thiếu batch lines/schema/evidence vẫn hiện quantity/location/time gốc; không tạo fake batch IDs hoặc measurements. Optional fields có thì hiển thị, thiếu thì unavailable/ẩn. Relocation có ô trước/ô mới và staff-processed label chỉ khi fixture cung cấp; khách hàng chỉ xem, không relocation button/mutation.

## F. Navigation

- Inventory → Detail tại URL preview hiện có → Edit / History native stack.
- Inventory → Register draft native stack.
- Back đúng previous screen; fallback Inventory khi không có history.
- Direct Edit/History/Detail IDs kiểm tra tồn tại và local owner; unknown không gọi API.
- Register/Edit draft được giữ sau save và normal internal navigation; logout/restart xóa.
- Năm tabs, auth/demo guard, Self Storage và Managed routes giữ nguyên. Không browser history APIs trong app, không tab navigator thứ hai.

## G. Verification

| Lệnh/kiểm tra | Kết quả |
| --- | --- |
| npm run typecheck | PASS |
| npm test -- --silent | 5 suites, 167/167 PASS = 107 cũ + 60 mới |
| npm run check:versions | local SDK map báo dependencies up to date; endpoint offline không truy cập, không claim online Expo Doctor |
| npm run export:native | PASS iOS/Android Hermes HBC, 39 assets (~3,7/4 MB); không phải APK/IPA |
| npm run verify:website | PASS 1.074 file, changed/missing rỗng |
| node scripts/verify-phase4a-preservation.cjs | PASS 88 mobile baseline files; đúng 7 existing changes, missing/unexpected rỗng |
| Metro expo start --offline --port 8091 --max-workers 2 | PASS startup |
| node scripts/smoke-preview.cjs | PASS Phase 1, six screens/tabs/auth/back/logout/search; 320/390/768 |
| node scripts/smoke-booking.cjs | PASS Phase 2 Self Storage/rental flow; 320/390/430/768 |
| node scripts/smoke-managed.cjs | PASS Phase 3 multi-Cell Map/Review/Preview; 320/375/390/430/768 |
| node scripts/smoke-inventory.cjs | PASS Phase 4A, 320/375/390/430/768; 0 mutations/Backend requests/page errors |

60 tests mới phủ Item valid/missing/owner/status/actions; registered vs known/unknown/inconsistent/zero stock; unit differences; batches; register/edit prefill; schema required/count/decimal precision/dimensions/weight/rental/preferred Cell; image add/reorder/remove; unsaved guard; actual memory save/restore/source mismatch/confirmed removal/logout; immutable original inventory/warehouse counters; history FlatList/300-record sorting/filter/owner; legacy/single/multi-batch/mixed measurement/unit/nullable/unknown event; relocation read-only; Vietnam time; loading/error/empty; transport GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS blocked before injected adapter.

Browser test origins chỉ localhost 8091. Tất cả 4 smoke scripts không gửi Backend HTTP/mutations. Inventory smoke kiểm tra disabled stored edit, many-batch detail, unknown-stock Item, native dirty dialog cancel, save/restore, form registration/illustration reorder/remove, giữ 3 Item gốc, auth deep-link guard và document overflow. Ảnh RN Web bổ trợ: artifacts/phase4a/{detail,history,edit,register}-{320,375,390,430,768}.png. Đã xem ảnh 390/320 cho cả ba thiết kế. Đã chờ dialog fade đóng trước ảnh form cuối. Expo dev-tool badge trong ảnh không phải production UI. Artifacts/cache/node_modules gitignored.

Lượt test đầu có selectors nhầm filter text với event label và một timeout cold-run; đã chỉnh selectors trong test mới cho đúng UI semantics, focused/full rerun PASS. Không sửa/xóa tests cũ hoặc nới Jest config để làm qua. Có NO_COLOR/FORCE_COLOR tooling warning khi export, không build error.

## H. Website integrity và phạm vi file

Website files changed=[]; missing=[] trên 1.074 SHA-256 baseline. Không sửa website dependencies/config/source, không đọc secrets. Mọi source/test/docs/script writes nằm trong customer-mobile. Không Backend/database/Postman operations. 26 file gồm 7 file cũ thay đổi và 19 file mới; danh sách máy đọc: phase4a-changed-files.txt.

- app/inventory/edit/[id].tsx
- app/inventory/register.tsx
- app/inventory/[id]/history.tsx
- app/inventory/_layout.tsx
- app/_layout.tsx
- docs/ARCHITECTURE.md
- docs/design-map.json
- docs/phase4a-changed-files.txt
- docs/phase4a-mobile-baseline.json
- docs/PHASE4A_REPORT.md
- README.md
- scripts/smoke-inventory.cjs
- scripts/verify-phase4a-preservation.cjs
- src/components/inventory.tsx
- src/components/InventoryMovementCard.tsx
- src/domain/inventory.ts
- src/fixtures/inventory.ts
- src/forms/inventory.ts
- src/screens/InventoryFormScreen.tsx
- src/screens/InventoryHistoryScreen.tsx
- src/screens/InventoryItemDetailScreen.tsx
- src/screens/InventoryScreen.tsx
- src/screens/PreviewDetailScreen.tsx
- src/state/useCustomerStore.ts
- src/state/useInventoryDraftStore.ts
- tests/inventory.test.tsx

## I. Remaining scope

16/23 designs hoàn chỉnh ở UI/fixture level. Còn 7: 11 Contract Review/Signing, 12 Payment Detail, 16 Repeated Inbound, 17 Canonical Outbound, 19 Notifications, 20 Support, 23 Registration account đầy đủ. Account Registration vẫn scaffold; Inventory form (15) đã hoàn thành prototype, hai khái niệm khác nhau. Không tự triển khai Phase 4B hoặc workflows inbound/outbound.

## J. Limitations và Backend dependencies

- Không real Backend Inventory integration, authoritative stock ledger hoặc live ownership enforcement.
- Không tạo/sửa Item thật, physical inbound/outbound/relocation, occupancy/capacity/stock mutations, staff inspection hoặc rental activation.
- Không actual image upload/picker/camera hoặc persistent draft storage. Draft chỉ sống trong phiên.
- Trước integration phải xác minh Customer ownership, editable fields/statuses, eligibility/gates, DTO validation/precision, ledger envelope/batches/arithmetic policy, movement pagination và image lifecycle từ Backend. Không coi fixture fields là API contract.
- Chưa simulator/thiết bị Android/iOS: adb/xcrun không có trong PATH. Chưa verify native keyboard/gesture/hardware Back/safe-area/TalkBack/VoiceOver/font scaling/performance trên device. RN Web/Hermes không phải native device E2E hoặc live E2E.
- Dependency graph/lock không đổi; audit baseline 19 findings (13 low, 6 High, 0 Critical) vẫn chưa remediation, chưa lấy audit database mới. Nested CLI/Zod là tooling chain; Router/query-string/decode-uri-component có thể runtime URL parsing, không gọi toàn bộ dev-only. Không audit fix --force hoặc major upgrade. Xem PHASE2_REPORT/dependency-audit.json.

Sẵn sàng review UX Inventory prototype bằng fixtures, chưa sẵn sàng production release.
