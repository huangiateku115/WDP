# MI-07C.3 — Outbound, Relocation and Metadata Lifecycle Fence

## Scope

This increment makes existing Managed Inventory outbound, relocation and editable Item metadata transactions participate in the Reservation `inventoryVersion` lifecycle fence. It does not add a closure request workflow, clearance evidence, final approval, financial settlement, Reservation closure, or allocation release. Feature gates and existing operation authorization remain unchanged. Self-Storage does not use these Managed Inventory paths.

## Fence behavior

- Every participating path first acquires its existing Item compare-and-swap token, then reads the scoped Managed Inventory Reservation and conditionally increments `inventoryVersion` using the observed version (legacy missing version is treated as zero and matched as missing-or-zero).
- A version/status/term race returns a conflict; no operation reports success on a failed CAS.
- Legacy and canonical outbound are allowed while a closure marker exists only under their existing ACTIVE/in-term and authorization rules. Outbound request cancellation and Staff rejection remain available as existing resolution transitions.
- Legacy and canonical relocation require the closure marker to be absent. Metadata edits require an eligible ACTIVE reservation, or the existing narrowly scoped rejected-registration correction path, and require the marker to be absent.
- Canonical outbound cancellation also participates in the fence so release of held stock is ordered with closure lifecycle changes.
- Existing idempotency events and stock/counter transactions remain the source of operation replay and atomicity; a fence increment is not a substitute for those records.

## Transaction ordering

| Operation | Relevant order |
| --- | --- |
| Legacy outbound request/confirm/reject | Item CAS → Reservation version CAS → existing request/ledger/counter/movement and audit writes |
| Canonical outbound create/cancel/confirm | Item CAS → Reservation version CAS → existing balance/hold/request/event or movement/counter writes |
| Legacy relocation | Item CAS → facility-capacity/Zone locks as applicable → Reservation version CAS → Rack/Cell/counter/allocation/movement writes |
| Canonical relocation | Item CAS → capacity/Zone/Rack/Cell locks in its existing deterministic order → Reservation version CAS with marker-absent predicate → stock/balance/counter/movement writes |
| Item metadata edit | Item CAS → Reservation version CAS with marker-absent predicate → optional preferred-Cell validation and image attachment → Item save |

The Item-first order is preserved on existing operations. Reservation registration remains the approved exception because it has no existing Item to lock and fences before inserting a new Item. This document does not claim that mock tests prove database-level deadlock freedom or serialization.

## Clearance freshness limitation

MI-07C.3 does not create clearance snapshots. Future clearance/finalization must re-read and reconcile current Item state, stock balances, movement history, request states, holds, custody and allocations inside its own transaction. `inventoryVersion` can detect participating lifecycle activity, but a version change alone does not identify whether the operation changed physical stock or custody. Operation-specific events and immutable movements remain necessary evidence.

## Verification boundary

Focused tests use deterministic model/session mocks. They verify predicates, lock call order, conflict outcomes, and that rejected operations do not commit mocked side effects. Real MongoDB replica-set tests are still required for concurrent Reservation CAS, retry labels, transaction rollback, and interactions between legacy and canonical writers before any production rollout.

## MI-07C.4B compatibility addendum (2026-10-27)

The following separately authorized hardening is present in the current working tree:

- Legacy Managed `ReservationController.confirmMockBalance` now uses a transaction. Its first transactional write is a Reservation `inventoryVersion` CAS with `activeClosureRequestId: null`, scoped to Managed legacy flow, owner, `CHECKIN_READY`, and the observed version (including missing/zero legacy version compatibility). It saves the deterministic MOCK balance payment only after the CAS. A committed payment plus PAID Reservation is replayed; stale marker/version or write conflicts fail closed. Version 2 Managed balance continues to use its dedicated endpoint. MOCK balance confirmation is disabled in production.
- Managed `ContractController.confirmSignedPaper` now checks Staff Facility scope, pre-activation Reservation eligibility and marker absence; then Reservation CAS precedes Contract proof/status and audit writes in one MongoDB transaction. Existing signature/content-version fields are left intact. A replay with the already committed proof is a no-op. Cloudinary remains external to MongoDB: known aborted transactions trigger best-effort deletion of the newly uploaded unattached asset; an unknown commit is reconciled against the exact proof public ID and otherwise returns 503 without deleting an asset that might be referenced.
- `ManagedCheckinService.currentContent`, `createOrRefreshContract`, and `ManagedReservationService.approve` now await database reads sequentially when they share a transaction session.

This addendum does not add closure state transitions, define pending-closure payment policy, or establish replica-set concurrency correctness. Focused model/session-mock tests pass; real transaction race testing is still required.
