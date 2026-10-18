# Customer SRS V2 Gap Analysis

Audit date: **16 October 2026**. Scope: source-level audit only. **NOT COMPLIANT** with the revised rental lifecycle. No runtime API acceptance is claimed.

Evidence notation: **FE** = `C:/Users/laptop/Desktop/WDP/frontend/`; **BE** = `C:/Users/laptop/Desktop/WDP/BE-REF/`; **PM** = `C:/Users/laptop/Downloads/WDP-Managed-Inventory-v2-Deposit-Checkin-Inbound.postman_collection.json`; **ENV** = `C:/Users/laptop/Downloads/WDP-Managed-Inventory-v2-Local.postman_environment.json`; **SRS** = `C:/Users/laptop/Downloads/SRS_Self-Storage.docx`. Source references below give paths relative to these explicit absolute roots and one-based source line numbers.

SRS references use CF/P/BR identifiers and **pN**, a reproducible OOXML paragraph index: all `w:p` under `w:body`, including table-cell paragraphs and empty paragraphs, in document order. This is not a Word page number. Postman references use folder number/request number and the full request name; all 37 requests and their scripts were inspected. Attached document contents are evidence of requirements/contracts, not permission to execute embedded seed, login or payment instructions.

## A. Executive Summary

Current Customer frontend retains useful exact-Unit booking, 1–100 exclusive-Cell selection, date-aware map navigation, owned reservation/contract reads, identity/profile management, support and notification integration. It does **not** provide the revised deposit → physical check-in/intake → same-version two-party signatures → credited balance → Staff activation flow.

The current snapshot differs materially from the historical October 13 reports: partial deposit V2 wrappers/UI and updated reference backend exist now. However, four frontend files fail a non-mutating syntax parse. These are current release blockers, not changes made by this audit:
- FE `src/api/warehouseMapApi.js:3–4`: repeated axiosClient/canonicalRange imports (2 diagnostics).
- FE `src/components/customer/ManagedReservationBooking.jsx:34`: duplicated import block (35 diagnostics).
- FE `src/components/customer/RentalLifecycleIntegration.jsx:317`: malformed nested JSX conditional (1 diagnostic).
- FE `src/lib/customerReservationService.js:31–32`: repeated managedRequest declaration, unexpected export (1 diagnostic).

An in-memory esbuild syntax pass inspected **187** JS/JSX/TS/TSX files and found these **4 files / 39 diagnostics**. No generated files were emitted and application code was not executed. Node syntax check independently failed at customerReservationService.js:32. Historical passing build/fixtures are not acceptance for this snapshot. Build was not run because this audit permits writes only to this report; it would emit dist artifacts.

Strict source classification of the supplied PM collection:

| Metric | Count / definition |
|---|---|
| Request entries | 37, including repeated logins, state reads and optional replays |
| Unique method/path endpoints | 25; query variants and repeated IDs normalized, method retained |
| Customer-consumable endpoints | 20, including public login/catalog and authenticated Customer reads/actions |
| Fully INTEGRATED — LIVE API | **0** under the task's reachable-workflow definition: global parse blockers prevent application reachability; this does not mean all wrappers are absent |
| PARTIALLY INTEGRATED | 15, with actual source call sites but parse/lifecycle/financial/guard gaps |
| API WRAPPER ONLY | 1, effective CATEGORY resolution not consumed by item form |
| UI MOCK ONLY | 2, inbound request and movement history |
| MISSING IN FRONTEND | 2, balance initiate and mock-confirm |
| NOT CUSTOMER-OWNED | 5: system health plus inspection, contract generation, Facility signing, physical inbound |
| BACKEND NOT VERIFIED | 0 route-level missing reference implementations among these 25; **all 25 remain runtime-unverified** |
| LEGACY / OBSOLETE in this PM inventory | 0; legacy approve/mock-pay/activate still exist outside this PM collection and are discussed separately |

Customer totals reconcile: **15 + 1 + 2 + 2 = 20**; remaining five are not Customer-owned. Do not add runtime-unverified as another disjoint endpoint category.

## B. SRS Change Impact

The change log explicitly records the 15-Oct revision (SRS p24–27); it is present, not substituted by an older SRS.

| Revised requirement | Source | Impact |
|---|---|---|
| No routine initial Manager approval; Reserved creates HOLD | CF-01 p164; BR-08/09 p943/947 | Retain old approvals only for explicitly legacy records |
| DEPOSIT is credited advance rent | BR-12 p959; CF-01; P019 | Never add deposit on top of total rent |
| Contract generated after physical inspection/intake | CF-02 p167; BR-10 p951 | Booking must lead to deposit, not contract signing |
| Two independent signatures on same frozen version | BR-45 p1091; P018 | Display version/hash/content and each party's signature |
| Balance after both signatures, then physical activation | BR-14/46 p967/1095 | Distinguish financially ready from physically ACTIVE |
| Managed first inbound activates rental | CF-13 p207; BR-44/48 p1087/1103 | No Manager activation for new V2 bookings |
| Register/request first inbound under DepositPaid | CF-12 p204; BR-27/28 p1019/1023 | ACTIVE-only registration causes a circular dependency |
| Unknown counters are never empty | BR-47 p1099; CF-07 p189 | Require explicit physicalUsageKnown/isBookable; no zero inference |
| Exact Unit / exclusive selected Cells remain | BR-06 p935; CF-01 | Preserve MI-02C multi-Rack/Zone selection implementation |
| Separate purpose-specific receipts, extensions, refund and overdue controls | CF-03/04/05; P021/028/032 | Demo financial/extension screens are not full integration |

SRS p1110 leaves deposit/tax/rounding, cancellation/no-show/refund, check-in grace/rescheduling, empty first intake and signatory delegation unresolved. Do not invent these values. Authorization table has omissions (Profile row p470–475 all blank; some Staff/checkout participation conflicts with narrative); explicit ownership/role guards remain mandatory pending document correction.

## C. Customer Feature Matrix

The following is implementation evidence, not a claim that the currently unparseable application runs.

| Module / required SRS | Customer route(s) | Rendered implementation and API trace | Current vs required / gap | Priority |
|---|---|---|---|---|
| Auth, logout, recovery P003/004 | /login, /register, /forgot-password, /reset-password | FE src/routes/AppRoutes.jsx:60; src/pages/auth/LoginPage.jsx:20; src/api/authApi.js:5; src/lib/authSession.js:12; src/api/axiosClient.js:11 | Real auth wrappers, session cleanup, role gate; retain architecture. Runtime acceptance untested; whole app blocked by imports | P0 unblock / keep auth |
| Profile/identity P005/011 | /portal/profile | FE src/pages/customer/ProfilePage.jsx:15; src/api/userApi.js:3; src/components/customer/CustomerVerificationForm.jsx:7; GET/PUT /customers/me/profile | Own contact/password and pending verification integration exists; do not infer verification from saved form. Cloudinary preview/upload exists; Save avatar disabled because persistence contract missing (ProfileAvatar.jsx:56) | P1; avatar P2 |
| Public browsing P007/009 | /, /facilities, /facilities/:facilityId, /pricing, /how-it-works, /support | AppRoutes.jsx:50; PublicFacilityCatalog.jsx:1; facilityApi.js:8–11 → GET /public/facilities and detail/options/pricing | Real public catalog and active-service filtering; retain; no live acceptance | P1 |
| Exact private Unit P012 | /portal/rent, /portal/rent/period, /portal/rent/review | RentalBookingIntegration.jsx:17–27; RentalPeriodIntegration.jsx:206; SelfStorageReservationReview.jsx:66/132; reservationApi.js:22 | Correct exact Unit, pricing ID, date/profile/revalidation; lifecycle still approval/contract/full mock rather than deposit | P0 |
| Managed exclusive Cells P012/016 | /portal/rent?service=managed; map routes | ManagedReservationBooking.jsx:227; warehouse/ManagedCellBooking.jsx:1; managedReservationApi.js:7–8 | Existing selection/request/reconcile valuable; syntax blockers and obsolete financial display/next action | P0/P1 |
| Warehouse Map P009/024 | /portal/warehouse-map, /:facilityId, /:facilityId/racks/:rackId | WarehouseMapPage.jsx:50; warehouseMapApi.js:18–31; managedCellBooking.js:30 | Date-aware reads and geometry preserved; V2 booleans ignored, unknown source counters may arrive as projected zero | P1 |
| Rentals / detail / history P014/023 | /portal; /portal/reservations/:id | MyStoragePage.jsx:115; ReservationStatusPage.jsx:107 → RentalLifecycleIntegration.jsx:89/218; reservationApi.js:53–85 | Own list + Managed detail and service routing; incomplete V2 grouping/history labels/actions; DEPOSIT_PAID/CHECKIN_READY under generic fallback; malformed payment link | P0/P1 |
| Deposit P019/020 | /portal/payments/:reservationId | PaymentPage.jsx:130 → RentalLifecycleIntegration.jsx:500/535–543; managedReservationApi.js:12–13 | Partial dev-only actions; Axios allowlist blocks them, no real provider/polling, no durable pending recovery | P0 |
| Contract P017/018 | /portal/contracts; /portal/contracts/:reservationId | ContractsPage.jsx; ContractPage.jsx → RentalLifecycleIntegration.jsx:339/376; contractApi.js:7–10 | Own contract discovery/read/sign call exists; legacy guard blocks V2 and first signature expects SIGNED; frozen version and Facility signature not shown | P0 |
| Balance P019/063 | No functioning Customer action | No balance wrapper/call site; paymentApi.js:10 is old mock-pay | Need credited balance, both-current-signature gate, zero-balance and reconciliation states | P0 |
| Scheduled check-in / consent P025/030/039 | /portal/handover/:reservationId | HandoverPage.jsx:140 exports ReservationDetailIntegration | Route is detail alias, not scheduled check-in/inspection acceptance; no customer consent workflow | P0 |
| My Inventory P070 | /portal/inventory | MyInventoryPage.jsx:32 → inventory/InventoryIntegration.jsx:11 → inventoryApi.js:7 | Real owned paginated list; no rental/name/category/status search/filter, receipt/inspection progress incomplete | P1 |
| Register/edit P071 | /portal/inventory/register; /portal/inventory/:id | InventoryItemForm.jsx:10–24; inventoryRegistration.js:4–18; inventoryApi.js:8–10 | Valid dimensions/quantity/images/immutable fields; ACTIVE-only selection blocks deposit-paid intake. Edit rules differ from creation; do not blindly relax all guards | P1 |
| Inbound P073 | /portal/inventory/:id/inbound | InventoryMovementRequestPage.jsx:3–17 → customerDemoStore requestDemoMovement | Demo only, ACTIVE-only, real item IDs cannot resolve in fixture store; no actual POST /inventory-items/:id/inbound-request | P1 |
| Location / inspection / history P072/076 | /portal/inventory/:id; /history | InventoryIntegration.jsx:18–22 reads currentCellId; InventoryHistoryPage.jsx:8 reads demo movements | Current real Cell ID shown; location hierarchy/measurements/receiving inspection/signature progress and real movement reads missing | P1 |
| Outbound P075 | /portal/inventory/:id/outbound | InventoryMovementRequestPage.jsx:3 | Demo request only; no BE outbound route/state in supplied reference | P2 required full SRS |
| Extension / capacity upgrade CF-03 | /portal/rentals/:id/extend | RentalExtensionPage.jsx:3/16–18 → requestDemoExtension | Demo scalar m3/monthly arithmetic, no additional exclusive Cells, amendment/payment/real availability | P2 |
| Overdue CF-04 | Existing rental status, access route | RentalLifecycleIntegration.jsx:82/213/642; no overdue settlement action | Status and ACTIVE-only access guard; no policy fee/grace/renewal/controlled outbound integration | P2 |
| Checkout/refund/charges CF-05 | /portal/refunds/:id, /charges/:id, /payments | FinancialDetailPage.jsx:2–10; PaymentHistoryPage.jsx:12 → demo store | No real checkout request, ledger/refund/settlement API; do not treat advance rent as security refund | P2; unsafe activation P0 |
| Support CF-06/P037 | /portal/support | CustomerSupportIntegration.jsx:9–13; supportApi.js:5–9 → /support-requests, detail/messages | Actual own ticket/reply workflow; all six SRS categories match BE support-request.type.ts:3. Related rental/item/facility context not submitted by current create wrapper | P1 contextual linking |
| Notifications P032 | /portal/notifications | NotificationsPage.jsx:21 → CustomerNotificationsIntegration.jsx:6; customerRentalApi.js:14 | Real mine/read, unread filter, session guard; no V2 event deep-links/semantic progress; backend event coverage unverified | P2 |
| Private access P027/040 | /portal/rentals/:id/access | RentalAccessPage.jsx:20 → RentalLifecycleIntegration.jsx:620–679; customerRentalApi.js:5 | Own ACTIVE SELF_STORAGE only, fresh check before simulated unlock; no Managed credentials. Preserve. Missing upstream handover guarantees are BE issue | P0 upstream / keep gate |
| Payment receipts P021 | /portal/payments | PaymentHistoryPage.jsx:12, demo payments/refunds | Separate from /payments/:id real dev action; no real purpose ledger/history/polling endpoint found | P0 financial visibility / P2 receipts |

Route inventory: AppRoutes.jsx:70–112 defines **26 portal routes including the index** (plus four auth routes and six public routes). All were inspected: index, inventory, profile, three warehouse routes, notifications, extension, access, register, detail, inbound, outbound, history, refunds, charges, support, contracts list, payments list, rent, period, review, reservation, contract detail, payment detail, handover. No dedicated checkout, renewal payment or balance route exists. Legacy Preview function bodies in page files are not the default exports and do not prove integration.

## D. Complete Postman V2 API Inventory

All paths below have base `http://localhost:5000/api/v1`, documented by ENV baseUrl. Environment keys include customer/manager/staff email/password; their values are omitted and were not used. Collection has no top-level auth; requests specify bearer token placeholders or are public. GETs are reads; quote POST is source-confirmed read-only; login POST changes authentication state; other POST/PATCH actions are mutations even if described as replay.

Every collection response-example array is empty: **0 saved example responses**. Expected envelopes come from test scripts plus BE controllers, not captured runtime responses. Scripts often tolerate alternative envelopes and conditional assertions; these do not establish a firm DTO by themselves.

| ID | Method and endpoint | PM request entries | Actor / SRS stage | Body/query and source-confirmed contract | BE route | FE wrapper → actual call site | Status / action / priority |
|---|---|---|---|---|---|---|---|
| PM01 | `GET /health` | 1 | SYSTEM | GET read; no body; health success/service/database; PM expects 200 | BE src/routes/index.ts:24 | — → — | **NOT CUSTOMER-OWNED**; Health only; no Customer UI required; P2 |
| PM02 | `POST /auth/login` | 2, 3, 4 | PUBLIC → Customer | POST auth mutation; {email,password}; public; data.accessToken; PM login 200 | BE src/routes/auth.routes.ts:8 | FE src/api/authApi.js:7 → FE src/pages/auth/LoginPage.jsx:20 | **PARTIALLY INTEGRATED**; Keep login contract; application parse blockers prevent reachable workflow; P0 |
| PM03 | `GET /customers/me/profile` | 5 | CUSTOMER | GET owner profile; no body; verificationStatus=VERIFIED expected | BE src/routes/customer-profile.routes.ts:13 | FE src/api/customerRentalApi.js:4 → FE src/components/customer/CustomerVerificationForm.jsx:7 | **PARTIALLY INTEGRATED**; Keep owner verification read; do not auto-verify; P1 |
| PM04 | `GET /public/facilities` | 6 | PUBLIC | GET public; page=1,limit=20,serviceType=MANAGED_INVENTORY; data list + pagination | BE src/routes/public.routes.ts:5 | FE src/api/facilityApi.js:8 → FE src/components/customer/PublicFacilityCatalog.jsx:1 | **PARTIALLY INTEGRATED**; Keep public catalog; application parse blockers; P1 |
| PM05 | `GET /warehouse-map` | 7 | Authenticated Customer reader | GET; facilityId,startDate,endDate; data.zones; date-aware half-open interval | BE src/routes/warehouse-map.routes.ts:12 | FE src/api/warehouseMapApi.js:18 → FE src/pages/customer/WarehouseMapPage.jsx:50 | **PARTIALLY INTEGRATED**; Fix syntax; retain date-aware rendering; require explicit V2 eligibility; P1 |
| PM06 | `GET /racks/:rackId/detail-map` | 8, 13, 17, 29, 31 | Authenticated Customer reader | GET; startDate,endDate; rack,levels[].cells; isBookable,physicalUsageKnown,periodStatus | BE src/routes/warehouse-map.routes.ts:13 | FE src/api/warehouseMapApi.js:25 → FE src/components/customer/warehouse/ManagedCellBooking.jsx:1 | **PARTIALLY INTEGRATED**; Same flags; HOLD/RESERVED projection; preserve cross-Rack basket; P1 |
| PM07 | `GET /reservations/managed/capacity/:facilityId` | 9 | CUSTOMER (also scoped management) | GET; startDate,endDate; availableCapacityM3 >= selected volume | BE src/routes/reservation.routes.ts:20 | FE src/api/managedReservationApi.js:6 → FE src/components/customer/ManagedReservationBooking.jsx:227 | **PARTIALLY INTEGRATED**; Keep paired dates; parse-blocked page; P1 |
| PM08 | `GET /policies/resolve` | 10 | Authenticated Customer reader | GET; facilityId,serviceType,type=CATEGORY,at; config.allowedCategories includes DOCUMENTS, blockedCategories excludes it | BE src/routes/pricing-policy.routes.ts:1 | FE src/api/customerRentalApi.js:10 → FE src/components/customer/RentalPeriodIntegration.jsx:206 uses DEPOSIT, not CATEGORY | **API WRAPPER ONLY**; Add effective CATEGORY consumption to item form; existing generic wrapper alone is not integration of this collection request; P1 |
| PM09 | `POST /reservations/managed/quote` | 11 | CUSTOMER | POST READ ONLY; {facilityId,cellIds,allocatedCapacityM3,startDate,term}; quote pricing/deposit/amountBreakdown; V2 version when gate enabled | BE src/routes/reservation.routes.ts:18 | FE src/api/managedReservationApi.js:7 → FE src/components/customer/warehouse/ManagedCellBooking.jsx:1 | **PARTIALLY INTEGRATED**; Read-only POST; fix displayed total and parse blockers; P0 |
| PM10 | `POST /reservations/managed` | 12 | CUSTOMER verified | POST mutation; same five fields; data {reservation,quote}, reservation RESERVED/bookingFlowVersion=2 expected; 1–100 unique Cells | BE src/routes/reservation.routes.ts:19 | FE src/api/managedReservationApi.js:8 → FE src/components/customer/warehouse/ManagedCellBooking.jsx:1 | **PARTIALLY INTEGRATED**; Retain exact Cells/body/reconciliation; render V2 deposit next action; P0 |
| PM11 | `POST /reservations/managed/:id/deposit` | 14 | CUSTOMER owner | POST mutation; {idempotencyKey}; 201 data {payment,reservationId,amount,currency,idempotent}; MOCK DEPOSIT PENDING | BE src/routes/reservation.routes.ts:26 | FE src/api/managedReservationApi.js:12 → FE src/components/customer/RentalLifecycleIntegration.jsx:542 | **PARTIALLY INTEGRATED**; Wrapper + gated UI exist but request allowlist rejects; navigation malformed; no production PayOS; P0 |
| PM12 | `POST /reservations/managed/:id/deposit/mock-confirm` | 15, 35 | CUSTOMER owner | POST mutation/replay; {idempotencyKey}; 200 data {payment,reservation,idempotent[,reconciliationRequired]}; SUCCEEDED/DEPOSIT_PAID or late RECONCILIATION_REQUIRED | BE src/routes/reservation.routes.ts:27 | FE src/api/managedReservationApi.js:13 → FE src/components/customer/RentalLifecycleIntegration.jsx:543 | **PARTIALLY INTEGRATED**; Allowlist rejects; idempotent replay/PENDING recovery incomplete; dev mock only; P0 |
| PM13 | `GET /reservations/managed/:id` | 16, 28, 34 | CUSTOMER owner (also scoped management) | GET owner; no body; reservation DTO includes version/status/snapshot/allocatedCells | BE src/routes/reservation.routes.ts:22 | FE src/api/managedReservationApi.js:9 → FE src/api/reservationApi.js:65 → FE src/components/customer/RentalLifecycleIntegration.jsx:218 | **PARTIALLY INTEGRATED**; Owned list first; add CHECKIN_READY/version-specific actions/history; P1 |
| PM14 | `POST /inventory-items` | 18 | CUSTOMER owner | POST mutation; managedReservationId,itemCode,name,category,description,quantity,quantityUnit,unitWeightKg,unitDimensionsM,preferredCellId,images; 201 REGISTERED/currentCellId=null | BE src/routes/inventory-item.routes.ts:14 | FE src/api/inventoryApi.js:9 → FE src/components/customer/inventory/InventoryItemForm.jsx:15 | **PARTIALLY INTEGRATED**; ACTIVE-only rental filter blocks DEPOSIT_PAID; category/preferred allocation validation; P1 |
| PM15 | `POST /inventory-items/:id/inbound-request` | 19 | CUSTOMER owner | POST mutation; {}; 200 PENDING_INBOUND/currentCellId=null; owner unplaced REGISTERED, deposit-paid V2 or eligible ACTIVE | BE src/routes/inventory-item.routes.ts:18 | — → FE src/pages/customer/InventoryMovementRequestPage.jsx:3 | **UI MOCK ONLY**; Add real wrapper/allowlist and owner DEPOSIT_PAID/ACTIVE flow; current page uses demo store; P1 |
| PM16 | `POST /inventory-items/:id/receiving-inspection` | 20 | FACILITY_STAFF assigned | POST mutation; decision,observedQuantity,observedUnitWeightKg,observedUnitDimensionsM,compatibleCellIds,packingLayoutVerified,note,custodyTaken; ACCEPTED inspection; received custody not storage | BE src/routes/inventory-item.routes.ts:20 | — → — | **NOT CUSTOMER-OWNED**; Staff receives/inspects; Customer needs read-only results/progress, never inspection control; P1 |
| PM17 | `POST /reservations/managed/:id/contract` | 21 | FACILITY_STAFF / FACILITY_MANAGER assigned | POST mutation; {}; 201 contract after accepted inspection + deposit; DRAFT/currentContentVersion/contentVersions/signatures | BE src/routes/reservation.routes.ts:28 | — → — | **NOT CUSTOMER-OWNED**; Operator generates frozen contract after accepted inspection; Customer only views/signs; P0 |
| PM18 | `GET /contracts/:id` | 22, 25 | CUSTOMER owner (also scoped operators) | GET owner; no body; contract DTO (versions/hash/signatures), not data.contract wrapper in actual controller | BE src/routes/contract.routes.ts:13 | FE src/api/contractApi.js:7 → FE src/components/customer/RentalLifecycleIntegration.jsx:54 | **PARTIALLY INTEGRATED**; Read exists; render currentContentVersion/contentVersions/signatures and signature progress; P0 |
| PM19 | `PATCH /contracts/:id/sign` | 23 | CUSTOMER owner | PATCH mutation; {}; source ignores body; one current-version Customer signature, DRAFT until both parties | BE src/routes/contract.routes.ts:14 | FE src/api/contractApi.js:10 → FE src/components/customer/RentalLifecycleIntegration.jsx:432 | **PARTIALLY INTEGRATED**; Old CONTRACTED+hold guard blocks V2; success incorrectly demands SIGNED after first signature; P0 |
| PM20 | `PATCH /contracts/:id/sign/facility` | 24 | FACILITY_STAFF / FACILITY_MANAGER assigned | PATCH mutation; {}; Facility signature after Customer signature; same content version/hash; SIGNED only after both | BE src/routes/contract.routes.ts:15 | — → — | **NOT CUSTOMER-OWNED**; Facility countersign control must stay outside Customer; show resulting current-version signature; P0 |
| PM21 | `POST /reservations/managed/:id/balance` | 26 | CUSTOMER owner | POST mutation; {idempotencyKey}; 201 {payment,reservation,amount,currency,idempotent}; zeroBalance=true/payment=null possible | BE src/routes/reservation.routes.ts:29 | — → — | **MISSING IN FRONTEND**; Add balance request/allowlist and signed-version gate; handle zeroBalance payment=null; P0 |
| PM22 | `POST /reservations/managed/:id/balance/mock-confirm` | 27, 36 | CUSTOMER owner | POST mutation/replay; {idempotencyKey}; 200 {reservation,payment,idempotent}; SUCCEEDED BALANCE → CHECKIN_READY | BE src/routes/reservation.routes.ts:30 | — → — | **MISSING IN FRONTEND**; Add explicit dev confirmation and refresh CHECKIN_READY; never activate in Customer UI; P0 |
| PM23 | `POST /inventory-items/:id/confirm-inbound` | 30, 37 | FACILITY_STAFF assigned | POST mutation/replay; cellId,verifiedQuantity,actualUnitWeightKg,actualUnitDimensionsM,physicalPackingConfirmed,inspectionNote,idempotencyKey; item/movement/idempotentReplay; Staff only | BE src/routes/inventory-item.routes.ts:19 | — → — | **NOT CUSTOMER-OWNED**; Staff physical confirmation only; Customer observes atomic IN_STORAGE/ACTIVE result; P1 |
| PM24 | `GET /inventory-items/:id/movements` | 32 | CUSTOMER owner (also scoped operators) | GET owner; no body; data immutable movement array; no pagination in PM; PM expects exactly one INBOUND for new test item | BE src/routes/inventory-item.routes.ts:22 | — → FE src/pages/customer/InventoryHistoryPage.jsx:2 | **UI MOCK ONLY**; Replace demo history with real immutable movement reads; add wrapper/allowlist; P1 |
| PM25 | `GET /inventory-items/me` | 33 | CUSTOMER owner | GET owner; page=1,limit=100; data list plus pagination; test finds item IN_STORAGE in first page | BE src/routes/inventory-item.routes.ts:15 | FE src/api/inventoryApi.js:7 → FE src/components/customer/inventory/InventoryIntegration.jsx:11 | **PARTIALLY INTEGRATED**; Owned pagination exists; lacks rental/code/category/status search/filter and V2 progress; P1 |

### D1. Complete request-level inspection ledger

PM numbering here is document traversal order, independent of endpoint IDs above. Each listed request's method, path, query, auth placeholder, body, pre-request and test code was read; request-level scripts were syntax-compiled without execution (**45 scripts, zero syntax errors**). Collection-level shadow-variable guard was read and not executed. No collection runner or HTTP request was used.

| Entry | Folder / request name | Method/path | Assertions / scenario |
|---|---|---|---|
| 1 | 00 · PRECHECK & LOGIN (5) / 01 — Health + lịch thuê mặc định (+15 phút, 1 tháng) | `GET /health` | Backend /health OK; Booking start in future |
| 2 | 00 · PRECHECK & LOGIN (5) / 02 — Customer login → customerToken | `POST /auth/login` | HTTP 200 success; Access token present |
| 3 | 00 · PRECHECK & LOGIN (5) / 03 — Manager login → managerToken | `POST /auth/login` | HTTP 200 success; Access token present |
| 4 | 00 · PRECHECK & LOGIN (5) / 04 — Staff login → staffToken | `POST /auth/login` | HTTP 200 success; Access token present |
| 5 | 00 · PRECHECK & LOGIN (5) / 05 — Customer Profile phải VERIFIED | `GET /customers/me/profile` | HTTP 200 success; Customer VERIFIED |
| 6 | 01 · FACILITY, MAP & CHỌN CELL (5) / 01 — Browse Facility MANAGED_INVENTORY | `GET /public/facilities?page=1&limit=20&serviceType=MANAGED_INVENTORY` | HTTP 200 success; Facility list data exists |
| 7 | 01 · FACILITY, MAP & CHỌN CELL (5) / 02 — Warehouse Map → gợi ý Rack ID | `GET /warehouse-map?facilityId={{miFacilityId}}&startDate={{miStartDate}}&endDate={{miEndDate}}` | HTTP 2xx and success=true; zones array |
| 8 | 01 · FACILITY, MAP & CHỌN CELL (5) / 03 — Rack Detail → chọn 2 Cell, tính tổng m³ | `GET /racks/{{miRackId}}/detail-map?startDate={{miStartDate}}&endDate={{miEndDate}}` | HTTP 200 success; Manual Cell IDs must exist; 2 available cells chosen; Selected m3 > 0 |
| 9 | 01 · FACILITY, MAP & CHỌN CELL (5) / 04 — Capacity theo ngày (kiểm tra quota m³) | `GET /reservations/managed/capacity/{{miFacilityId}}?startDate={{miStartDate}}&endDate={{miEndDate}}` | HTTP 200 success; Selected quota fits Facility |
| 10 | 01 · FACILITY, MAP & CHỌN CELL (5) / 05 — CATEGORY DOCUMENTS đang cho phép? | `GET /policies/resolve?facilityId={{miFacilityId}}&serviceType=MANAGED_INVENTORY&type=CATEGORY&at={{miNowUtc}}` | HTTP 200 success; DOCUMENTS permitted by effective CATEGORY |
| 11 | 02 · CREATE & DEPOSIT v2 (7) / 01 — Quote 2 Cell (v2, read-only) | `POST /reservations/managed/quote` | HTTP 200 success; Quote volume equals selected Cell sum; Price and deposit returned |
| 12 | 02 · CREATE & DEPOSIT v2 (7) / 02 — Create Reservation v2 → HOLD [GHI DB] | `POST /reservations/managed` | HTTP 2xx and success=true; RESERVED + bookingFlowVersion=2; Reservation ID saved |
| 13 | 02 · CREATE & DEPOSIT v2 (7) / 03 — Map sau Create: Cell đang HOLD | `GET /racks/{{miRackId}}/detail-map?startDate={{miStartDate}}&endDate={{miEndDate}}` | Rack detail HTTP 200; Both selected Cells in this Rack; Both Cells unavailable for selected period |
| 14 | 02 · CREATE & DEPOSIT v2 (7) / 04 — INITIATE DEPOSIT [GHI DB] | `POST /reservations/managed/{{miReservationId}}/deposit` | HTTP 2xx and success=true |
| 15 | 02 · CREATE & DEPOSIT v2 (7) / 05 — MOCK CONFIRM DEPOSIT → DEPOSIT_PAID [GHI DB] | `POST /reservations/managed/{{miReservationId}}/deposit/mock-confirm` | HTTP 2xx and success=true; Reservation DEPOSIT_PAID; DEPOSIT SUCCEEDED |
| 16 | 02 · CREATE & DEPOSIT v2 (7) / 06 — GET Managed Reservation → DEPOSIT_PAID | `GET /reservations/managed/{{miReservationId}}` | HTTP 2xx and success=true; Reservation is v2 and DEPOSIT_PAID |
| 17 | 02 · CREATE & DEPOSIT v2 (7) / 07 — Map sau Deposit: 2 Cell RESERVED, chưa OCCUPIED | `GET /racks/{{miRackId}}/detail-map?startDate={{miStartDate}}&endDate={{miEndDate}}` | Rack detail HTTP 200; Both selected Cells in this Rack; Both selected Cells remain empty and reserved |
| 18 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 01 — Customer REGISTER ITEM (sau DEPOSIT_PAID) [GHI DB] | `POST /inventory-items` | HTTP 201 item created; REGISTERED and not physically placed |
| 19 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 02 — Customer REQUEST INBOUND → PENDING_INBOUND [GHI DB] | `POST /inventory-items/{{miItemId}}/inbound-request` | HTTP 200 success; PENDING_INBOUND, not yet placed |
| 20 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 03 — Staff RECEIVING INSPECTION ACCEPTED [GHI DB] | `POST /inventory-items/{{miItemId}}/receiving-inspection` | HTTP 2xx and success=true; Inspection ACCEPTED; Inspection ACCEPTED status |
| 21 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 04 — Facility CREATE CONTRACT v2 [GHI DB] | `POST /reservations/managed/{{miReservationId}}/contract` | HTTP 2xx and success=true; Contract ID present |
| 22 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 05 — GET CONTRACT → kiểm tra version & hash | `GET /contracts/{{miContractId}}` | HTTP 2xx and success=true; Contract loaded |
| 23 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 06 — Customer SIGN CONTRACT [GHI DB] | `PATCH /contracts/{{miContractId}}/sign` | HTTP 2xx and success=true |
| 24 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 07 — Facility representative SIGN CONTRACT [GHI DB] | `PATCH /contracts/{{miContractId}}/sign/facility` | HTTP 2xx and success=true; Contract SIGNED after two signatures |
| 25 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 08 — GET CONTRACT → SIGNED, đủ 2 bên | `GET /contracts/{{miContractId}}` | HTTP 2xx and success=true; Contract SIGNED |
| 26 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 09 — INITIATE BALANCE [GHI DB] | `POST /reservations/managed/{{miReservationId}}/balance` | HTTP 2xx and success=true |
| 27 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 10 — MOCK CONFIRM BALANCE → CHECKIN_READY [GHI DB] | `POST /reservations/managed/{{miReservationId}}/balance/mock-confirm` | HTTP 2xx and success=true; CHECKIN_READY; BALANCE SUCCEEDED |
| 28 | 03 · REGISTER → STAFF INSPECTION → CONTRACT → BALANCE (11) / 11 — GET Reservation → CHECKIN_READY | `GET /reservations/managed/{{miReservationId}}` | HTTP 2xx and success=true; CHECKIN_READY, not ACTIVE |
| 29 | 04 · FIRST INBOUND → ACTIVE & VERIFY (6) / 01 — Map baseline trước first inbound | `GET /racks/{{miRackId}}/detail-map?startDate={{miStartDate}}&endDate={{miEndDate}}` | Rack detail HTTP 200; Both selected Cells in this Rack; Both Cells RESERVED before physical inbound |
| 30 | 04 · FIRST INBOUND → ACTIVE & VERIFY (6) / 02 — Staff CONFIRM FIRST INBOUND → ACTIVE [GHI DB] | `POST /inventory-items/{{miItemId}}/confirm-inbound` | HTTP 200 success; Staff inbound -> IN_STORAGE and movement |
| 31 | 04 · FIRST INBOUND → ACTIVE & VERIFY (6) / 03 — Map sau Inbound → Cell1 OCCUPIED, Cell2 RESERVED | `GET /racks/{{miRackId}}/detail-map?startDate={{miStartDate}}&endDate={{miEndDate}}` | HTTP 200 success; C1 OCCUPIED, +40kg, +0.03m3, owned; C2 stays RESERVED, no added stock |
| 32 | 04 · FIRST INBOUND → ACTIVE & VERIFY (6) / 04 — GET ItemMovement → 1 INBOUND | `GET /inventory-items/{{miItemId}}/movements` | HTTP 200 success; Exactly one INBOUND movement |
| 33 | 04 · FIRST INBOUND → ACTIVE & VERIFY (6) / 05 — Customer My Inventory → IN_STORAGE | `GET /inventory-items/me?page=1&limit=100` | HTTP 200 success; My Inventory lists stored item |
| 34 | 04 · FIRST INBOUND → ACTIVE & VERIFY (6) / 06 — GET Reservation → ACTIVE | `GET /reservations/managed/{{miReservationId}}` | HTTP 2xx and success=true; First inbound activated v2 rental |
| 35 | 05 · OPTIONAL IDEMPOTENCY REPLAY (3) / 01 — OPTIONAL: replay DEPOSIT (không ghi thêm) | `POST /reservations/managed/{{miReservationId}}/deposit/mock-confirm` | HTTP 2xx and success=true; Reservation DEPOSIT_PAID; DEPOSIT SUCCEEDED |
| 36 | 05 · OPTIONAL IDEMPOTENCY REPLAY (3) / 02 — OPTIONAL: replay BALANCE (không ghi thêm) | `POST /reservations/managed/{{miReservationId}}/balance/mock-confirm` | HTTP 2xx and success=true; CHECKIN_READY; BALANCE SUCCEEDED |
| 37 | 05 · OPTIONAL IDEMPOTENCY REPLAY (3) / 03 — OPTIONAL: replay same Inbound idempotency key | `POST /inventory-items/{{miItemId}}/confirm-inbound` | HTTP 2xx and success=true; Inbound idempotent replay; Same movement ID |

PM future-map tests inspect exactly two same-Rack Cells for convenience; this is not a backend restriction against cross-Rack or cross-Zone selections. Optional replay requests remain mutations and must never be automatically run.


### D2. Additional Customer API traceability outside the supplied Managed collection

These endpoints were traced through active default exports; they do not increase the PM counts. All are source-only, globally blocked by current parser failures. “Keep” means preserve the verified request contract, not claim runtime acceptance. Roles below are Customer owner unless marked public.

| Method / exact endpoint | SRS | FE API → call site / route | BE reference / guard | Action / priority |
|---|---|---|---|---|
| POST /users/register | P003 | authApi.js:11 → pages/auth/RegisterPage.jsx /register | routes/user.routes.ts:10; public customer registration | Keep / P1 |
| POST /auth/forgot-password; POST /auth/reset-password | P003 | authApi.js:5–6 → ForgotPasswordPage/ResetPasswordPage | routes/auth.routes.ts:20–21; public recovery | Keep / P1 |
| POST /auth/logout | P003 | authApi.js:15 → common/LogoutButton.jsx and auth session clearing | routes/auth.routes.ts:11; authenticated refreshToken body | Keep / P1 |
| GET /users/me | P005 | userApi.js:3 → ProfilePage.jsx:18, authApi.me → LoginPage.jsx:24 | routes/user.routes.ts:14; authenticated identity | Keep / P1 |
| PUT /users/me/profile | P005 | userApi.js:4 → ProfilePage.jsx:20; displayName/phone | routes/user.routes.ts:15; own user | Keep / P1 |
| PUT /users/me/password | P003 | userApi.js:5 → ProfilePage.jsx:21; oldPassword/newPassword | routes/user.routes.ts:16; own user | Keep / P1 |
| PUT /customers/me/profile | P011 | customerRentalApi.js:4 → CustomerVerificationForm.jsx:7 /portal/profile; identityCard/address/taxCode | routes/customer-profile.routes.ts:14; resets verification pending | Keep / P1 |
| GET /public/facilities/:id | P007 | facilityApi.js:9 → PublicFacilityCatalog and RentalBookingIntegration.jsx:22 | routes/public.routes.ts:8; public | Keep / P1 |
| GET /public/facilities/:id/storage-options; GET /public/facilities/:id/pricing | P009/051 | facilityApi.js:10–11 → RentalBookingIntegration.jsx:23 and public catalog | routes/public.routes.ts:6–7; public summaries, not reservable Unit IDs | Keep / P1 |
| GET /facilities/:facilityId/storage-units; GET /storage-units/:id | P009/012 | storageApi.js → RentalBookingIntegration.jsx:25–26 /portal/rent; SelfStorageReservationReview.jsx:36 | routes/storage-unit.routes.ts; authenticated catalog, server booking rechecks interval | Keep exact IDs / P1 |
| GET /pricing-rules; GET /pricing-rules/resolve | P051 | customerRentalApi.js:7–8 → ManagedReservationBooking term query / RentalPeriodIntegration | routes/pricing-policy.routes.ts:1; effective term/service/Facility resolution | Keep snapshot discipline / P1 |
| GET /policies/resolve (type=DEPOSIT) | P052 | customerRentalApi.js:10 → RentalPeriodIntegration.jsx:206 | pricing-policy.routes.ts, RuleService; not same semantic request as CATEGORY | Keep policy read; new money semantics / P0 |
| POST /reservations/estimate | P012/051 | reservationApi.js:22 → SelfStorageReservationReview.jsx:66; startDate/endDate/pricingPolicyId | reservation.routes.ts:17; estimate, source read-only | Modify Self financial contract with BE / P0 |
| POST /reservations | P012/016 | reservationApi.js:29 → SelfStorageReservationReview.jsx:132; exact Unit+pricing+dates | reservation.routes.ts:35; Self create service, verified profile and HOLD | Keep payload, replace future lifecycle only with confirmed BE / P0 |
| GET /reservations/me | P014/023 | reservationApi.js:53 → RentalsIntegration, contractContext, inventoryRentals, uncertain create | reservation.routes.ts:36; own collection includes service records | Keep ownership-first + add V2 status handling / P1 |
| PATCH /reservations/:id/cancel; PATCH /reservations/managed/:id/cancel | P015 | reservationApi.js:88–97, managedReservationApi.js:10 → ReservationDetailIntegration.jsx:268 | reservation.routes.ts:25/37; unpaid legacy/reserved guards | Keep eligible unpaid; paid resolution contract missing / P1 |
| GET /contracts/me | P018 | contractApi.js:8 → ContractsIntegration.jsx:339 / contractContext:54 | contract.routes.ts:12; owner collection | Keep / P1 |
| POST /reservations/:id/mock-pay | P019 legacy | paymentApi.js:11–12 → SelfStorageMockPayment.jsx:26 /payments/:id | reservation.routes.ts:40, controller:194; CONTRACTED Self, legacy simulated PAID | Legacy only; new Self lifecycle backend required / P0 |
| POST /reservations/managed/:id/mock-pay | P019 legacy | managedReservationApi.js:11 → paymentApi.js:10 → RentalLifecycleIntegration.jsx:598 | reservation.routes.ts:31; source excludes V2; old dev flag | Legacy only / P0 |
| GET /access/me; POST /access/simulate-unlock | P027/040 | customerRentalApi.js:5 → AccessIntegration.jsx:626/666 /rentals/:id/access | routes/access.routes.ts; access controller; ACTIVE private Unit, reservationCode/pinCode | Keep owner/service/ACTIVE checks, upstream BE handover hardening / P0 |
| GET /notifications/me; PATCH /notifications/:id/read | P032 | customerRentalApi.js:14 → CustomerNotificationsIntegration.jsx:6–8 | notification.routes.ts:8–9; owner notification | Keep; add V2 navigation/event coverage / P2 |
| GET /support-requests; POST /support-requests | P037/038 | supportApi.js:5/7 → CustomerSupportIntegration.jsx:9/12 /portal/support | support-request.routes.ts:11–12; own Customer scope in service | Keep category/subject/description; add relatedEntity with confirmed schema / P1 |
| GET /support-requests/:id; GET /support-requests/:id/messages; POST /support-requests/:id/messages | P037/038 | supportApi.js:6/8/9 → CustomerSupportIntegration.jsx:10–12; message,isInternal=false | support-request.routes.ts:13–14/20; owner and public-message visibility | Keep / P1 |
| GET /inventory-items/:id; PATCH /inventory-items/:id | P071/072 | inventoryApi.js:8/10 → InventoryIntegration.jsx:18, InventoryItemForm.jsx:17 | inventory-item.routes.ts:23–24; owner read, REGISTERED unplaced edit guard and narrow V2 exception | Keep DTO, split eligible create/edit policy / P1 |
| GET /inventory-items/:id/placement-preview | P072/079 | inventoryApi.js:11 → PlacementPreview.jsx; InventoryMapPreference.jsx:18 | inventory-item.routes.ts:17; inventory-item.service.ts:634 ACTIVE guard | Advisory only; clarify before deposit-paid use / P1 |

Unreachable or legacy wrapper methods are not integrated routes: contractApi.js:30/45 uses /contracts/reservation/:id and POST /contracts/:id/sign, while default UI uses own GET collection + PATCH signReal. paymentApi.js:28/37 uses generic /payments paths absent from reference mounts. supportApi.js:10–13 old /support paths are not the active /support-requests flow. No cleanup/removal was performed.


## E. New Customer APIs

### Deposit integrations exist in part, but are blocked

FE managedReservationApi.js:12–13 already wraps the two exact POST endpoints with `{idempotencyKey}`. PaymentIntegration at RentalLifecycleIntegration.jsx:505–543 creates a key, checks V2 and a separate development flag, offers two explicit ConfirmAction components, verifies purpose/PENDING/amount and later DEPOSIT_PAID/SUCCEEDED, notices reconciliationRequired and refreshes the reservation. Therefore neither endpoint is simply “missing.”

However:
1. Axios request interceptor invokes assertConfirmedRequest (axiosClient.js:11–12). Its managedCustomer allowlist (confirmedContract.js:7) allows old mock-pay but **neither /deposit nor /deposit/mock-confirm**, so both calls reject locally before HTTP.
2. Reservation navigation JSX is malformed at RentalLifecycleIntegration.jsx:316–324. Its nested old CONTRACTED/PAID condition also contradicts the outer V2 RESERVED condition; correcting syntax alone will not make the new action semantically reachable.
3. BE gate is **NODE_ENV === development AND MI_MANAGED_DEPOSIT_FLOW_ENABLED === true**, not the legacy MI_MOCK_PAYMENT_ENABLED guard (BE managed-reservation.service.ts:29/514; managed-checkin.service.ts:30). FE new flag is **DEV AND VITE_MI_MANAGED_DEPOSIT_FLOW_ENABLED === true** (FE RentalLifecycleIntegration.jsx:516). Neither current runtime flag nor DB safety was verified; no environment values were changed.
4. Initiate expects only PENDING in FE. A previously succeeded/reconciled payment or uncertain result is not reconciled through a real payment query. depositInitiated is local state, lost on reload; depositKey is useRef initialized from reservationId and is not reset when the route ID changes without remount. No payment polling/status/history integration exists.
5. ConfirmAction prevents duplicate clicks for its own action (RentalBackendUI.jsx:228), not a shared lock across both deposit actions. Owner token checks exist after requests, but initiated state is not scoped/reset to token/ID. Preserve session checks and add purpose/key/record-bound recovery before implementing.
6. Current backend deposit provider is **MOCK**, not a PayOS checkout. A successful mutation is not proof of payment gateway integration. BE 201 initiation returns payment/reservationId/amount/currency/idempotent, whereas confirmation returns payment/reservation/idempotent; late confirmation can return success=true with reconciliationRequired=true without advancing rental (managed-reservation.service.ts:537–594).

### Missing Customer balance and inventory integrations

Add, after approved implementation scope:
- POST /reservations/managed/:id/balance and /balance/mock-confirm, body `{idempotencyKey}`, using existing client/allowlist and explicit action. Backend source supports both; current FE has neither wrapper nor call site.
- POST /inventory-items/:id/inbound-request, body {}, and GET /inventory-items/:id/movements. Backend exists; current pages use demo stores and these paths are absent from confirmedContract allowlist.
- Use existing GET/PATCH /inventory-items/:id and GET /inventory-items/:id/placement-preview; do not invent replacement endpoints or Staff-confirm controls.
- GET CATEGORY resolution has a generic wrapper but no item form consumer. Self Storage DEPOSIT lookup at RentalPeriodIntegration.jsx:206 does not satisfy this Managed CATEGORY request.

Staff-only receiving-inspection, contract-generation, Facility-sign and confirm-inbound are dependencies, not new Customer mutation controls. No deposit/balance status polling endpoint is documented in this PM or mounted reference routers; request a confirmed read/reconciliation contract rather than guessing one.

## F. Existing APIs Requiring Changes

| API / shared adapter | Existing implementation | Required handling |
|---|---|---|
| POST managed quote / create | Correct selected five-field body, unique IDs, geometric capacity; managedCreation unwraps reservation+quote (customerReservationService.js:31–42) | Fix syntax separately; keep body; inspect bookingFlowVersion and snapshot payment breakdown, no approval step for V2 |
| GET managed detail and own reservations | Owned collection first then scoped Managed read (reservationApi.js:53–85) | Version-specific timeline/actions; DEPOSIT_PAID and CHECKIN_READY; do not infer V2 from legacy status |
| GET contracts/me + /:id | contractContext verifies owner association (RentalLifecycleIntegration.jsx:54–72) | Render currentContentVersion/contentVersions[].content/contentHash/signatures; distinguish Customer signed from both signed; preserve owned discovery |
| PATCH /contracts/:id/sign | Correct method, old canSign requires CONTRACTED/live hold; response requires SIGNED | V2 source allows DEPOSIT_PAID/CHECKIN_READY; first Customer signature leaves DRAFT plus signatures array, not necessarily SIGNED; refresh and show Facility pending, not a false failure |
| GET /inventory-items/me + item / create | Existing DTO validation and real requests; ACTIVE-only eligibleInventoryRental | Allow deposit-paid V2 registration with backend eligibility; preserve server read ownership, null currentCellId and quantity/geometry rules |
| PATCH inventory item | editableInventory ACTIVE-only; uses currentCellId null + REGISTERED | Backend normal edits remain ACTIVE-only, with narrow deposit-paid rejected-inspection/no-contract exception (BE inventory-item.service.ts:372–394). Separate create vs edit; clarification needed before allowing all preactivation edits |
| GET placement-preview | ACTIVE-only on both FE and BE (inventory-item.service.ts:632–634) | Do not blindly enable on DEPOSIT_PAID; confirm advisory preactivation API support or show unavailable |
| Map/rack DTO | Validates structure; preserves booleans without checking them (warehouseMap.js:24; managedCellBooking.js:30–39) | Require isBookable===true AND physicalUsageKnown===true plus current checks; preserve flags across cache/refetch |
| Cancellation | Customer canCancel only RESERVED/CONTRACTED; service-specific patch | Keep legacy/unpaid cancellation; deposit-paid financial resolution is unresolved BE/SRS work, do not just add status to FE list |
| Existing generic payment wrappers | /payments/payos/create and /payments/:id/status exist as legacy/mock wrappers (paymentApi.js:13–37) | No reference route mount found for these paths; not approved alternatives to V2 payment endpoints |
| Error mapping | RentalBackendUI.jsx:56–90 whitelists mainly legacy business messages | Map new version/signature/receiving/payment reconciliation errors safely; distinguish blocked, conflict, unknown outcome and actual financial failure |

### Lifecycle mapping

| SRS logical state/domain | Backend enum / source | Trigger / actor | Current FE handling / gap |
|---|---|---|---|
| Reserved | RESERVED, bookingFlowVersion=2 when gate enabled (BE reservation.type.ts:4–16; managed-reservation.service.ts:332) | Customer selected create → HOLD | Correct create shape; partial V2 deposit description, old wait-approval still exists elsewhere |
| DepositPaid | DEPOSIT_PAID | Confirmed DEPOSIT ledger; owner dev mock in reference | Partial detail/payment branch; not registration eligible |
| Paid, physical event pending | **CHECKIN_READY for V2**, PAID retained legacy | Both current-version signatures and balance success or zero-balance settlement (BE managed-checkin.service.ts:267–331) | No dedicated CHECKIN_READY label/action/timeline; PAID copy wrongly tells management to activate |
| Active | ACTIVE | V2 first Staff inbound within interval (BE inventory-item.service.ts:464/563) | FE ACTIVE copy still says physical occupancy awaits inbound; wrong for first V2 activation |
| Contracted, legacy only | CONTRACTED, no automatic V2 migration | Old Manager approval (BE managed-reservation.service.ts:423–427) | Core sign/pay guard still assumes this for all Managed records |
| Contract DRAFT / PARTIALLY_SIGNED / SIGNED | **No PARTIALLY_SIGNED enum**; DRAFT with one signature, SIGNED with both (BE contract.type.ts:3–7; managed-checkin.service.ts:350–354) | Customer then assigned Facility representative, same current version/hash | FE expects SIGNED after Customer only; does not show partial array-based state |
| Payment PENDING/SUCCESS/FAILED | PENDING/SUCCEEDED/FAILED/**RECONCILIATION_REQUIRED** (payment.type.ts:10–15) | Independent purpose-specific ledger | Current dev deposit reads some states; no ledger/history/recovery; never equate rental PAID with payment SUCCEEDED |
| Allocation HOLD → RESERVED → OCCUPIED | Same enums; map periodStatus projects HOLD as RESERVED | Create → deposit → actual inbound | Existing bookingStatus RESERVED indistinguishable from projected hold except rental stage; need explanatory labels, no invented public HOLD enum |
| Item Registered → PendingInbound → InStorage | REGISTERED/PENDING_INBOUND/IN_STORAGE plus **RECEIVED_PENDING_ACCEPTANCE** and custody/inspection metadata | Owner registration/request, Staff receiving, physical confirm | List/detail show raw states but no V2 inspection or receiving progression; movement pages remain demo |
| Overdue / CheckedOut / Closed / Cancelled | OVERDUE/CHECKED_OUT/CLOSED/CANCELLED enum | Policy/system/authorized operations | Status labels partly exist; operational endpoints not generally implemented |

V2 identity is explicit `bookingFlowVersion===2`; absence must mean legacy/unknown, not silently treated as migrated. SRS Paid should map to V2 CHECKIN_READY in UI explanation while retaining raw backend state; do not send PAID to force compatibility.

### Financial mismatch

SRS CF-01/BR-12/46 defines T = original rent + tax − discount, 0≤D≤T, credited advance rent, B=max(0,T−confirmed D). BE payment-accounting.ts:34–53 enforces finite amounts and rejects D>T; its depositCredit is the scheduled amount used in the quote and backed by a SUCCEEDED ledger at balance time.

Current errors:
- FE warehouse/ManagedCellBooking.jsx:84 displays **estimatedRent + deposit.amount + taxAmount** as calculated estimate. It ignores backend amountBreakdown totalDue/depositCredit/balanceDue (BE managed-reservation.service.ts:268–278). Example rent100, deposit20,tax0: current estimate120, intended total100, deposit20, remaining80. This is a source-derived arithmetic example, not a live quote.
- FE verifiedCellQuote (managedCellBooking.js:52–54) validates old numbers but does not validate the V2 breakdown, D≤T or reconcile credited/paid amount.
- FE contractAmounts (customerReservationService.js:15–18) selects only pricingSnapshot.amountBreakdown for Managed. V2 current contract content has separate frozen pricing totalDue/depositCredit/balanceDue plus versions; FE ignores actual signed version content and signature arrays.
- FE selfStoragePayment.js:5–10 and SelfStorageMockPayment.jsx:32 explicitly use rent + deposit + tax − discount, even though labeled arithmetic rather than confirmed charge. That is still misleading against advance-rent requirements.
- Existing backend Self Storage calculator uses a hardcoded monthly/half-month deposit (reservation.service.ts:98–101), potentially larger than short-period rent. V2 managed accounting constraints do not fix Self Storage.
- Missing balance/payment history makes settled-credit, refund and late webhook reconciliation unverifiable. Do not infer creditedDepositPaid from depositAmount alone; require successful payment evidence. No real PayOS webhook/status implementation was found in mounted reference routes.

## G. Obsolete Frontend Flows

| Flow / exact source | Obsolete assumption | Required safe scope |
|---|---|---|
| RentalLifecycleIntegration.jsx:75/79/81 | RESERVED waits approval, PAID management activation, ACTIVE no stock yet | Keep these explanations only for legacy; new V2 first inbound creates physical stock and activation together |
| RentalLifecycleIntegration.jsx:208–216 | Self Reserved→approval, Contracted→contract, PAID→Manager handover | Replace only once confirmed Self V2 backend is available; no Managed endpoint reuse |
| customerReservationService.js:9–12 | Every Managed sign/pay requires live CONTRACTED hold | Version-specific old signing/mockPay; V2 deposit has removed expiresAt after payment |
| RentalLifecycleIntegration.jsx:432–456 | Customer signing must immediately return SIGNED | V2 one-party signature is successful DRAFT+signature array; show Facility pending |
| paymentApi.js:10; managedReservationApi.js:11 | Old /managed/:id/mock-pay | **LEGACY / OBSOLETE for V2**, backend excludes bookingFlowVersion2 at managed-reservation.service.ts:501; keep old history compatibility |
| Manager ReservationApiView.jsx:20/35; facilityReviewApi.js:11 | Any RESERVED can be approved to CONTRACTED | UI needs version guard; BE approve/reject excludes V2. Do not expose Manager approval in Customer booking |
| Managed manager activation endpoint | PAID→ACTIVE by Manager | V2 should reach CHECKIN_READY, then Staff inbound. BE activate query at managed-reservation.service.ts:601 lacks explicit version exclusion, though normal V2 flow never sets PAID; backend hardening confirmation warranted |
| InventoryRegistration.js:4 and InventoryBackendUI.jsx:10 | Only ACTIVE may register | Prevents first intake required to become ACTIVE |
| InventoryMovementRequestPage.jsx:11 | Registered + ACTIVE only; demo dispatch | Must request under owned deposit-paid V2, preserve no-stock effect |
| RentalExtensionPage.jsx:16–18 | Arbitrary extra scalar capacity and local monthly estimate | Real upgrade needs selected exclusive Cells, paid amendment; P2, not a rebuild of initial basket |

No deprecated endpoint in the supplied collection was proved removed from backend. “Legacy” here describes state-limited use; the reference retains old endpoints. Unused old contractApi.getByReservation/sign and paymentApi.createPayment wrappers must not be mistaken for default Customer paths; default exports use integration components.

## H. Managed Inventory Gap Analysis

### Preserve existing correct design

FE managedCellBooking.js:25–50 validates finite measured usable dimensions, parent Rack AVAILABLE, operational/booking/display status, actual numeric zero counters, same Facility, 1–100 unique Cell IDs and sum of geometric volume. No weight-to-volume or arbitrary allocation. It rejects truly absent counters rather than defaulting them to zero. selectedPayload validates calendar interval consistency.

FE warehouse/ManagedCellBooking.jsx:1–75 retains scoped in-memory basket across Rack/Zone navigation; scope includes token/Facility, date/key changes invalidate quotes; freshSelection and new quote precede create; duplicate submit busy refs and uncertain-create owned-list reconciliation prevent silent automatic retry. Existing date-aware overview/rack API config carries paired startDate/endDate. These should be repaired/adapted, not rebuilt.

### V2 map safety gap

BE warehouse-map.service.ts:230–249 derives physicalUsageKnown from original counter presence/validity, **but projects usedWeightKg/usedVolumeM3 using null-coalesced zero**. It returns isBookable=false when uncertainty exists. Current FE cellBookingReason ignores both isBookable and physicalUsageKnown and accepts numeric projected zeros. Thus a missing legacy source counter can appear selectable even though backend explicitly rejects booking. This is a concrete cross-layer mismatch, not a claim that FE itself replaces every missing counter with zero.

FE map UI does not display these certainty flags (CellInformation.jsx:21–62); maxVolumeM3 is shown but bookable volume uses configured dimensions. Preserve dimension sum and compare documented authoritative volume if discrepancy appears; do not infer volume from nominal height or a maximum weight. Ownership is informational, never eligibility override. Source map periodStatus/HOLD projection must be explained accurately.

### Inventory and first intake

Backend supports deposit-paid registration via managed-inventory-reservation.guard.ts:49–62; creation sets currentCellId null and no physical stock movement (inventory-item.service.ts:290–310). First inbound request uses registration status and no counters (399–425). Final Staff confirmation checks accepted inspection, actual measurements, destination allocatedCellIds, quota and rental/payment/contract state; atomic first activation occurs at 563–590. Customer must never perform that operation.

FE's real list/create/detail/metadata validation remain useful. It needs DEPOSIT_PAID rental eligibility, effective categories, allocatedCell preference choices, actual request and movement integration, receiving inspection/custody state, frozen contract/signature and balance progress.

Preferred Cell gap exists on both sides: FE accepts any syntactically valid ID/manual entry, and map preference checks Facility/AVAILABLE only (inventoryRegistration.js:17; InventoryMapPreference.jsx:13–17). BE validatePreferredCell at inventory-item.service.ts:278 checks same Facility and operational availability, but not membership in reservation. SRS CF-12 requires allocatedCellIds membership. **Do not rely only on FE narrowing to enforce ownership; backend validation needs correction/confirmation.** Actual final inbound DOES validate membership, so preference success is not allocation authority.

Backend placement-preview still requires ACTIVE and normal edits ACTIVE, with narrow rejected-inspection correction exception. Source limits must be reported, not bypassed to complete preactivation UI. Detailed current Cell is an ID only; enrich from confirmed owner-safe map data without inventing a location endpoint. My Inventory lacks SRS P070 search/filter even though real pagination exists.

## I. Self Storage Gap Analysis

The supplied PM collection is Managed-specific. No new Self deposit/balance/check-in-consent/Facility-signature workflow was found in reference route mounts. Generic /contracts/:id/sign/facility is routed to a service that explicitly loads V2 MANAGED_INVENTORY; it is **not** a Self V2 endpoint (BE managed-checkin.service.ts:53–55).

| Step | Existing source evidence | Gap |
|---|---|---|
| Exact Unit + HOLD | FE RentalBookingIntegration.jsx:25–26, SelfStorageReservationReview.jsx:132; BE reservation.service.ts:144 onward | Preserve exact resource and transaction protections; list availability must still be rechecked for selected interval by backend |
| Deposit | FE SelfStorageMockPayment.jsx:32; BE reservation.controller.ts:194–225 | No purpose-DEPOSIT API; old CONTRACTED mock PAID after approval, no credited ledger |
| Scheduled check-in/customer condition acceptance | FE HandoverPage.jsx:140 default detail alias | No real customer acceptance/reschedule step |
| Two-party frozen contract | BE reservation.controller.ts:86–130 creates contract on approval; contract.controller.ts:87 onward single-party legacy branch | Wrong timing; no Self frozen-version/Facility sign support |
| Balance | No Self BALANCE routes in BE routes/index.ts and reservation.routes.ts | Backend API development/confirmation required |
| Physical handover and ACTIVE | BE inspection.controller.ts:40–70 | Completion directly sets ACTIVE/OCCUPIED, without shown paid/deposit/two-signature/condition-consent/Facility-assignment transaction guards. This is a source-level safety finding, not an exercised exploit |
| Access | FE RentalLifecycleIntegration.jsx:642–669; /access/me and /access/simulate-unlock | FE correctly requires own ACTIVE SELF_STORAGE and denies Managed; cannot establish upstream physical checks because existing BE activation omits them |
| Cancellation | FE service-specific cancel, BE reservation.controller.ts:169 | Unpaid RESERVED/CONTRACTED only; deposit-paid financial resolution not implemented |
| Extension/checkout/refund | FE demo extension/financial routes; BE generic inspection CHECK_OUT can mark CHECKED_OUT | No full Customer settlement APIs or policy-based closure/refund ledger |

Shared change risks: customerReservationService, RentalBackendUI status/amounts, RentalLifecycleIntegration, contractApi, paymentApi, reservationApi and confirmedContract are shared. Introduce explicit service+flow-version boundaries rather than changing all CONTRACTED/PAID checks globally. Do not retrofit Managed v2 endpoints onto Self Storage or remove old record rendering. The old Self arithmetic and backend deposit convention also need alignment with approved advance-rent rules.

## J. Cross-role Dependencies

| Actor | Required responsibility | Customer exposure / current dependency |
|---|---|---|
| Customer | Own create/deposit/item declaration/inbound request, read physical findings, accept terms/sign, pay balance | Add actual owner actions; no stock edits, Facility signing or activation |
| Facility Staff | Receive/measure goods; ACCEPTED/DISCREPANCY/REJECTED and custody; first/subsequent inbound; Self inspection/handover | Receiving and confirm endpoints exist in reference; current Staff pages are largely demo/missing V2 API consumption. A full Staff rewrite is separate scope |
| Facility Staff/Manager representative | Generate or refresh inspected contract and countersign after Customer | BE assignedFacilityId and role required; Customer sees signature progress only |
| Facility Manager | Exceptions/no-show, approved extensions/refunds, assignment | Existing initial approve UI is legacy and needs version restriction; new booking no approval |
| BOM | Effective rate/deposit/category/policy/quota configuration | Missing or ambiguous policy must surface as blocked, not invented FE defaults |
| Admin/environment owner | Test isolation, accounts/assignments, runtime/index evidence | Historical live-write gate remains blocked; attachments containing credential keys are not isolation or write authorization |

## K. SRS / Postman / Backend Contradictions

| Sources | Conflicting behavior / impact | Clarification / safe interim handling |
|---|---|---|
| SRS p68–71 Paid vs BE reservation.type.ts:8–11 / PM 03.10 | V2 uses CHECKIN_READY, legacy PAID also exists | Display semantic “rent settled, waiting Staff inbound,” retain raw CHECKIN_READY and explicit version |
| SRS Contract PARTIALLY_SIGNED vs BE contract.type.ts:3 / managed-checkin.service.ts:354 | One signature remains DRAFT, no partial enum | Derive displayed partial state from current version/hash signature array; backend contract naming decision needed |
| SRS PayOS P019/020 vs PM and BE payment provider | New endpoints generate MOCK only, dev flag; no mounted PayOS webhook/status/read contract | Development simulation only; confirm provider, callback verification, polling/reconciliation and receipt API before production |
| SRS independent same-version signature intent vs BE sign body ignored | Backend signs computed current version, not a client-supplied expected hash/version; ensureVersion may refresh content | Confirm optimistic expected-version/hash acknowledgment contract; UI must show exact current content and refresh on change; do not invent payload fields |
| SRS “independent” signatures vs BE signFacilityContract:256 | Facility is forced to sign after Customer | Document/order dependency; confirm whether order is intentional |
| SRS CF-12 arbitrary preferred Cell forbidden vs BE validatePreferredCell:278 | Same-Facility/AVAILABLE check lacks allocatedCellIds membership | FE restrict choices; backend must enforce; preference is advisory, never accepted placement |
| SRS first-intake edit needs vs BE update/preview:372/634 | General edit and placement preview ACTIVE-only; narrow rejected-inspection exception | Keep explicit unavailable/correction path until approved API behavior |
| SRS allowed zero deposit BR-12 vs BE effectiveQuote:175 | V2 rejects deposit≤0, VND only, rounding nonnegative half-up | Confirm configured minimum/currency/tax policy; show server-blocked, no FE fake zero deposit |
| SRS depositPaid may register but Paid pending physical vs registration guard | Guard allows ACTIVE or DEPOSIT_PAID V2 only, not CHECKIN_READY | Clarify ability to add new lots while waiting first inbound; preserve actual backend guard |
| SRS receiving no physical stock vs BE RECEIVED_PENDING_ACCEPTANCE | Additional custody state exists | Render custody vs warehouse IN_STORAGE distinctly; never increment counters from receipt |
| SRS all services new lifecycle vs BE Self legacy approval/single sign/inspection | Self remains structurally incompatible | Separate backend work required; do not claim Customer-only changes solve it |
| SRS full CF-03/04/05/14/15 vs reference API coverage | No full extension/amendment/outbound/refund/worker routes | Required full-product gaps, P2 later unless unsafe physical/financial behavior elevates priority |
| PM optional replay folder after ACTIVE vs BE deposit confirm:568–569 / balance confirm:320–321 | PM replay assertions expect DEPOSIT_PAID/CHECKIN_READY after flow already ACTIVE; source short-circuits only at those earlier states, then rejects terminal nonpending payment | Collection replay scenario and backend desired idempotency behavior need agreement. Run phase-local replay before state advancement or update approved tests; do not claim global idempotency from this collection |
| PM record shapes fallback vs actual controllers | PM guesses data.contract/data, data.balancePayment/data, contentVersion/version, contentHash/contractHash; source uses currentContentVersion/contentVersions/signatures | Use actual reference DTO, add strict contract tests; collection descriptions explicitly disclaim live execution |
| SRS no-show/refund/reschedule policy TBD p168/p1110 | No confirmed deadline/forfeiture rule; worker/index runtime unverified | Display pending policy/support resolution; no hardcoded automatic cancellation, release or activation |
| SRS authorization table p470–475 / checkout p566 vs narrative | Blank Profile roles; Customer participation in checkout narrative but table omits | Requirement-owner documentation correction; never infer broad privileges |

The restored reference also now validates selected parent Rack operationalStatus=AVAILABLE (managed-reservation.service.ts:226), so the old audit's missing-create-Rack-guard finding no longer applies to this snapshot.

Reference legacy activate service query at managed-reservation.service.ts:601 lacks explicit version !=2, while normal V2 is CHECKIN_READY so ordinary V2 activation cannot match. Add a backend hardening item rather than claiming actual V2 Manager activation succeeded. No runtime exploit, payment, signature or stock mutation was attempted.

## L. Prioritized Implementation Backlog

| ID | Priority | Module | Required Change | API | FE Files | Dependency | Acceptance Criteria |
|---|---|---|---|---|---|---|---|
| CV2-001 | P0 | Source integrity | Resolve four existing syntax blockers without refactoring behavior | None | warehouseMapApi.js; ManagedReservationBooking.jsx; RentalLifecycleIntegration.jsx; customerReservationService.js | Separate implementation authorization | All 187 source files parse, build passes, no unrelated changes |
| CV2-002 | P0 | Version boundaries | Define service+bookingFlowVersion lifecycle mapping and legacy compatibility | Own reservation reads | customerReservationService.js; RentalBackendUI.jsx; RentalLifecycleIntegration.jsx | State mapping agreement | V2 never initial-approves; legacy CONTRACTED renders correctly; CHECKIN_READY never ACTIVE |
| CV2-003 | P0 | Money | Use immutable rent total/advance credit/balance, no additive deposit | Quote/detail/contract snapshot | managedCellBooking.js; ManagedCellBooking.jsx; selfStoragePayment.js | Approved tax/discount/rounding, Self backend contract | T100/D20 shows T100/B80; D>T rejected; paid credit from ledger |
| CV2-004 | P0 | Managed deposit | Repair reachable link, allowlist exact paths, key/session guards and pending/reconcile recovery | POST deposit, deposit/mock-confirm | managedReservationApi.js; confirmedContract.js; RentalLifecycleIntegration.jsx | CV2-001/002/003; approved dev flags | Explicit action; correct purpose/amount/key/record; no automatic retry or active state |
| CV2-005 | P0 | Contract | Show frozen current content/version/hash and both signature states; correct owner signing guard/result | GET /contracts/:id; PATCH /sign | contractApi.js; RentalLifecycleIntegration.jsx; customerReservationService.js | Staff accepted inspection + generated contract; version-intent API decision | First signature is successful pending Facility; changed content requires new consent |
| CV2-006 | P0 | Balance | Add both-current-signature payment UI and request wrappers/allowlist; zero balance handling | POST balance, balance/mock-confirm | managedReservationApi.js; confirmedContract.js; RentalLifecycleIntegration.jsx | CV2-005, confirmed ledger | Correct credited amount; payment=null zero balance supported; CHECKIN_READY after settlement only |
| CV2-007 | P1 | Inventory creation | Separate registration/edit eligibility; include deposit-paid V2 and actual category/allocated Cell choices | Inventory create/me/item; policies/resolve | inventoryRegistration.js; InventoryBackendUI.jsx; InventoryItemForm.jsx; InventoryMapPreference.jsx | Deposit; backend preferred membership and edit/preview decision | Owner can register before ACTIVE; currentCellId null; no physical usage change |
| CV2-008 | P1 | First inbound/history | Replace demo movement path with owner request/read wrappers and receiving progress | POST inbound-request; GET movements | inventoryApi.js; confirmedContract.js; InventoryMovementRequestPage.jsx; InventoryHistoryPage.jsx; InventoryIntegration.jsx | CV2-007; Staff inspection/physical confirm UI | PENDING_INBOUND/RECEIVED distinguish stock; real immutable history; Customer cannot confirm |
| CV2-009 | P1 | Map safety | Enforce V2 explicit bookability/counter certainty and period projection, keep basket | GET map/detail-map | managedCellBooking.js; CellInformation.jsx; ManagedCellBooking.jsx | V2 DTO | false/missing certainty blocks even numeric0; multi-Rack/Zone/100 limit preserved |
| CV2-010 | P0 | Self Storage backend coordination | Define deposit/check-in consent/dual sign/balance/handover endpoints and safe activation | **Not supplied; no invented paths** | Shared lifecycle and SelfStorageMockPayment.jsx later | Backend implementation + approved contract | No Self ACTIVE/access without physical evidence and both signatures/settlement |
| CV2-011 | P0 | Role safety | Restrict legacy approve/mockPay/activate; add operator-generated contract/inspection/countersign flow separately | Existing management/Staff V2 APIs | Manager ReservationApiView.jsx; role API adapters, Staff pages | Assigned roles; authorized signatory policy | New V2 cannot approve or Manager-activate; Customer no Facility sign controls |
| CV2-012 | P1 | Status/detail/list | Full V2 grouped progress, item search/filter and actual Cell/inspection display | Own reservation/inventory reads | RentalLifecycleIntegration.jsx; RentalBackendUI.jsx; InventoryIntegration.jsx | State/DTO updates | No raw-status blind spot; correct date/deposit/signatures/intake/ownership |
| CV2-013 | P0 production / P2 receipts | Provider/payment ledger | Confirm PayOS checkout/webhook/status/history/refund contracts; no unverified generic wrapper calls | Backend confirmation required | paymentApi.js; PaymentHistoryPage.jsx | Payment backend | Real receipts only from real ledger; idempotent late/refund cases reconciled |
| CV2-014 | P2 | Other SRS | Extension/amendment/additional Cells, overdue, controlled outbound, checkout/refund | Missing backend contracts | RentalExtensionPage.jsx; movement/financial pages | CF-03/04/05/14/15 backend + policy | Paid amendments, no closure with stock, no policy-invented amounts |
| CV2-015 | P2 | Support/notification | Submit related record context; link real lifecycle events; avatar persistence separate | Existing support/notification, avatar contract missing | CustomerSupportIntegration.jsx; CustomerNotificationsIntegration.jsx; ProfileAvatar.jsx | Backend optional context / event coverage | Own related record links; no demo receipt or false avatar-save success |
| CV2-016 | P0 release | Acceptance | Static/fixture regression then isolated real DB acceptance | Confirmed routes only | Existing tests; new tests after authorization | Dedicated test environment + transactions/indexes + accounts/retention | No secrets; no mutation until gate; sequential/concurrent hold/deposit/balance/inbound verified |

Backlog is a proposal, not permission to edit application/Backend. P2 items are still required by full SRS; immediate MI-02C scope does not automatically include all of them.

## M. Regression Risk Assessment

| Area | Risk / required verification after authorized implementation |
|---|---|
| Whole frontend | Current shared imports are parse-blocked. Syntax repair first; old report PASS is historical |
| Self Storage | Global changes to PAID/CONTRACTED/deposit/sign guard can break legacy payment and access; service-specific contract is required |
| Managed selection | Preserve cached scope/range, cross-Rack navigation, uniqueIDs/1–100, fresh quote, stale selection and no silent retry |
| Authentication | Keep current client/session architecture; verify logout/401/stale-token results and payment key reset; no token-store redesign |
| Contracts | One-side DRAFT must not be treated as failure or full SIGNED; freeze and acknowledge exact version; preserve historical schema |
| Payments | Separate legacy mock, V2 mock deposit/balance and eventual gateway; no zero-value payment, duplicate keys or stale-route confirmations |
| Inventory | Creation eligibility differs from edit/preview; source counter certainty authoritative; custody not stock; movement idempotency/atomic activation |
| Manager / Staff | Existing approval screens legacy-only; V2 operator APIs need independent permission/Facility scope tests |
| Historical data | Absent bookingFlowVersion never inferred as2; retain CONTRACTED/PAID/single-sign snapshots without migrating data silently |
| Safety / database | No proof of runtime transactions/indexes; no live calls or database acceptance in this audit |

## N. Recommended Implementation Phases

0. **Restore parseability under separate authorized implementation scope.** Resolve CV2-001 first. Re-run build and current regression suites after repair; no approval to alter business logic is implied by this audit.
1. **Customer booking/deposit:** settle explicit version/state mapping and immutable money shape; repair V2 deposit navigation/client allowlist/recovery and map flag handling. Retain exact Unit and multi-Cell architecture. Keep legacy actions version-scoped.
2. **Physical contract/dual signing/balance:** align backend frozen-version intent, Staff inspection/contract generation and representative signing; then Customer view/sign and balance including zero-balance case. Self V2 requires its own confirmed backend contract before shared UI changes.
3. **My Inventory/first inbound:** enable deposit-paid create without loosening unsupported edit/preview rules; category/allocated preference; real inbound request/history; show inspection/custody/signature/balance/checkin-ready progress. Integration sequencing must allow these preparation APIs before testing Phase2's end-to-end contract generation.
4. **Other full-SRS features:** real payment records/provider, extension/amendment/extra Cells, overdue, outbound/checkout/refund, event navigation, support context and optional avatar persistence. Treat unsupported APIs as dependencies, not invented routes.
5. **Real backend E2E acceptance:** use approved isolated transaction-capable test DB, installed indexes, verified Customer A/B and assigned Manager/Staff, effective policies, minimal Cell set, idempotency ledger and retention policy. Execute individually; validate credited amounts, same-version signatures, first physical activation and concurrency/late/replay/cancellation cases. Historical safety gate remains **BLOCKED — TEST DATABASE SAFETY NOT VERIFIED** for mutations.

Before implementing Phase2: agree DRAFT+one-signature vs PARTIALLY_SIGNED semantics, CHECKIN_READY mapping, expected version/hash signing, mock vs gateway purpose records, Staff ownership of physical transitions, and Self-specific API scope. Do not wait to discover these by bypassing backend guards.

## O. Final Verdict

1. **Is current Customer FE compliant? NOT COMPLIANT.** Major lifecycle/financial/physical dependencies are missing or obsolete; current snapshot additionally has four source parse blockers.
2. **Most critical missing capability:** a reachable and correctly credited advance-rent deposit → dual-version-signature → balance → Staff physical activation flow. Existing partial deposit code is not a complete integration.
3. **New Customer APIs:** deposit and deposit/mock-confirm partially added but blocked; balance and balance/mock-confirm missing; inbound-request and movements absent from real Customer integration. CATEGORY is wrapper-only for this request. Operator contract/inspection/Facility signature are not Customer mutations.
4. **Existing APIs to update:** quote/detail/snapshot money mapping, reservation statuses/version routing, owner sign state guards/results, item registration eligibility/preferred selection, map explicit certainty flags and conditional cancellation rules. Keep correct paths/methods and shared Axios/session infrastructure.
5. **Already correct and to preserve:** exact private Unit identifiers, multi-Cell unique/geometric selection, date-aware map requests, scoped basket and uncertain-create reconciliation, owner-first detail/contract lookup, auth/identity/profile flow, no-stock registration semantics, support categories/replies, notification owner reads and ACTIVE SELF_STORAGE-only access guard. These are source-level strengths, not current runtime passes.
6. **Before Phase2:** restore syntax, make Phase1 deposit/money/version flow viable, agree current-version contract signing and prepare Staff first-intake dependencies; define Self V2 backend separately.
7. **Backend confirmation/development:** production PayOS/webhook/status/history/refund; Self V2 lifecycle and activation safeguards; preferred Cell membership; preactivation edit/preview scope; signing expected version/hash; partial-state semantics; post-ACTIVE payment replay contract; configured no-show/refund/zero-deposit/currency policies; real transaction/index/worker evidence.

Blocking decisions that source cannot answer:
- What approved deposit minimum/rate, tax/rounding, cancellation/no-show/refund/retention, check-in grace/rescheduling and empty-first-intake policy applies?
- Who may act as delegated Facility signatory, and is Customer-first order required?
- Should API signing acknowledge an expected frozen version/hash, and how should post-activation replay return idempotent payment results?
- What confirmed Self V2 and real PayOS/status/history contracts will be delivered, and when is an isolated authorized E2E environment available?

### Verification and changed-file record

Read the attached revised SRS (all 1144 OOXML body paragraphs, including blanks/table cells), entire PM collection (37 requests / 25 unique method+path routes, auth/bodies/query/assertion scripts) and ENV schema/public base. Previous reports were read as historical context; current source, all Customer routes and relevant actual API call sites were traced. BE-REF was inspected strictly read only. Source was compared, not inferred from filenames or prior fixture PASS.

Only new file: **FE docs/CustomerSRSV2GapAnalysis.md**. No source, route, CSS, animation, package, environment, test script, previous report or BE-REF file was edited. No original backend/ access; no dependency install, login, HTTP request, payment, seed, migration or database operation. Static checks emitted no files. A pure local confirmedContract allowlist probe (no Axios/network) additionally confirmed deposit, deposit/mock-confirm, balance, inbound-request and movements reject before network, while PATCH contract/sign is allowed.

Final SHA-256 preservation check compared **667 existing files**, including **174 BE-REF files**: zero existing files changed or missing; exactly one new file, this report. All BE-REF, application source, existing reports, environment/configuration and dependency manifests remain unchanged. The reference count differs from the historical October 13 count because this audit snapshots the current restored reference, not the older baseline.

