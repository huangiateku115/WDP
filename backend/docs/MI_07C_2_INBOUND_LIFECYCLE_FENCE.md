# MI-07C.2 — Managed Inbound Lifecycle Fence

## Scope

This phase coordinates first and repeated Managed Inventory inbound operations with the Reservation lifecycle fence introduced in MI-07C.1. It does not add closure-request writers, change stock arithmetic, or alter Self-Storage, payments, contracts, allocation release, or outbound/relocation behavior.

The shared `Reservation.inventoryVersion` is advanced by a conditional compare-and-set (CAS) in the same transaction as each participating write. Legacy Reservations with a missing version are treated as version `0`; the CAS accepts either explicit zero or a missing field. A missing/null `activeClosureRequestId` means no active closure marker.

## Closure-marker behavior

| Operation | Requires marker absent | Participates in Reservation CAS | Rationale |
|---|---:|---:|---|
| First inbound request | Yes | Yes | A new inbound request cannot start during closure. |
| First inbound confirmation | Yes | Yes | Prevents committing new stock during closure. |
| Repeated inbound CREATE | Yes | Yes | Prevents creation of a new receipt obligation. |
| Repeated inbound AMEND | Yes | Yes | Prevents modifying an inbound obligation during closure. |
| Repeated inbound CANCEL | No | Yes | Safe cancellation remains available if request lifecycle rules permit it. |
| Repeated Staff inspection | For `ACCEPTED` only | Yes | ACCEPTED transitions create a pending stock-confirmation obligation and require the closure marker to be absent in the same Reservation CAS. DISCREPANCY and REJECTED may use existing state transitions during closure while the gate is ON; they do not commit stock. |
| Staff return completion | No | Yes | Resolves custody already held by the Facility. This safe return transition remains available if the repeated-inbound feature gate is off. |
| Repeated inbound confirmation | Yes | Yes | Confirmation adds physical stock and is blocked while closure is pending. |

Gate OFF continues to block new repeated-inbound CREATE/AMEND, all Staff inspection decisions, and Staff confirmation. Owner-scoped history/detail, safe CANCEL, and Staff return completion for an already-`RETURN_PENDING` request remain available. Existing unresolved records continue to be considered by the Item-level operational guards independently of the gate.

### Custody safety during closure

- While a closure marker is active, Staff cannot create a new `ACCEPTED_PENDING_CONFIRMATION` obligation. The ACCEPTED inspection checks `activeClosureRequestId: null` and the observed `inventoryVersion` in one conditional Reservation write, after acquiring the Item CAS. A marker/version race therefore fails closed before inspection evidence, request state or event writes.
- With the gate ON, valid DISCREPANCY and REJECTED inspections continue through the existing lifecycle. REJECTED without Facility custody becomes `REJECTED`; REJECTED with custody taken during this event or retained from an earlier attempt becomes `RETURN_PENDING`. `RETURN_COMPLETED` is the only existing transition from `RETURN_PENDING` to terminal `REJECTED` with custody `RETURNED`.
- A request already in `ACCEPTED_PENDING_CONFIRMATION` when closure becomes active remains unresolved: confirmation is blocked and the existing lifecycle does not permit changing that accepted request to REJECTED or RETURN_PENDING. Readiness must treat it as a blocker. This phase intentionally adds no forced cancellation, custody return, or terminal transition for that state.
- With the feature gate OFF, inspection remains disabled, including rejection/discrepancy decisions. `RETURN_COMPLETED` remains available for a request already in `RETURN_PENDING`. Any other held-custody or accepted-before-closure case without an existing valid transition requires a separately approved business policy; do not fabricate a transition.

## Lock order

For existing-Item operations, the relevant order is:

```text
Item __v CAS
→ Facility capacity token when required by the existing operation
→ sorted Zone token(s)
→ Reservation inventoryVersion CAS and closure-marker predicate
→ sorted Rack token(s)
→ sorted Cell token(s)
→ request / evidence / movement / stock / audit writes
```

Operation-specific paths:

- First inbound request: Item CAS → Reservation CAS.
- First inbound confirmation: Item CAS → existing Facility capacity and Zone locks → Reservation CAS → Rack/Cell locks → stock and audit writes.
- Repeated inbound CREATE/AMEND/CANCEL: Item CAS → Reservation CAS → request and immutable event writes. CREATE/AMEND require marker absence; CANCEL does not.
- Repeated Staff inspection/return completion: Item CAS → Reservation CAS → request/evidence/event writes. They may resolve pre-existing obligations during closure; only valid state-machine transitions are accepted.
- Repeated confirmation: Item CAS → Zone token → Reservation CAS with marker absent → Rack/Cell and canonical transactional writes.

The existing MI-06B structural order is preserved. Registration remains the documented exception because it has no existing Item: it fences the Reservation before inserting the new Item in one transaction. No structural or capacity ordering was changed in this phase.

## Failure and idempotency behavior

Request and Item writes remain transactional. The Reservation CAS checks the observed `inventoryVersion`, current identity/status/term where applicable, and the closure marker where the operation adds or amends an inbound obligation or commits stock. A stale version, closure-marker change, or failed Item CAS returns a stable 409 conflict. Existing operation event replay is checked before mutation; the request/event and any evidence or canonical stock writes remain atomic under the existing implementation.

The MongoDB driver's transaction retry and unknown-commit recovery remain in use. Mock tests do not prove concurrent outcomes or transaction rollback against MongoDB. A transaction-capable local/test replica set is required for final concurrency verification; production or unknown databases must not be used for that verification.

Replica-set verification must include concurrent ACCEPTED inspection versus closure-marker activation, ACCEPTED inspection versus Reservation version change, marker activation after a committed ACCEPTED inspection, confirmation rejection during closure with no ADD/counter writes, and return completion during closure. Verify request, immutable inspection evidence, event, movement, balance and counters are atomic under commit/abort.

## Out of scope

This change does not fence outbound, relocation, Reservation closure writers, payment/contract transitions, MI-03B legacy Staff inspection, or Self-Storage. These remain separate authorized compatibility phases. No closure marker is created or activated by this document or implementation.
