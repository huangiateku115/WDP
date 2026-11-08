# Phase 6A-R — Backend Business Re-Audit & Frontend Impact

**Ngày: 7/11/2026. Trạng thái: REVIEW_REQUIRED. Chỉ audit và tài liệu, không triển khai sửa Frontend.**

## A. Current Backend

Root thực tế: `C:/Users/laptop/Desktop/WDP`. Đọc trực tiếp `backend/` theo quyền read-only mới trong yêu cầu; BE-REF được đối chiếu độc lập. Website Customer/Staff/Manager/Admin/BOM và Customer Mobile đều chỉ đọc.

- Branch local: **Frontend**.
- HEAD: **b7f09b48299882075d6c16511f8419fdb040488a**, 5/11/2026.
- Baseline cũ xác định lại: **7a5cd84b7f1ba7e5076f268276fc49dbee0b138e**. Tất cả221 hash lịch sử khớp Git object sau chuẩn hóa CRLF; không chỉ suy đoán từ ngày commit.
- Local source không đồng nghĩa deployment. **Deployment revision, gate values, PayOS setup, Mongo topology và native return chưa xác minh.**

[BACKEND_CURRENT_BASELINE](BACKEND_CURRENT_BASELINE.md) ghi history, công cụ, phạm vi hash, Git status limitation và hierarchy bằng chứng. [SOURCE_EVIDENCE](SOURCE_EVIDENCE.md) có đường dẫn/dòng/symbol/snippet hiện tại; các matrix có route/controller/service pointers. Backend assertions chỉ được đọc, không chạy.

## B. Backend Changes

Các thay đổi nghiệp vụ quan trọng đã xác minh:

1. **Self overlap đã sửa trong source**: có DEPOSIT_PAID/CHECKIN_READY và phân biệt committed reservation với hold hết hạn; vẫn `[start,end)`.
2. **Self availability theo kỳ thuê đã có**: Unit list nhận khoảng thuê và calendar GET theo UTC tháng/ngày; UNKNOWN khi vượt giới hạn scan.
3. **Self create tự CONTRACTED**, đồng thời tạo DRAFT contract trong transaction; không chờ routine approval.409 có suggestedUnits top-level; không tự chọn lại kho.
4. **PayOS thực cho Self**: SDK checkout, signed webhook, owner status và cursor history. Ba chiều status/provider settlement/application riêng; receipt có thể được xác minh nhưng chưa áp dụng vào Reservation.
5. **Self activation hardening**: scope/linkage/CAS/transaction/recovery, nhưng handover/CHECK_IN hiện chỉ dev/test. Có PayOS không có nghĩa đã đủ production lifecycle.
6. **Managed legacy proof/mocks hardening**, V2 tách riêng; Self proof branch chưa được bảo vệ tương đương.
7. **Inventory lifecycle fencing**: register/edit/inbound/relocation bị chặn khi activeClosureRequestId tồn tại; outbound/cleanup không bị cấm hàng loạt, vẫn phải thỏa term/state/key/version. Registration/edit nay transaction cả khi không có ảnh.
8. **Closure readiness GET mới chỉ diagnostic**. Financial/disposition UNKNOWN, overall UNKNOWN/BLOCKED; không có close/release/settlement command.

Refactor tuần tự hóa reads trong một ClientSession được ghi là reliability change, không tự đổi thành API hoặc business transition mới. Xem [BACKEND_CHANGELOG](BACKEND_CHANGELOG.md) và [BUSINESS_FLOW_DIFF](BUSINESS_FLOW_DIFF.md), gồm sơ đồ lifecycle và DTO/gate/retry cụ thể.

## C. API Changes

**184 unique registered method/path**, bao gồm root/health và mở rộng hai pricing router. Old full inventory178; con số86 của Phase6A là subset Customer/dependency, không phải tổng Backend.

| Primary classification | Số operation |
| --- | ---: |
| NEW | 6 |
| REQUEST_CHANGED | 1 |
| BEHAVIOR_CHANGED | 19 |
| SECURITY_CHANGED | 7 |
| UNCHANGED | 151 |
| REMOVED | 0 |
| RENAMED | 0 |

Tổng27 operation cũ thay đổi. Một operation có nhiều tác động nhưng chỉ một primary class để không đếm trùng; Unit list có response decoration mới, Self create có response/lifecycle mới. UNCHANGED không có nghĩa secure/enabled/deployed. Đọc từng validator/service theo source pointers khi chuẩn bị implementation; không dùng raw controller body làm DTO chung cho mọi family.

6 route mới: Self Unit availability; Managed closure-readiness; Self PayOS create/history/status; PayOS webhook. [API_CHANGE_MATRIX.csv](API_CHANGE_MATRIX.csv) có184 dòng ×28 cột; JSON kèm controller extracts, middleware/source và chi tiết API. Không tự giả endpoint refresh/refund/Managed PayOS/native callback.

## D. Website Impact

[WEBSITE_FRONTEND_IMPACT.csv](WEBSITE_FRONTEND_IMPACT.csv): **32 dòng/file được review, 22 file có đề xuất điều chỉnh/dependency, 10 file NO_CHANGE**. Đây là danh sách để review, chưa phải cho phép sửa toàn bộ22 file.

Nhóm sửa cụ thể:

- Shared API: `src/api/confirmedContract.js` — 11 Staff MI06 method/path bị chặn dù helpers/UI thật đã có; `inventoryApi.js` cần tests đi qua interceptor, không đổi API architecture.
- Staff repeated/canonical/relocation: `RepeatedInboundQueuePage.jsx`, `CanonicalOutboundQueuePage.jsx`, `CanonicalRelocationPage.jsx`, `ManagedReceivingQueue.jsx` — closure409, key/retry cleanup, stale selection và pagination.
- Staff/FM physical operations: `FacilityHandoverPanel.jsx`, `facilityHandoverApi.js`, `InspectionApiView.jsx`, `CheckoutApiView.jsx` — unsafe print/scope/production gate containment; không bypass server.
- Customer Inventory: `InventoryItemForm.jsx`, `RepeatedInboundRequests.jsx`, `managedInventoryContext.js` — eligibility closure và CAS conflicts, giữ form/intent.
- Self lifecycle: `customerReservationService.js`, `SelfStorageReservationReview.jsx`, Manager `ReservationApiView.jsx`, BOM `OversightLivePage.jsx` — trạng thái hiện tại/suggestion/error/copy.
- Contracts: `ManagedContractReview.jsx`, `ManagedContractLookup.jsx` — review-bound signing Backend dependency; đọc/progress/refresh giữ nguyên.
- Support private reference safeguards và optional Managed diagnostic read là task riêng, không lý do redesign.
- QR build environment: `src/lib/selfStoragePayosQr.js` import `qrcode` chưa resolve trong cài đặt hiện tại; dependency đã được khai báo. Không sửa package/lock trong audit.

Website **đã có** PayOS Self checkout/status/history/polling/QR, monthly availability, safe Customer A4 print và real inventory workflows. Không mang kết luận cũ “payment API chưa có” sang website hiện tại. Customer ContractPrintAction dùng safe detail; unsafe raw print hiện vẫn được Staff helper gọi. Stable Admin User, BOM facility/pricing/policy/warehouse CRUD không có contract change được chứng minh, phải bảo toàn. Routes Staff đã mount đúng các real pages; lỗi allowlist không phải lỗi thiếu route.

208 direct network-call sites được lập chỉ mục ở WEBSITE_API_CALLS.json, cộng kiểm tra call chains/components/helpers/routes liên quan. Đây là static index, không tự chứng minh mọi dynamic call đã chạy hay mọi callback business-correct.

## E. Mobile Impact

[MOBILE_FRONTEND_IMPACT.csv](MOBILE_FRONTEND_IMPACT.csv): **23/23 designs**,26 unique screen/form files từ design-map, có native routes/current behavior/user actions/current contract/proposal/classification/dependency/tests. Mọi màn hình vẫn offline fixture; tất cả23 cần real-data alignment trước integration, **0 full redesign** được yêu cầu bởi source diff.

Ảnh hưởng mới rõ nhất:04–06 Unit interval/current Self CONTRACTED confirmation;09–10 Self/Managed lifecycle và closure diagnostic;11 contract eligibility/version;12 Self PayOS/status/history/web-only return.15–17 cần itemCode/DTO/CAS/closure/gate mapping.22–23 cần native session và registration mapping, không refresh giả. Những màn hình khác cần source DTO/paging/owner/unknown-state adapters đã ghi rõ, không nhất thiết thay bố cục.

Không trộn fixture slug với ObjectId thật, registered quantity với onHand, ảnh minh họa với upload, MOCK với production payment hay Customer request với Staff physical confirmation.

## F. Critical Issues

**35 findings: P0=2, P1=14, P2=18, P3=1**, không phải35 confirmed production bugs. [FRONTEND_GAP_REGISTER](FRONTEND_GAP_REGISTER.md) phân biệt source finding, historical disposition và current uncertainty.

P0:

- **R01:** contract print thiếu owner/facility enforcement trong current controller. Customer safe detail print được bảo toàn; raw endpoint phải khóa.
- **R02:** Inspection create/list và CHECK_OUT thiếu scope/linkage/transaction bảo vệ tương đương CHECK_IN. Client facility filter không sửa được server authorization. Chưa thử exploit live.

P1 nổi bật: reviewed version/hash signing; no refresh/audience/OTP hardening; Self pricing scope; Self proof/sign eligibility; Managed/MI06 production gates; Self-only provider và native return; Staff allowlist; closure/CAS alignment; website dependency build blocker; native/security acceptance.

Các blocker cũ **đã FIXED_IN_SOURCE — DEPLOYMENT_UNVERIFIED**: overlap và interval discovery. PARTIALLY_FIXED: PayOS provider chỉ Self, mock restrictions, Staff scope/activation và transaction safety, source revision identity. Print/signing/auth/Managed production gates chưa hết blocker. Toàn bộ **29 historical gap entries** có kết luận và evidence ở [HISTORICAL_FINDING_RESOLUTION.csv](HISTORICAL_FINDING_RESOLUTION.csv). Không có regression claim chỉ vì mới tìm ra vấn đề trong audit mở rộng.

## G. Frontend Fix List

Ưu tiên nhỏ, có thể review:

1. Contain unsafe print/inspection/invalid signing actions theo R01/R02/R03/R08; server phải sửa authorization/eligibility. Không mở production flow bằng UI flag.
2. Sửa shared allowlist11 verified Staff operations + fake-adapter/interceptor tests. Không thêm wildcard, endpoint mới hay Axios thứ hai.
3. Align closure/CAS/key/version, giữ cleanup/read và eligible outbound; sửa stale selected-request response và uncertain return key.
4. Self status copy và explicit409 suggestions; giữ current PayOS/calendar implementation.
5. Native session/owner read DTO adapters trước mutation; itemCode/form fields, stock unknown, exact request DTOs.
6. Contract/payment native chỉ sau Backend/security/return prerequisites. Không provider fallback cho Managed; không zero-stock auto-close.

Khôi phục local qrcode dependency installation là task môi trường riêng để build/test đầy đủ, không yêu cầu thay version hoặc code trong audit này.

## H. Integration Readiness

- Có thể lập kế hoạch owner-scoped catalogue/rental/inventory/stock/movement, safe contract details, notification REST và support public messages sau auth/DTO/session acceptance.
- Self availability và PayOS source contract hiện đủ để lập kế hoạch, website đã dùng; deployment/config/payment sandbox/native return vẫn chưa xác minh.
- Managed V2, repeated/canonical writes, production activation, unsafe print/sign/proof/checkout phải giữ unavailable theo blocker tương ứng. Nguồn có code không đồng nghĩa enabled.
- Closure diagnostic chỉ hiển thị UNKNOWN/BLOCKED/nullable facts; không có close/release/refund feature để mở.

Chưa thể kết luận production ready. Không mở Axios native, không replace fixtures hoặc sinh successful Backend response giả.

## I. Verification

| Check thực hiện | Kết quả thực tế |
| --- | --- |
| Native `npm run typecheck` | PASS |
| Native `npm test -- --silent` | PASS375/375,8 suites |
| `verify-ui-completeness.cjs` | PASS23 designs,0 missing mapped files |
| Website JS/JSX/TS/TSX parser | PASS281 files,0 syntax errors |
| Website `npm run build` | **FAIL** — cannot resolve qrcode imported by selfStoragePayosQr.js |
| Website `npm test` | **133 PASS,1 failed test file**,134 reported; payos-checkout.test.mjs cannot import qrcode; not an executed financial assertion failure |
| `node --test tests/managed-warehouse-booking.test.cjs` | PASS3/3 |
| Existing `npm run verify:website` | FAIL against historical1074 baseline:26 changed,1 missing, pre-existing relative to this task |
| Task-start preservation hash | PASS1186 pre-existing selected text files,0 changed/missing |
| Current Backend vs BE-REF selected files |257 corresponding files identical |
| Tracked content vs HEAD, excluding secrets |1523 checked,0 differences after line-ending normalization; not complete git-status/index proof |
| Historical baseline identification |221/221 match7a5cd84 raw/CRLF-normalized |
| CSV validation |184 API,32 Website,23 Mobile,29 historical rows; fixed column counts;0 missing Mobile action sets |
| Shared allowlist probe | Local function evaluation only;11 Staff operations blocked, no HTTP |
| Backend tests/build/provider/db/live API | NOT RUN; no requests or Backend execution |
| Native exports/browser/device E2E | SKIPPED / NOT VERIFIED — source audit only; no claim based on past Phase5B results |

Historical website baseline reports `.env.example`, package/lock and application changes plus missing old selfStoragePayment.js. This audit did not alter them or reset baseline. `.env` secret values were not inspected. Exact machine results in VALIDATION.json, PRESERVATION.json, REVISION_METADATA.json.

## J. Preservation and deliverables

Only new files under **frontend/customer-mobile/docs/PHASE6AR/**. No application/source/fixtures/tests/domain/state/form/API client/routes/auth/styles/dependency/config changes. No Backend/BE-REF writes, seeds, migration, database or payment mutations. Current task snapshots—not obsolete website baseline—establish preservation. Axios guard SHA256 unchanged: `cfc5016fd0b5cd0e60183f7a73adf1ca30e2de6ff97ebbedfdbfdcb1b500d774`.

Required10 outputs:

1. BACKEND_CURRENT_BASELINE.md
2. BACKEND_CHANGELOG.md
3. BUSINESS_FLOW_DIFF.md
4. API_CHANGE_MATRIX.csv
5. WEBSITE_FRONTEND_IMPACT.csv
6. MOBILE_FRONTEND_IMPACT.csv
7. SECURITY_AND_FEATURE_GATES.md
8. FRONTEND_GAP_REGISTER.md
9. FRONTEND_REFACTOR_PLAN.md
10. PHASE6AR_REPORT.md

Supporting18 audit/evidence/metadata files: API_OPERATIONS.json, API_SUMMARY.json, FINDINGS.json, FRONTEND_IMPACT_DATA.json, HISTORICAL_FILE_COMPARISON.json, HISTORICAL_FINDING_RESOLUTION.csv, HISTORICAL_OPERATIONS.json, IMPACT_SUMMARY.json, PRESERVATION.json, REGISTERED_ROUTES.json, REVISION_METADATA.json, SOURCE_BASELINE.json, SOURCE_EVIDENCE.md, SYNTAX_RESULT.json, WEBSITE_ALLOWLIST_PROBE.json, WEBSITE_API_CALLS.json, VALIDATION.json, FILE_MANIFEST.json. **28 new documentation/metadata files total**, exact inventory in manifest. Existing audit documents/README unchanged.

Limitations: parent-worktree Git status and connected workspace tools unavailable; source hashes/object comparison used instead. Complete registered-route coverage is established, but static route/controller/service evidence is not exhaustive runtime/API authorization proof for every unchanged CRUD branch. No deployment configs/secrets, provider network, device testing or fresh dependency advisory scan.19 historical advisories are not current scan results. No FULL live/E2E/security certification claim.

## K. Recommended First Implementation Phase

**R1 narrow Staff API allowlist repair**, only11 verified existing method/path combinations in confirmedContract.js, plus fixture tests through shared interceptor verifying headers/method/IDs/unknown paths/gate error preservation. Existing UI/routes/helpers are present; no redesign or API architecture change. Production MI06 stays blocked by server gates; exclude unsafe print, generic checkout, closure mutation and legacy fallback. Exact paths and acceptance criteria in [FRONTEND_REFACTOR_PLAN](FRONTEND_REFACTOR_PLAN.md).

Review P0 containment/server dependencies in parallel planning, without enabling unsafe operations. Full website build acceptance additionally needs a separately approved existing-dependency installation repair for qrcode. No next implementation prompt has been generated or executed.

## L. Handoff for Review

```text
[C2C]
TASK_ID: WDP_BACKEND_REAUDIT_FRONTEND_IMPACT
PHASE: 6A-R
STATE: REVIEW_REQUIRED
BACKEND_REVISION: b7f09b48299882075d6c16511f8419fdb040488a (Frontend local; deployment UNVERIFIED)
BASELINE_REVISION: 7a5cd84b7f1ba7e5076f268276fc49dbee0b138e (221 historical hashes verified)
FRONTEND_WEBSITE_IMPACT_COUNT: 22 actionable/review files; 32 assessed including10 NO_CHANGE
FRONTEND_MOBILE_IMPACT_COUNT: 23 designs;26 unique screen/form files;0 full redesigns
P0_BLOCKERS: 2 — R01 contract print ownership; R02 inspection scope/checkout atomicity
P1_BLOCKERS: 14 — see FRONTEND_GAP_REGISTER; source/dependency/native risks, not14 production incidents
DOCUMENTS_CREATED: 28 (10 required plus18 audit metadata/evidence)
SOURCE_MODIFICATIONS: NONE
NEXT_PHASE_RECOMMENDATION: Independent review, then narrow R1 Staff allowlist + interceptor fixtures; no production rollout
```
