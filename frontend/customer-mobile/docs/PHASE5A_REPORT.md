# VaultSpace Customer Mobile — Phase 5A

Ngày kiểm tra: 30/10/2026. Phạm vi: Customer mobile offline UI/fixture. Không tích hợp hoặc kiểm thử Backend thật.

## A. Preservation

Đã đọc AGENTS.md, README, ARCHITECTURE, báo cáo Phase 1–4B, design-map và HTML Stitch 11/12. Không truy cập backend/ hoặc BE-REF; không đọc secrets/.env. Kiểm tra cấu trúc My Rentals, Rental Detail, RentalLifecycleTimeline, fixtures, stores, guard, primitives và test trước sửa.

Baseline mobile trước Phase 5A: **122 file**. Sau task: **117 không đổi**, 5 file cũ được sửa đúng phạm vi, **0 missing, 0 unexpected**. Bằng chứng: phase5a-mobile-baseline.json, phase5a-preservation-result.json và scripts/verify-phase5a-preservation.cjs. Các cấu hình, dependency manifests/lock, transport Axios, tokens, Zustand stores, fixtures cũ và tất cả 226 tests cũ không đổi. Không thực hiện destructive git. Git metadata cha không truy cập được như repository thông thường trong phiên; dùng đối chiếu SHA-256, không khẳng định clean git working tree.

18 thiết kế cũ vẫn qua regression cùng năm smoke scripts (login/five tabs, Self Storage booking, Managed multi-Cell map/booking, Item Detail/register/edit/history, repeated inbound/canonical outbound). Điều này xác nhận mức prototype/fixture và RN Web bổ trợ; không khẳng định feature Backend hoặc native device đã được nghiệm thu.

Chỉ hai source cũ được sửa:

- app/_layout.tsx: thêm rentals stack dưới demo guard hiện có, không router/tab mới.
- src/screens/RentalDetailScreen.tsx: entry points tới hai màn hình và dùng validated finance cho số tiền hiển thị. Giữ URL cũ, lifecycle/handovers và các labels tương thích.

Ba tài liệu cũ được cập nhật: README.md, docs/ARCHITECTURE.md, docs/design-map.json. Danh sách đầy đủ file mới/sửa: phase5a-changed-files.txt. Artifacts và .expo là output kiểm thử, không source changes.

## B. New Screens

| Stitch | Màn hình native | Expo Router URL | Source |
|---|---|---|---|
| 11 | Hợp đồng thuê kho | /rentals/:id/contract | src/screens/ContractReviewScreen.tsx; app/rentals/[id]/contract.tsx |
| 12 | Chi tiết thanh toán | /rentals/:id/payment | src/screens/PaymentDetailScreen.tsx; app/rentals/[id]/payment.tsx |

Tích hợp native stack trong app/rentals/_layout.tsx, chung guard hiện có. Giữ route Rental Detail /preview/rental/:id. Payment nhận purpose=DEPOSIT hoặc BALANCE; scenario query chỉ chọn ví dụ thuộc cùng owner/rental. Không route API hoặc browser history mới.

Mỗi design có source HTML SHA-256, domain/components, fixtures, coverage và Backend dependency trong design-map.json. Dùng native Screen/Card/Button/Chip/Filter/AppText/Icon/Value/BackAction; không DOM, WebView, HTML scripts hoặc CDN. Giữ tokens Emerald/forest/mint/orange và Inter của app cũ, không đổi theme toàn app.

## C. Contract Review

Domain: ContractDocument, PartySignature và RentalDocumentScenario trong src/domain/rentalDocuments.ts. Fixture deep-frozen trong src/fixtures/rentalDocuments.ts. Snapshot giữ owner/rental/service, facility/customer placeholder, resources, dates, version/reference và financial terms. UI đọc nội dung từ snapshot; không sửa nội dung hoặc tính hash. Tham chiếu nội dung là nhãn minh họa, không cryptographic proof.

Khách hàng và đại diện cơ sở có hai cards riêng với vai trò, trạng thái, version và timestamp mẫu khi có. SIGNED chỉ hiển thị đầy đủ khi status rõ và hai recorded signatures cùng version/reference. One-party là partial; version/content mismatch hoặc stale không coi signed. Legacy chỉ đọc. Các trạng thái deposit chưa xác nhận, chưa inspection, missing/error document không tạo tài liệu thay thế. Snapshot lệch owner/rental/service/financial terms bị từ chối.

Nội dung dài cuộn native; các mục mô tả không phải điều khoản pháp lý. Checkbox chỉ local useState và reset theo scenario/version/reference, không đổi signatures/rental hoặc mở thanh toán. Sign/PDF/email luôn disabled. Các ví dụ signed/paid là dữ liệu tĩnh được gắn nhãn; không sinh từ bấm nút.

Reusable: PrototypeFinancialNotice, ContractProgressCard, ContractSignatureStatus, FinancialBreakdown, FinancialScenarioPicker, safeRentalDate. Không thêm global financial store hoặc lưu dữ liệu vào device storage.

## D. Payment Detail

Typed DemoPayment tách DEPOSIT/BALANCE thành hai record độc lập; các status *_DEMO là enum trình bày fixture, không được khẳng định là Backend enum. Mỗi record có amount/currency/status/timestamp tùy chọn, reference thực để null. Không tạo tài khoản ngân hàng/ref/provider credentials.

reviewFinance là nguồn tính mới duy nhất. Chỉ chấp nhận số nguyên VND không âm trong Number safe integer; không làm tròn dữ liệu bất nhất. Required deposit, confirmed credited deposit và paid balance có kiểm tra bằng chứng/status/purpose/amount/currency.

- Initial balance = max(0, totalRent − confirmedDepositCredited).
- Outstanding = initialBalance − confirmedBalancePaid.
- Deposit là advance rent cấn trừ tổng thuê, không khoản bảo đảm cộng thêm.
- Pending/failed/expired/unknown không credit; balance chưa confirmed không coi paid.
- SETTLED cần marker tường minh, deposit đủ và bằng chứng record tương ứng; outstanding 0 đơn thuần không tự tất toán.
- Zero balance không tạo record/yêu cầu 0 VND. Ví dụ zero có confirmed deposit đủ total và marker SETTLED sẵn.
- Thiếu/mâu thuẫn/unsafe currency amounts hiển thị unavailable, không fallback 0 hoặc fabricate amount.

Ví dụ gốc Self: tổng 5.550.000, credited 1.850.000, confirmed balance paid 3.700.000, outstanding 0. Managed gốc: tổng 2.880.000, required 960.000, credit 0 khi pending, initial balance 2.880.000; ví dụ deposit confirmed độc lập có initial balance 1.920.000. Đối chiếu giá trị gốc rentalFacts bằng tests.

Đã có pending/confirmed/failed/expired/unknown/no request/settled/zero/missing/inconsistent examples. Purpose picker chỉ đổi nội dung xem. Placeholder đúng phạm vi ngoại tuyến; Pay/Refresh disabled, không polling hoặc refresh synthetic success.

## E. Rental Integration

Kho thuê → Rental Detail → Contract/Payment → Back về Rental Detail bằng native stack. Không đổi năm tabs. Self dùng deposit → inspection → signatures → settlement → staff handover → activation. Managed tách registration/inspection, signatures/settlement và first staff-confirmed inbound → activation. PaymentTimeline dùng bằng chứng riêng từng bước, không hoàn tất tương lai từ bước trước. Timeline cũ và dữ kiện gốc giữ nguyên.

Rental Detail tự chọn purpose theo confirmed deposit evidence; vẫn cho xem trạng thái unavailable. Owned lookup xử lý wrong customer, unknown ID/scenario và invalid purpose. Alternate scenario chỉ đổi ví dụ đang xem, không viết vào customerFixtures/rentalFacts hoặc booking/request stores. Không cấp shared warehouse access code hoặc thêm Customer staff controls.

## F. Security

Axios fail-closed không đổi; tests chặn GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS. Không thêm Backend URL, tokens, env bypass, request hoặc custom adapter. Không live mutations, signatures, mock-confirm, provider checkout, database writes, OTP, QR, hashes/certificates, PDF/email hay activation. Ownership filter fixture chỉ UX demo, không thay security phía server. Backend verification/auth/permissions/contracts và feature gates phải được xác nhận ở phase tích hợp riêng.

## G. Testing

| Lệnh | Kết quả |
|---|---|
| npm run typecheck | PASS |
| npm test -- --silent | PASS: 7 suites, 291/291 tests (226 cũ + 65 mới) |
| npm run check:versions | PASS theo local Expo SDK dependency map; offline warning, chưa xác nhận compatibility endpoint online |
| npm run export:native | PASS: Android và iOS Hermes bundle + local assets; không APK/IPA/device startup |
| npm run verify:website | PASS: 1.074 checked, 0 changed, 0 missing |
| node scripts/verify-phase5a-preservation.cjs | PASS: 122 checked, 117 unchanged, 5 permitted changed, 0 missing/unexpected |
| node scripts/smoke-preview.cjs | PASS: auth/register/back/five tabs, 320/390/768 |
| node scripts/smoke-booking.cjs | PASS: Self booking/detail/back/drafts, 320/390/430/768 |
| node scripts/smoke-managed.cjs | PASS: multi-Cell booking/map/back, 320/375/390/430/768 |
| node scripts/smoke-inventory.cjs | PASS: detail/edit/register/history/draft guard, 320/375/390/430/768 |
| node scripts/smoke-requests.cjs | PASS: inbound/outbound/amend/cancel previews, 320/375/390/430/768 |
| node scripts/smoke-financial.cjs | PASS: Contract/Payment/Rental Back, five target widths, 0 page/console errors, 0 Backend requests, 0 mutations |

Các browser scripts chạy bằng Playwright có sẵn + Edge headless, Metro offline localhost:8091; chặn mọi origin khác. Không install dependency. Financial smoke kiểm tra checkbox không ký, action disabled, unavailable/draft/partial/signed/mismatch, từng payment purpose/status, zero/missing finance, auth guard và document horizontal overflow. Jest bổ sung missing fields/loading/error, role separation, stale reference, integer arithmetic, consistency, original fixtures intact và all-method Axios blocker.

Screenshots trong ../artifacts/phase5a/:

- contract-{320,375,390,430,768}.png: bản đọc đầu trang.
- contract-ack-{width}.png: local acknowledgement và disabled actions.
- payment-{width}.png: confirmed BALANCE mẫu.
- contract-unavailable-{width}.png, contract-mismatch-{width}.png.
- zero-balance-{width}.png, missing-finance-{width}.png.
- smoke-result.json: kết quả máy đọc.

Đã xem ảnh contract 320, payment 390 và zero 320 để kiểm tra wrap/currency/card, không thấy tràn ngang/chồng nội dung. Các màn khác kiểm qua smoke/assertions ở đủ widths. Không có screenshot before vì hai màn hình chưa tồn tại ở baseline; ảnh phase cũ chỉ là regression output. Không khẳng định screen reader/device gesture/safe area vật lý hoặc native E2E đã test. Export có warning NO_COLOR/FORCE_COLOR từ tooling, không chặn bundle.

## H. Website Integrity

Baseline 1.074 files: **0 changed, 0 missing**. Không sửa website dependencies/config/API/routes/source; không thay Staff/Manager/BOM. Verification bỏ qua node_modules/dist/.git/mobile/.env đúng baseline gốc. Không truy cập backend/; BE-REF không được sử dụng hoặc thay đổi. Website production build không chạy lại vì task mobile và source website được hash bảo toàn; build hợp lệ của task là native export.

## I. Remaining Scope

**20/23 designs hoàn thành ở UI/fixture level** (18 cũ + 11/12). Còn 19 Notification Center, 20 Customer Support, 23 Customer Registration đầy đủ. Registration scaffold không tính design hoàn chỉnh. Chưa triển khai những màn này hoặc phase tiếp theo.

## J. Limitations / Release blockers

- Không ký hợp đồng thật, chữ ký số/certification, OTP, hash, PDF/email hoặc legal equivalence.
- Không thanh toán thật, payment QR, provider/ledger reconciliation hoặc authoritative settlement.
- Không live Backend/API/auth/ownership verification. Không live E2E.
- Không native Android/iOS device/simulator E2E; Hermes export và RN Web không thay thế device tests. Host Windows chưa có native toolchain hoạt động được xác nhận.
- Toàn bộ dữ liệu và timestamps là fixture minh họa, không giao dịch hoặc bằng chứng ký thực.
- Dependency baseline còn **19 findings: 13 Low, 6 High, 0 Critical**. Không audit fix, upgrade hoặc đổi lock. Các advisory chưa xử lý là release blockers; không coi tất cả chỉ dev-only (Router/query-string/decode-uri-component có thể ở runtime). Đây là baseline đã ghi, không fresh online security scan.
- Compatibility check chỉ local map do offline. Trước phát hành cần xác minh SDK/runtime/dependency advisories online và nghiệm thu trên thiết bị; không tự mở transport trong phase này.
