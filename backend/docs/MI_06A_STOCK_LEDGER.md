# MI-06A — Managed stock ledger and read-only reconciliation

MI-06A adds a versioned append-only movement format, a stock-balance projection schema, pure read-only reconciliation helpers, stable error codes, and a disabled-by-default write gate. It does not change MI-03B inbound, MI-04 outbound, MI-05 relocation, receiving inspection/evidence, reservation lifecycle, Cell counters, or operational API behavior. No migration or backfill is included or run.

## Identity and accounting

`InventoryItem.quantity` retains its legacy registration meaning. It is not incremented as new receipt batches arrive. Version 2 `ItemMovement` events carry immutable `batchLines`; each line includes a receipt `batchId`, action (`ADD`, `REMOVE`, `MOVE`), positive affected quantity, unit and verified physical measurements. INBOUND adds a batch, OUTBOUND removes from named batches, and RELOCATION records the current batch quantities while moving placement. Every line's quantity unit must equal both the Item and parent movement unit; this phase defines no conversion between units. For canonical v2 movements, weight is `quantity × actualUnitWeightKg` rounded once to 3 decimal places and volume is `widthM × depthM × heightM × quantity` rounded once to 6 decimal places; parent totals equal the sum of canonical line totals. Canonical comparison uses integer precision units (milli-kg and micro-m³), and invalid submitted totals are rejected rather than normalized.

`ItemMovement.arithmeticPolicy` is independent of `schemaVersion`. New v2 writes require `CANONICAL_V1`; it is invalid on v1. Missing/null policy on historical v1/v2 records uses the compatibility tolerance. Unknown policies fail closed. `StockBatchBalance.arithmeticPolicy` is `COMPATIBILITY` or `CANONICAL_V1`, inherited from the receipt movement and retained across REMOVE/MOVE. A single Item may hold batches with different policies. Compatibility projection keeps rounded recorded receipt totals, accepts only the existing tolerance, and recalculates remaining totals from the remaining quantity after removal; immutable movement rows are never rewritten. For a v2 movement with heterogeneous batches, parent `actualUnitWeightKg` and `actualUnitDimensionsM` are a compatibility summary copied from the first line; they are not an aggregate measurement.

For remaining batch quantity `q`, projected weight/volume are rounded from the batch unit measurements and `q`. An outbound of `r` units records canonical movement physical totals for `r`, while capacity/projection delta is `Balance(q) - Balance(q-r)`. These may differ by one precision unit; reconciliation compares each value against its own defined arithmetic rather than equating them.

`InventoryStockBalance` is a transactional projection keyed uniquely by `itemId`. It stores current Cell, per-receipt-batch remaining quantities and measurements, on-hand/held quantities, aggregate kg/m³, source version and reconciliation cursor. Its validation enforces unique batch IDs, nonnegative stock, held quantity not exceeding on-hand, and aggregate physical totals matching batch totals. MI-06A defines this model but does not write projection rows.

`InventoryItem` remains the metadata identity and its `quantity` keeps its original registration meaning. Physical quantities live in receipt batches and their ledger-derived stock projection. Inbound/outbound request lifecycle remains separate work for MI-06B/MI-06C; MI-06A does not mutate Item status or run any operation request.

Each version 2 batch line has optional immutable origin references for its receipt request and IMAGE-04 receiving evidence snapshot. Future inbound confirmation must verify the current accepted snapshot committed by inspection and reference it; confirmation must not create or attach that snapshot again. MI-06A defines the references without changing inspection or inbound behavior.

For legacy movements without a version or batch lines, the read-only fold creates a deterministic `legacy:<inboundMovementId>` batch identity. Legacy outbound quantity is allocated oldest receipt first, ordered by `performedAt` and then movement ID. Legacy relocation must match the current Cell, full current quantity, and previous placement pointer when present. Item ownership, placement, status, and counters are checked; corruption fails closed with a stable code.

## Capacity and reconciliation

The helper derives `EMPTY`, `PARTIAL`, `FULL`, or `UNKNOWN` from validated physical usage and capacity without writing `WarehouseCell.operationalStatus`. `FULL` means at least one hard kg/m³ limit is exhausted; geometry-specific fit still requires its own placement evaluation.

Counter reconciliation compares movement-derived aggregate stock against Cell counters and Reservation `usedCapacityM3`. It is a pure/read-only check and does not repair or rewrite counters. Callers must supply totals for the complete Cell or Reservation scope, not just one Item.

Stable error codes include `INVALID_MOVEMENT`, `NEGATIVE_STOCK`, `BATCH_MISMATCH`, `PLACEMENT_LINEAGE_INVALID`, `ITEM_PROJECTION_MISMATCH`, `CELL_COUNTER_MISMATCH`, `RESERVATION_COUNTER_MISMATCH`, `CAPACITY_UNKNOWN`, `CAPACITY_EXCEEDED`, and `FEATURE_DISABLED`.

## Write gate and compatibility

`MI06_STOCK_LEDGER_WRITES_ENABLED` defaults off. The exported gate permits opt-in only outside production; production always remains disabled in this phase. Existing MI-03B/MI-04/MI-05 movements remain schema v1 and append-only. No automatic migration/backfill occurs. A future dry-run should report per-Item ledger folds and Cell/Reservation counter mismatches before any approved backfill is considered.

The initial partial-outbound policy for later MI-06C is: Staff may confirm less than requested; commit only the physically delivered quantity, atomically release the unused hold, and close the request as `PARTIALLY_FULFILLED`. Any further withdrawal requires a new request. Relocation in the future MI-06 scope must be blocked while an unresolved outbound hold exists. IMAGE-04 snapshots are committed during inspection; inbound confirmation will verify/reference the accepted snapshot and must not recreate or reattach evidence.

## Verification boundary

Unit tests cover ledger folding, legacy lineage, batch arithmetic, negative stock prevention, corruption detection, counter reconciliation, capacity status and the feature gate. They do not establish MongoDB transaction rollback, unique-index races, or concurrent update behavior. The projection schema and version 2 ledger are not used by existing production operations in MI-06A.
