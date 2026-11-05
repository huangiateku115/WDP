# MI-07C.4A — Reservation Lifecycle Fence Coverage Audit

**Mode:** Read-only source audit plus this document only. No runtime source, schema, route, configuration, or test files were changed by this audit.

**Audit date:** 2026-10-27  
**Observed branch / HEAD:** `feat/mi07-managed-rental-closure` / `7a5cd84b7f1ba7e5076f268276fc49dbee0b138e`  
**Observed tree:** dirty before this audit. The existing MI-07C.1/.2/.3 implementation, tests, Postman files, and untracked MI-07 docs/readiness files were preserved. This new audit document is the only file added by this task.

Line references below refer to the observed working tree, which includes uncommitted changes. They are source pointers, not claims that the changes are present in HEAD.

**C.4B follow-up:** This document records the original read-only audit plus the subsequent authorized C.4B implementation. Rows marked as C.4B-fixed describe current working-tree source; all C.4B changes remain uncommitted.

## A. Git baseline and working-tree state

- Branch and HEAD were confirmed as above.
- Before this document was added, the tree already contained modified Managed Inventory source/tests/Postman files and untracked MI-07 documentation/readiness files. None were reset, checked out, stashed, or overwritten.
- The full backend suite was **not run**. Repository tests include MongoDB integration cases (`backend/tests/integration/managed-inbound-request.mongo.test.cjs`, `backend/tests/integration/mi06b-mongo-safety.test.cjs`), HTTP listener/fetch tests, and subprocess/seed-oriented cases. Without running or auditing every test's external effects, a full run cannot be classified as safe offline. No test is reported as passing in this audit.
- `git diff --check` and `git diff --cached --check` are the only requested executable checks; their results are recorded in the final audit response.

## B. C.3 source review results

### Fence participation and pending-closure predicates

| Writer | Observed implementation | Finding |
|---|---|---|
| Legacy Item metadata update | `backend/src/services/inventory-items/inventory-item.service.ts:734-770`; Item `__v` write token precedes `lockReservationForMetadata()` at `:294-318`. Reservation CAS includes version and `activeClosureRequestId: null`. | Blocks metadata changes when closure is marked; preserves Item optimistic concurrency. |
| Legacy outbound request | `inventory-item.service.ts:1004-1043`; Item CAS, unresolved inbound guard, then Reservation fence. | Marker is permitted, with existing active/in-term eligibility enforced by `lockActiveReservationLifecycle()` (`:277-280`). This preserves eligible outbound during clearance. |
| Legacy outbound confirmation | `inventory-item.service.ts:1045-1158`; Item CAS, unresolved receipt guard, then Cell/Zone and Reservation fence before counters/movement. | Marker is permitted but rental-term/status checks remain. The stock-changing path participates in Reservation CAS. |
| Legacy outbound rejection | `inventory-item.service.ts:1160-1186`; Item CAS then a Reservation lifecycle token permitting closure-resolution semantics. | Rejection does not change stock counters or movement history. It preserves the existing rejection transition and does not erase hold history. Verify the state machine still releases/retains holds as its established contract specifies; this audit did not change it. |
| Canonical outbound CREATE | `backend/src/services/inventory-items/managed-outbound-request.service.ts:218-268`; Item CAS then Reservation CAS and hold/request/event transaction. | Marker is allowed; active/in-term check remains. A pending outbound is visible to future clearance revalidation. |
| Canonical outbound CANCEL | `managed-outbound-request.service.ts:276-326`; Item CAS then Reservation token without requiring active term, followed by request/hold/event writes. | Allows valid cancellation of existing work during closure without adding stock. This is a state-machine resolution path. |
| Canonical outbound CONFIRM | `managed-outbound-request.service.ts:327-432`; Item token, request version, structure tokens, Reservation CAS, then REMOVE/stock/counter/request/event writes. | Marker is allowed under existing active/in-term rules. Confirmation changes physical stock and must invalidate any future clearance snapshot. |
| Legacy relocation | `inventory-item.service.ts:1188-1370` (method continues beyond the excerpted source); Item CAS, unresolved request guards, optional facility token, sorted Zone locks, Reservation CAS with marker rejection, then Rack/Cell/counter/movement writes. | Marker is atomically rejected. Positive-stock placement and existing relocation checks remain in the movement path. |
| Canonical relocation | `backend/src/services/inventory-items/managed-canonical-relocation.service.ts:164-181,355-`; Item CAS first, capacity token where applicable, sorted Zone locks, Reservation version CAS requiring active term and `activeClosureRequestId: null`, then Rack/Cell and canonical movement writes. | Marker rejection is part of the same Reservation CAS. Legacy missing/zero `inventoryVersion` is handled explicitly. |

`Reservation.inventoryVersion` is incremented with explicit conditional query updates in these paths. `backend/src/models/reservations/reservation.model.ts:23-25` defines the version and optional marker, but the schema has no `optimisticConcurrency: true`; document `.save()` by itself is not a substitute for explicit CAS.

### Transaction-session safety and order

- The C.3 operations above execute transactionally and their transactional reads/writes are awaited sequentially. `Promise.all()` in `managed-outbound-request.service.ts:269,434,453` is used by list/detail reads outside transactions. `managed-canonical-relocation.service.ts:327` is a preflight read outside the write transaction. `inventory-item.service.ts:647` uses parallel Zone/Rack reads only when no session is supplied; its transactional registration/update callers pass a session and use sequential reads. The other `Promise.all()` sites in the inventory-item file around `:691,717,1442,1460` are read/preview paths outside the C.3 write transaction. No same-session parallel DB operation was found in the reviewed C.3 writers.
- Observed C.3 ordering is consistent with the documented Item-first protocol: **Item CAS → optional Facility capacity token → sorted Zone token(s) → Reservation CAS → sorted Rack token(s) → Cell/allocation/request/stock/movement/audit writes**. Metadata update uses **Item CAS → Reservation CAS → validation/image attachment and Item save**. A request record is read/versioned after the Item token where applicable.
- Registration is necessarily a special case because the Item does not yet exist: **Reservation fence → Item insert/image attachment** in one transaction. This creates a theoretical inverse against item-first stock writers only if a transaction were to hold the Reservation lock and then wait for an existing Item resource; registration has no existing Item token, and closure finalization must not hold Reservation while acquiring Items. Whether MongoDB write conflicts fully serialize all intended races remains a replica-set proof obligation.
- D08 proposes sorted multi-Item locking for a finalizer. No such finalizer exists. A future finalizer must not acquire Reservation and then wait for Item(s), because that reverses the established order and can deadlock against Item-first operations. Lock Items in stable `_id` order first, then shared capacity/Zone/Reservation resources in the agreed order, and revalidate the full closure snapshot before commit.

### C.3 conclusion

The reviewed C.3 outbound, relocation, and metadata paths implement the approved policy: outbound resolution remains available subject to existing authorization and rental-term guards; relocation and metadata changes are blocked by the active marker; and stock-changing writes participate in explicit Reservation CAS. No C.3-specific same-session `Promise.all()` defect was found. This is a source-level review, not proof of multi-writer behavior under MongoDB replica-set concurrency.

## C. Full Reservation and closure-eligibility writer matrix

| Writer / method | Current eligibility and first write/order | Version / marker participation | Closure impact and required stage |
|---|---|---|---|
| Managed Item registration, `InventoryItemService.create` — `backend/src/services/inventory-items/inventory-item.service.ts:654-689` | Transaction; validates Customer/Facility/Reservation; Reservation CAS before Item insert; image attachment and Item save share transaction. | `inventoryVersion` CAS; marker must be absent. | Correctly blocks registration. Replica-set race with closure marker creation remains unverified. MI-07D needs this compatibility; finalizer must also enumerate after a shared fence. |
| Managed Item metadata amendment, `InventoryItemService.update` — `inventory-item.service.ts:734-770` | Item `__v` token then Reservation CAS. | Explicit version CAS and marker-null predicate. | Blocked during closure. Already covered in C.3. |
| First inbound request/confirm — `inventory-item.service.ts:779-803,804-1002` | Item state/CAS, Facility where applicable, Zone → Reservation → Rack/Cell and physical writes. | C.2 adds Reservation fence; new stock confirmation has marker-null predicate; safe existing custody resolution has a separate allowed path. | New inbound and adding-stock confirm blocked; valid existing custody return/resolution preserved. Existing pre-ACTIVE receiving is outside a valid closure term. MI-07D must revalidate stock and custody. |
| Repeated inbound CREATE/AMEND/CANCEL — `managed-inbound-request.service.ts:342-386,413-471` | CREATE Item-first then active Reservation CAS; AMEND/CANCEL use Item/Reservation/request version checks as implemented in C.2. | CREATE/AMEND require marker absent; CANCEL is allowed only under lifecycle, inspection and custody safety predicates. | Correct policy; pending requests remain historical. Confirm requires marker absent. MI-07D needs to block/resolve unresolved states without discarding them. |
| Repeated inbound inspection/return/confirm — `repeated-inbound-operations.service.ts:255-352,353-` | Item/Reservation/request/evidence transaction; inspection evidence snapshot and request state transition are atomic; confirm uses marker-aware Reservation CAS. | Confirmation adding stock rejects marker; valid return-completion can resolve custody while preserving evidence. | Correct C.2 policy per current implementation. Confirmed acceptance waiting to add stock while closure is pending can be a business dead-end; D03 allows custody resolution but does not approve forced return or forced confirmation. Must remain BLOCKED until a permitted transition exists. |
| Legacy outbound request/confirm/reject — `inventory-item.service.ts:1004-1186` | Item CAS first; request/confirm then Zone → Reservation → Rack/Cell; reject uses Item then Reservation. | C.3 Reservation CAS; marker allowed for outbound under active/in-term guard. | Eligible outbound allowed. Any stock/custody transition invalidates prior clearance. No overdue exception. |
| Canonical outbound create/cancel/confirm — `managed-outbound-request.service.ts:218-432` | Item CAS → Reservation CAS → request/hold/event; confirm includes structure/counter/movement writes. | Explicit Item and Reservation/request CAS. Marker allowed; active-term guard on stock-changing confirm. | Pending outbound must be included in readiness and final revalidation. Cancellation remains a valid resolution path. MI-07D/F require real race verification. |
| Legacy/canonical relocation — `inventory-item.service.ts:1188-` and `managed-canonical-relocation.service.ts:355-` | Item-first, optional capacity, sorted Zone(s), Reservation, Rack(s), Cell(s), movement/counters. | Reservation CAS requires marker absent. | Correctly blocked during closure. Physical structure edits share Zone/Rack/Cell tokens and need finalizer revalidation. |
| Managed reservation creation — `managed-reservation.service.ts:313-358` | Transaction starts with Facility capacity booking token, then selected structural Cells/availability, then new Reservation and HOLD allocations. | Facility `bookingVersion`; no existing Reservation inventory CAS (new document). | A new booking cannot itself be the pending closure Reservation, but can compete with final Facility quota release. Policy whether booking/activation should be globally/facility blocked while another closure is pending is not defined. MI-07F must share capacity token and revalidate commitments. |
| Managed capacity configuration — `managed-reservation.service.ts:360-` | Facility capacity `bookingVersion` CAS/update, then commitment scan/config save. | Facility-level token, not per-Reservation inventoryVersion or closure marker. | Can change capacity while closure is pending; must coordinate with final release through the same token and recheck committed quota. Essential before MI-07F quota release; not by itself a reason to change unrelated reservation statuses. |
| Managed legacy approve/reject/cancel — `managed-reservation.service.ts:423-512` | Approve reads RESERVED/legacy, then Reservation `.save()` and contract; reject/cancel lock Facility capacity then read/save Reservation and release HOLD/RESERVED allocation. | Pre-ACTIVE status guards; not a general `inventoryVersion` CAS. Reject/cancel share Facility capacity token. | No approved closure should exist for a pre-active Reservation under current MVP policy. Preserve behavior; finalizer must require ACTIVE/OVERDUE policy resolution and status revalidation. Existing `approve` performs parallel session reads at `:430-434`; see Section E. |
| Managed deposit/balance/activation — `managed-reservation.service.ts:514-` and `managed-checkin.service.ts:322-` | Dedicated Managed flows are constrained to pre-ACTIVE states. Payment/activation transitions use Facility capacity lock where needed; activation changes PAID→ACTIVE. | Do not consistently increment inventoryVersion; predicates/status revalidation protect the current pre-active flow. | No active closure is expected pre-activation. Creation of closure must atomically require ACTIVE and finalizer must revalidate. Whether pending closure affects later payment callbacks is unapproved. |
| Managed legacy `confirmMockBalance` branch — `backend/src/controllers/reservations/reservation.controller.ts:21-92,530-`; route `reservation.routes.ts:46` | Transaction; reads scoped legacy Managed Reservation and payment; first write is Reservation CAS requiring `CHECKIN_READY`, exact observed `inventoryVersion` (missing/zero compatibility), and `activeClosureRequestId:null`; saves deterministic MOCK balance payment in the same transaction. Replays a matching committed PAID/payment pair. Production mock balance is disabled. | Explicit Reservation CAS and marker predicate. V2 Managed uses dedicated route. | C.4B fixed the balance bypass. Deposit coverage is described in the later C.4C addendum below; the original audit table predates that work. |
| Generic Reservation `handoverReservation` — `reservation.controller.ts:518-555`; route `reservation.routes.ts:49` | Reads by ID, checks PAID, then sets ACTIVE and saves without serviceType, CAS, transaction, or Facility-scope check visible in this method. Optional StorageUnit update follows separately. | No lifecycle CAS or marker predicate. | Normally pre-active only and not an active-marker bypass by state; still a cross-service, stale-write and non-atomic activation risk. Confirm route-level facility scope middleware before reuse; this method itself does not show it. Review/isolate before relying on it for Managed activation. |
| Managed `confirmSignedPaper` branch — `backend/src/controllers/contracts/contract.controller.ts:146-267`; route `contract.routes.ts:20-25` | Checks Staff Facility scope, Managed pre-activation status and marker absence; external Cloudinary upload; transaction first writes Reservation CAS, then updates Contract proof/status and audit. Already committed proof replay is a no-op. | Explicit Reservation CAS with `activeClosureRequestId:null`; Contract and Reservation DB changes share a transaction. | C.4B bypass/partial-DB-write risk is fixed. External Cloudinary upload cannot be atomic; known aborts get best-effort deletion, uncertain commit is reconciled against the exact proof public ID. Self-Storage path is unchanged. |
| Managed check-in inspection/contract/payment — `managed-checkin.service.ts:104-243,244-363` | First receiving is pre-ACTIVE and uses Facility/Zone/Rack/Cell ordering; contract signatures and balance are restricted to DEPOSIT_PAID/CHECKIN_READY. | No closure marker is expected in these statuses; no universal Reservation inventoryVersion CAS. | C.4B now sequences session-bound reads in `currentContent()` and `createOrRefreshContract`. No business/status behavior was changed. |
| Reservation payment controllers and callbacks | Generic controllers at `reservation.controller.ts:315-396,455-`; dedicated Managed payment services. No external provider webhook route was found in inspected routes. | Managed legacy balance is fenced by C.4B; Managed v1 generic deposit is fenced by C.4C; WDP-SEC-01 blocks Self-Storage generic MOCK deposit confirmation in production. | D06 settlement and pending-closure payment policy remain unresolved. The separate generic Self-Storage `mockPayReservation` endpoint remains an adjacent security finding; do not expand WDP-SEC-01 to it. |
| Self-Storage reservation create/approve/cancel/payment/handover | `backend/src/services/reservations/reservation.service.ts:107-` and generic controllers/services guarded by `serviceType === SELF_STORAGE` in core business methods. | StorageUnit `bookingVersion`/existing Self-Storage rules; no Managed closure marker. | No changes proposed. Generic endpoints above need explicit service-type boundaries to ensure no accidental cross-service behavior; preserve Self-Storage proof/payment behavior. |
| Warehouse structure updates | `backend/src/services/warehouse-map/warehouse-map.service.ts:594-653` and sibling Zone/Rack operations. Cell update locks Zone → Rack → Cell and checks allocations/physical counters. | Structure tokens, not Reservation inventoryVersion. | Structural changes can affect physical capacity. Final clearance/final release must use compatible structural tokens and revalidate. Essential before MI-07F, not a closure-marker participant by itself. |

### D. Missing fence participants and minimum future MI-07C.4B patch

No operational closure writer exists yet, so active marker creation/clear and final release are not currently performed by application code. C.4B closed the identified `confirmMockBalance` and `confirmSignedPaper` Managed status-write gaps. Remaining adjacent work is not authorized by C.4B.

1. **`ReservationController.confirmMockBalance` (`reservation.controller.ts:21-92,530-`, route `reservation.routes.ts:46`)** — implemented in C.4B: Managed legacy CAS, marker predicate, transactional payment persistence, replay and production mock guard. Replica-set verification remains required.
2. **`ContractController.confirmSignedPaper` (`contract.controller.ts:146-267`, route `contract.routes.ts:20-25`)** — implemented in C.4B for Managed Reservations with Facility/status checks, CAS, transactional Contract/Reservation/audit updates, proof-preserving replay and best-effort Cloudinary compensation. External asset atomicity remains limited.
3. **`ReservationController.handoverReservation` (`reservation.controller.ts:518-555`, route `reservation.routes.ts:49`)** — verify route-level Facility scope and restrict service types/state transitions; if it can activate Managed reservations, use a conditional state transition and revalidate marker/status. Essential only if this route is an active Managed activation path before **MI-07D**; otherwise document as Self-Storage-only and cover its intended consumer.
4. **`ManagedCheckinService.currentContent` and `createOrRefreshContract` (`managed-checkin.service.ts:60-70,244-270`)**, and **`ManagedReservationService.approve` (`managed-reservation.service.ts:423-451`)** — sequence DB reads that share a transaction session instead of `Promise.all()`. This is transaction-session correctness, not a closure-specific fence gap. It should be addressed before relying on those paths in transaction tests; obtain authorization if the patch scope is strictly fence-only.
5. **Future closure request/finalizer** — use explicit Reservation version/marker CAS and stable sorted Item locks; Facility capacity and structural locks must use existing tokens. This is MI-07D/F, not authorized by this audit.

Do not add a global fence to unrelated Self-Storage or pre-activation writers merely because they mutate Reservation. Apply a fence only where a write can invalidate an ACTIVE closure snapshot or where it competes for a shared resource that the finalizer releases.

## E. Lock ordering and concurrency protocol

### Existing compatible order

For Item-scoped operations that change stock, custody, placement, or metadata:

`Item __v CAS → Facility capacity token when needed → Zone token(s) sorted by ID → Reservation.inventoryVersion CAS → Rack token(s) sorted by ID → Cell/allocation/request/balance/movement/event writes`.

For Item registration, where no Item exists:

`Reservation.inventoryVersion CAS (marker absent) → insert Item and attach images within the same transaction`.

For booking and capacity configuration:

`Facility ManagedFacilityCapacity.bookingVersion token → structural resource tokens in stable order → Reservation/allocation writes`.

For warehouse structure mutation:

`Zone token → Rack token → Cell token`.

### Closure implications

- A closure request/finalizer must not lock Reservation then wait on an existing Item, Zone, or Facility capacity token. That would invert the Item-first or Facility-first order and create a wait cycle.
- If finalization spans many Items, acquire Item IDs in stable sorted order first, then Facility capacity/Zone/Reservation/Rack/Cell tokens in the established order, and recompute readiness after all tokens are acquired.
- Registration has no Item token to acquire; its Reservation-first insert is safe only if finalization's reservation fence/scan design proves it cannot commit an omitted Item. This requires a real replica-set race test.
- Capacity release must serialize on `ManagedFacilityCapacity.bookingVersion` against booking and capacity configuration. Per-Reservation `inventoryVersion` alone does not protect facility quota.
- `inventoryVersion` legacy missing-value handling is explicitly supported by current helper CAS filters (`0 OR field missing`). New closure code must preserve this compatibility and must not interpret missing fields as evidence of no concurrent writer.
- Bounded retries and idempotent replay are required for transient write conflicts. `UnknownTransactionCommitResult` cannot be reported as success based only on a request/marker document; resolve by reading the durable event/result under a bounded retry policy. No production concurrency claim is made here.

## F. Unresolved business-policy decisions

The MVP contract and current source establish only some boundaries. They do not authorize filling in the rest.

| Topic | Existing authority / current fact | Status |
|---|---|---|
| Registration/new inbound during active closure | D03/D08 and C1/C2 marker behavior block registration and new stock addition. | **Defined/approved** |
| Outbound during closure | D03/D08 allow outbound only with existing authorization and rental-term rules; no overdue bypass. | **Defined/approved** |
| Relocation and metadata amendment | D03/D08 block both while marker active. | **Defined/approved** |
| Booking/activation while closure is pending | No explicit rule says whether new facility bookings or pre-active activation are blocked due to another reservation's closure. | **Proposed / requires approval** |
| Payment updates/callbacks | D06 financial settlement remains blocked; no approved pending-closure rule for late payment callbacks or refunds. | **Blocked — missing policy** |
| Contract content/signature changes | Existing signing is pre-active; pending closure behavior and any contract correction policy are not approved. | **Blocked — missing policy** |
| Rental term amendment / grace / timezone | No term amendment writer was found; D07 timing/overdue detail remains unresolved. | **Blocked — missing policy** |
| Cancellation/termination of an active lease | No approved active-lease termination or marker-clearing workflow. Existing cancel methods are pre-active. | **Blocked — missing policy** |
| Accepted receipt with Facility custody, not yet confirmed into stock | C2 forbids new stock confirmation under closure and forbids inventing a return flow; existing custody must be resolved through valid transitions. No universal safe completion is defined for already ACCEPTED evidence. | **Blocked — business transition needed** |
| Existing pending outbound | Eligible existing outbound may proceed under in-term rules; request cancellation/rejection follows its current state machine. Clearance must include holds and revalidate after changes. | **Defined in principle; final evidence policy needs D05 approval** |
| Closure request cancellation / marker clearing | No closure request writer exists; no approved actor, state, version or audit semantics for clearing the marker. | **Blocked — missing policy** |
| Financial readiness/final settlement | D06 remains explicitly blocked; readiness must not claim overall READY while mandatory financial obligations are unresolved. | **Blocked — missing policy** |
| Customer acknowledgement, handover evidence and disposition of never-received Items | D04/D05 policy is partial; detailed evidence/acknowledgement requirements are not approved. | **Blocked / requires approval** |

The D08 review file currently says its status is C1-only and that C2/C3 and Reservation compatibility are future work (`backend/docs/MI_07_D08_LIFECYCLE_FENCE_REVIEW.md:3,9-16,22-42`). That document is stale relative to the observed C2/C3 dirty working tree. Reconcile it only with an explicitly authorized documentation update; do not treat its stale matrix as current implementation evidence.

## G. Existing regression coverage

The repository contains focused mock/unit/API files for the relevant paths:

- C1 registration and metadata: `backend/tests/inventory-item.test.cjs`.
- C2 inbound lifecycle/evidence/check-in: `managed-inbound.test.cjs`, `managed-inbound-request-api.test.cjs`, `managed-inbound-request-foundation.test.cjs`, `managed-repeated-inbound-operations.test.cjs`, `managed-repeated-inbound-operations-security.test.cjs`, `managed-repeated-inbound-foundation.test.cjs`, `managed-receiving-evidence.test.cjs`, `managed-checkin.test.cjs`.
- C3 outbound: `managed-outbound.test.cjs`, `managed-outbound-request-api.test.cjs`, `managed-outbound-allocation.test.cjs`, `managed-outbound-staff-read.test.cjs`.
- C3 relocation: `managed-relocation.test.cjs`, `managed-canonical-relocation.test.cjs`.
- Booking/activation and Self-Storage: `managed-reservation.test.cjs`, `reservation.test.cjs`, `payment-accounting.test.cjs`.
- Readiness: `managed-closure-readiness.test.cjs`.
- Real MongoDB integration: `backend/tests/integration/managed-inbound-request.mongo.test.cjs`; there are also MongoDB safety tests under `backend/tests/integration/`.

Coverage is not equivalent to proof of every cross-writer race. C.4B adds focused mock tests for Managed balance CAS/marker conflict, production MOCK blocking, Managed signed-paper CAS/proof/signature preservation and marker rejection, plus session-read overlap assertions for Managed check-in and approval. The C.4B tests were not part of the original read-only audit; their results are recorded in the execution report. No real replica-set race test has been run.

## H. Replica-set verification requirements

Run only in an explicitly authorized disposable local/test replica set; never production, staging, Atlas, or an unknown URI. Required scenarios:

1. Registration vs active-marker creation/finalizer scan: exactly one serializable result; no committed Item omitted by clearance.
2. First/repeated inbound request and confirm vs marker activation; accepted custody behavior and rollback.
3. Canonical outbound CREATE/CANCEL/CONFIRM and legacy outbound request/confirm/reject vs final clearance; hold/stock/event conservation.
4. Legacy and canonical relocation vs marker/finalization; stable multi-Zone and multi-Item ordering.
5. Metadata amendment vs marker/finalization; stale Item and Reservation CAS conflict.
6. Booking and capacity reconfiguration vs quota release; facility bookingVersion protects exact committed capacity.
7. Two simultaneous finalizers; only one may clear marker/close/release allocations, with exactly-once audit/release semantics.
8. Injected late-write failure after stock/capacity/allocation changes; all changes roll back.
9. Transient transaction retries and `UnknownTransactionCommitResult`; bounded recovery returns the original committed result or a stable uncertain outcome, never false success or duplicate events.
10. Conservation checks: Item and batch stock, HeldQty, Cell/Rack/Zone/Facility counters, Reservation used capacity, allocation ownership/status, and immutable movement/event history remain consistent.
11. Legacy Reservation without `inventoryVersion`, and stale/missing ledger/balance paths fail closed or initialize only under the approved transaction-local reconciliation design.
12. Generic legacy balance/proof endpoints cannot mutate Managed closure-relevant state without the approved guard; Self-Storage proof/payment regressions remain unchanged.

Mocks can characterize branches and conflict mapping but cannot establish MongoDB transaction conflict ordering, commit uncertainty, or index behavior under concurrent writers.

## I. GO / REVISE / BLOCKED recommendation

**Recommendation: BLOCKED before MI-07D operational closure request/final clearance.**

The reviewed C.3 item-scoped writers appear aligned with the approved marker policy and lock order at source level. MI-07C.4B fenced the Managed branches of `ReservationController.confirmMockBalance` and `ContractController.confirmSignedPaper`. MI-07C.4C subsequently contained and fenced the Managed branch of generic `confirmMockDeposit`; see the addendum for exact behavior and the separate unchanged Self-Storage finding.

Closure/clearance/finalization business rules remain unresolved for D05/D06/D07, accepted custody awaiting stock confirmation, and marker clearing. WDP-SEC-01 separately closes the generic Self-Storage MOCK deposit confirmation production path. The generic Self-Storage `mockPayReservation` endpoint remains a separate finding requiring its own scoped review. Real replica-set concurrency remains unverified. Do not proceed to closure writers or claim production-safe concurrency until remaining writer boundaries, policy blockers, and integration tests are addressed.

## C.4C authorization and implementation addendum (2026-10-28)

Product Owner explicitly authorized MI-07C.4C-S1/S2. The Managed branch of the generic `ReservationController.confirmMockDeposit` is now contained and fenced; this addendum supersedes the earlier statement that the endpoint remained unaudited/unmodified.

- Route remains `POST /api/v1/reservations/:id/deposit/mock-confirm` and still requires authentication plus `CUSTOMER`. For Managed reservations, production is rejected, `bookingFlowVersion: 2` is rejected in favor of the dedicated Managed v2 route, and legacy v1 simulation requires `NODE_ENV` `development` or `test` plus `MI_MOCK_PAYMENT_ENABLED=true`.
- Managed v1 confirmation now uses a transaction. The Reservation CAS is its first write and checks `_id`, customer, facility, service type, legacy flow version, `RESERVED`, exact `inventoryVersion` (including missing/zero compatibility), and `activeClosureRequestId:null`. The same CAS advances `inventoryVersion`, transitions to `DEPOSIT_PAID`, links the payment, clears the hold expiry, and records simulation provenance. Payment and any new draft Contract are saved in that transaction.
- New legacy Managed deposit payments use a deterministic per-Reservation idempotency key. Replays follow `depositPaymentId` and validate the linked successful MOCK deposit and Contract; this also preserves recognition of historical successful records whose old key was timestamp-derived. The endpoint has no client idempotency key or payload contract, so same-key/different-payload comparison is not applicable; request-body payment/provider/status values are ignored. Uncertain commit outcomes are returned as success only after durable Reservation/payment/Contract reads prove the committed result; otherwise the route returns 503. Known state/write conflicts map to 409.
- At the time of C.4C, the generic handler's Self-Storage `confirmMockDeposit` branch was unchanged and retained a production MOCK settlement exposure. WDP-SEC-01 (2026-10-28) adds a production-only rejection before payment, Reservation, or Contract writes while preserving non-production simulation behavior; see `WDP_SEC_01_SELF_STORAGE_MOCK_DEPOSIT.md`.
- Adjacent endpoint review found `POST /api/v1/reservations/:id/mock-pay` (`ReservationController.mockPayReservation`) also lacked an environment guard and could transition a Self-Storage `CONTRACTED` Reservation to `PAID` without provider verification. WDP-SEC-02 now limits that endpoint to `NODE_ENV=development|test`; see `WDP_SEC_02_SELF_STORAGE_MOCK_PAY.md`. Generic `confirmMockBalance` rejects production; dedicated Managed mock endpoints retain their own production/gate checks.
- No PayOS integration, external financial-source verification, financial settlement policy, closure writer, database operation, or feature-gate activation was added. Reservation/payment/Contract failure tests use transaction mocks; they do not prove real rollback, write-conflict order, or unknown-commit behavior on MongoDB. Replica-set verification remains required. D06 final settlement remains unresolved.

## J. Source change candidates by phase

| Target | Exact method | Needed by | Notes |
|---|---|---|---|
| `backend/src/controllers/reservations/reservation.controller.ts` | `confirmMockBalance` | MI-07D | C.4B implements Managed legacy CAS, marker check, transactional payment, replay, and production mock guard. Verify with replica set. |
| `backend/src/controllers/contracts/contract.controller.ts` | `confirmSignedPaper` | MI-07D | C.4B implements Managed CAS and transactional proof/status/audit writes; Cloudinary compensation is best-effort. |
| `backend/src/controllers/reservations/reservation.controller.ts` | `handoverReservation` | MI-07D only if Managed activation consumer; otherwise prove Self-Storage-only route use | Add Facility/service scope and conditional activation or document/restrict service ownership after approval. |
| `backend/src/services/reservations/managed-checkin.service.ts` | `currentContent`, `createOrRefreshContract` | C.4B completed | Session-bound queries are awaited sequentially; real transaction behavior remains unverified. |
| `backend/src/services/reservations/managed-reservation.service.ts` | `approve` | C.4B completed | Facility/Profile/User reads are awaited sequentially; pre-ACTIVE status behavior is unchanged. |
| Future closure modules (not present) | closure request creation, clearance assessment, finalizer | MI-07D/E/F only after policy approvals | Must use stable Item-first ordering, Reservation CAS, Facility capacity token, structural locks, idempotent event snapshots, and transactional release. |

No source modifications are authorized or made by this audit. MI-07C.4A documentation does not implement or authorize MI-07C.4B.
