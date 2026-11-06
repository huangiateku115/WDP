# Phase 6A — API Contract Audit

Ngày:30/10/2026. **Audit source-level ONLY; chưa tích hợp Phase6B.** Kết quả:23/23 designs mapped,108 operation rows,86 unique verified method/path pairs. 86 includes Staff dependencies/management-only operations, not86 safe Customer APIs. No live connectivity/ownership/transaction/device verification claimed. All source/screens/client/fixtures/tests unchanged.

## Executive decision

Có đủ contract source để lập kế hoạch Customer auth ngắn hạn, public catalog, phần lớn owner-scoped reads, notification single-read và Support public conversation. Không đủ điều kiện bật end-to-end production booking/payment/signing/MI06 writes. **Không mở Axios transport**, không thay fixture, không tự sửa Backend.

P0: contract print missing ownership; Self ungated/non-atomic mock confirms; Self overlap omits actual deposit/check-in occupying states. P1: provider checkout/status/history absent; production V2/MI06 write gates off; no refresh endpoint; no reviewed-version compare-and-sign; Item form missing required itemCode; private support references not validated. Details and closure criteria in GAP_REGISTER.

## Source coverage and authority

- BE-REF accessible at C:/Users/laptop/Desktop/WDP/BE-REF. No .git metadata: branch/commit **UNVERIFIED**; do not consult parent repository or forbidden backend directory to guess. SHA-256 inventory of221 src/tests/docs files in PHASE6A_SOURCE_BASELINE.json pins reviewed contents; no secrets/.env read. Directory mtime is not revision evidence.
- API mounted /api/v1 via src/app.ts and src/routes/index.ts. All relevant routed families -> controllers -> validators/services -> types/models/gates reviewed. Backend tests read for behaviors (mocks/dist usage), **NOT executed**. No Backend server, seeds, build or DB command run.
- No revision-matched Swagger/OpenAPI file or explicit external spec reference found in inspected source/docs/README/package. No external Swagger call or Postman execution. Older docs mention PayOS/no-ledger/earlier lifecycle and are DOCUMENTED_ONLY/CONTRADICTORY when source differs.
- Website src/api and relevant inventory/auth/booking helpers are READ ONLY comparison, OBSERVED_IN_WEB_FRONTEND; a helper/allowlist/comment is not server proof.
- Mobile README/architecture/Phase1–5B reports/UI completeness/design-map/routes/models/forms/fixtures/stores/client/tests inspected. Current23 designs remain offline. MOBILE_FIXTURE_ONLY is never a contract.

Evidence vocabulary: VERIFIED_FROM_BACKEND_SOURCE; VERIFIED_BY_BACKEND_TEST (assertion source inspected, not live PASS); DOCUMENTED_ONLY; OBSERVED_IN_WEB_FRONTEND; MOBILE_FIXTURE_ONLY; UNVERIFIED; CONTRADICTORY; UNSUPPORTED. CSV primary levels:86 source,20 unsupported/missing operations,2 local-only interactions. Secondary tests/web/fixture evidence has separate columns. Unknown production configuration, source commit and topology remain UNVERIFIED rather than invented API rows.

## Inventory / support levels

| Support level | Operation rows | Interpretation |
|---|---:|---|
| READY_FOR_INTEGRATION | 17 | Source adequate for planning; includes2 local actions; not live-ready |
| PARTIALLY_SUPPORTED | 18 | DTO/lifecycle/ownership/product gaps require scoped resolution |
| BACKEND_BLOCKED | 17 | Missing provider/capability or production write gate |
| READ_ONLY_READY | 30 | Source-backed read adapter can be planned |
| NOT_SUPPORTED | 19 | Missing action or not a Customer operation |
| SECURITY_BLOCKED | 7 | Do not expose pending specific security/precondition fix |

47 rows are planning-ready/read-only (including2 local actions),18 partial,24 Backend/security-blocked,19 unsupported/excluded. Support level is operation-specific, not a whole-screen readiness stamp. All endpoints still require Phase6B tests, deployment confirmation and authorized environment. No CONTRACT_UNVERIFIED row was forced when source either proved a route or a negative search; deployment/session details themselves remain unverified.

## Screen-to-operation coverage

Full request/response/auth/status/gate/paging/error/version/retry/evidence/complexity/action fields are in PHASE6A_API_CONTRACT_MATRIX.csv (28 columns). Each row is a separately assessed operation; shared methods map multiple designs. Staff dependency rows are explicit excluded Customer actions. Local memory draft/preference rows have NO HTTP request. Proposed lifecycle commands can be catalogued even when prototype currently shows no enabled button; this is not a claim real commands are connected.

| Design | Native route | Operation IDs | Support levels |
|---|---|---|---|
| 01 | /(tabs) (Home URL /) | USER-ME, FAC-LIST, RENTALS-MINE, ITEM-LIST, NOTIF-LIST, DASHBOARD | READ_ONLY_READY, READY_FOR_INTEGRATION, PARTIALLY_SUPPORTED |
| 02 | /(tabs)/explore | FAC-LIST, FAC-PRICING | READY_FOR_INTEGRATION |
| 03 | /preview/facility/:id | FAC-DETAIL, FAC-SIZES, FAC-PRICING, FAC-AMENITIES | READY_FOR_INTEGRATION, READ_ONLY_READY, PARTIALLY_SUPPORTED |
| 04 | /booking/:facilityId/units | FAC-SIZES, FAC-PRICING, UNIT-LIST, UNIT-GET, UNIT-PERIOD, PRICE-pricing-LIST, PRICE-policy-LIST | READ_ONLY_READY, READY_FOR_INTEGRATION, BACKEND_BLOCKED |
| 05 | /booking/:facilityId/review | PRICE-pricing-LIST, PRICE-pricing-RESOLVE, PRICE-pricing-GET, PRICE-policy-LIST, PRICE-policy-RESOLVE, PRICE-policy-GET, SELF-ESTIMATE | READ_ONLY_READY, PARTIALLY_SUPPORTED |
| 06 | /booking/:facilityId/confirmation | SELF-CREATE, MI-CREATE | SECURITY_BLOCKED, PARTIALLY_SUPPORTED |
| 07 | /managed/:facilityId/map | FAC-PRICING, PRICE-pricing-LIST, PRICE-policy-LIST, MI-QUOTE, MI-CAPACITY, MAP-FLOOR, MAP-RACK, MAP-MGMT | READY_FOR_INTEGRATION, READ_ONLY_READY, NOT_SUPPORTED |
| 08 | /managed/:facilityId/review | FAC-PRICING, PRICE-pricing-LIST, PRICE-pricing-RESOLVE, PRICE-pricing-GET, PRICE-policy-LIST, PRICE-policy-RESOLVE, PRICE-policy-GET, MI-QUOTE, MI-CREATE, MI-CAPACITY | READY_FOR_INTEGRATION, READ_ONLY_READY, PARTIALLY_SUPPORTED |
| 09 | /(tabs)/rentals | RENTALS-MINE | READ_ONLY_READY |
| 10 | /preview/rental/:id | SELF-DETAIL, SELF-CANCEL, MI-DETAIL, MI-CANCEL, STAFF-HANDOVER | PARTIALLY_SUPPORTED, READY_FOR_INTEGRATION, READ_ONLY_READY, NOT_SUPPORTED |
| 11 | /rentals/:id/contract | CONTRACT-MINE, CONTRACT-BY-RES, CONTRACT-GET, CONTRACT-SIGN, CONTRACT-PRINT, CONTRACT-PDF, STAFF-MI-CONTRACT, STAFF-SIGN, STAFF-PAPER | READ_ONLY_READY, SECURITY_BLOCKED, NOT_SUPPORTED |
| 12 | /rentals/:id/payment | MI-deposit-INIT, MI-deposit-MOCK, MI-balance-INIT, MI-balance-MOCK, SELF-deposit-INIT, SELF-deposit-MOCK, SELF-balance-INIT, SELF-balance-MOCK, LEGACY-SELF-PAY, LEGACY-MI-PAY, PROVIDER-CREATE, PROVIDER-STATUS, PROVIDER-HISTORY, PROVIDER-WEBHOOK, PROVIDER-RETURN, PROVIDER-REFUND, STAFF-PAPER | BACKEND_BLOCKED, PARTIALLY_SUPPORTED, SECURITY_BLOCKED |
| 13 | /(tabs)/inventory | ITEM-LIST, STOCK-GET | READ_ONLY_READY |
| 14 | /preview/item/:id | ITEM-GET, ITEM-PREVIEW, STOCK-GET | READ_ONLY_READY, PARTIALLY_SUPPORTED |
| 15 | /inventory/register; /inventory/edit/:id | ITEM-CREATE, ITEM-EDIT, ITEM-FIRST-IN, ITEM-PREVIEW, IMAGE-UPLOAD, IMAGE-DISCARD | PARTIALLY_SUPPORTED, READY_FOR_INTEGRATION, BACKEND_BLOCKED |
| 16 | /inventory/:id/inbound | ITEM-FIRST-IN, INBOUND-CREATE, INBOUND-LIST, INBOUND-DETAIL, INBOUND-AMEND, INBOUND-CANCEL, STAFF-FIRST-IN, STAFF-REPEAT-IN | READY_FOR_INTEGRATION, BACKEND_BLOCKED, READ_ONLY_READY, NOT_SUPPORTED |
| 17 | /inventory/:id/outbound | ITEM-LEGACY-OUT, STOCK-GET, OUTBOUND-CREATE, OUTBOUND-LIST, OUTBOUND-DETAIL, OUTBOUND-CANCEL, OUTBOUND-AMEND, STAFF-CANONICAL-OUT | NOT_SUPPORTED, READ_ONLY_READY, BACKEND_BLOCKED, READY_FOR_INTEGRATION |
| 18 | /inventory/:id/history | MOVEMENTS | READ_ONLY_READY |
| 19 | /notifications | NOTIF-LIST, NOTIF-READ, NOTIF-ALL, NOTIF-COUNT, NOTIF-DETAIL, NOTIF-DELETE, NOTIF-PUSH, NOTIF-DESTINATION | READ_ONLY_READY, READY_FOR_INTEGRATION, NOT_SUPPORTED |
| 20 | /support; /support/new; /support/:requestId | SUPPORT-LIST, SUPPORT-GET, SUPPORT-CREATE, SUPPORT-PATCH, SUPPORT-MESSAGES, SUPPORT-REPLY, SUPPORT-STATUS, SUPPORT-ATTACH, SUPPORT-DRAFT | READ_ONLY_READY, PARTIALLY_SUPPORTED, READY_FOR_INTEGRATION, NOT_SUPPORTED |
| 21 | /(tabs)/profile | AUTH-LOGOUT, AUTH-REFRESH, USER-ME, USER-PROFILE, USER-PASSWORD, IDENTITY-GET, IDENTITY-PUT, USER-AVATAR, LOCAL-PREFERENCES | PARTIALLY_SUPPORTED, BACKEND_BLOCKED, READ_ONLY_READY, READY_FOR_INTEGRATION, NOT_SUPPORTED |
| 22 | /(auth)/login (URL /login) | AUTH-LOGIN, AUTH-LOGOUT, AUTH-REFRESH, AUTH-FORGOT, AUTH-RESET, USER-ME | READY_FOR_INTEGRATION, PARTIALLY_SUPPORTED, BACKEND_BLOCKED, READ_ONLY_READY |
| 23 | /(auth)/register (URL /register) | AUTH-REGISTER | READY_FOR_INTEGRATION |

## Contract handbook (source evidence IDs)
 
### Auth/profile — E-AUTH/E-USER/E-PROFILE
 
JSON tokens + Authorization Bearer, not cookie-only. Local active User.role authorizes Customer; Managed booking additionally VERIFIED identity. No application refresh route. Native login can be planned without website cookies, but provider/client/lifetime/revocation/audience policy unknown. Register displayName maps mobile name; phone optional in service; confirmation/consent not posted. Keycloak sets emailVerified without verification flow. User and identity Profile differ; identity GET creates missing profile. Password recovery OTP source exists but security issues must be reviewed. Native storage/session design in SECURITY_AND_OWNERSHIP and Phase6B plan, not implemented.
 
### Facility/Unit/map — E-CATALOG/E-UNITS/E-MAP/E-PRICING
 
Public catalog returns nested address/serviceTypes/images and sanitized contact, no invented amenities/monthly price. Storage options count current AVAILABLE by size and explicitly informational. Exact Units require authenticated list/detail; no date-range discovery query. Customers must never use management WarehouseZone/Rack/Cell CRUD lists as their API.
 
Sanitized map returns zones -> aisles -> racks; Rack mapX/mapY/orientation/dimensions and Cell levelNumber/cellNumber are actual structural fields. Zone has no physical polygon/coordinates/floorplan extents/unit convention. This is PARTIAL geometry support, not absence of all coordinates. Map interval requires paired canonical toISOString() string (.sssZ); Managed quote parser permits Z with/without milliseconds. Preserve Rack/Cell identity/positions, no authoritative fake zone geometry.
 
Cell operationalStatus, bookingStatus/displayStatus, periodStatus and physical utilization are distinct. Source may return display AVAILABLE yet period RESERVED. Use periodStatus for interval presentation and exactly isBookable=true for selection. isMine/hasMyInventory do not grant selection; OCCUPIED comes from physical/allocation evidence, not ownership alone. Unknown physicalUsageKnown/counters never becomes0.
 
### Booking/date/price/lifecycle — E-SELF/E-MANAGED
 
Self DTO:{facilityId,storageUnitId,startDate,endDate,pricingPolicyId}; derives Customer; Unit bookingVersion + transaction, half-open overlap predicate but incomplete occupying state set. Hold24h. start must be strictly future instant, end>start. Estimate uses ceil(elapsedDays), price/30 prorating, monthly/halfmonthly advance rule, no resource binding on supplied policy ID. These are verified current formulas, not a recommendation to keep business defects.
 
Managed DTO:{facilityId,allocatedCapacityM3,startDate,term:{value,unit},cellIds}; create requires1..100 unique exact Cell IDs; own VERIFIED profile; configured capacity and Cells locked transactionally; physical counters known empty, active Rack/Zone, no period conflict. V2 under dev gate only; Cell HOLD until confirmed deposit. Server recomputes selected volumes and quote; price is term-specific PER_M3*allocatedCapacity, NOT monthly*months; deposit configured percentage of whole rent, V2 integer half-up. UTC DAY/MONTH/YEAR calendar clamping; no client endDate allowed. Cancellation only RESERVED/CONTRACTED and no refund inference.
 
Backend ReservationStatus:RESERVED,DEPOSIT_PAID,CHECKIN_READY,CONTRACTED,PAID,ACTIVE,OVERDUE,CHECKED_OUT,CLOSED,CANCELLED. Mobile three rental status labels are presentation-only and cannot decide payment/access. Self staged source:RESERVED -> DEPOSIT_PAID/DRAFT -> Staff signed paper CHECKIN_READY -> balance PAID -> Staff handover ACTIVE. Managed V2:RESERVED -> deposit DEPOSIT_PAID -> item registration/first inbound request/inspection -> frozen contract -> two current signatures -> balance CHECKIN_READY -> Staff physical first inbound ACTIVE. Legacy CONTRACTED/PAID/activate is separate; never silently substitute it. Payment/signing do not independently confirm handover/first inbound.
 
### Contracts — E-CONTRACT/E-CHECKIN
 
Owner-safe list/detail/byReservation available. Self paper signedProofUrl and legacy customer-only sign do NOT imply Managed V2 two-party/hash guarantees. V2 creation Staff/FM assigned Facility, DEPOSIT_PAID + accepted inspection/current handover snapshot, version+SHA256 contentHash+signature entries. One signature remains Backend DRAFT; PARTIALLY_SIGNED is a derived UI label only. Facility must sign after Customer current signature. Changed content produces new version, old signatures excluded. However sign request lacks expected reviewed version/hash and may regenerate before signing, so safe Customer signing BLOCKED. No CA/certification/contract OTP/provider signatures verified. Print JSON endpoint lacks ownership: SECURITY_BLOCKED; pdfUrl optional model field not PDF generation.
 
### Payments — E-PAYMENT/E-DEPOSIT/E-CHECKIN/E-SELF_PAYMENT
 
Active snapshot contains MOCK stage flows, no implemented PayOS checkout/webhook/status/history/refund/deep-link return. PAYOS enum/comments/SRS are not provider capability. Provider success cannot be inferred from redirect. Current Backend PaymentStatus:PENDING,SUCCEEDED,FAILED,RECONCILIATION_REQUIRED. Mobile EXPIRED_DEMO/settlement flags not Backend enum.
 
DEPOSIT/BALANCE separate ledger purposes, advance rent credit (not extra refundable security). Server totalDue=rent+tax-discount; depositCredit<=totalDue; balanceDue=totalDue-depositCredit. Display returned breakdown, do not claim credited confirmation merely from amount due. Managed balance validates actual SUCCEEDED matching deposit + both current signatures; zero balance settles explicit CHECKIN_READY with payment:null, no0-VND record. Real payment record/status reads absent: Reservation payment IDs/status alone cannot fill all fixture payment details.
 
Managed initiation BODY idempotencyKey <=160, confirmation reuses SAME key and verifies economics/owner/provider. Deposit late hold expiry -> RECONCILIATION_REQUIRED, no reclaim/occupancy. Balance confirmation->CHECKIN_READY only. Both gated development+MI_MANAGED_DEPOSIT_FLOW_ENABLED. Self initiation breakdown only, no ledger row or checkout; Self mock confirms have no verified environment gate, timestamp keys and nontransactional writes. Keep them locked; frontend flags do not fix Backend.
 
### Inventory/stock/movements — E-ITEM/E-IMAGE/E-STOCK
 
Quantity units are nonempty strings up to32 characters, not the four UI fixture choices. UI 3-decimal input limits are not a universal Backend measurement precision rule. Do not silently round real data to fit a fixture schema.

Create required:itemCode,name,category,quantity safe integer,quantityUnit,unitWeightKg,unitDimensionsM,managedReservationId; optional description/preferredCellId/images. Item codes cannot be fabricated from fixture IDs. Create REGISTERED/unplaced, no confirmed stock. Registration eligible ACTIVE or V2 DEPOSIT_PAID (future end); normal edit ACTIVE + unplaced REGISTERED; V2 rejected-inspection/no-contract exception narrowly defined. Preferred Cell is advice, not physical placement or reserved resource permission. Image upload/attachment is owned, Idempotency-Key/file proof, max10 images/8MiB, production503 until private delivery policy.
 
StockBalance GET returns actual initialized projection/batches/onHandQuantity/heldQuantity/source/version. Customer parent Item owner enforced. Missing404 ITEM_PROJECTION_MISMATCH means unknown, not0. No synthesized initialized stock from Item.quantity or frontend movement fold. Available may be displayed from validated same-unit onHand-held; Backend validates hold/reconciliation for commands. Actual batch physical dimensions/weight may differ; preserve per-batch measurements/source lineage and arithmetic policy. Backend helper uses exact decimal BigInt precision units/canonical rounding (weight3,volume6 in aggregation), legacy COMPATIBILITY and CANONICAL_V1 accepted only with known schema. Client display does not reimplement stock accounting.
 
Movement history owner via parent Item, unpaginated sorted performedAt/_id desc; schemaVersion/arithmeticPolicy/batchLines optional. Customer DTO omits performedBy/customerId and uses sourceCellId/destinationCellId, not display codes. No Staff identity or measurement guess; physical relocation/fulfillment endpoints remain Staff only.
 
### Repeated inbound/canonical outbound — E-INBOUND/E-OUTBOUND/E-STOCK
 
First inbound singular transitions REGISTERED->PENDING_INBOUND only. Repeated plural create requires reconciled first history and ACTIVE in-term Managed, supports stored or fully checked-out reconciled item, physical payload requestedQuantity/quantityUnit/declaredUnitWeightKg/declaredUnitDimensionsM. No note. Create/amend opt-in nonproduction, request state/custody/inspection/version separate; only untouched PENDING_INSPECTION+NOT_TAKEN+no attempt can amend/cancel. Request DTO/state not mobile *_DEMO enum.
 
Canonical outbound create ONLY requestedQuantity, positive safe integer, real reconciled available stock/currentCell/allocation; FIFO batch holds atomically, onHand unchanged. Cancel PENDING releases holds without physical REMOVE. Staff confirm actual quantity creates one REMOVE, releases unused hold, terminal CONFIRMED/PARTIALLY_FULFILLED; full removes placement. No Customer amendment endpoint; never legacy outbound fallback.
 
Header Idempotency-Key regex8..128 differs from payment body key. Cancel/amend If-Match quoted nonnegative version (weak accepted), missing428/stale409. Create201/replay200 + ETag; replay uses persisted economic/payload/event identity and rejects changed payload409. 503 UNKNOWN_COMMIT/outcome unknown -> same payload/key/version, not duplicate/new key. Gate disabled responses differ: repeated create404 INBOUND_REQUEST_FEATURE_DISABLED; canonical503 OUTBOUND_REQUEST_FEATURE_DISABLED. Reads and cancels deliberately not same creation gate; no claim all methods disabled production.
 
Gate names/defaults:
 
| Name | Source behavior / affected operation |
|---|---|
| MI_MANAGED_DEPOSIT_FLOW_ENABLED | strict true + NODE_ENV development for V2 marker/deposit/check-in/sign/balance; default false |
| MI_MOCK_PAYMENT_ENABLED | legacy Managed mock-pay true and not production; not V2/provider |
| MI06_REPEATED_INBOUND_ENABLED | trim/lower true, forced false production; create/amend and Staff repeated ops, not Customer history/cancel |
| MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED | opt-in, production forced false; new holds need ledger flag too |
| MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED | separate Staff confirm opt-in, production false; ledger writes also needed |
| MI06_STOCK_LEDGER_WRITES_ENABLED | explicit true, nonproduction for physical ledger writes; source config not deployment evidence |
| Image delivery production policy | current upload explicitly503 in production, no frontend flag override |
 
No values from .env were read. No claim any gate is enabled on a running deployment.
 
### Notifications / Support — E-NOTIFICATION/E-SUPPORT
 
Notification only GET me/PATCH id read, owned for any active role, unpaginated. type/title/content/isRead/sentVia, no typed destination or detail/count/bulk/delete/push/WebSocket contract. UI mark-all is local-only until explicitly designed partial-failure single-read orchestration; no invented atomic endpoint.
 
Support real APIs do include Customer public conversation and replies. Categories RENTAL/ACCESS/PAYMENT/ITEM/LOCATION/OTHER, priorities LOW/MEDIUM/HIGH/URGENT, states OPEN/ASSIGNED/IN_PROGRESS/RESOLVED/CLOSED. Subject1..200/description1..5000; one optional relatedEntity, not mobile rentalId+itemId fields. Parent owner404, Customer messages force isInternal:false/filter internal messages out. Generic related private IDs not owner-validated, raw ticket may include assignment/escalation fields that mobile mapper must omit. Customer may edit own OPEN subject/description only; no Staff status/assignment controls. Reply service no explicit CLOSED rejection; clarify policy. No attachments or message idempotency contract. Ticket draft remains memory-only, not server reference.
 
## Deliverable index / acceptance
 
CSV machine-readable operation matrix; Evidence240+ exact anchors; Security matrix; Drift28 findings; Gap register prioritized closures; Phase6B ordered adapter/security/device/rollback plan; final report and preservation JSON. README unchanged intentionally because all deliverables linked from audit/report. All23 source components/routes validated by existing completeness checker. No source/API/auth behavior changed or Phase6B implemented.

