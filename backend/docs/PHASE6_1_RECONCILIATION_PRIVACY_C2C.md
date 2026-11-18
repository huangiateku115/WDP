# WDP Managed V3 Phase 6.1 — Reconciliation & Customer Privacy

**TASK_ID:** `WDP_MANAGED_V3_PHASE6_1_RECONCILIATION_PRIVACY`  
**STATE:** `REVIEW_READY`  
**Branch:** `feat/managed-v3-sku-item-cell-redesign`  
**HEAD:** `aea47e0500a18a3d8e31df9dae46730ea3208287` (unchanged; no commit)

## Scope completed

- Customer warehouse-map responses now contain server-computed booking eligibility and ownership booleans without disclosing cross-customer physical use, rated/remaining capacity, rack utilization, or reconciliation reasons. Rack and Cell structural data remains available. The frontend presents a neutral state and does not convert redacted values into zero or “not configured”.
- Customer ownership highlighting no longer uses legacy `InventoryItem.currentCellId`; own allocation is still derived from scoped Cell Allocation. V4 stock-to-map ownership highlighting remains for increment 6.4.
- Customer V3 stock responses now pass through a customer-safe response projection: internal ledger/reason codes are removed; `RECONCILED` becomes `VERIFIED`, empty verified scope becomes `NO_ACTIVITY`, and unverified states become the generic `CHECKING` status.
- Facility diagnostics remain read-only and restricted to an assigned Facility Manager. Raw Cell stock diagnostics are no longer available to Facility Staff. Incomplete/truncated history or projection evidence cannot yield a complete Cell reconciliation. Empty Cells with complete evidence are emitted as `EMPTY_VERIFIED`; legacy records are explicitly `LEGACY_BLOCKED`. Level capacity remains `UNKNOWN` until every Cell in that level is `RECONCILED` or `EMPTY_VERIFIED`; measured overload is `MISMATCH`.
- No Visit, Access Session, stock writer, movement, allocation, reservation, or payment behavior was changed by this increment.

## Reconciliation contract

| Status | Meaning |
| --- | --- |
| `RECONCILED` | Canonical V4 replay, stock projections, Item Instances, allocations, physical Cell counters, and the applicable Reservation usage evidence agree within canonical precision. |
| `EMPTY_VERIFIED` | A configured zero-counter Cell with no movement/stock history and complete source evidence. |
| `MISMATCH` | Evidence exists and measured quantity/counters or configured capacity disagree. No automatic repair is performed. |
| `UNKNOWN` | Evidence is incomplete, unsupported, out of scope, or cannot establish a complete authoritative comparison. |
| `LEGACY_BLOCKED` | A legacy movement or legacy `currentCellId` record is associated with the Cell. It blocks V4 reconciliation; no history is reinterpreted or repaired. |

Facility diagnostics are bounded. A query reaching its evidence bound is not treated as complete. Rack-level physical utilization is not reported as reconciled merely because an individual SKU projection matches.

## Files changed in this increment

- `backend/src/controllers/inventory-items/managed-cell-stock.controller.ts` — apply customer-safe stock DTO at the HTTP boundary.
- `backend/src/controllers/inventory-items/managed-inventory-v3.controller.ts` — apply the same safe projection to the V3 stock route.
- `backend/src/routes/warehouse-map.routes.ts` — restrict cross-customer Cell stock diagnostics to management roles.
- `backend/src/services/inventory-items/managed-cell-stock-read.service.ts` — safe Customer status mapping, incomplete-source fencing, and stable Cell-before-Level reconciliation evaluation.
- `backend/src/services/warehouse-map/warehouse-map.service.ts` — remove legacy Customer Cell ownership lookup and redact shared physical use/capacity from Customer map DTOs.
- `backend/tests/managed-cell-stock-phase2.test.cjs`, `backend/tests/managed-cell-stock-read-privacy.test.cjs`, `backend/tests/warehouse-map.test.cjs` — privacy, reconciliation, overflow, and role tests.
- `frontend/src/components/customer/warehouse/CellInformation.jsx`, `frontend/src/components/customer/warehouse/DigitalWarehouseDashboard.jsx` — render redacted map capacity safely.
- `frontend/src/components/customer/inventory/ManagedUnifiedSelfInbound.jsx`, `frontend/src/components/customer/inventory/ManagedSelfInboundV3.jsx`, `frontend/src/components/customer/inventory/ManagedSelfOutboundV3.jsx` — use friendly verification states rather than internal reconciliation codes.
- `frontend/tests/customer-warehouse-cell-information.test.mjs` — redaction UI regression coverage.

## Validation

- Backend `npm run build`: **PASS**.
- Focused Backend command (`warehouse-map`, stock phase 2/read privacy, unified inbound domain, V3 relocation, access service, visit schedule): **106 passed, 0 failed**.
- Focused Customer Web command (`customer-warehouse-cell-information`, V3 relocation): **9 passed, 0 failed**.
- Full Customer Web `npm test`: **312 passed, 32 failed**. Failures include BOM oversight/contract tests, Customer payment and inventory loading, Managed Access, V3 inbound proof, same-day booking, PayOS return/checkout, and Self-Storage calendar tests. The inventory-loading test fails resolving `./ManagedSelfRelocationV3` from its test location. The V3 inbound proof tests assert A1/A2 helpers/contracts that are not part of the Unified Inbound flow. Several failures are in pre-existing dirty files; since the tree was already dirty at preflight, the full suite failures cannot be labeled baseline failures without a clean-baseline rerun. No unrelated fixes were made.
- Customer Web production build using Vite `--outDir` under the temporary directory: **PASS**. Existing `frontend/dist` was not touched. Vite reported the existing large-bundle advisory.
- `git diff --check`: **PASS**.
- No Docker, database connection/write, migration, production activation, or real operational test was performed.

## Limits and next gate

- Replica-set transaction behavior and live facility-counter reconciliation remain unverified.
- No browser E2E was run.
- Full Customer Web suite is not green; review the 32 failures before release. The Customer privacy focused tests and build pass.
- Phase 6.1 is ready for independent review only. Do not start 6.2 until the reviewer returns the explicit `APPROVED_NEXT` handshake naming `REVIEWED_INCREMENT: 6.1` and `NEXT_INCREMENT: 6.2`.
