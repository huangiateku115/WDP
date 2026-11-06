# Kiến trúc mobile

## Tách biệt website

`customer-mobile/` có manifest, lockfile, tsconfig, Metro, Babel và Jest riêng. Không có workspace hoặc cấu hình nào được thêm vào website. Không import code web shadcn/ui, Vite, React Router DOM hoặc dùng WebView. `react-dom`/`react-native-web` chỉ phục vụ target preview/test phụ trợ do Expo hỗ trợ; source UI dùng React Native và export được cả Android/iOS.

## Cấu trúc

```text
app/
  _layout.tsx              SafeAreaProvider, font assets, native root Stack
  index.tsx                Redirect theo trạng thái demo cục bộ
  (auth)/                  Login / Registration stack
  (tabs)/                  5 Customer tabs
  preview/[kind]/[id].tsx   Facility/Rental/Item detail, giữ URL Phase 1
  booking/[facilityId]/     Units → Review → Preview Confirmation stack
src/
  api/client.ts            Axios foundation, fail closed trước transport
  components/ui.tsx        Text, Button, Input, Card, Chip, Filter, states, Screen
  components/customer.tsx  Header/brand, facility/rental/item cards
  components/WarehouseArt.tsx  Artwork vector cục bộ
  domain/models.ts         Models, labels và format tiếng Việt
  fixtures/customer.ts     Dữ liệu mẫu tách khỏi presentation
  forms/auth.ts            Zod schemas cho form mẫu
  screens/                 Customer screens + completed registration UI (offline)
  state/useCustomerStore.ts Zustand: demo session, fixtures, local preferences
  theme/tokens.ts          Màu, spacing, type, radius, elevation, theme
tests/                     Native component/unit fixture tests
scripts/                   Website integrity + optional preview smoke
docs/                      Design map, audit, baseline, báo cáo
```

## Native navigation

- Root Stack sử dụng Expo Router; tabs và preview chỉ hiển thị khi `demoSession=true`.
- Auth group gồm `/login`, `/register`; chưa có xác thực hoặc roles từ Backend.
- Tabs: Trang chủ, Khám phá, Kho thuê, Hàng hóa, Tài khoản.
- Details push ra ngoài tab group vào stack shell; native Back/custom Back dùng history, fallback về tabs nếu không có history.
- Logout xóa trạng thái demo và tùy chọn cục bộ; protected routes chuyển về auth. Không persist token hoặc thông tin đăng nhập.

Khi tích hợp API thật phải thay guard demo bằng session/role Backend đã xác minh, không xem boolean demo là cơ chế bảo mật.

## Design system

- Tokens: spacing 4/8/12/16/20/24/32/40; radius 8/12/20/pill; elevation theo platform.
- Inter regular/medium/semibold/bold được require từ file TTF cục bộ; không tải Google Fonts CDN.
- Ionicons native, import riêng family; không mang toàn bộ icon/font families vào app.
- Native `StyleSheet` là styling solution; không cấu hình web Tailwind/shadcn hay thêm NativeWind không cần thiết.
- Mục tiêu chạm tối thiểu 44–50 dp, screen-reader labels/role/state, form error, keyboard scroll, safe-area, content max width 720 cho tablet.
- Inter giữ tiếng Việt; text/empty states đều tiếng Việt. Cần kiểm tra font scaling, bàn phím, TalkBack/VoiceOver trên thiết bị ở phase sau.

## State và dữ liệu

Presentation đọc typed fixtures từ Zustand. Không có API response giả được diễn giải như Backend thật. Search/filter là phép lọc cục bộ. Stock fixture có onHand/held/available riêng; missing/inconsistent trả unavailable, không suy diễn positive availability.

RHF + Zod kiểm tra form bản mẫu; login chỉ mở demo và registration chỉ báo hợp lệ. Password không được lưu/log/đưa vào Zustand. Các schema này chưa phải contract xác thực Backend.

Axios có interceptor ném `PHASE1_OFFLINE` với mọi method trước transport. Tests chứng minh GET/POST/PUT/PATCH/DELETE đều bị chặn, kể cả adapter do caller truyền. Khi tích hợp API thật cần audit API rồi thay foundation có chủ đích; không bật bằng một env flag ẩn.

## Giới hạn hiện tại

Không Backend calls, mutation, notification subscription, camera, NFC, payment, contract signing hoặc warehouse physical operation. Không API business rule nào được suy diễn từ HTML handoff. Facility booking và rental lifecycle hiện là UI/fixture Phase 2; Item Detail/Registration/History là UI/fixture Phase 4A; chưa có Inventory operations thật.

## Phase 2 · Booking prototype

Typed draft trong `useBookingStore`: facilityId, unitId duy nhất, start (YYYY-MM-DD theo lịch Việt Nam), months, previewed. Báo giá/end date được derive qua hàm thuần, không giữ thêm state có thể lệch. Unit fixtures độc lập với Managed Cells. Kho trống được kiểm tra theo interval [start,end), operational fixture và lock xem trước trong phiên; không phải live availability/HOLD.

`RentalPeriodSelector` tái sử dụng RHF/Zod ở Unit Selection và Review; đồng bộ draft khi quay lại stack. Quy ước mẫu tính tháng lịch, clamp ngày cuối tháng; không tự coi là chính sách Backend. Đơn giá mẫu × tháng; tiền thuê trả trước bằng một tháng mẫu được cấn trừ, không có phí bảo đảm bổ sung, ưu đãi hoặc hoàn cọc suy đoán.

Preview là thao tác bộ nhớ, không tạo ID, không sửa rentals, không tạo giao dịch. Lock Unit ngăn xem trước lặp lại trong cùng phiên; logout xóa draft và lock. Nút đồng ý chỉ xác nhận hiểu phạm vi prototype. Confirmation deep link không có draft hợp lệ hiển thị empty state.

Route Facility/Rental cũ vẫn tương thích; booking screens nằm trong native Stack được bảo vệ bởi cùng demo guard. Custom Back dùng Expo Router history và fallback tab, không dùng browser history. Android hardware Back do native stack xử lý; chưa kiểm tra trên emulator/device.

RentalFacts riêng chứa total/depositCredited/balancePaid, contract, handover và các milestone; không suy diễn chúng từ ACTIVE. Chỉ mô tả đủ điều kiện tự quản khi ACTIVE + handover, không có PIN/NFC/QR/unlock. Managed hiển thị ô kệ và không có quyền ra vào kho chung.

## Phase 3 · Managed Warehouse / Multi-Cell

Thêm native stack `managed/[facilityId]/{map,review,confirmation}` trong cùng demo guard; không thêm tab. Facility Detail chỉ bổ sung CTA Managed. `Screen` có footer tùy chọn ngoài ScrollView, sử dụng safe-area/KeyboardAvoidingView hiện có; các màn cũ không dùng footer giữ nguyên cấu trúc. `RentalPeriodSelector` nhận Pick<BookingDraft,start|months>, tái sử dụng RHF/Zod mà không ghép hai draft.

Domain ManagedFacility → ManagedZone → ManagedRack → ManagedCell trong `domain/managedBooking.ts`; cấu hình tầng, vị trí map, kích thước/volume/weight/null usage/operational evidence và intervals từ `fixtures/managedWarehouse.ts`. Có kệ 1/2/3/4/5 tầng, nhiều kích cỡ và Zone/Rack inactive/empty. Không suy từ operational AVAILABLE ra bookable.

`useManagedBookingStore` độc lập với `useBookingStore`, chỉ giữ facilityId/cellIds/start/months và metadata preview. Không giữ tổng volume/giá redundant. Đổi facility khởi tạo draft mới; cùng facility/Back giữ draft. Đổi kỳ thuê giữ các ô mất điều kiện kèm giải thích, chặn tiếp tục đến khi khách chủ động bỏ hoặc đổi kỳ. Logout xóa cả hai draft.

Eligibility: valid calendar [start,end), period OCCUPIED/overlapping RESERVED/HOLD ưu tiên hơn operational AVAILABLE; ownership không cấp ngoại lệ. Sau đó kiểm tra hoạt động Facility/Zone/Rack, cấu trúc/geometry, period AVAILABLE, operational AVAILABLE và physical counters được biết, hợp lệ, bằng 0. Thiếu/mâu thuẫn fail closed. Weight limit null không bị tự gán, physical usage null không được đổi thành 0. Không suy OCCUPIED từ RESERVED/isMine.

Map dùng View/Pressable tọa độ fixture + hai ScrollView có nested scrolling, không map engine. Zoom thay tỷ lệ hiển thị; không sửa geometry. Rack drill-down cùng panel, Back trở lại floorplan còn mounted để giữ zoom/pan trong Zone khi có thể. Chọn Zone khác đặt lại panel/góc nhìn của Zone nhưng giữ basket. Ô nhóm theo levels thực, cuộn nội bộ, mã ô/volume/trạng thái và detail card; unknown IDs không fallback sang ô khác.

Tổng volume cộng ở đơn vị nguyên 1e-6 m³, giá mẫu tính qua số nguyên tử số micro-m³ × VND/m³ rồi chia 1e6; nếu không có giá nguyên VND nhất quán thì không quote. Tổng = monthly × months; advance-rent deposit = monthly, remaining = total − deposit. Đây chỉ là chính sách fixture, không Backend policy.

Preview chỉ đánh dấu bộ nhớ, không tạo ID/record/HOLD hoặc đổi counters. Fingerprint JSON cục bộ bind kỳ thuê/rate/dữ kiện ô đã review, không phải hash bảo mật/concurrency token. Confirmation đòi preview flag + fingerprint khớp + eligibility/quote hiện tại; thay dữ liệu có thể invalid. Sửa ô/kỳ thuê xóa flag/fingerprint, cùng preview không gửi lặp. Draft được giữ đến khi đổi facility/logout/restart; không insert My Rentals.

Shared PrototypeConfirmationHeader được dùng cho Self Storage và Managed; thông điệp không tạo đơn thật không đổi. Chỉnh sửa từ Managed Review dùng Back về Map hiện tại (fallback replace nếu không có history), tránh tạo Map trùng trên stack. Không route nào dùng browser history trong source app.

## Phase 4A · Inventory

Giữ /preview/item/:id và dispatcher preview; thêm inventory/{register,edit/[id],[id]/history} trong cùng demo-protected native stack. Inventory tab thêm đăng ký bản nháp, vẫn dùng search/category/card hiện có. Chỉ lọc metadata owner cục bộ; không thay Backend authorization. Không đổi năm tabs hoặc Self Storage/Managed routes.

Model riêng domain/inventory.ts, fixtures/inventory.ts bổ sung metadata owner, descriptions, illustration refs, preferred Cell, measurements, canonical stock certainty/unit, source batches, form rental contexts và legacy/canonical movements. Customer fixtures cũ, ledger values, warehouse counters không đổi. Rental contexts của form có eligibility rõ ràng DEPOSIT_PAID/ACTIVE/awaiting/closed, chỉ minh họa; không thêm My Rentals hoặc suy từ mọi Managed Reservation.

StockBalance dùng stock hiện có đã validate arithmetic + metadata state/unit; registered quantity không thay on-hand. Missing/inconsistent ledger không đổi thành 0 hoặc suy available. Batch location/measurements tách thông số khai báo và movement parent. Không cộng quantity khác đơn vị.

useInventoryDraftStore chỉ lưu form values trong bộ nhớ theo owner+register/edit:itemId, timestamp và source binding. Không tạo Item IDs/fixtures, không persist device storage. Save kiểm tra schema, owner key, eligibility và stored-item edit restriction. Logout xóa. Khôi phục chỉ khi source fingerprint phù hợp; stale draft phải xác nhận trước khi bỏ.

RHF/Zod: name/category/count quantity/unit/rental/dimensions/weight; quantity nguyên dương cho 4 đơn vị đếm mẫu, dimensions/weight dương tối đa 3 decimals, dot/comma; optional preferred Cell phải thuộc rental context. Đây là UI fixture validation, chưa Backend DTO. Editor tách gate để giữ hook order an toàn. usePreventRemove từ public expo-router/react-navigation + useNavigation bảo vệ native stack Back/gesture/hardware removal; Modal cho giữ/sửa hoặc bỏ thay đổi. Sau save reset dirty; bản nháp save được phục hồi, phần chưa lưu phải xác nhận bỏ khi rời.

Images là Illustration IDs cho SVG gốc cục bộ, thêm/xóa/đổi thứ tự bằng buttons; không camera/picker/filesystem/upload hoặc remote assets. Lưu memory không tự thêm ảnh vào item gốc.

History dùng FlatList độc lập SafeAreaView, không nested vertical ScrollView; initialNumToRender/maxToRenderPerBatch=8, windowSize=7, sort giảm dần theo event time, invalid time về cuối, stable ties. Search/filter local, owner/item bound. Parent quantity/time/location riêng; mỗi canonical batch giữ số đo thực riêng. Legacy thiếu lines/optional fields render unavailable, không fake batch IDs, không tự infer arithmetic policy hay recompute ledger. Relocation chỉ read-only; không Staff controls.

## Phase 4B · Requests UI

Thêm /inventory/[id]/inbound, /outbound và /requests/[requestId] trong native Inventory stack hiện có. Inbound nhận requestId query để dùng lại editor ở mode AMEND. Không đổi route cũ, năm tabs hoặc Item Registration/History. Item Detail chỉ bật prototype navigation khi request policy fixture cho phép; cà phê cố ý feature-disabled, packaging eligible, samples chưa tiếp nhận lần đầu.

Domain/fixtures riêng inventoryRequests.ts: policy cho từng owner/item/kind, first-intake evidence và feature DEMO_AVAILABLE/DISABLED; request status *_DEMO, version, explicit amend/cancel flags, issue scenarios và read-only timeline. Không coi các enum là Backend contract hoặc suy eligibility từ mọi IN_STORAGE. Policy chỉ mô phỏng: không đọc gate môi trường, không bật MI06 trên server.

requestEligibility cần owned context + explicit feature/eligibility + stored/first-intake-completed + rental ACTIVE trong fixture. Outbound còn cần canonicalStock hợp lệ, unit khớp và available>0; schema chặn quantity>available. Inbound chỉ validate khai báo, không capacity/placement approval. Không lấy registeredQuantity/movement totals làm availability. Cancel/amend trong prototype cũng fail closed khi base context không eligible; không khẳng định đây là chính sách cancellation Backend.

useRequestDraftStore độc lập với Item draft và tất cả authoritative fixtures. Key theo owner/item/kind/intent/reference gốc; chỉ lưu form values, source fingerprint, updated time và PREVIEW_ONLY. Không tạo Backend request IDs. CREATE không được mang requestId; AMEND/CANCEL phải có request gốc thuộc owner/item/kind, explicit action flag, version đúng và source snapshot còn khớp. Confirm re-check current fixture data. Duplicate normalized values/source không ghi timestamp hoặc tạo draft lặp. Đây không phải real idempotency/concurrency protection.

Editor RHF/Zod có schema theo kind; đơn vị cố định từ Item, inbound có số đo dương 3 decimals/dot-comma, outbound positive integer <=verified available. Note chỉ là design field. Native Modal lưu preview có snapshot fingerprint/version tại lúc mở; stale source bị chặn ở store. Native usePreventRemove/DiscardDraftDialog giữ phần đã lưu, xác nhận bỏ phần chưa lưu; saved compatible drafts restore, stale drafts không tự restore. Logout xóa cả request kinds.

RequestWorkspace dùng FlatList với form trong ListHeader, history rows virtualized và CTA cố định ngoài list/safe-area/keyboard container, không nested long vertical FlatList trong ScrollView. RequestDetails dùng Screen cho timeline ngắn; partial fulfillment/held chỉ đọc. Các UI issues version/status/precondition/uncertain/network đều từ fixture, không fake HTTP response, headers hoặc retry API.

## Phase 5A · Read-only rental documents

Native stack mới /rentals/[id]/{contract,payment} dùng root demo guard hiện có; không đổi năm tabs, dispatcher /preview/rental/:id hoặc các flow booking/inventory/requests. RentalDetail chỉ thêm entry points và dùng reviewFinance cho các số tiền cũ. Không thêm global store hoặc persist tài chính.

Domain rentalDocuments.ts dùng typed contract snapshot, phiên bản và tham chiếu nội dung minh họa (không hash), hai PartySignature độc lập; tiến độ SIGNED đòi status rõ + hai recorded signatures khớp cùng version/reference. Mismatch/stale fail closed, acknowledgement không thay đổi model. contractAvailabilityReason kiểm tra ownership/rental/service của snapshot, financial terms và deposit/inspection evidence. Nội dung/tài nguyên/ngày/terms hiển thị từ snapshot bất biến. Chỉ các đoạn mô tả để đánh giá UI, không legal clauses.

reviewFinance là điểm duy nhất tính tài chính mới: số nguyên VND an toàn, T/D_required/D_credited/initialBalance/balancePaid, kiểm tra từng payment record theo purpose/status/currency. RemainingInitialBalance=max(0,T-D_credited); outstanding=initialBalance-balancePaid. Pending/failed/expired/unknown không credit. SETTLED cần marker và bằng chứng xác nhận; số dư 0 không tự coi là settled hoặc tạo payment 0. Thiếu/mâu thuẫn không fallback số tiền. Formatter money cũ chỉ nhận giá trị đã validate.

fixtures/rentalDocuments.ts giữ deep-frozen snapshots, financial records DEPOSIT/BALANCE riêng. Các original records đối chiếu đúng rentalFacts cũ; alternate scenarios chỉ thay góc nhìn, không ghi fixture, không mô phỏng giao dịch thành công từ nút bấm. Các timestamp/signature chỉ là dữ liệu sẵn minh họa, không proof thật. Owner filter cục bộ không thay Backend security.

ContractReview dùng Screen native scrolling, cards/progress/signature/finance + local checkbox reset theo scenario/version/reference. PaymentDetail có purpose picker và service-specific PaymentTimeline, explicit handover/first inbound/activation evidence độc lập. Không suy các bước vật lý từ thanh toán/ký đủ. ScenarioPicker local state, không store. Tất cả financial/legal mutations, PDF/email/refresh bị khóa. Axios client, blockers, auth foundation, dependencies và design tokens không đổi.

## Phase 5B · Customer Care & Registration

`/notifications` và native `/support` stack (index/new/[requestId]) ở root demo guard cũ; `/register` vẫn auth group, không duplicate route/router/tab. Home CustomerHeader nhận showNotifications để thêm bell, Profile có care entries. Shared BackAction chỉ mở rộng kiểu fallback sang Expo Href; runtime behavior cũ không đổi.

Domain customerCare.ts có typed presentation categories/statuses, owned resource selectors, stable Vietnam date sorting và literal route resolver. Không nối path từ metadata tùy ý. Resolver kiểm owner của notification, owned Rental snapshot/Item metadata/request item+owner/support record và Payment purpose. Missing/unknown targets không mở route khác. Fixture customerCare.ts deep-frozen, chỉ customer hiện tại, gồm incomplete/unknown/missing examples. Các messages support chỉ customer-visible mẫu, không internal notes/assignment.

CareList dùng FlatList độc lập cho notifications/support list/conversation, không nested long list. ListEmptyComponent được bọc View (không Fragment nhận onLayout từ VirtualizedList). Existing Screen dùng cho forms với keyboard-aware safe-area. Category/status cards tái sử dụng primitives; không đổi token/dependency.

useCareSessionStore tách readOverrides theo owner/notification và một support draft theo owner, không persist. SourceBinding chỉ owner + owned resource identity/relationship; không Backend hash/version token. Support form save kiểm schema và binding trên current data. Restore cần owner/source/reference hợp lệ; stale draft fail closed tới explicit removal. Native usePreventRemove bảo vệ dirty Back/gesture, dialog keep/discard và explicit delete; saved draft không insert ticket fixtures, không sinh server reference. Logout gọi clear cùng các draft stores cũ.

Support optional related rentals gồm My Rentals có explicit original owner metadata và inventoryRentals có owner rõ; inventory contexts vẫn tách khỏi My Rentals, không tạo route detail giả. Item+rental phải khớp inventoryDetail.rentalId khi cùng chọn. Request detail chỉ mở liên kết nguồn khi tồn tại/owned/matching; ngữ cảnh inventory rental chỉ là label nếu chưa có My Rentals detail. Reply disabled.

Registration mở rộng scaffold tại chỗ: giữ Login schema/demo semantics. RHF/Zod name/email/phone/password/confirmation/consent, normalize display fields, không trim password ngầm. Thresholds UI-only; terms placeholder không thay chính sách thật. Password chỉ RHF local, không store/log/params/storage/network; reset password/confirmation sau validation hợp lệ, không auth. Không API/OTP/email/account creation.

23 designs được audit trong UI_COMPLETENESS_AUDIT.md; design-map chứa route files, implementation paths, fixture/entry/tests/backend/limitations từng design. Registry verification chỉ kiểm kê source/metadata, không thay visual/native/Backend acceptance. Security/compatibility và integration remain separate phases.
