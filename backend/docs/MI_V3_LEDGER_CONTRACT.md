# Managed Inventory V3 ledger contract (design freeze)

**Status:** design only. No V3 stock writer or operational endpoint is enabled by this document.

## Authority and compatibility

`ItemMovement` remains the single append-only canonical ledger. Historical records with no `schemaVersion` remain V1; existing V2 `batchLines` retain their current meaning. V3 must be an additive discriminated event representation in the same collection, never a reinterpretation of V1/V2 and never a parallel authoritative journal. `ManagedV3BatchPlacement.sourceMovementId` references the canonical `ItemMovement` event and is a projection pointer only.

## V3 event shape

Each event carries an explicit `schemaVersion: 3`, action (`ADD`, `MOVE`, `REMOVE`), SKU, reservation, customer, facility, actor, event time, idempotency key, expected item/ledger/topology revisions, and correlation/operation ID. Exactly one of the payloads below is present:

- **A1 PhysicalUnit effect:** one row per indivisible `physicalUnitId`, with quantity exactly `1`, total weight and volume exactly once, and a footprint of unique Cell IDs with certified support-reaction weight and occupied-volume contribution. The sum of support reactions equals the unit weight; cell count never affects inventory quantity.
- **A2 batch placement effect:** rows keyed by `batchId + cellId`, carrying positive safe-integer quantity and canonical weight/volume. A batch may span Cells; a Cell may contain many batches. Per-batch placement sums must equal the batch balance.

For every event, quantity, weight and volume are conserved across its effect lines under the established integer-unit rounding rules (weight: 0.001 kg, volume: 0.000001 m³). `MOVE` has matching source and destination effects. `ADD` and `REMOVE` balance against the SKU/reservation stock effects. V3 placement is never projected to an arbitrary single `currentCellId`.

## Write ordering and concurrency

The future writer must validate ownership, reservation lifecycle/access session, physical-presence evidence, certified topology, reservation allocation, holds and capacity before writes. Within one supported MongoDB multi-document transaction it will acquire deterministic Cell/level and SKU/reservation revision fences; append exactly one immutable movement; update batch/PhysicalUnit placement, stock and capacity projections; consume the idempotency key/session nonce; and commit. Unique keys cover event idempotency and active A2 `(skuId,batchId,cellId)` placement. Compare-and-swap revisions reject stale submissions. Any conflict aborts the entire transaction. An ambiguous commit is resolved by reading the original idempotency key, never by issuing a new operation key.

## Legacy operations

Legacy single-Cell readers may continue reading V1/V2 history. Before writing, any legacy writer must reject a V3 item or any V3 movement/projection it cannot fully understand. Warehouse maps must expose V3 quantities by placement projection; unsupported old map/outbound/relocation/closure code must fail closed rather than infer a Cell or omit stock. This task adds no migration, ledger writer, projection rebuild or production activation.

## Release prerequisite

The implementation must not enable stock mutations until transaction-capable deployment topology, certified facility geometry, trusted physical-presence evidence, access-session issuance/revocation, legacy-writer fences, and reconciliation/rollback procedures have independent acceptance.
