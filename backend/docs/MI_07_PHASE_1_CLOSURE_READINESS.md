# MI-07 Phase 1 — Managed Rental Closure Readiness

## Purpose and safety boundary

`GET /api/v1/reservations/managed/:id/closure-readiness` is a diagnostic snapshot only. It does not close a Reservation, release a CellAllocation or facility quota, change Item stock/state, create a movement or balance, or initiate payments/refunds. A future closure operation must independently revalidate its prerequisites inside an approved transaction; this response is neither a lock nor an authorization token.

The handler reads using a MongoDB snapshot transaction. Reads within the transaction are deliberately sequential on the same session. The scan is bounded at 2,000 Items; exceeding a safe scan boundary yields `UNKNOWN` rather than a partial positive result. Physical Rack capacity is also `UNKNOWN` when the full Rack Cell scope was not scanned. The snapshot is point-in-time and concurrent work may change state immediately after it is returned.

## Authorization and response

- CUSTOMER: must own the Managed Inventory Reservation; a non-owner receives 404.
- FACILITY_MANAGER: must be assigned to the Reservation's Facility; out-of-scope receives 403.
- ADMIN and BOM: retain the existing Managed Reservation read convention.
- Self-Storage Reservations and missing Reservations return 404. Invalid IDs return 400.
- Success uses the standard `{ "success": true, "data": ... }` envelope with HTTP 200.

The DTO includes Reservation identity/type/status/dates, evaluation timestamp and snapshot marker, physical/operational/allocation/financial/disposition/overall readiness, stock totals, outstanding request counts, allocation and Cell summaries, and machine-readable blockers. It does not expose details for Items belonging to another Customer; shared Cell physical usage is aggregated.

Readiness values are `READY`, `BLOCKED`, or `UNKNOWN`. `BLOCKED` means a known unmet condition; `UNKNOWN` means evidence is missing, inconsistent, unsupported, or bounded out. Phase 1 always leaves financial settlement and disposition policy unresolved, so `overallReadiness` is never `READY`.

## Stock and physical reconciliation

- Current stock is derived from committed ItemMovement history with `reconcileManagedItemStock()`, never from `InventoryItem.quantity`.
- `CurrentQty = SUM(IN) - SUM(OUT)`; MOVE changes placement only. Persisted StockBalance batch, movement, placement, quantity, and measurement projections are compared when present.
- Outstanding holds are derived through the existing hold reconciler. Legacy cases whose holds cannot be proven are `UNKNOWN`.
- Missing canonical StockBalance, corrupt movement lineage, mismatched projections, or incomplete scan yields a blocker and does not infer zero.
- Shared Cell usage includes all found Items currently in that Cell and is checked against stored Cell counters. Reservation capacity is compared with movement-derived Reservation volume. Rack/Zone/Facility hierarchy and Rack level weight limits are checked conservatively.
- A zero-stock Item does not release its allocation. Expired allocation dates are reported; no allocation is altered.
- Pending inbound/outbound requests and custody/inspection obligations block or make operational readiness unknown.

## Blocker codes

| Code | Meaning |
| --- | --- |
| `STOCK_REMAINING` | Reconciled positive on-hand stock remains. |
| `STOCK_LEDGER_UNKNOWN` | Movement history or legacy held quantity cannot be safely reconciled. |
| `STOCK_BALANCE_MISMATCH` | Persisted StockBalance differs from movement-derived stock/provenance. |
| `HOLD_OUTSTANDING` | Outbound stock is held or a hold cannot be reconciled. |
| `INBOUND_REQUEST_PENDING` | Repeated-inbound request remains unresolved. |
| `OUTBOUND_REQUEST_PENDING` | Canonical outbound request remains pending. |
| `CUSTODY_UNRESOLVED` | Inspection, custody, or return obligation remains. |
| `PLACEMENT_INCONSISTENT` | Placement/lineage is inconsistent (reserved for placement-specific findings). |
| `ALLOCATION_INCONSISTENT` | Allocation ownership, membership, dates, status, Cell, or hierarchy cannot be verified. |
| `PHYSICAL_COUNTER_UNKNOWN` | Cell/Reservation/Rack counters or physical limits cannot be verified. |
| `FINANCIAL_POLICY_UNRESOLVED` | Final settlement, waivers, refunds, or complete financial rules are not established. |
| `DISPOSITION_POLICY_UNRESOLVED` | Goods disposition and closure authority are not implemented or not yet eligible. |
| `SCAN_LIMIT_EXCEEDED` | The safe scan bound prevents a complete readiness assessment. |

## Example outcomes

Positive stock is `BLOCKED`:

```json
{
  "physicalReadiness": "BLOCKED",
  "overallReadiness": "BLOCKED",
  "stockSummary": { "currentQuantity": 3, "heldQuantity": 0, "availableQuantity": 3 },
  "blockers": [{ "code": "STOCK_REMAINING", "scope": "reservation", "message": "Movement history shows physical stock remains in this Reservation." }]
}
```

Zero stock can still be `UNKNOWN` because Phase 1 does not implement final financial/disposition authorization:

```json
{
  "physicalReadiness": "READY",
  "overallReadiness": "UNKNOWN",
  "stockSummary": { "currentQuantity": 0, "heldQuantity": 0, "availableQuantity": 0 },
  "blockers": [
    { "code": "FINANCIAL_POLICY_UNRESOLVED", "scope": "reservation", "message": "Additional charges, waivers, refunds and final settlement rules are not represented by current verified data." },
    { "code": "DISPOSITION_POLICY_UNRESOLVED", "scope": "reservation", "message": "End-of-term goods disposition and final handover policies are not implemented." }
  ]
}
```

Examples are illustrative; omitted fields are present in the complete response DTO.

## Postman

Import `backend/postman/WDP_MI06B_Repeated_Inbound.postman_collection.json` and `backend/postman/WDP_MI06B_Development.postman_environment.json`. Set `baseUrl` to the actual backend API base, then provide `customerToken`, `facilityManagerToken`, `otherCustomerToken`, `otherFacilityManagerToken`, `reservationId`, and `otherReservationId` as applicable. The added requests are manual examples and have not been executed against a live database.

## Verification limits

Unit/API controller tests use deterministic model/session mocks. No MongoDB connection or replica-set integration test was run. The snapshot transaction's behavior against the configured MongoDB deployment, real indexes/data shape, and concurrency with writers remains unverified here. Financial settlement and disposition policy are intentionally unresolved, so this endpoint must not be used to authorize actual closure.
