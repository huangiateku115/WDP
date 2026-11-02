# Customer Mobile — Phase 4B: Repeated Inbound & Canonical Outbound UI

## A. Preservation

Hoàn thành trong frontend/customer-mobile trên Expo 57 / React Native 0.86.3 / React 19.2.3 hiện có. Đã đọc AGENTS, README, Architecture, các báo cáo Phase 1–4A, design-map, source Inventory/models/fixtures/stores/forms/routes/tests và HTML 16/17. Chỉ tham khảo HTML/design intent; không copy DOM/scripts/CDN/WebView hoặc fake API code. Dùng native components, Inter/Ionicons và design primitives/colors có sẵn.

Giữ 16 thiết kế trước, năm tabs và 167 tests gốc không chỉnh sửa/xóa. StockBalance, Batch/source, Registration/Edit, Movement History và Self Storage/Managed booking không thay logic. Item Detail chỉ thêm prototype navigation nơi policy fixture eligible. Coffee cố ý feature-disabled nên placeholders cũ vẫn disabled, bảo toàn regression; packaging là ví dụ hoạt động; samples REGISTERED chưa tiếp nhận lần đầu bị chặn.

Baseline mobile trước phase gồm 107 file: đúng 5 file có sẵn đổi trong phạm vi; missing/unexpected rỗng. Không đổi manifest/lockfile, dependencies, Metro/Expo/Jest config, API client/transport, auth/demo guard, date/price helpers hoặc fixtures Item/Stock/Batch/Movement/Cell cũ. Logout chỉ bổ sung clear request drafts. Git status không đọc được metadata worktree cha (fatal cannot change to WDP); không reset/checkout/clean. Không đọc .env, backend/, BE-REF/, database/Postman.

## B. Hai màn hình hoàn chỉnh ở phạm vi prototype

| Design | Route | Implementation |
| --- | --- | --- |
| 16 Repeated Inbound | /inventory/:id/inbound | InventoryRequestScreen kind INBOUND, native RHF form + request history |
| 17 Canonical Outbound | /inventory/:id/outbound | InventoryRequestScreen kind OUTBOUND, verified fixture stock + partial quantity + native confirmation |
| Supporting request detail | /inventory/:id/requests/:requestId | InventoryRequestDetailScreen, read-only status/timeline and prototype actions |
| Amendment mode | /inventory/:id/inbound?requestId=:requestId | Same Inbound editor, request prefill/version binding; không tính thêm design |

Map design-map có source hashes, routes/components/data/tests/Backend dependencies. Không dùng shell để tính completed. Không thêm navigator thứ hai; các routes mới dùng Inventory native stack đã có.

## C. Repeated Inbound

Context tách own Item/Detail, Managed rental fixture và policy theo owner/item/request kind. Cần explicit feature DEMO_AVAILABLE, policy eligible, IN_STORAGE, firstIntakeCompleted=true và rental ACTIVE trong fixture. Đây là điều kiện minh họa, chưa xác nhận business contract Backend. Không coi mọi IN_STORAGE eligible. REGISTERED chờ intake lần đầu không được dùng repeated inbound.

Main UI: local ItemArtwork, item name/code/status/rental/location, StockBalance và form quantity/unit/declared width/depth/height/weight/optional note. Current stock chỉ hiện nếu Phase 4A canonicalStock hợp lệ. Không lấy registeredQuantity làm on-hand, không approve capacity hay placement dựa trên số đo khai báo.

RHF/Zod validate required positive safe-integer count quantity, unit khớp Item, positive finite dimensions/weight tối đa 3 decimals, dot/comma; note tối đa 1.000 ký tự chỉ là design field. Đơn vị cố định, không tự convert quantity. Không thêm Backend DTO fields/schedule/insurance/delivery promises từ Stitch.

History FlatList có reference, quantity/unit, demo status, created/updated và details. Có pending, completed read-only, version conflict, missing precondition, uncertain outcome và long archived list. Các enum *_DEMO là UI fixtures, không Backend state enums đã xác nhận.

Detail có context/request/declared unit measurements/version/timeline/actions. AMEND chỉ cho request fixture allowAmend, cùng owner/item/kind, issue NONE, valid version và base context eligible. Prefill request gốc; lưu amendment preview không sửa quantity/version/status gốc. CANCEL cũng kiểm tra explicit flag và phiên bản, cần native confirmation; chỉ tạo draft intent CANCEL, không đổi request thành canceled.

Feature disabled hiển thị chính xác “Tính năng yêu cầu nhập thêm hiện chưa khả dụng.” Không có environment flag/switch unlock. Những cảnh báo không phải thông báo lỗi HTTP thật.

## D. Canonical Outbound

Tái sử dụng StockBalance: packaging đăng ký 99 kiện, on-hand 60, held 15, available 45. Chỉ cho prototype khi base eligibility rõ ràng và canonical balance KNOWN/consistent/unit-matching. Positive quantity <=45; 12 kiện là partial preview, 50/99 bị chặn dù registered quantity lớn hơn. Verified available=0 chặn số dương; missing/inconsistent ledger hoặc mixed units fail closed, không coi thiếu ledger là zero.

Native confirmation Modal có item, quantity, available trước yêu cầu, summary và note Staff handling. Chỉ sau confirm và store save thật mới hiện “Đã lưu bản nháp yêu cầu xuất kho trong phiên — chưa gửi lên hệ thống.” Không real submission success. Unchanged duplicate preview bị disable và store chống ghi trùng.

History có pending request 3 kiện và partial request 20 kiện (Staff đã xử lý 8, còn held 12 trong dữ liệu mẫu). Partial timeline chỉ đọc; không Customer partial-completion controls. Số held trên từng request không dùng để tính lại canonical balance. Cancel chỉ qua detail khi explicit eligible; ví dụ partial/completed/status-changed bị khóa và giải thích. Status gốc sau cancel preview vẫn giữ nguyên.

Coffee minh họa feature disabled; không tự giả định MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED hoặc MI06_STOCK_LEDGER_WRITES_ENABLED của Backend đang bật. Không Expo env flag, không Frontend bypass và không legacy outbound fallback. Production availability chưa xác minh.

## E. Local state, concurrency và safety

useRequestDraftStore tách Item Registration draft và toàn bộ authoritative fixtures. Một draft theo owner/item/kind/intent/original reference, chỉ giữ values/source fingerprint/updated time/PREVIEW_ONLY. Inbound/Outbound tách kind, CREATE/AMEND/CANCEL tách intent. Không generate Backend request IDs; reference chỉ trỏ request fixture đã có.

Confirm revalidate current fixture data: ownership, feature/item/rental eligibility, stock/schema, action flags/version và source fingerprint. CREATE không mang requestId; AMEND/CANCEL cần valid original request và expectedVersion đúng. Native modal giữ snapshot fingerprint/version tại lúc mở, tránh dùng dữ liệu mới để hợp thức hóa preview cũ. Source thay đổi bị từ chối. Repeated same normalized values/source không ghi timestamp hoặc tạo draft mới. Đây chỉ là local duplicate/staleness protection, không real idempotency/concurrency authorization.

Compatible saved draft restore khi Back/reopen. Unsaved form state nằm trong RHF, được giữ khi push Detail và trở lại; khi removal có native usePreventRemove + DiscardDraftDialog. Confirm bỏ phần chưa save, giữ draft đã save trước đó. Stale saved draft không restore tự động, cần xác nhận bỏ nháp cũ. Logout/restart xóa nháp nhạy cảm, không persist device storage.

Các issue states từ fixtures: invalid input, no longer eligible, changed status, version conflict, missing precondition, feature disabled, uncertain outcome, network unavailable. Có giải thích cho Customer và disabled actions. Không fake HTTP errors, automatic retry hoặc giả success. Future API có thể yêu cầu Idempotency-Key/If-Match/version/re-fetch; phase này không tạo hoặc gửi headers/calls nào.

No physical operations: không receive/inspect/confirm inbound, complete outbound/partial fulfillment, relocate, alter BatchBalance/ledger/Cell counters, activate rental, payments hoặc contracts. All Staff events chỉ đọc. Store confirm không thay Item, StockBalance, Batch, Movement hoặc request fixtures. Tests snapshot nguyên dữ liệu trước/sau xác nhận chứng minh không đổi.

## F. Navigation và mobile UX

Inventory → Item Detail (packaging) → Inbound/Outbound → Request Detail → Inbound amendment hoặc cancellation preview. Back giữ compatible draft; unknown Item/request, wrong owner/item/kind fail safely. Existing Edit/History/Self Storage/Map/Managed Review và năm tabs giữ nguyên.

Reusable InventoryRequests components: RequestWorkspace, InventoryRequestCard, RequestStatusChip, RequestItemContext, RequestDetails, RequestUnavailableState, RequestDraftNotice, RequestConfirmation. Reuse ItemArtwork, StockBalance, Value, Card/Input/Button/Text/Chip/StateCard/DiscardDraftDialog. Không sửa shared primitives để làm workflows mới.

Workspace dùng SafeAreaView + KeyboardAvoidingView + FlatList, form trong ListHeader, sticky CTA ngoài list. initialNumToRender/maxToRenderPerBatch=6, windowSize=7; không nested long vertical FlatLists trong ScrollView. Request Details dùng Screen cho short timeline. Touch targets 44–50dp, clear labels/disabled states, Vietnamese wrapping và internal scroll. Illustration dùng cục bộ; không uploads/camera hoặc remote assets mới.

## G. Testing

| Exact command/check | Actual result |
| --- | --- |
| npm run typecheck | PASS |
| npm test -- --silent | 6 suites, 226/226 PASS = 167 cũ + 59 mới |
| npm run check:versions | local SDK dependency map báo up to date; endpoint offline không truy cập được, không claim online Expo Doctor |
| npm run export:native | PASS Android/iOS Hermes HBC, 39 assets (~4 MB / 3,7 MB); không phải APK/IPA |
| npm run verify:website | PASS 1.074 file, changed/missing rỗng |
| node scripts/verify-phase4b-preservation.cjs | PASS 107 mobile baseline files, đúng 5 existing changes, missing/unexpected rỗng |
| Metro expo start --offline --port 8091 --max-workers 2 | PASS startup |
| node scripts/smoke-preview.cjs | PASS Phase 1 six screens/tabs/auth/back/logout/search |
| node scripts/smoke-booking.cjs | PASS Phase 2 Self Storage/rental flow |
| node scripts/smoke-managed.cjs | PASS Phase 3 multi-Cell Map/Review/Preview |
| node scripts/smoke-inventory.cjs | PASS Phase 4A Item/Register/Edit/History/draft/images |
| node scripts/smoke-requests.cjs | PASS Phase 4B at 320/375/390/430/768, 0 mutations/Backend requests/page/console errors |

59 new tests: eligible/missing/first-intake distinction; item/rental/gate rejection; count/dimension/weight/precision/unit; list/native routes/detail/version; save/restore/native removal guard; amend/cancel immutable previews; completed/feature-disabled actions; canonical 60/15/45 vs 99; partial >available/zero/missing/mixed-unit/REGISTERED rejection; duplicate timestamp protection; modal honest save; partial read-only; no legacy fallback; inventory/batch/movement/counter immutability; scoped IDs/owner; logout; all conflict/uncertain/network/precondition states; stale source/draft; kind separation; no Staff controls; loading/error; GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS blocked before adapter; bare text outside native Text regression.

Browser scenarios: validate 50>45 then 12, native outbound confirmation, unchanged duplicate disabled, partial request read-only, cancel preview still WAITING, inbound invalid weight then save, unsaved Back cancel, amendment 14 with original request still 12/version 3, conflict actions disabled, Back draft restoration, logout/deep-link demo guard, document overflow. All scripts intercept origins to localhost only and verify no API/Backend mutations.

Screenshots RN Web bổ trợ: artifacts/phase4b/{inbound,outbound,outbound-confirm,partial,amend,conflict}-{320,375,390,430,768}.png. Đã xem ảnh 320/390 của form/partial/conflict/modal. Modal screenshots chờ opacity fade ổn định; Expo dev tooling badge không phải production UI. Không coi ảnh RN Web là device screenshots. Artifacts/cache/node_modules gitignored.

Initial typecheck gặp stale generated route types, Metro sinh lại routes rồi PASS, không sửa protected config. Browser smoke đầu bắt raw JSX whitespace trong View ở RequestDetails, gây native warning/LogBox overlay; đã sửa đúng component mới, thêm bare-text regression và console-error smoke guard, rerun PASS. Không dismiss lỗi để giả pass. Tooling NO_COLOR/FORCE_COLOR warning còn, không build failure.

## H. Website integrity / files

Website SHA-256 baseline: 1.074 file, changed=[], missing=[]. Không modify website dependencies/config/source. Không Backend/database/Postman operations hoặc secrets reads. Mọi source/test/docs/script writes trong customer-mobile. 20 file gồm 5 file có sẵn thay đổi và 15 file mới; manifest: phase4b-changed-files.txt.

- app/inventory/[id]/inbound.tsx
- app/inventory/[id]/outbound.tsx
- app/inventory/[id]/requests/[requestId].tsx
- docs/ARCHITECTURE.md
- docs/design-map.json
- docs/phase4b-changed-files.txt
- docs/phase4b-mobile-baseline.json
- docs/PHASE4B_REPORT.md
- README.md
- scripts/smoke-requests.cjs
- scripts/verify-phase4b-preservation.cjs
- src/components/InventoryRequests.tsx
- src/domain/inventoryRequests.ts
- src/fixtures/inventoryRequests.ts
- src/screens/InventoryItemDetailScreen.tsx
- src/screens/InventoryRequestDetailScreen.tsx
- src/screens/InventoryRequestScreen.tsx
- src/state/useCustomerStore.ts
- src/state/useRequestDraftStore.ts
- tests/inventory-requests.test.tsx

## I. Remaining scope

18/23 UI designs complete ở offline fixture level. Còn 5: 11 Contract Review/Signing; 12 Payment Detail; 19 Notifications; 20 Support; 23 Account Registration đầy đủ (vẫn scaffold). Supporting Request Detail/AMEND modes không tính thành design mới. Không tự triển khai phase tiếp theo.

## J. Limitations / Backend dependencies

- No live Backend integration, real inbound/outbound request, amendment/cancellation, stock movement, ledger write, Cell occupancy change hoặc Staff completion.
- Local status/fingerprint/version checks không chứng minh Backend Idempotency-Key/If-Match semantics, concurrency protection hoặc ownership authorization. Khi integration cần source-verified endpoints/method/body/envelopes/roles/gates/request-state eligibility/version/replay/conflict re-fetch.
- Cancel/amend cũng bị chặn nếu base prototype context mất eligibility/stock certainty; không khẳng định đây là cancellation business rule Backend. Các *_DEMO enums/rental ACTIVE/feature choices chỉ mô phỏng thiết kế.
- Không image upload mới, actual physical placement, request persistence hoặc native device storage. Draft chỉ trong bộ nhớ, mất logout/restart.
- Chưa simulator/device E2E, adb/xcrun không có trong PATH. Chưa xác minh OS keyboard/hardware Back/gesture/safe-area/font scaling/TalkBack/VoiceOver/performance; RN Web/Hermes không thay native acceptance hoặc live E2E.
- SDK-compatible dependency graph/lock giữ nguyên. Recorded audit baseline 19 findings (13 Low, 6 High, 0 Critical) chưa remediation hoặc refresh advisory DB. CLI/nested Zod là tooling chain; Router/query-string/decode-uri-component có thể runtime URL parsing, không gọi toàn bộ dev-only. Các advisories là release blockers, task riêng; không audit fix --force/major upgrades. Xem PHASE2_REPORT/dependency-audit.json.

Sẵn sàng review UX request prototypes, chưa sẵn sàng production Inventory integration.
