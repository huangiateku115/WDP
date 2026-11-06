# MI-07 D08 — Reservation Lifecycle Fence Review

**Status (2026-10-27):** D08 architecture is approved under staged Product Owner authorizations. MI-07C.1, MI-07C.2, MI-07C.3 and MI-07C.4B have implementation authorization. Their changes are present in the observed working tree, which remains uncommitted; verify `git status` before relying on that state. MI-07D/E/F operational closure request, clearance, finalization, payment settlement, Reservation `CLOSED`, and allocation/quota release remain unauthorized.

## Product Owner decision and implementation boundary

The approved contract reuses `Reservation.inventoryVersion` as a transactional lifecycle fence with explicit CAS and bounded retry, adds optional `activeClosureRequestId`, preserves existing Item-first/Facility/Zone/Reservation/Rack/Cell ordering, and requires registration to acquire the Reservation fence before inserting an Item in one transaction. Pending-closure policy: block registration and new inbound/stock additions; preserve resolution of already-held custody; allow outbound only under existing authorization and rental-term rules; block relocation and metadata amendment; invalidate stale clearance after any stock/custody change. No closure writer is authorized by this decision.

MI-07C.1 implements the fence/marker foundation and transactional registration. MI-07C.2 and C.3 were separately authorized and implemented in the current working tree. MI-07C.4B separately authorized the two general controller fixes and same-session sequential-read hardening. Those stages do not authorize closure lifecycle writers. Remaining scope:

- MI-07C.4A is a read-only writer coverage audit; its proposed broader writer/capacity work has not been authorized by C.4B.
- MI-07D/E/F: closure request, Staff clearance/evidence, acknowledgement, financial approval, final status and allocation/quota release require separate authorization; D05/D07 detailed policy remains unresolved and D06 settlement remains blocked.

MI-07C.4B specifically hardens the Managed branch of legacy `confirmMockBalance`, the Managed branch of `confirmSignedPaper`, and serializes same-session reads in Managed check-in and Managed approval. It does not add a closure writer or activate a marker.

Real MongoDB replica-set concurrency tests remain required before claiming the fence is proven for production.

## Approved design reference

The lock/resource analysis below is retained as the technical basis for staged integration. Proposed rows outside MI-07C.1 are not implementation authorization. D03 requires new registration and inbound to stop while an active closure request is processed, while eligible outbound remains available for physical clearance under existing rental-term rules.

## Pre-implementation architecture baseline (historical)

The matrix below records the source state when the D08 design audit was written. It is retained as historical reasoning and is **not** a current implementation matrix. For C.1/C.2/C.3/C.4B observed source status, use the staged implementation documents and `MI_07C_4_LIFECYCLE_COVERAGE_AUDIT.md`.

## Current source behavior and CAS coverage (historical baseline)

| Writer | Current serialization/version behavior | Consequence for closure |
|---|---|---|
| `InventoryItemService.create` | Non-image path checks Reservation eligibility then inserts Item without transaction. Image path uses a transaction for image attachment and Item save, but does not write a shared Reservation fence. | Closure cannot prevent a new Item appearing after its Item scan. Must become transactional and participate in the fence. |
| `InventoryItemService.update` | Item schema enables `optimisticConcurrency`; document `save()` provides a `__v` CAS. The paths do not serialize on Reservation lifecycle. | Item metadata can race with closure snapshot; add lifecycle participation and keep Item version check. |
| First `requestInbound` | Conditional Item status/currentCell update increments `__v`; then increments Reservation `inventoryVersion`. | Item-first, but closure-pending eligibility is not represented. |
| First `confirmInbound` | Conditional Item status/currentCell update increments `__v`; optional Facility capacity token; Zone then Reservation token, followed by Rack/Cell and physical writes. It does not bind the token to a previously read `__v`. | Must reject closure-pending inbound; current Item CAS is status/location based, not exact expected-version CAS. |
| MI-06B repeated inbound CREATE | Item identity/status token increments `__v`; then `lockActiveReservation` increments `inventoryVersion`; then Item/ledger/request/event checks and writes. | Good item-first foundation, but must check closure marker in the Reservation token and handle exact conflicts. |
| MI-06B AMEND/CANCEL | Calls Reservation `inventoryVersion` lock first; reads Item and mutates versioned Request/Event. Request schema uses `version` as optimistic concurrency. | Reservation-first order conflicts with the item-first protocol; must be refactored to Item CAS → Reservation fence → Request CAS. |
| MI-06B Staff inspection | Increments Reservation `inventoryVersion` first, then validates Request version and writes immutable inspection/evidence/event. | Reservation-first order conflicts with existing item-first stock operations; must acquire Item CAS first, then Reservation, then Request/Evidence. |
| MI-06B repeated confirmation | Exact preflight `Item.__v` CAS first; then structural/reservation locks; movement/balance/Item/Request/Event writes share one transaction. | Add closure-pending inbound guard after the shared Reservation fence; preserve exact Item version and evidence lineage checks. |
| Legacy outbound request/confirmation/rejection | Item conditional state/location token first; request/confirm then Zone → Reservation → Rack → Cell; reject currently reads Reservation after Item CAS without a Reservation write token. | Eligible request/confirm must remain available during pending closure. All state-changing paths must participate in the shared Reservation token; rejection invalidates clearance. |
| Canonical outbound CREATE/CANCEL | Exact Item `__v` CAS first. CREATE then Reservation `inventoryVersion`, balance hold, Request/Event; CANCEL currently item CAS then hold/request/event and does not use the shared Reservation token. | Both paths need the lifecycle fence. They may remain allowed during closure if current outbound eligibility holds. |
| Canonical outbound CONFIRM | Exact Item CAS → Request version check → Zone → Reservation token → Rack/Cell and atomic REMOVE/hold/request/event writes. | Keep Item-first and term guard; outbound can proceed while closure is pending but invalidates/requires a fresh clearance snapshot. |
| Legacy/canonical relocation | Item conditional/CAS first; optional Facility capacity token; sorted Zones → Reservation → sorted Racks → sorted Cells; movement/counters/allocation are transactional. | Add the approved closure-pending block and shared Reservation fence in MI-07C.3; not part of MI-07C.1. |
| Booking/capacity and reservation transitions | Booking locks Facility capacity before structural resources and Reservation/allocation writes. Reservation operations vary; some status/payment transitions save the Reservation without a universal lifecycle token. | Lifecycle/status writers that can alter closure eligibility must check the closure marker and serialize through the fence. Facility capacity ordering must remain compatible. |

The `Reservation.inventoryVersion` field already exists and is incremented by multiple Managed Inventory flows, but not every relevant writer participates. `InventoryItem` has `optimisticConcurrency: true`, but query updates only receive CAS semantics when their filters explicitly include the expected `__v`. Neither fact currently constitutes a universal closure fence.

Source pointers for the table above: `inventory-item.model.ts` schema options and `inventory-item.service.ts` methods `create` (~551), `update` (~641), `requestInbound` (~711), `confirmInbound` (~736), `requestOutbound` (~936), `confirmOutbound` (~977), `rejectOutbound` (~1092), and `relocate` (~1122); `managed-inbound-request.service.ts` `create` (~312), `amend` (~388), and `cancel` (~446); `repeated-inbound-operations.service.ts` `inspectItem` (~202), `completeReturn` (~276), and `confirm` (~299); `managed-outbound-request.service.ts` `create` (~198), `cancel` (~256), and `confirm` (~305); `managed-canonical-relocation.service.ts` `relocate` (~371); `managed-reservation.service.ts` `lockCapacity` (~201) and booking transitions; `managed-checkin.service.ts` capacity and activation/payment transitions. Confirm line positions against current HEAD before implementation because later edits may move them.

## Approved fence contract and staged implementation

1. Reuse Reservation `inventoryVersion` as the shared transactional serialization counter, with explicit expected-version/CAS behavior in every participating transaction. The fence is only fully effective after the staged writer inventory below is integrated.
2. Add optional Reservation pointer `activeClosureRequestId` so participating writers can reject new registration/inbound based on the same Reservation document. Missing/null on legacy records means no active closure marker.
3. Creating/cancelling/rejecting a closure request updates the pointer and immutable closure Request/Event in one transaction. Do not change Reservation `status` to `CLOSED` at request time.
4. Registration and every new inbound path conditionally acquire the Reservation fence with `activeClosureRequestId` absent. Outbound request/confirm/cancel/reject must participate in the same fence but may ignore the closure pointer when existing in-term authorization allows the operation.
5. Finalization uses the same Reservation fence and performs a complete re-scan/reconciliation after acquiring locks. Set terminal Reservation status, release only eligible allocations/quota, and append immutable event/audit in one transaction.

### Proposed lock order

For operations on an existing Item:

```text
Item CAS (sorted Item IDs for multi-Item closure)
→ Facility capacity token when the operation affects quota/allocation
→ sorted Zone locks
→ Reservation lifecycle fence (inventoryVersion CAS + closure pointer check)
→ sorted Rack locks
→ sorted Cell locks
→ CellAllocation / Request / StockBalance / Movement / immutable Event writes
```

Operations that do not need a structural resource omit it but preserve relative order. Registration has no existing Item to lock: it must acquire the Reservation fence first, then insert the new Item in the same transaction. Closure request creation uses the Reservation fence and request/event only; it must not hold the Reservation fence while waiting for Item locks. Final closure locks existing Items, then capacity/structure, then Reservation, and re-scans after acquiring the fence.

Registration’s Reservation-first sequence is not a universal total lock order with existing Item-first operations. The intended safety property is that all contenders write the same Reservation document in MongoDB transactions: if registration wins, finalization’s fence write conflicts/retries and it re-scans the newly created Item; if finalization wins and commits terminal closure, registration’s eligibility CAS fails on retry. Registration does not lock an existing Item, so it creates no direct Item↔Reservation wait cycle. This is a design argument only; MongoDB replica-set concurrency tests are mandatory and must prove both serial outcomes.

## Closure-pending behavior matrix (approved policy; integration staged)

| Operation while active closure request exists | Proposed behavior | Reason / unresolved decision |
|---|---|---|
| New Item registration | Block with stable 409. | D03 explicit; requires Reservation fence. |
| New first/repeated inbound request | Block with stable 409. | D03 explicit; first-inbound legacy path must participate too. |
| Existing inbound request inspection/confirmation | Block any confirmation that adds stock; allow legitimate resolution of already-held custody without discarding its request, inspection or evidence history. | Exact implementation belongs to MI-07C.2 and must preserve each existing state machine. |
| Eligible outbound request/confirm/cancel | Preserve existing authorization and term guards; allow operation to clear stock. Any operation after Staff clearance invalidates that clearance snapshot and requires re-clearance. | D03 allows eligible outbound; no expired-term exception. |
| Outbound rejection/return-to-storage | Allow only under existing state machine; it cannot count as clearance and forces re-assessment. | State change can restore physical stock. |
| Relocation | Block during active closure request. | Approved; implement in MI-07C.3. |
| Item metadata amendment | Block while closure is active; preserve historical Item identity. | Approved; implement in MI-07C.3. |
| Reservation status/payment/term updates | Participate in the fence where they affect eligibility; do not infer D05/D06/D07 rules from this requirement. | D06 settlement and D05/D07 detailed policies remain unresolved. |

An unresolved inbound request at closure request time cannot be silently erased. The closure request should remain blocked from clearance until its request/custody obligation reaches an approved terminal state. Whether already accepted goods can be returned rather than confirmed inbound is a required policy decision; no fallback is authorized.

## Retry, idempotency and failure contract

- Use MongoDB transactions with snapshot reads and majority writes, but only on a replica set/sharded deployment that supports transactions.
- Every mutating operation has an operation-scoped idempotency key, canonical payload hash, immutable event snapshot and exact resulting request version.
- Same key/same payload returns the original committed event result. Same key/different payload returns 409. Duplicate unresolved closure request returns a stable conflict unless product explicitly selects replay of the existing request.
- Retry only recognized transient transaction/write-conflict outcomes with a bounded attempt/time policy. Do not busy-wait.
- For unknown commit outcome, query the durable idempotency event. If no authoritative result is visible after bounded recovery, return an uncertain/retryable error; never infer success from a Request document alone.
- Any finalization failure rolls back Reservation status, active closure pointer, allocation release, facility capacity, and audit/event writes together.

## Required participating implementation scope

The writer inventory below records the compatibility scope. In the current MI-07C.1 execution only Reservation schema/type and transactional registration are authorized; all other writers remain unmodified until their separately authorized phase:

- `backend/src/models/reservations/reservation.model.ts` and `backend/src/types/reservation.type.ts`: lifecycle pointer/fence contract.
- `backend/src/services/inventory-items/inventory-item.service.ts`: create/update, first inbound request/confirmation, legacy outbound request/confirmation/rejection, relocation.
- `backend/src/services/inventory-items/managed-inbound-request.service.ts`: repeated inbound CREATE/AMEND/CANCEL.
- `backend/src/services/inventory-items/repeated-inbound-operations.service.ts`: inspection, return, confirmation.
- `backend/src/services/inventory-items/managed-outbound-request.service.ts`: canonical outbound CREATE/CANCEL/CONFIRM.
- `backend/src/services/inventory-items/managed-canonical-relocation.service.ts`: canonical MOVE.
- `backend/src/services/reservations/managed-reservation.service.ts` and `managed-checkin.service.ts`: status, activation, payment and allocation transitions that can race with closure.
- Future MI-07 closure request/event models and services; routes/controllers only after separate MI-07D/E/F authorization.
- Existing managed inbound/outbound/relocation/reservation tests plus new replica-set integration suites.

This scope must not touch Self-Storage behavior. Each reused service must retain its existing authorization, term, movement, capacity and idempotency rules. A future implementation should be staged behind an independent closure gate default OFF and production-forced OFF; the gate does not protect unresolved records by itself, so active closure markers must remain enforced when new writes are disabled.

## Required verification before production rollout

### Unit/API regression

- Registration and both inbound generations reject after closure marker; existing first inbound remains unchanged with no marker.
- Outbound request/confirm/cancel remains available only when current in-term rules pass and invalidates prior clearance.
- Metadata amendment, relocation, inbound inspection/confirm, reservation activation/term change and closure transitions follow approved fences.
- Duplicate closure create, stale version, replay, changed payload, transaction rollback and gate-off protection.
- Customer/Staff/Manager owner and Facility scope; never-received Items retain identity; no evidence leakage.
- MI-03B, MI-04, MI-05, MI-06B, IMAGE-01–04, Contract Proof and Self-Storage regressions.

### Real MongoDB replica-set integration (required; mocks insufficient)

- Two registrations vs closure fence: both serial outcomes, no Item inserted after successful close.
- Registration vs first/repeated inbound vs finalization.
- Repeated inbound inspection/confirmation vs closure request, including already-held custody.
- Concurrent outbound request/cancel/confirm vs final clearance and finalization; exact stock/movement/counter totals.
- MOVE vs clearance/finalization; allocation/Cell/Rack/counter invariants.
- Facility capacity booking vs release; no double-release or overbooking.
- Concurrent finalizers and retry/unknown commit recovery; one terminal status, one release and one immutable event.
- Late write failure rolls back Reservation/status/pointer, allocations, capacity and events.
- Server-time/endDate boundary, delayed Manager approval, post-clearance events and incomplete historical custody.

## Recommendation

**Historical D08 decision:** Architecture was conditionally approved and the original execution was limited to MI-07C.1. Subsequent separate Product Owner authorizations expanded implementation through MI-07C.4C only; they do not establish runtime concurrency correctness, and authorized replica-set tests are still required.

## MI-07C.4C update (2026-10-28)

The Product Owner separately authorized Managed Inventory mock-deposit containment and lifecycle fencing. The generic reservation mock-deposit controller now rejects Managed v2 so it cannot bypass its dedicated gated flow, rejects Managed confirmation in production, and permits legacy Managed simulation only in development/test when `MI_MOCK_PAYMENT_ENABLED=true`. The Managed v1 path uses Reservation `inventoryVersion` CAS with an `activeClosureRequestId:null` predicate as its first transaction write, then atomically records the simulated payment and draft Contract. Legacy missing/zero versions remain supported; deterministic new idempotency and `depositPaymentId`-based replay preserve existing historical successful-payment references. The generic endpoint has no client idempotency-key/payload contract; it ignores body payment/provider/status fields, so changed-payload comparison is not applicable without a separately approved API contract. Uncertain commits fail closed unless durable reads confirm the exact result.

At the time of C.4C, the Self-Storage branch was unchanged. WDP-SEC-01 (2026-10-28) subsequently added a production-only rejection to generic Self-Storage deposit confirmation. WDP-SEC-02 further restricts generic Self-Storage `POST /:id/mock-pay` to explicit development/test environments. Both remain mock simulations, not provider verification. A PAID-consumer audit found a separate handover/payment-reference trust-boundary concern documented in `WDP_SEC_02_SELF_STORAGE_MOCK_PAY.md`; it was not changed under SEC-02. Mock-based tests do not verify MongoDB replica-set concurrency/rollback/unknown-commit semantics. No closure writer, final settlement, or production feature activation is authorized by this update.

