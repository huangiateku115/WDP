# MI-06B.1B — Customer Receipt Request API Foundation

This phase persists Customer receipt requests and their immutable command events. It does not inspect or confirm goods, append ItemMovement rows, write InventoryStockBalance, change placement/capacity, create contracts or payments, or change existing first/ACTIVE inbound handlers.

## Gate and compatibility

`MI06_REPEATED_INBOUND_ENABLED` is independent of `MI06_STOCK_LEDGER_WRITES_ENABLED`, defaults off, and is forced off in production. When off, CREATE and AMEND are disabled. Owner-scoped GET and history remain available, and CANCEL remains available only when request version, no-inspection and no-custody predicates pass. No Facility cutover is stored or activated.

The existing singular `POST /inventory-items/:id/inbound-request` and Staff `confirm-inbound` routes are unchanged. The new endpoints only accept an already `IN_STORAGE` Item with positive movement-reconciled stock, or a `CHECKED_OUT` Item with zero stock and a terminal OUTBOUND matching `outboundMovementId`. `InventoryItem.quantity` is never used as on-hand stock.

## API

All routes require authentication and CUSTOMER role. Ownership comes from the authenticated principal. Foreign or missing Items/requests return 404.

### Create

`POST /api/v1/inventory-items/:itemId/inbound-requests`

Requires `Idempotency-Key` and this strict JSON body:

```json
{
  "requestedQuantity": 4,
  "quantityUnit": "box",
  "declaredUnitWeightKg": 2.5,
  "declaredUnitDimensionsM": { "widthM": 0.2, "depthM": 0.3, "heightM": 0.4 }
}
```

Quantity must be a positive safe integer; `declaredUnitDimensionsM` must be a plain object containing exactly `widthM`, `depthM`, and `heightM`, each a finite positive number. Unknown keys, arrays, nulls, accessors, malformed prototypes and invalid numeric types are rejected for both CREATE and PATCH. Derived totals must remain finite. Quantity unit must match the Item registration unit. A transaction conditionally write-locks the in-term ACTIVE Managed Reservation as its first transactional database operation, re-reads the Item, reconciles all committed movement history, verifies current placement/allocation or terminal checkout lineage, and saves the request and CREATE event atomically. It does not acquire an Item write lock.

New creation returns HTTP 201. Same key and payload returns the original response snapshot with HTTP 200. Same key with a different payload returns 409. A different key while an unresolved request exists returns 409. Duplicate/transient/unknown-commit recovery performs at most four event lookups with short bounded delays; a visible committed event replays its original snapshot. If a commit result remains unknown after bounded recovery, the API returns 503 `INBOUND_REQUEST_OUTCOME_UNKNOWN`; the caller should retry with the same key. The unresolved partial unique index is a final safeguard; physical database index installation is not claimed by this code-only phase.

### History and detail

- `GET /api/v1/inventory-items/:itemId/inbound-requests?page=1&limit=20`
- `GET /api/v1/inbound-requests/:requestId`

History is owner-scoped, sorted by `createdAt DESC, _id DESC`, and paginated with a maximum limit of 100. Read access does not require an ACTIVE rental and continues after rental expiry or closure.

### Amend

`PATCH /api/v1/inbound-requests/:requestId` requires `Idempotency-Key`, `If-Match: "<version>"`, and a non-empty object containing one or more of the four create fields. The amended complete payload is validated. Amendment requires an in-term ACTIVE Managed Reservation, `PENDING_INSPECTION`, explicitly no inspection-attempt reference, and no custody. It uses a Reservation-first transaction, request document save with optimistic version checking, and an immutable AMEND event.

### Cancel

`POST /api/v1/inbound-requests/:requestId/cancel` requires `Idempotency-Key` and `If-Match: "<version>"`. It requires owner scope, `PENDING_INSPECTION`, no inspection-attempt reference and no custody. It deliberately does not require the Reservation to remain ACTIVE or in term. Request and CANCEL event are saved atomically.

Successful writes return the request DTO and an ETag containing its resulting version. Events retain operation, scoped key, payload hash/input snapshot, exact resulting request version and original response snapshot. Replays return that original snapshot, not current request state.

## Locking and transactions

Repeated inbound CREATE takes a conditional Item `__v` token first, then the Reservation eligibility token, re-reads and reconciles Item/ledger state, checks unresolved requests, and saves Request/Event atomically. It excludes `PENDING_OUTBOUND`. Outbound request, outbound confirmation and relocation check for unresolved receipt requests after taking the Item token. These checks always run, including when the repeated-inbound gate is off. First inbound and operations without an unresolved request retain their existing behavior. Cross-operation contention and recovery still require real replica-set verification.

CANCEL serializes on the request document version and event transaction. A future inspection implementation must use the same request CAS/event history; it is not included here.

## Errors

Errors use `{ "success": false, "message": "...", "code": "..." }` with stable codes for feature-off, invalid input, ineligibility, unresolved-request conflict, idempotency conflict and version conflict. Owner privacy uses 404.

## Verification limits

Mock tests do not establish MongoDB transaction, unique-index race, unknown-commit or concurrency safety. The transaction helper is bounded to 15 seconds and recovery has a fixed maximum of four event reads; unresolved unknown commits are surfaced as 503, never reported as successful without finding the committed event. Run the integration suite only against an explicitly authorized disposable local/test replica set. Do not use production, Atlas or an unknown URI. No migration, seed, backfill or index build is performed by this phase.
