# Managed Inventory V3 ledger contract

**Status:** D3/D4 implementation present; production release remains blocked pending infrastructure and facility acceptance.

## Canonical record and projections

`ItemMovement` remains append-only and authoritative. Missing `schemaVersion` and versions 1–2 keep their existing meaning. Version 3 adds an immutable `v3Effect` with `ADD | MOVE | REMOVE`, `A1_PHYSICAL_UNIT | A2_BATCH`, operation/request identity, access-session and inventory/ledger/topology revisions, and per-placement Cell plus topology certificate/revision. V3 never falls back to `currentCellId` or `batchLines`.

`ManagedV3StockProjection`, `ManagedV3Footprint`, `ManagedV3PhysicalUnit`, and `ManagedV3BatchPlacement` are derived or identity/projection records. Replay folds version-3 events in revision order and reconstructs A2 batch/Cell quantities and A1 units/footprints; A1 contributes quantity one regardless of footprint Cell count. The projection is compared with replay before it is presented as ledger-reconciled. Facility Cell counters are exposed separately; they remain `UNKNOWN` for full ledger reconciliation because the shared counters also include historical/legacy inventory.

## Customer Self-Inbound

The Customer flow supports SKU-owned PhysicalUnit preparation, certified placement preview, A2 split across allocated Cells, and transactional confirmation. Confirmation checks Customer/SKU/Reservation/Facility ownership, active reservation and access-session scope, allocation, certified topology/capacity, preview revisions, idempotency, and reservation/Cell/Rack/certificate fences. It appends one canonical ADD movement and updates placement, stock projection, reservation usage and Cell occupancy inside one MongoDB transaction. Exact retries resolve by the original idempotency key.

Single-Cell A1 is supported when capacity and certified geometry are available. Multi-Cell A1 deliberately fails closed: the current certification data does not prove the object's actual support reactions/pose across its footprint. Cells with obstacles also fail closed because the Customer request does not declare a certified object pose. No movement, outbound, relocation, stock hold or removal writer is added here.

## Read access

Customer APIs are scoped to the owning Customer and reservation. Staff/Manager APIs are read-only and facility-assigned. Manager/Staff overview replays the full event history up to 5,000 events per SKU; above that threshold it reports `UNKNOWN`, never `RECONCILED` from only the recent movement list. Staff activity is filtered in the UI to active access-session IDs; Manager can inspect batch placements. Legacy V1/V2 readers and writers are not rewritten by this change; unsupported legacy mutation paths remain a release compatibility risk and must be guarded before enabling V3 data in production.

## Release gates

- Verify deployment is a MongoDB replica set or sharded cluster that supports multi-document transactions; no repository `withTransaction` call proves deployment capability.
- Deploy and verify indexes for V3 operation/idempotency and placement uniqueness before enabling writes.
- Certify real facility geometry, capacities, topology revisions and invalidation workflow. Synthetic tests do not certify real facilities.
- Integrate trusted physical-presence evidence; current D4 confirmation represents Customer attestation and access-session scope, not independent sensor proof.
- Prove all legacy inventory writers, maps, outbound, relocation, holds, warehouse counters and closure readers either understand V3 placements or reject them.
- Run replica-set integration tests and concurrency/ambiguous-commit tests in an isolated environment, then obtain independent review before production activation.
