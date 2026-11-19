# Managed Inventory V3 — Post-Pull Backend Full Re-Audit

**Task:** `WDP_MANAGED_V3_POST_PULL_BACKEND_AUDIT`  
**Audit mode:** Strict read-only source audit  
**Checkpoint:** `WDP_MANAGED_V3_BACKEND_REAUDIT_REVIEW_REQUIRED`  
**Result:** `MANAGED_V3_BACKEND_AUDIT_PARTIAL`

> This report records the current source tree. Git could not access its configured worktree, so it is not possible to attribute source changes to the recent pull. No application source, frontend, MongoDB data, environment file, or index was modified. `npm run build` generated/updated `backend/dist/`; this is the only intentional filesystem output beyond this report. No MongoDB, PayOS, or other external-service tests were run.

## A. Git baseline

The requested read-only commands (`status`, branch, HEAD, log, reflog, remotes, top-level) all failed with `fatal: cannot change to 'C:/Users/laptop/Desktop/WDP'` while invoked from the Backend checkout. The current shell can read Backend files but Git cannot enter its configured worktree.

| Field | Result |
|---|---|
| Branch / HEAD / remote | `NOT_VERIFIED` |
| Before-pull commit | `PRE_PULL_BASELINE_UNVERIFIED` |
| After-pull commit | `NOT_VERIFIED` |
| Working-tree status | `NOT_VERIFIED` |
| Post-pull file/commit diff | `NOT_AVAILABLE` |

No claim is made that any current behavior or file was added by this pull. Prior reports are historical context only, not a verified before-pull baseline.

## B. Executive summary

- Managed V3 booking is a concrete Cell-selected flow: Customer quote and create, terms acceptance, verified profile, capacity/cell locks, time-bounded Cell holds, idempotency, and a `RESERVED` reservation. Source and unit tests exist; live E2E was not run in this audit.
- New Managed V3 bookings are `FULL_UPFRONT_V1`. PayOS `FULL_RENT` is the supported payment. Deposit/Balance are explicitly rejected for V3 in the PayOS service. A verified webhook atomically applies payment, converts holds, advances the reservation, and creates the contract snapshot.
- V3 contract and handover are paper-evidence/staff workflows. Full-rent V3 digital signature is explicitly unavailable. Staff/Manager confirms handover only after verified payment, current signed contract evidence, date/cell checks; this activates the rental. Customer Mobile can present state and documents, but cannot perform the staff action.
- Customer SKU and Item Specification APIs are present, owner-scoped, revision-aware, and transactional. Item registration is not the same as placing stock.
- Unified Inbound has context/preview/confirm source and a transactional canonical ADD writer, but Confirm returns `503 INBOUND_CONFIRM_ENVIRONMENT_BLOCKED` whenever `NODE_ENV=production`. A1 Physical Unit preparation/list routes separately return `410 STOCK_WORKFLOW_NOT_AVAILABLE`; an A1 UI cannot complete its prerequisite through these routes. A2 has the clearer source path, subject to production guard and runtime verification.
- Direct Customer Outbound and Relocation have context, preview, operation lookup, transaction writers, Access Session scope checks, idempotency and revision fences. Unit coverage is substantial, but this audit did not verify current MongoDB E2E.
- V3 stock is movement-derived and compared with a persisted projection. `LEDGER_REPLAY_UNKNOWN` and related reconciliation `503`s remain intentional fail-closed outcomes when legacy or incomplete history cannot be reconciled. They are not proof of a currently corrupt database.
- Managed V3 has a read-only closure-readiness endpoint, but no closure request/confirm/release API was found. No Managed V3 renewal API/service was found. These are backend gaps.
- Warehouse-wide `/rack-cells/:id/stock` is restricted to ADMIN/BOM/Facility Manager. Customer stock reads are SKU/Reservation-scoped and passed through a customer-safe DTO.

## C. Post-pull change log

Because Git baseline and history were inaccessible, post-pull changes cannot be listed without guessing.

| File | Change type | Before pull | Current source | Business / Mobile effect |
|---|---|---|---|---|
| All Backend files | `UNVERIFIED` | `PRE_PULL_BASELINE_UNVERIFIED` | Audited by source path and functions below | No pull attribution asserted |

Current high-impact source evidence (not a pull diff):

| Current source | Evidence | Business / Mobile impact |
|---|---|---|
| `src/routes/reservation.routes.ts:20-32`; `src/services/reservations/managed-reservation.service.ts:333,366` | Managed quote/create and supporting lifecycle routes; create persists booking flow v3 and full-upfront contract | Mobile can build booking against real DTOs; runtime still needs integrated verification |
| `src/services/payments/payos-payment.service.ts:524-570,830-984,1382+` | Managed full-rent checkout, idempotency, V3 purpose restrictions, verified webhook application | Customer can open Hosted PayOS and read status; never infer success locally |
| `src/services/inventory-items/managed-unified-inbound.service.ts:236-352` | Unified context/preview/confirm, canonical ADD, operation replay; production confirmation guard | Inbound UI may support read/preview; production Confirm is blocked |
| `src/services/inventory-items/managed-inventory-v3-outbound.service.ts:390-522` | Direct REMOVE service context/preview/confirm/operation | Outbound UI can be integrated in development after Access Session validation |
| `src/services/inventory-items/managed-inventory-v3-relocation.service.ts:309-421` | Direct MOVE context/preview/confirm/operation | Relocation UI can be integrated after development/runtime verification |
| `src/services/reservations/managed-closure-readiness.service.ts:87+` | Snapshot-only closure readiness; no request/release writer found | Can display readiness; cannot submit/complete closure |

## D. Full Managed Inventory business audit

### D1. Operating model and scope

| Question | Current-source finding | Evidence / Mobile impact |
|---|---|---|
| Who creates reservation? | Customer selects one or more Cells and creates a V3 reservation. | `ManagedReservationService.create`; quote requires selected Cell in HTTP controller path. |
| Who performs physical stock operations? | Customer direct V3 inbound/outbound/relocation requests are modeled, but each requires an active Staff-verified Access Session with operation purpose and Cell scope. | Inbound/outbound/relocation services call `assertManagedAccessSessionScope`; no per-operation Staff approval is evident in direct paths. Inbound production guard blocks Confirm. |
| Staff role | Staff schedules/assigns/checks in Visits, verifies Customer presence/identity/safety, creates/refreshes contract and confirms handover; Staff also has legacy receiving workflow routes, currently fail-closed for writes. | `access.routes.ts`, `managed-access.service.ts`, `managed-checkin.service.ts`, `managed-reservation.service.ts`. |
| Facility Manager | Can assign Visit staff and inspect facility sessions; can perform V3 contract/handover where assigned-facility rules pass. Also has diagnostics and management configuration. | Route role guards and facility-scope checks. No manager approval step is part of direct Customer stock operations. |
| Access Session | Still required. Check-in is Staff-only. It snapshots scoped Reservation/Cell IDs, allowed purposes and revision; overlap protection covers primary plus complete reservation scope. | `ManagedAccessService.checkIn`, `assertManagedAccessSessionScope`, `managed-access-session.model.ts`. Session checks include Customer, Facility, Reservation, purpose, Cell, time, revision. |
| Escort / attendance | Check-in records Staff manual attestation that identity, customer presence and safety were checked. Continuous escort behavior is not represented by the audited stock API contract. | Do not present a continuous escort feature as implemented without a separate source contract. |
| Allocation and footprint | Reservation holds selected Cells. V3 A1 Physical Unit has topology/pose/footprint placement; A2 batch stock has receipt placements across Cells. Reservation Cell allocation is not the same as actual item placement. | V3 ledger and placement models/services. A1 preparation HTTP route is currently blocked. |
| Stock source | Canonical V3 movements (`schemaVersion=4`, `stockEffect`) are replayed into persisted projections. Cell Stock/Item Instance and physical counters are reconciled separately. | `managed-inventory-v3-ledger.service.ts`, inbound/outbound/relocation writers and `managed-unified-inbound.service.ts`. |

### D2. Booking, map and reservation

- Route mount is `/api/v1` (`src/app.ts:33`). Managed reservation endpoints are under `/reservations/managed`.
- Quote validates dates, selected Cell membership/facility, operational state, known empty physical counters, configured volume, interval conflicts, active zone and available rack. Create requires selected Cells, idempotency key, current Terms acceptance and verified Customer profile. It recomputes the quote inside a transaction, locks facility capacity and Cells, writes reservation + Cell HOLD allocations + audit record atomically.
- The reservation snapshots pricing, term, dates, Cell IDs/volume, quota and booking version. A reservation starts `RESERVED`; holds have expiry. Conflicting booking is prevented by transactional fences/availability checks, but live concurrency behavior was not tested here.
- V3 API should use `/warehouse-map?facilityId=...` and `/racks/:id/detail-map`; the map service has reservation-scoped Customer read behavior. Customer cannot use the facility-wide `/rack-cells` listing, which is Staff/Manager/Admin/BOM only. The facility-wide cell-stock route is manager/oversight-only.
- Cell availability is period-aware; do not infer `isBookable` from color/status alone. Quote/create are authoritative. No separate V3 quote-expiration token was identified; reservation hold duration is configured in facility capacity.
- Facility discovery routes are authenticated but not role-restricted at the route. Backend filtering and active service type remain important; exact public/customer facility DTO behavior should be checked per endpoint before exposing extra fields.

### D3. Payment, contract and handover

- New V3 reservation records use `bookingFlowVersion: 3`, `rentalPaymentFlow: FULL_UPFRONT_V1`, zero deposit, full amount, terms acceptance and an expiring Cell hold.
- Payment service accepts `FULL_RENT` for new V3. `DEPOSIT`/`BALANCE` are rejected with `409 FULL_RENT_REQUIRED`. The route names controller methods `createSelfStorageCheckout`, but service validation explicitly supports only Self Storage or Managed V3 and differentiates their state rules; endpoint names should not be treated as contract semantics.
- PayOS webhook is public only to the provider callback and verifies signature before matching Payment. Managed V3 settlement uses transaction/session, immutable payment identity/amount, reservation/cell hold fences, duplicate capture handling and audit. Verified full rent moves reservation to `PAID`, promotes holds, and materializes a versioned/hash contract snapshot. It does not activate rental.
- Contract content includes reservation, cells, dates/capacity, price, facility, payment and terms snapshots. `FULL_UPFRONT_V1` V3 cannot use the digital signature path (`409`); facility staff confirms paper evidence through the contract proof route. Handover requires verified payment and current contract signatures/proof, valid date and allocation, then records staff actor/time and moves reservation to `ACTIVE`. The active reservation is not evidence that inventory has been inbounded.
- Existing legacy routes `/reservations/:id/mock-pay`, `/mock-pay-full`, `/deposit/mock-confirm`, `/balance/mock-confirm` remain in source with Customer/Manager/Admin roles. They are compatibility/mock surfaces, not valid payment routes for V3; V3 discriminator/business checks must remain in force. They should not be exposed for Managed V3 UI.

### D4. SKU, specification and catalog

- Customer can create/list/get/update SKU and list/create/update/delete Item Specifications using `/inventory-items` routes. Services enforce owner, reservation, Facility and active SKU scope; revisions use `If-Match`/revision checks where updates occur; writes use transactions where multiple records/images are attached.
- SKU creation route is `POST /inventory-items/`; specification CRUD is `/inventory-items/:skuId/specifications[/... ]`. Active category and quantity-unit selectors are `GET /managed-inventory-catalog/categories/active` and `/quantity-units/active`. Customer list is active-only; catalog mutation is Admin/BOM only.
- Item Specification is the quantity/measurement snapshot source for A2; request paths validate unit, weight and dimensions. Category/unit lookup does not itself prove physical stock placement.

### D5. Inbound

- Current Customer V3 routes are `GET /inventory-items/:id/v3/inbound/context`, `POST .../preview`, `POST .../inbound`.
- Preview validates SKU ownership, Reservation status, Item Specification/revision, Access Session/cell scope, capacity/topology and A1/A2 placement input. It is read/preview only.
- Confirm checks idempotency, preview/sku/session/inventory/topology revisions, geometry, level and cell capacity, Reservation capacity and canonical stock state. It writes ADD Movement, item instance or batch placements, Cell counters, Reservation counters and projection in one MongoDB transaction, then replays/reconciles before returning.
- **Production guard:** `ManagedUnifiedInboundService.confirm` immediately fails `503 INBOUND_CONFIRM_ENVIRONMENT_BLOCKED` for `NODE_ENV=production`. This remains a hard production blocker for Customer Inbound Confirm.
- **A1 additional blocker:** `POST/GET /inventory-items/:id/v3/physical-units` are wired to `phaseOneNoStockMutation` and return `410 STOCK_WORKFLOW_NOT_AVAILABLE`; `preparePhysicalUnit` itself also returns 410. The active Unified Inbound route therefore lacks a supported HTTP preparation path for the required `PREPARED` Physical Unit. A1 UI should not claim a complete inbound flow.
- Older registration/inbound/receiving write routes and repeated inbound customer/staff mutations currently return 410 through route guards. Keep these separate from Unified Inbound; do not route Mobile to them.

### D6. Outbound

- Direct V3 customer endpoints are `GET .../v3/outbound/context`, `GET .../operations`, `POST .../outbound/preview`, `POST .../outbound`.
- Confirm is a customer direct writer guarded by Idempotency-Key, If-Match revisions, active OUTBOUND Access Session scope, Reservation/Facility/customer ownership, stock/holds and transaction. It creates canonical REMOVE Movement and applies projection/cell/reservation effects atomically. A2 permits partial quantity and receipt FIFO allocation in the plan; A1 requires the complete physical-unit footprint.
- Legacy `/inbound-requests` outbound-request flow is a distinct Staff-confirmed request workflow; it uses canonical request/Movement support but should not be presented as the V3 direct flow. Legacy stock writer APIs return 410 or reject V3 mutation.
- Source/unit tests establish algorithmic coverage; no current MongoDB E2E was executed in this audit.

### D7. Relocation

- Direct V3 customer endpoints are `GET .../v3/relocation/context`, `GET .../operations`, `POST .../relocation/preview`, `POST .../relocation`.
- Confirm validates active Reservation ownership/same Facility, source stock and placement lineage, destination eligibility/capacity/topology/level, Access Session RELOCATION purpose and complete Cell scope, revisions and idempotency. Transaction writes MOVE Movement and projection/cell/reservation effects together; replay/unknown commit paths are explicit.
- Supports A2 quantity movement and preserves receipt lineage; A1 movement must preserve the complete physical-unit footprint. Relocation is not the unrelated legacy canonical-relocation endpoint/writer.
- Unit/domain suites exist; live integration was not performed here.

### D8. Ledger, stock, movement and endpoint privacy

- Canonical V3 ledger is replay of each SKU’s ordered Movement `stockEffect` ADD/REMOVE/MOVE events, including receipt IDs, batches/cells and PhysicalUnit placements. Projection stores a replay result and revision; reads compare replay result to projection.
- `LEDGER_REPLAY_UNKNOWN` remains in Unified Inbound’s fail-closed preflight at `managed-unified-inbound.service.ts:132`. Related `503` codes include `CAPACITY_RECONCILIATION_UNKNOWN`, `LEGACY_STOCK_UNRECONCILED`, `LEGACY_STOCK_SCOPE_UNKNOWN`, `CELL_STOCK_RECONCILIATION_UNKNOWN`, `CELL_ALLOCATION_RECONCILIATION_UNKNOWN`, `CELL_COUNTER_RECONCILIATION_UNKNOWN`, `RESERVATION_COUNTER_RECONCILIATION_UNKNOWN`, `CELL_CAPACITY_UNKNOWN`, `QUANTITY_UNIT_UNKNOWN`, `OUTCOME_UNKNOWN`, and `TRANSACTIONS_UNAVAILABLE`.
- Replay supports canonical A1/A2 placement and ADD/REMOVE/MOVE in the V3 ledger source. It can still reject legacy/incomplete/corrupt/unbounded input rather than silently fabricate a balance. This is a source-level statement, not a claim that every old database record replays.
- Customer SKU endpoints return owner-scoped stock; the controller applies `customerSafeStockDto`. `GET /inventory-items/:id/v3/movements` is owner-scoped for Customer, while staff readers are assigned-Facility scoped. Customer cannot use `GET /warehouse-map/rack-cells/:id/stock` because that route is restricted to ADMIN/BOM/Facility Manager and is facility-wide cross-customer diagnostic data.
- Do not expose rack-cell physical stock endpoint in Customer Mobile. Use the Customer SKU-scoped stock endpoint.

### D9. Access, roles and facility scope

- All protected routers use `requireAuth`; route role guards are listed in the endpoint matrix.
- Customer write services additionally re-fetch SKU/reservation and verify `customerId`; staff/manager services check `assignedFacilityId` or an authorized Facility representative. Several reads intentionally return 404 for foreign records to avoid disclosure.
- Visit creation and check-in are idempotent/revision-controlled. Check-in is Staff-only and records presence/safety attestations; session expiry is bounded by visit/rental boundaries and capped at 60 minutes. Current scope requires reservation end more than seven days from activation for stock operations.
- ACTIVE Session overlap protection is by the full Reservation scope, not only primary ID. Model declares unique partial indexes on primary and scoped reservation IDs; actual production index presence is not established by source audit.
- Admin/BOM may have oversight/management access, but Customer Mobile should only use Customer-scoped routes. The broad `/warehouse-map/rack-cells/:id/stock` route is not a customer surface.

### D10. Renewal and closure

- **Managed V3 renewal:** `NOT_IMPLEMENTED`. Self Storage renewal routes exist (`/:id/renew-quote`, `/:id/extension-request`, extension PayOS, extension-contract confirm/reject/cancel), but the Managed V3 service has no renewal/extension path. Existing payment service only permits `RENEWAL` for Self Storage ACTIVE reservation/extension. Do not reuse Self Storage renewal as V3 support.
- **Closure:** only `GET /reservations/managed/:id/closure-readiness` was found. It is a snapshot/read-only diagnostic that scans inventory, movements, balance, allocations, pending inbound/outbound and contract/payment state. No Managed V3 closure request, confirmation, contract-close, Cell release, refund, or forced-close writer was found. Readiness is not closure completion.
- Overdue/capacity commitments have source-level handling in booking/capacity logic; no customer closure endpoint means Cell release lifecycle cannot be completed from Mobile.

## E. Endpoint inventory for Customer Mobile

Prefix for all rows is `/api/v1`. DTO descriptions below identify the accepted source contract at a functional level; route/controller methods wrap most success responses as `{ success: true, data }`. Status does not imply live E2E.

| Feature | Method / endpoint | Role | Request / response (source) | Status | Mobile screen / note |
|---|---|---|---|---|---|
| Facility discovery | `GET /facilities`, `GET /facilities/:id` | Authenticated; no explicit route role | Query / Facility DTO | `VERIFIED_SOURCE` | Explore / Facility Detail; validate active Managed service in returned data |
| Warehouse Map | `GET /warehouse-map?facilityId=...` | Authenticated; service applies Customer map scope | facility/query filters → scoped zone/rack/cell map | `PARTIAL` | Warehouse Map; Customer map is allowlisted/scoped, not facility-wide inventory |
| Rack map detail | `GET /racks/:id/detail-map` | Authenticated, service authorization | Rack ID/query → rack/cell map | `VERIFIED_SOURCE` | Cell detail; must honor service access scope |
| Cell list/detail | `GET /rack-cells`, `GET /rack-cells/:id` | Admin/BOM/FM/Staff | query/ID → Cell records | `VERIFIED_SOURCE` | Not Customer browse API |
| Cell selection/quote | `POST /reservations/managed/quote` | Customer | facilityId, selected cellIds, term/date, terms data → priced/capacity quote | `TESTED` | Booking Review; quote authoritative, no client price |
| Managed booking | `POST /reservations/managed` | Customer | quote fields + Terms acceptance + `Idempotency-Key` → Reservation/quote | `TESTED` | Booking Review/Confirmation; transaction/holds source exists |
| Capacity read | `GET /reservations/managed/capacity/:facilityId` | Customer, Staff, FM, Admin, BOM (scope for Staff/FM) | date interval → capacity/commitments | `VERIFIED_SOURCE` | Booking; availability estimate only |
| Reservation detail | `GET /reservations/managed/:id` | Customer/Staff/FM/Admin/BOM | ID → reservation (owner/facility checks) | `VERIFIED_SOURCE` | Reservation Detail |
| Cancel hold | `PATCH /reservations/managed/:id/cancel` | Customer | ID → reservation state | `VERIFIED_SOURCE` | Reservation Detail; eligibility is backend-controlled |
| Full-rent checkout | `POST /reservations/managed/:id/payments/payos` | Customer | purpose/idempotency/client channel → PayOS payment DTO | `TESTED` | Payment; V3 uses FULL_RENT; Deposit/Balance get `409 FULL_RENT_REQUIRED` |
| Payment history/status | `GET /reservations/managed/:id/payments/payos`; `GET .../payments/:paymentId`; `POST .../reconcile` | Customer | cursor/payment ID → status DTO/history | `VERIFIED_SOURCE` | Payment Detail; owner-scoped; no live provider test here |
| Webhook | `POST /payments/payos/webhook` | PayOS signed callback | Provider payload/signature → applied/reconciled result | `TESTED` (unit) | Not called by Mobile; external runtime unverified |
| Contract creation | `POST /reservations/managed/:id/contract` | Staff/FM | reservation ID → contract snapshot | `VERIFIED_SOURCE` | Customer Contract read after payment |
| Contract read | `GET /contracts/reservation/:reservationId`, `GET /contracts/:id`, `GET /contracts/:id/print` | Customer/Staff/FM/Admin/BOM; owner/facility checks in controller/service | ID → versioned contract/proof DTO | `VERIFIED_SOURCE` | Contract Detail |
| Managed contract sign | `PATCH /contracts/:id/sign` | Customer | contract ID → signature/state for supported flows | `PARTIAL` | V3 full-upfront is explicitly rejected for digital signature; paper proof path applies |
| Facility signature/proof | `PATCH /contracts/:id/sign/facility`; `POST /contracts/:id/confirm-signed-paper` | Staff/FM; proof route includes Admin | signature or multipart proof → contract state | `VERIFIED_SOURCE` | Staff-only; customer can display verified result |
| Handover | `POST /reservations/managed/:id/handover` | Staff/FM | condition/access notes → ACTIVE reservation | `VERIFIED_SOURCE` | Customer sees status; no Customer action |
| Visit / Access Session | `/access/managed-v3/visits*`, `/access/managed-v3/sessions*` | Customer for own visit/session; Staff check-in; FM assignment; staff/FM session ops | visit DTO, purpose, date, IDs, idempotency/revision | `TESTED` | Visit/session screens; session required before stock writes |
| SKU create/list/detail/update | `POST /inventory-items/`, `GET /inventory-items/me`, `GET/PATCH /inventory-items/:id` | Customer for own SKUs | SKU DTO / paginated list / `If-Match` update | `TESTED` | Inventory List, Register Item, Item Detail |
| Item Specification | `GET/POST /inventory-items/:skuId/specifications`, `PATCH/DELETE .../:specId` | Customer owner | spec body incl. category/unit/measurements; revision on updates | `TESTED` | Register/Edit Specification; real Customer API exists |
| Catalog selectors | `GET /managed-inventory-catalog/categories/active`, `GET .../quantity-units/active` | Customer/Admin/BOM | active catalog DTO | `VERIFIED_SOURCE` | SKU/Specification forms |
| Physical Unit prep | `GET/POST /inventory-items/:id/v3/physical-units` | Customer route, but handler is disabled | A1 physical unit DTO | `BLOCKED` (`410 STOCK_WORKFLOW_NOT_AVAILABLE`) | A1 inbound prerequisite unavailable via HTTP |
| Unified inbound context/preview | `GET /inventory-items/:id/v3/inbound/context`, `POST .../preview` | Customer owner | session/spec/A1/A2 placements/revisions → context/preview DTO | `PARTIAL` | Inbound; source exists, production Confirm is blocked |
| Unified inbound confirm | `POST /inventory-items/:id/v3/inbound` | Customer owner | preview DTO + `Idempotency-Key` → ADD movement/operation | `BLOCKED` in production (`503 INBOUND_CONFIRM_ENVIRONMENT_BLOCKED`) | Do not claim production inbound success |
| Legacy inbound | `/inventory-items/:id/inbound-request`, `/confirm-inbound`, `/inbound-requests/*` mutation paths | Customer or Staff by route | Legacy request/receiving payload | `DEPRECATED` / `BLOCKED` | Several return `410 STOCK_WORKFLOW_NOT_AVAILABLE`; do not use for V3 |
| Direct outbound | `GET /inventory-items/:skuId/v3/outbound/context`, `/operations`; `POST .../preview`, `POST .../outbound` | Customer owner | quantity/receipt/Cell/session/revisions; confirm requires Idempotency-Key and If-Match | `TESTED` | Outbound screen; source/unit tests, live integration not verified here |
| Relocation | `GET /inventory-items/:id/v3/relocation/context`, `/operations`; `POST .../preview`, `POST .../relocation` | Customer owner | source/destination Cell, qty, session/revisions; confirm idempotent/fenced | `TESTED` | Relocation screen; live integration not verified here |
| SKU stock | `GET /inventory-items/:id/v3/stock`, `/v3/cell-stock`, `/v3/specifications/:specId/cell-stock` | Customer/Staff/FM/Admin/BOM by route; service owner/facility scope | SKU/spec ID → safe stock projection/read model | `TESTED` | Item Detail/Stock; Customer-safe mapping |
| Facility cell stock | `GET /warehouse-map/rack-cells/:id/stock` | Admin/BOM/Facility Manager only | cell ID → facility-wide stock diagnostics | `VERIFIED_SOURCE` | **Not for Customer Mobile** |
| Movement history | `GET /inventory-items/:id/v3/movements` | Customer owner + scoped readers | SKU ID → movements (bounded) | `TESTED` | Movement History; source exists |
| Managed renewal | No V3 route/service | — | — | `NOT_IMPLEMENTED` | Mobile should show unavailable/request support, not reuse Self Storage renewal |
| Closure readiness | `GET /reservations/managed/:id/closure-readiness` | Customer/FM/Admin/BOM | reservation ID → blockers/readiness snapshot | `VERIFIED_SOURCE` | Closure screen can display only |
| Closure request/release | No V3 request/confirm/release route found | — | — | `NOT_IMPLEMENTED` | Cannot complete closure or release Cells |
| Notifications | `GET /notifications/me`, `PATCH /notifications/:id/read` | Authenticated; user-scoped service | paginated notifications / read state | `VERIFIED_SOURCE` | Notifications |

Errors evidenced in source include `400` malformed input/terms, `403` role/profile, `404` missing or foreign scope, `409` conflict/eligibility/idempotency, `410 STOCK_WORKFLOW_NOT_AVAILABLE`, `412` stale revision, `422` invalid placement/input, `503` production inbound guard, reconciliation/capacity unknown, or unavailable transactions. Exact error payload is operation-specific; Mobile should preserve code/status distinction.

## F. Business flow readiness matrix

| Business flow | API | Business logic | Authorization | Tests | E2E | Mobile readiness |
|---|---|---|---|---|---|---|
| Managed V3 booking | Present | Quote + transactional holds + idempotency + snapshot | Customer + verified profile/terms | Unit suites pass in selected run | Not run in this audit | `READY_FOR_MOBILE_UI`; `READY_FOR_MOBILE_INTEGRATION`; runtime verification still needed |
| Full Payment | Present | FULL_RENT only for new V3; verified webhook transaction | Customer-owned V3 reservation; provider signature | selected PayOS tests mostly pass; one fixture failure | Not run | `READY_FOR_MOBILE_UI`; `READY_FOR_MOBILE_INTEGRATION`; `NEEDS_RUNTIME_VERIFICATION` |
| Contract | Present | version/hash snapshot; V3 paper proof; digital sign unavailable for full-rent | owner and staff facility scopes | source/tests, but full-rent mock test has fixture gap | Not run | `READY_FOR_MOBILE_UI`; paper proof/handover integration `NEEDS_RUNTIME_VERIFICATION` |
| Handover | Staff route present | prerequisites + transaction → ACTIVE | Staff/FM facility representative | source and surrounding tests | Not run | Customer status UI ready; action is staff-only |
| Access Session | Present | visit/check-in/revoke/expiry/revision/full reservation scope | Customer owns Visit; Staff check-in; assigned Facility checks | unit tests, one stale fixture failing | Not run | `READY_FOR_MOBILE_UI`; `NEEDS_RUNTIME_VERIFICATION` |
| Register inventory SKU | Present | owner/Reservation checks, revision-aware update | Customer owns Reservation/SKU | selected SKU tests | Not run | `READY_FOR_MOBILE_UI`; `READY_FOR_MOBILE_INTEGRATION` |
| Item Specification | Present | active category/unit, measurement contract, owner checks | Customer owns SKU/reservation | selected SKU/spec tests | Not run | `READY_FOR_MOBILE_UI`; `READY_FOR_MOBILE_INTEGRATION` |
| First Inbound A1 | Preview/confirm routes plus disabled Physical Unit routes | transactional ADD exists but no routed preparation; production confirm guard | customer + session | domain tests; prod guard test | Not run | `BLOCKED_BY_BACKEND` (A1 preparation 410 + production Confirm 503) |
| First Inbound A2 | Context/preview/confirm | transactional ADD + receipt placements/projection/capacity | owner + inbound Access Session + revisions | unified inbound tests | Not run | `READY_FOR_MOBILE_UI` for preview; `BLOCKED_BY_BACKEND` for production confirm; development integration needs verification |
| Repeated Inbound | Legacy inbound-request + Staff receipt paths | mutation routes fail closed/feature gated; not equivalent to direct Unified A2 inbound | Customer/Staff route split | foundation tests only | Not run | `BLOCKED_BY_BACKEND` for production repeated receipt |
| Multi-Cell placement | Unified inbound preview/confirm | A2 multi-cell and A1 footprint logic; topology/capacity | session Cell scope | domain tests | Not run | A2 preview `READY_FOR_MOBILE_UI`; confirm limited as above; A1 blocked |
| Partial Outbound | Direct V3 outbound | REMOVE, FIFO receipt allocations, holds, transaction and replay | customer owner + Outbound session | direct outbound tests | Not run | `READY_FOR_MOBILE_UI`; `READY_FOR_MOBILE_INTEGRATION`; `NEEDS_RUNTIME_VERIFICATION` |
| Full Outbound | Direct V3 outbound | A2 full quantity and complete A1 footprint supported in service | same | direct outbound tests | Not run | Same as partial outbound; runtime required |
| Relocation | Direct V3 relocation | MOVE with lineage, capacity/revision checks and transaction | customer owner + RELOCATION session | relocation tests | Not run | `READY_FOR_MOBILE_UI`; `READY_FOR_MOBILE_INTEGRATION`; `NEEDS_RUNTIME_VERIFICATION` |
| Stock | SKU stock/cell stock | movement replay compared with persisted projection | Customer safe DTO; staff facility scope | stock/ledger tests | Not run | `READY_FOR_MOBILE_UI`; `NEEDS_RUNTIME_VERIFICATION` for real customer data |
| Movement History | V3 movements/operation | canonical movement query, owner scope | owner/facility reader | direct outbound/ledger tests | Not run | `READY_FOR_MOBILE_UI`; integration verification needed |
| Ledger replay | internal service/read APIs | canonical replay with fail-closed unknown/reconciliation errors | inherited from stock operation | ledger/unified tests | Not run | UI can display backend error; cannot resolve legacy data issue in Mobile |
| Managed renewal | Missing | Missing | — | none found for V3 | Not run | `BLOCKED_BY_BACKEND` / `NOT_IMPLEMENTED` |
| Rental closure | readiness only | no request/confirm/release writer | read scope present | readiness tests | Not run | Readiness UI only; complete closure `BLOCKED_BY_BACKEND` |
| Cell release | No closure writer found | no confirmed end-to-end release path | — | none for V3 closure | Not run | `BLOCKED_BY_BACKEND` |
| Notifications | Present | list/read | authenticated user-scoped | not included in focused run | Not run | `READY_FOR_MOBILE_UI`; source verified |

## G. Tests and runtime evidence

| Command / test | Result | Evidence / limit |
|---|---|---|
| `npm run build` | PASS | TypeScript emitted to `dist/` (generated output updated). |
| `npx tsc --noEmit` | PASS | No diagnostics. |
| Focused offline Node suites | PARTIAL: 315 pass, 2 fail (317 total) | Command included inbound domain/confirm, V3 ledger, direct outbound, relocation, Access Session/service/policy, Managed reservation, closure readiness, SKU/spec, customer stock privacy and PayOS tests. No MongoDB or provider was contacted. |
| Access failure: `Staff check-in rejects a primary Reservation already covered as another ACTIVE Session secondary scope` | FAIL — test fixture | `tests/managed-access-service.test.cjs:295`; fixture reservation ends in one day, while current check-in requires every scoped V3 Reservation to end more than seven days after activation. The service fails earlier with `RENTAL_NOT_ACTIVE`, so the overlap assertion is never reached. This is a test fixture incompatibility, not proof the overlap check failed. |
| PayOS failure: `verified Managed V3 FULL_RENT applies once, promotes held Cells and leaves rental awaiting contract` | FAIL — test fixture/environment | `tests/payos-payment.test.cjs:1503`; timed out at `facilities.findOne()` after 10 seconds inside contract materialization in the webhook transaction. The fixture did not stub the Facility dependency used by current contract snapshot creation. This test did not verify or falsify payment application. |
| Other integrated tests in focused run | PASS | Includes direct A2 FIFO/partial REMOVE, Access scope checks, Unified inbound domain and explicit production 503 guard. |
| MongoDB integration/E2E, PayOS live, browser/device tests | NOT_RUN | Strict read-only audit; no live database/provider actions. |

Historical `LEDGER_REPLAY_UNKNOWN` is present in current source as a fail-closed reconciliation response. This audit did not access production inventory and cannot determine whether any specific customer record currently triggers it.

## H. Backend blockers

### P0 — blocks production completion / needs operational attention

- Unified Inbound Confirm is hard-blocked in production: `503 INBOUND_CONFIRM_ENVIRONMENT_BLOCKED`.
- Inbound preflight can block with `503 LEDGER_REPLAY_UNKNOWN` or capacity/counter reconciliation unknown codes. Database record-level status is unverified here; do not mask these errors or retry with new keys.
- No Managed V3 closure/release writer exists; the app cannot safely promise completed closure or Cell release.

### P1 — missing or disabled business path

- A1 Physical Unit preparation endpoints return 410, leaving A1 without a usable API path to create the PREPARED instance required by inbound.
- Repeated Inbound legacy request/inspection/confirm writes are 410 or feature-gated. A2 direct inbound and repeated receipts must not be conflated.
- Managed V3 Renewal is not implemented; Self Storage renewal is not applicable.
- Two focused unit tests need fixture maintenance before they can prove the intended conditions: Access fixture date and PayOS Facility model mock. No source fix is inferred by this audit.

### P2 — evidence gaps / follow-up

- Git baseline cannot establish what the pull changed; repeat read-only Git checks in a functioning worktree before attributing regressions.
- Current source/unit tests do not establish live production or development MongoDB behavior. Outbound, relocation, booking, access and payment need a fresh authorized integration environment for E2E.
- Full read of customer-facing error code mapping and DTO compatibility should precede Mobile API integration for each endpoint.

## I. Customer Mobile implementation plan (no implementation performed)

| Stitch screen | Current Mobile screen/route | Backend APIs | Readiness / gap |
|---|---|---|---|
| Managed Facility Detail | `ManagedCatalog` / facility routes | facilities + scoped warehouse map | UI exists; verify Managed-service filters and safe data fields |
| Warehouse Map | `ManagedWarehouse`, `/managed/[facilityId]/map` | `/warehouse-map`, `/racks/:id/detail-map` | Integrate backend eligibility; never infer from color alone |
| Cell Selection | Managed map/booking state | quote and capacity | Confirm multi-cell selection and request exact Cells |
| Booking Review | `ManagedBookingReviewScreen` | `/reservations/managed/quote` | Use server quote, Terms version/acceptance, expiry details |
| Reservation Confirmation | `ManagedConfirmationScreen` | create reservation, PayOS status | No simulated payment; display reserved hold and payment state |
| Reservation Detail | `ManagedCatalog`/reservation routes | managed reservation get, history/status | Present lifecycle; distinguish ACTIVE from inbound stock state |
| Contract | shared contract review routes | contract reservation/detail/print; staff paper proof | Display snapshot/proof; do not offer unsupported V3 digital signing |
| Payment | `PaymentDetailScreen`, return route | V3 full-rent create/history/status/reconcile | Confirm DTO accepts FULL_RENT and no mock provider action |
| Inventory List | `InventoryScreen` | `/inventory-items/me` | Customer-owned V3 SKU list |
| Item Detail | `InventoryItemDetailScreen` | SKU/specification/stock/movement reads | Use Customer-safe SKU stock; no facility-wide cell stock |
| Register Item | `InventoryFormScreen`, `ManagedSkuForms` | SKU create/update + categories | Backend source supports Customer registration |
| Inbound | `ManagedInboundScreen` | Unified inbound context/preview/confirm | Preview UI may proceed; production confirm blocked; A1 prep API 410 |
| Outbound | `ManagedStockOperations` / outbound route | direct V3 outbound context/preview/confirm | Good integration candidate; needs live nonproduction E2E |
| Relocation | inventory relocation route | direct V3 relocation API | Good integration candidate; needs live nonproduction E2E |
| Movement History | `InventoryHistoryScreen` | V3 movements/operations | Read only, translate movement details with canonical DTO |
| Renewal | no Managed V3 renewal API identified | none | Design as unavailable/support message only, or wait for backend |
| Closure | Rental Detail readiness area | closure-readiness only | Show blockers/readiness; do not expose “complete closure” action |

Suggested order: (1) booking/map/detail using live reads and quote, (2) verified full-rent status and contract display, (3) SKU/specification and safe stock/history reads, (4) Access Visit/Session status, (5) direct outbound and relocation in a verified nonproduction integration environment, (6) inbound UI limited to context/preview until Backend resolves the production guard and A1 prep path, (7) defer renewal/closure completion until APIs exist. The 23-screen handoff is design-only HTML; its README explicitly warns against treating placeholder signing/payment/NFC/UI claims as Backend functionality.

## J. Open questions / verification limits

1. Which exact commits/files changed in the pull? Requires Git to access `WDP/.git` and the checked-out worktree.
2. Are both partial unique Access Session indexes actually present in the current production database? Source declares them; not inspected in this audit.
3. Does current real customer data pass V3 replay/projection/capacity reconciliation? No production database read was performed.
4. Is a separate development backend intended to permit Unified Inbound Confirm, and what is its approved isolated database? No environment or endpoint was contacted.
5. Is Customer continuous escort intended after Staff-verified check-in? The audited service records check-in attestation but does not establish continuous escort.
6. What are exact runtime availability, CORS, and version compatibility for current Mobile against the pulled Backend? Not tested against a live API.

## Audit checkpoint

`WDP_MANAGED_V3_BACKEND_REAUDIT_REVIEW_REQUIRED`

No source implementation or Mobile work was started. Review the Git baseline limitation, current P0/P1 blockers, and the two failing test fixtures before authorizing any next phase.
