# MI-06B Repeated Inbound — API and Postman

## Manual verification scope

Import `backend/postman/WDP_MI06B_Repeated_Inbound.postman_collection.json` and `backend/postman/WDP_MI06B_Development.postman_environment.json`. This collection is for manual Postman verification against an explicitly authorized development/test WDP backend. It does not connect to, start, migrate, or seed a database.

The environment intentionally uses `http://localhost:REPLACE_WITH_BACKEND_PORT/api/v1`. Replace the port with the backend's configured `PORT`; do not assume port 3000. Use actual Customer and Facility Staff access tokens. The Staff user must have `FACILITY_STAFF` role and be assigned to the target Facility.

## Required starting state

For acceptance and canonical confirmation:

- The Customer owns an ACTIVE, in-term `MANAGED_INVENTORY` Reservation and an eligible Item belonging to the same Customer, Reservation, and Facility.
- The Item must be either `IN_STORAGE` with positive movement-reconciled stock and a current allocated Cell, or `CHECKED_OUT` with zero reconciled stock, no current Cell, and a matching terminal OUTBOUND movement.
- Current movement history, Cell counters, Rack counters, and Reservation `usedCapacityM3` must reconcile. The reservation must have sufficient remaining volume, and the target Cell must be allocated, available, measured, and within geometry, weight, volume, and Rack limits.
- Use a dedicated test reservation. The API does not mutate the Item's legacy `quantity` field.
- For confirmation only, run in `development` or `test` with both `MI06_REPEATED_INBOUND_ENABLED=true` and `MI06_STOCK_LEDGER_WRITES_ENABLED=true`. Both remain false by default; production is forced off. No Facility cutover is activated by this feature.
- To use evidence upload, configure development/test Cloudinary credentials on the backend. Public Cloudinary URLs are enabled only in development/test and are not private storage.

The rejection/discrepancy workflow should use a separate disposable request. The cancellation scenario must use a request that has not been inspected and has no custody. Never run the cancellation request after the acceptance path has begun.

## API inventory

Customer routes require authenticated `CUSTOMER`; missing and non-owned requests return 404.

| Method and path | Purpose | Key behavior |
|---|---|---|
| `POST /inventory-items/:itemId/inbound-requests` | Create a repeated receipt request | `Idempotency-Key`; new request 201; same-key replay 200; payload conflict 409 |
| `GET /inventory-items/:itemId/inbound-requests` | Paginated owner history | Stable newest-first ordering; available after rental closure |
| `GET /inbound-requests/:requestId` | Owner detail | Does not expose Staff evidence URLs |
| `PATCH /inbound-requests/:requestId` | Amend request before inspection | `If-Match` and operation `Idempotency-Key`; active, in-term reservation required |
| `POST /inbound-requests/:requestId/cancel` | Cancel safely before inspection/custody | `If-Match` and operation `Idempotency-Key`; remains available after expiry when safe |

Staff routes require authenticated `FACILITY_STAFF` assigned to the request Facility. Foreign Facility requests return 404.

| Method and path | Purpose |
|---|---|
| `GET /inbound-requests/receiving-queue` | Facility-scoped unresolved queue; optional `state`, `from`, `to`, `page`, `limit` |
| `GET /inbound-requests/:requestId/receiving` | Request, limited Item details, immutable attempts, and allocated Cells |
| `POST /inbound-requests/:requestId/evidence-uploads` | JPEG/PNG/WebP evidence upload, multipart field `file`, `Idempotency-Key` |
| `POST /inbound-requests/:requestId/inspection` | Append one inspection attempt; `If-Match`; decision and inspection key are in JSON body |
| `POST /inbound-requests/:requestId/return-completed` | Close a rejected request after explicit documented return; `If-Match`, `Idempotency-Key`, required `returnNote` |
| `POST /inbound-requests/:requestId/confirm` | Canonical receipt transaction; `If-Match`; body carries destination Cell, note and confirmation key |
| `GET /inventory-items/:itemId/stock-balance` | Owner-scoped Customer or authorized Staff materialized stock projection |
| `GET /inventory-items/:id/movements` | Existing movement history, including v2 receipt batch lines |

Canonical outbound and relocation read routes:

| Method and path | Scope and purpose |
|---|---|
| `GET /outbound-requests/staff-queue?state=PENDING&page=1&limit=20` | Facility Staff queue; stable oldest-first order, defaults to pending requests |
| `GET /outbound-requests/:requestId/staff-detail` | Facility-scoped request, Item, version and reconciled-stock display data; returns an ETag |
| `GET /inventory-items/:itemId/relocate-canonical/context` | Facility Staff only; verifies live reservation/placement/holds and lists currently allocated Cell choices |
| `POST /inventory-items/:itemId/relocate-canonical` | Existing canonical MOVE writer; server rechecks geometry and capacity |

The outbound folder includes the Staff queue and detail GET requests before the confirmation requests. The Staff token must belong to the Item Facility. These read endpoints do not change holds, movements, stock, request state, reservation state or counters.

## Inspection payload example

```json
{
  "decision": "ACCEPTED",
  "receivedQuantity": 4,
  "actualUnitWeightKg": 2.5,
  "actualUnitDimensionsM": { "widthM": 0.2, "depthM": 0.3, "heightM": 0.4 },
  "compatibleCellIds": ["<allocated-cell-id>"],
  "packingLayoutVerified": true,
  "custodyTaken": true,
  "note": "Receipt accepted and custody recorded",
  "evidenceUploadIds": ["<upload-id>"],
  "inspectionKey": "mi06b-inspect-000001"
}
```

Accepted quantity must equal requested quantity. `DISCREPANCY` preserves an immutable attempt and may be reinspected. `REJECTED` while the Facility holds goods enters `RETURN_PENDING`; Staff must separately call return completion with a note before the request closes as `REJECTED`. Earlier attempts and their evidence remain immutable.

## Confirmation payload example

```json
{
  "destinationCellId": "<allocated-cell-id>",
  "inspectionNote": "Physical receipt confirmed",
  "idempotencyKey": "mi06b-confirm-000001"
}
```

Confirmation references the accepted inspection snapshot already committed by inspection. It does not reattach evidence. It creates one canonical v2 INBOUND movement and receipt batch, reconciles/updates StockBalance, and updates Item placement and Cell/Reservation physical counters in one MongoDB transaction. It does not create a contract, signature, payment, or reservation activation.

## Conflicts and compatibility boundary

While a request is unresolved, the same Item's outbound request, outbound confirmation and relocation are blocked regardless of the repeated-inbound feature gate. If a canonical repeated receipt is committed, legacy MI-04/MI-05 outbound and relocation remain fail-closed for that Item because those writers use legacy whole-lot quantities. Canonical partial outbound uses its explicit canonical flow; canonical relocation uses `POST /inventory-items/:id/relocate-canonical` with `MI06_CANONICAL_RELOCATIONS_ENABLED=true` and the stock-ledger write gate. See `MI_06D_CANONICAL_RELOCATION.md` for its validation and accounting contract.

The Postman collection retains an explicit fail-closed check for legacy Staff relocation of a confirmed canonical receipt Item. The MI-06D folder separately verifies the new canonical MOVE endpoint, placement/balance/movement lineage and replay. The new relocation still requires manual development/test setup and has not been verified against a real MongoDB replica set.

An HTTP 503 after a write means retry the identical payload with the same operation key and then read request/movement/StockBalance state. The server performs bounded event recovery for unknown commits; if the event is not visible after that bound it does not claim success. Transaction rollback, unique index races, concurrent capacity updates, and unknown-commit recovery have not been verified against a replica set in this task.

## Canonical partial outbound request, hold and Staff confirmation (Phase B/C)

The collection also has a **Canonical partial outbound request and hold** folder. Use an Item with an existing, reconciled `InventoryStockBalance`, positive movement-derived on-hand stock, `IN_STORAGE` state, and an occupied Cell allocated to its ACTIVE Managed Inventory reservation. The Phase C subfolder confirms actual Staff delivery and writes canonical `REMOVE` movements.

New outbound holds require both development/test settings:

```env
MI06_CANONICAL_OUTBOUND_REQUESTS_ENABLED=true
MI06_CANONICAL_OUTBOUND_CONFIRMATIONS_ENABLED=true
MI06_STOCK_LEDGER_WRITES_ENABLED=true
```

All default to false; production forces canonical outbound request creation and confirmation off. The confirmation gate is separate so disabling creation does not silently switch existing canonical holds to the legacy whole-lot writer. Gate OFF permits owner-scoped request history/detail and safe cancellation of existing pending requests, and verified replay of a previously committed confirmation. New confirmations are blocked while the confirmation gate is OFF.

Customer API:

| Method and path | Purpose | Behavior |
|---|---|---|
| `POST /inventory-items/:itemId/outbound-requests` | Create quantity hold | Body `{ "requestedQuantity": 3 }`; `Idempotency-Key`; new request 201, same-key replay 200, payload conflict 409 |
| `GET /inventory-items/:itemId/outbound-requests?page=1&limit=20` | Paginated owner history | Newest first with stable `_id` tie-break |
| `GET /outbound-requests/:requestId` | Owner detail | Other Customers receive 404 |
| `POST /outbound-requests/:requestId/cancel` | Release a pending hold | `If-Match: "<version>"` and `Idempotency-Key`; returns 200 including replay |
| `POST /outbound-requests/:requestId/confirm` | Staff confirms actual delivered quantity | Staff Facility scope, `If-Match`, `Idempotency-Key`; same-key replay 200, changed payload 409 |

The request snapshot reports FIFO `batchAllocations`, `requestedQuantity`, `heldQuantity`, state, and version. Creation atomically updates per-batch and aggregate `StockBalance.heldQuantity`, then writes the request and immutable CREATE event in the same MongoDB transaction. `onHandQuantity`, Item legacy `quantity`, Item placement, movements, Cell counters and Reservation physical usage stay unchanged. Safe cancellation releases the exact stored allocation and writes its request transition and immutable CANCEL event atomically.

Legacy whole-lot outbound, legacy rejection, and relocation now fail closed while a canonical outbound request is pending. Those legacy paths also remain blocked for canonical repeated-receipt stock. After a hold is cancelled, legacy whole-lot behavior remains available only where the existing canonical-history guard allows it. This phase does not enable partial stock removal or relocation over canonical multi-batch stock.

The cancellation request can be replayed with the original key and original `If-Match` value after the state has changed; it returns the saved result without releasing twice. Use a separate disposable Item for any gate-OFF test so the enabled-run's pending request remains available for the cancellation scenario.

Staff confirmation requires `POST /outbound-requests/:requestId/confirm`, headers `If-Match: "<request-version>"` and `Idempotency-Key`, and this JSON body:

```json
{
  "actualDeliveredQty": 2,
  "handoverConfirmed": true,
  "handoverNote": "Staff confirmed actual handover"
}
```

`actualDeliveredQty` is a positive safe integer no greater than the held request quantity. Confirmation requires an active in-term Managed Inventory reservation, exact Customer/Facility/Item and occupied allocation scope, a pending request with matching version, and reconciled movement history, StockBalance, Cell counters and Reservation physical usage. The transaction consumes actual delivery from frozen FIFO holds, releases every unused hold, appends one immutable schema v2 `CANONICAL_V1` OUTBOUND movement with `REMOVE` lines and receipt batch IDs, then updates StockBalance, Item placement/status, Cell counters, Reservation usage, request and immutable CONFIRM event atomically. The legacy `InventoryItem.quantity` is unchanged. Partial fulfillment closes the request as `PARTIALLY_FULFILLED`; another withdrawal needs a new request. At zero stock the Item and StockBalance placement clear while the allocation remains owned; it becomes `RESERVED` only if no other stored Item remains in the Cell.

The existing Staff handover contract is preserved: `handoverConfirmed` must be true and a non-empty note is required. Current source has no separate outbound inspection/evidence endpoint, so Phase C does not invent one or reuse receiving evidence. Confirmation does not create or modify receiving inspection snapshots.

The collection verifies confirmation replay, request terminal-state rejection, StockBalance and movement batch-line reads, cross-Facility hiding, gate-OFF behavior, a new Customer request for the remaining CurrentQty, and final depletion to zero. To verify full depletion, create a second request for the exact remaining reconciled `CurrentQty` and confirm all of it, then verify placement cleared and allocation retained. A different stored Item in the Cell must keep the allocation `OCCUPIED`.

Mock-based tests do not prove transaction rollback, cross-operation concurrency, or unknown-commit recovery. These remain UNVERIFIED until authorized MongoDB replica-set integration tests are run. No database setup or connection is performed here.
