# Phase 6B — Integration Plan (NOT EXECUTED)

Phase 6A chỉ tạo tài liệu. Tất cả source/app/routes/forms/stores/tests/fixtures và Axios blocker hiện giữ nguyên. Các file/commands bên dưới là phạm vi dự kiến cho task triển khai riêng, không phải code đã viết hoặc quyền sửa Backend. Backend dependencies phải do team có thẩm quyền giải quyết; BE-REF vẫn read-only, không truy cập backend/.

## Go/no-go trước mỗi batch

- Pin Backend revision/deployment base URL và capability/gate policy không chứa secrets; BE-REF snapshot hiện không có commit/OpenAPI version. Không xem việc có route là production capability.
- Đóng P0 S-PRINT/S-SELF-PAY/S-SELF-OVERLAP và P1 liên quan đến batch; phần bị chặn vẫn disabled, không chặn triển khai catalog đọc độc lập.
- Có môi trường test riêng, accounts/ownership A/B, Facility/Unit/Cells được phép dùng, transaction-capable Mongo, retention/cleanup policy và quyền từng mutation. Không tự seed, gọi payment/provider hoặc dùng production để thử. GET identity-profile có side effect phải tính là write.
- Client transport chỉ thay có chủ đích trong batch auth/network riêng được duyệt; không thêm global EXPO/Vite flag để bypass interceptor. Không duplicate Axios hoặc trộn nguồn fixture/real từng record.
- Source-level READY chỉ đủ lập kế hoạch; cần mocked contract tests trước rồi mới approved deployment/native acceptance. Không claim E2E từ Hermes/RN Web.

## Typed adapter architecture — proposal

Một HTTP foundation dùng lại vị trí `src/api/client.ts`, có request cancellation/timeout, trusted configured base origin, Bearer attachment và safe headers. Không hardcode localhost trong build native hoặc dùng localhost của điện thoại như máy phát triển. Không provider/Keycloak secrets trong app. Chưa implement hoặc bỏ blocker.

Đề xuất tách `api/dto/*`, endpoint family adapters và pure `api/mappers/*` cho PublicCatalog, SelfReservation, ManagedReservationV2, Contracts, PaymentRead (hiện blocked), Inventory, RepeatedInbound, CanonicalOutbound, Notifications, Support. DTO validation phản ánh source field names/requiredness/enum/nullability; normalized native domain độc lập, không cast response thành fixture model. ID/code/populated reference normalization là hàm rõ ràng, không slug fallback. User and identity Profile là DTO riêng.

Phân biệt envelopes:

| Family | Decode |
|---|---|
| Auth | response.data.success + response.data.data.{accessToken,refreshToken,user}; no expiresIn field guaranteed |
| Object reads/commands | {success,data:DTO}, nhưng object có thể aggregate {reservation,quote} hoặc {payment,...} |
| Paginated lists | {success,data:DTO[],pagination:{page,limit,total,totalPages}} top-level |
| Unpaged lists | {success,data:DTO[]} (rentals/contracts/movements/notifications/support messages) |
| Requests | create201/replay200, DTO.version + quoted ETag; preserve zero version, not truthy checks |
| Errors | Controller `{success:false,message}`; global may preserve ManagedStockErrorCode/strip production text; some direct controllers return code/raw error, rate limiter own message. Normalize without inventing absent code. |

Normalized error: family, HTTP status, verified server code if present, safe UI message, retry classification, correlation/intent/session epoch. Never show raw token/body/OTP/password/error stack. 400 invalid DTO -> edit;401 terminal session/re-login;403 authorization/account -> do not retry;404 missing/owner-hidden/feature-disabled distinguish verified code;409 stale/state/stock/key -> reload/review;413upload limit;428 missing If-Match -> stop/re-fetch;429 backoff per headers;5xx/timeout after command -> UNKNOWN outcome. No universal422 source contract. Typed contract tests assert each family.

Idempotency boundary keeps intent identity (exact normalized payload, resource, owner, purpose, key, expectedVersion) immutable while in-flight/uncertain; duplicate button/tap locked. Persist only approved encrypted/memory retry state, not plaintext PII or secrets; no automatic offline write queue. Inbound/outbound header key != Managed payment body key. Same-key retries permitted only where server replay exists; create reservation/Item/Support/reply do not have such a contract. A GET state refresh is not universal proof of matching create intent.

Session manager: access token memory; approved OS Keychain/Keystore storage design for any persisted credentials. Library/SDK choice and package addition require separate compatibility review (none installed now). Bootstrap GET users/me -> CUSTOMER only; session epoch/cancel controller invalidates responses on logout/account switch. No token cache role as sole guard. Refresh synchronization is planned only after approved refresh/rotation API; until then explicit expiry re-login, no guessed endpoint or embedded confidential client secret. Logout always clears local state even on failed provider invalidation.

Data cutover: explicit demo source remains isolated from authenticated real adapter. Entire feature receives real DTO+domain results; errors/empty/null never fall back to demo records. Fixture IDs never enter network DTOs. Switching modes/account clears caches, pending actions and all demo drafts/notification overrides. Cross-feature resource context must come from the same real session. Local form draft is not submitted/received server record.

Read caching/pagination: keys include session epoch/owner/resource/service/interval/filter/page; cancel old reads and sequence-check responses. No totals from one page; no global search over only loaded pages without label. Backend listMine currently ignores category/status/search despite parser; request remediation or constrain UX transparently. Preserve nullable physical usage/stock, never replace missing with0.

Dates/money: choose and document Customer day-to-UTC instant policy before code. Backend requires strictly future instant, not merely today; Managed accepts UTC Z, map canonical .sssZ. Map end date can be derived using source-verified UTC DAY/MONTH/YEAR clamp and checked against server quote; do not submit a fabricated quota to get a date. Self pricing uses actual server estimate, Managed price is term-specific PER_M3*volume, not monthly*months. Preserve server tax/discount/deposit credit/balance amounts; no refunds invented. New quote binding includes server rule/policy versions, resource IDs/term/interval; changes invalidate review without discarding selections silently.

Native navigation: fixed typed route map by resource kind; retrieve owner-scoped resource before showing private target. Native deep links are untrusted, not token/auth evidence. Real notifications currently have no target metadata: do not parse title/content. No new Customer routes necessary. Customer never receives Facility signing/physical receiving/fulfillment controls.

Provider return design remains BLOCKED: require source-verified create/status/redirect/deep-link allowlist, signature-verified server reconciliation and owner-scoped GET. Approved external browser return/resume triggers bounded authoritative GET, never local success based on query params/redirect. No arbitrary checkout URL scheme, fake QR, provider webhook calls from Customer or mock success in production. PayOS is not implemented in current snapshot.

## Ordered batches

### 6B.0 — Security / environment contract readiness

- Contracts: D-SOURCE, A-REFRESH/A-AUTH-HARDEN, payment production gates, transaction topology, P0 gaps. Dependency remediation/device review separate workstream below.
- Expected mobile changes: documentation/test fixtures only until blockers have verified resolution; no production network enablement.
- Tests: source revision/gate assertions, approved test-env safety proof, owner A/B contracts. No live writes without authorization.
- Acceptance/rollback: branch-specific verified contract pack; any unknown capability keeps affected feature disabled; public catalog can proceed independently.

### 6B.1 — Authentication and User profile

- APIs: AUTH-LOGIN/REGISTER/LOGOUT, USER-ME/PROFILE; secure native storage and protected navigation. Refresh BLOCKED unless contract supplied; password reset/change require security/UX task. Identity GET side-effect issue resolved before “read-only” batch.
- Expected files: `src/api/client.ts`, new typed auth/session adapters + mappers, `src/state/useCustomerStore.ts` or isolated session module, root guard, Login/Register/Profile screens/forms/tests. Preserve demo source and five tabs; no parallel Axios instance.
- Security: Customer role from server, no client secret/password persistence; session epoch, logout cancellation/cache clear; register DTO displayName vs name, no false verified email.
- Failures:401expiry -> re-login,403inactive, provider failure; logout local clear; uncertain register/login result never fabricated success. Dedicated auth Backend hardening remains dependency.
- Tests/device: token response/missing fields/non-Customer/expired/revoked/invalidated session, rapid account switch, single-flight only if real refresh supported, OS secure-store lifecycle, resume/offline/logout. Android+iOS real acceptance required.
- Rollback: revoke/clear stored credentials, disable real source; no automatic demo-data substitution within authenticated feature.

### 6B.2 — Customer read-only data

- APIs: public facility list/detail/storage-options/pricing, USER-ME, own /reservations/me + Managed detail; Self detail gated by M-SELF-DETAIL. No dedicated Dashboard API invented.
- Expected files: public/rental DTO/mappers/adapters, Dashboard/Explore/Facility/Rentals/RentalDetail consumption, read stores/hooks/tests. UI design unchanged.
- Gates/security: owner/session queries, sanitized public allowlists, serviceType+bookingFlowVersion dispatch; list response may contain populated vs raw IDs.
- Failures/tests: paginated/empty/403/404/5xx, cancellation/late response owner isolation, no fake monthlyPrice/count; all23 regressions and first/last page bounds.
- Device/rollback: intermittent network/app resume/back, no cross-owner stale data; disable real adapter without mixing fixture resources. Identity-profile GET excluded until side-effect contract settled.

### 6B.3 — Discovery, map, period availability and quotes

- APIs: exact Units, effective pricing/policy resolve, sanitized warehouse-map/rack detail, Managed quote/capacity. B-UNIT-PERIOD/S-SELF-PRICE/S-SELF-OVERLAP block authoritative Self booking claims.
- Expected files: typed map/Unit/quote adapters, dates/selection mapper, WarehouseMap/UnitSelection/Review state/tests. No physical geometry redesign.
- Security/gates: Unit ID != Cell ID; isBookable true only, periodStatus separate from display/operational/physical; existing owner flags not privilege to select reserved Cells. Respect physicalUsageKnown. Zones without physical coords remain non-authoritative schematic grouping.
- Failures/tests: future UTC boundary/today/31st/leap/DAY/MONTH/YEAR; inactive Facility, unknown counters, ambiguous price, selected volume mismatch, race/409. Rapid Zone/period changes cancel stale responses and preserve basket with invalid reasons.
- Device/rollback: native pan/zoom/scroll/touch/resume at target widths, performance on large racks; unknown availability disables action, no mock map fallback.

### 6B.4 — Reservation commands (after Backend blockers)

- APIs: Self create/estimate, Managed quote/create, own detail/cancel. Native drafts remain independent but map to exact strict DTOs, not submit local preview flag/fingerprint as Backend version.
- Dependencies: S-SELF-OVERLAP/S-SELF-PRICE fixed; B-CREATE-RETRY policy, VERIFIED profile, V2 capability/source revision. Managed V2 must never silently become legacy outside development gate.
- Expected files: command adapters/intent boundary, booking/managed stores/review/confirmation, tests. Confirmation must use actual server IDs/status/quote; no fabricated reservation reference.
- Failures:409reload availability/re-review, unknown timeout no automatic duplicate create; no payment/activation merely because created. Holds/expiresAt server-owned.
- Tests/device: same Cell/Unit concurrency in approved test DB, adjacent intervals, expired hold, back/retry/app kill/resume, double tap, wrong owner; account switching cancels intents. Live mutation acceptance only with explicit test-env authorization.
- Rollback: disable writes, keep safe owner GET; do not reset/cleanup server reservations without an authorized policy.

### 6B.5 — Inventory read-only

- APIs: /inventory-items/me/:id, stock-balance, movements, plus request histories/details. Full initialized StockBalance source, not UI stock fixture or Item.quantity.
- Expected files: Inventory/Movement/Stock DTO mappers/adapters and screen hooks/list pagination; preserve native presentation/IMAGE controls pending real upload readiness.
- Security: parent owner API, session-bound caches; IDs/codes resolved via safe map; no private Staff evidence/notes. Missing404 projection -> unavailable, not0.
- Tests: quantityUnit equality, onHand/held safe integer/available, batch-specific declared-vs-actual precision, v1/v2 compatibility/arithmetic policy, missing data, mixed unit error, request version0/ETag, endpoint feature-disabled read behavior.
- Device/rollback: virtualized big list/history, offline/cache expiration, focus/resume refresh, accessibility; fail closed on missing source. No frontend movement ledger reconstruction.

### 6B.6 — Inventory registration/edit and allowed request commands

- Item create/edit: M-ITEM-CODE and actual edit eligibility resolved; code input, unit/dimension naming, owned real reservation selection and no invented IDs. First inbound singular is different from repeated receipt. Images production blocked until private asset policy; no direct Cloudinary secrets/unsafe remote upload fallback.
- Repeated create/amend: BLOCKED production by verified gate. Canonical new outbound: BLOCKED production by request+ledger gates. Keep read-only/no fallback. Owner cancel cleanup can be separately approved because it is intentionally not the creation gate; must satisfy version/custody/state and exact replay identity.
- Expected files: inventory form/schema/DTO mapper, dedicated repeated/canonical command adapters, intent/error states/tests; real stock refetch after known command, never optimistic physical stock/occupancy.
- Headers: incoming ETag or validated version -> quoted If-Match; key regex8..128 for request commands. Missing428 stops action. Preserve same payload/key/expectedVersion under503 UNKNOWN; changed intent requires explicit new review. Outbound body only requestedQuantity; inbound no note accepted.
- Tests/device: duplicate tap, lost response, stale409/428, key payload conflict, feature404/503, wrong owner, unresolved request, terminal partial, native unsaved draft, process death/resume retry-state privacy. No Staff inspection/physical confirmation/relocation in Customer.
- Rollback: disable affected writes and clear local real intents carefully; owner read stays, no legacy singular outbound fallback.

### 6B.7 — Contracts and payments (read first, commands blocked as needed)

- First: owner-safe contract GET/list/byReservation, frozen content/signature/hash mapper. Never unsafe print endpoint. Self paper and Managed V2 current signatures are different contracts; one V2 signature Backend DRAFT, partial derived UI.
- Writes require S-SIGN-VERSION, production capability, provider/read-status/history/reconciliation and Self payment fixes. Backend-only Staff snapshot/sign/paper/handover/first-inbound remain dependencies, not Customer operations. No production mock confirmation.
- Expected files: Contract/Payment DTO adapters/mappers and existing screens, lifecycle interpretation, deep-link return module ONLY after verified provider policy, tests. No manufacture payment record or hash.
- Money: totalDue and confirmed deposit credit authoritative; DEPOSIT/BALANCE distinct; zero balance response payment:null+explicit settlement means no0 transaction. Breakdown is not confirmation of paid funds. Current status enum PENDING/SUCCEEDED/FAILED/RECONCILIATION_REQUIRED; EXPIRED_DEMO not assumed server status.
- Tests/device: old version/hash/role, stale compare-and-sign rejection, same key amount mismatch, late expired deposit reconciliation, duplicate/unknown provider outcome, return/cancel/deep link/app resume must authoritative GET before display. Native external checkout not implemented until this testable contract exists.
- Rollback: read-only UI with explicit unavailable actions; no payment fallback or synthetic success. Provider money operations require separate approved environment/credentials handled outside chat.

### 6B.8 — Notifications and Support

- Notification real list+single-read supported; map content/isRead/type and compute count from complete list. No target metadata so disable real related link. Bulk/read-count/push/delete/detail APIs absent. Bounded single-read fanout only if explicitly approved, reports partial failures, not invented bulk atomicity.
- Support list/detail/public messages/reply source-supported; create without private linked refs can plan, private association requires S-SUPPORT-REF closure. Map enums/singular relatedEntity and actual text limits, not two arbitrary IDs. Admin/status/assign/internal flags excluded; closed-ticket reply policy clarified before UI enablement.
- Expected files: customerCare DTO/mappers/adapters/screens/store/forms, preserving memory draft separation and ownership revalidation. Current reply disabled can be enabled only in dedicated task after contract tests, not audit.
- Failures: unknown write outcomes don't create fake ticket/reference/message; avoid duplicate support POST/reply (no key contract). Read overrides reconciled with server, not permanently cached as ack. Unread missing list not zero. Logout clears cached private data/drafts.
- Tests/device: malicious metadata/foreign targets, pagination/status/date unknowns, private message filtering, no state mutation from notification, long conversations/performance, keyboard/voiceover. Rollback owner reads only; no fabricated staff replies.

## Separate dependency remediation & native release workstream

Historical docs/dependency-audit.json:19 findings,13Low/6High/0Critical, not fresh scan. CLI/config/Metro/prebuild/nested Zod and Jest chains need tooling review; Router -> query-string -> decode-uri-component can reach native deep-link URL parsing and must not be dismissed dev-only. Direct form Zod4.6.7 differs from audited nested SDK Zod. Reproduce locked dependency graph, inspect runtime bundle reachability/advisory ranges, select SDK-compatible patch/upgrade path under separate approval, regenerate audit/lock deliberately, rerun all375+future contract tests,23-screen navigation and Android/iOS binary tests. No force-major audit fix. None performed in Phase6A.

Device checklist before release: Android real device and iOS device/simulator startup, OS secure storage/session restore/logout/revocation, keyboard/form focus, Android hardware Back/gesture and draft guards, native deep links/untrusted URLs, checkout return/cancel, safe area/font scaling/TalkBack/VoiceOver, network drop/timeout/unknown command outcome, background/resume/account switch, large map/list/conversation memory/performance. Native Hermes export and RN Web are supplementary only.
