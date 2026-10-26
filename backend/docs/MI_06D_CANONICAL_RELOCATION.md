# MI-06D — Canonical Managed Inventory Relocation

## Scope and compatibility

`POST /api/v1/inventory-items/:id/relocate-canonical` is the explicit Facility Staff endpoint for moving the complete positive remaining stock of an Item whose movement history can be reconciled into the MI-06 stock ledger. The existing `POST /inventory-items/:id/relocate` route and its legacy contract remain unchanged for legacy-only Items. Canonical-history Items are never sent through the legacy whole-lot writer.

The endpoint requires both `MI06_STOCK_LEDGER_WRITES_ENABLED=true` and `MI06_CANONICAL_RELOCATIONS_ENABLED=true`. The new gate defaults OFF and is forced OFF in production. A replay of an already committed idempotency key remains readable when the gate is OFF; a new write is rejected. This is not a production cutover or migration.

## Request

Headers: `Authorization: Bearer <Facility Staff token>`, `Idempotency-Key: <stable key>`, `Content-Type: application/json`.

```json
{
  "sourceCellId": "<current Cell ObjectId>",
  "destinationCellId": "<different allocated Cell ObjectId>",
  "physicalPackingConfirmed": true,
  "relocationNote": "Move to the allocated lower rack"
}
```

The body is strict. Client quantity, reservation, Facility, Customer, batch and movement fields are rejected. The service derives the full remaining quantity and physical batch lines from reconciled movement history. The staff member's assigned Facility, Item ownership, ACTIVE in-term Reservation, source placement, both Cell allocations, hierarchy, operational state, counters and capacity are verified server-side.

Success returns HTTP 200 with the existing API envelope and a result containing the Item placement, canonical MOVE movement, current quantity and `idempotentReplay`. Same key/same payload returns the original movement. Same key/different payload returns 409. Capacity, placement, ledger, allocation or hold conflicts return a structured 409. A transaction outcome that cannot be proven returns 503; retry only with the same key.

## Atomic behavior

Within one MongoDB transaction the service acquires locks in this order: Item `__v` token, optional Facility capacity token (booking flow v2), sorted Zone tokens, Reservation eligibility token, sorted Rack tokens, sorted Cell tokens. It then checks unresolved repeated-inbound requests and pending outbound holds, reconciles all affected Rack Cell counters plus Reservation usage from movement histories, validates StockBalance and placement lineage, verifies geometry/packing/Cell/Rack capacity, and applies the canonical MOVE and accounting updates.

The immutable schema v2 `RELOCATION` movement uses `CANONICAL_V1`; it includes one `MOVE` line for each positive remaining receipt batch and preserves receipt movement, request and inspection evidence provenance. The movement's parent quantity is the complete reconciled on-hand stock, never the Item registration quantity. StockBalance quantity, held quantity, batch quantities, Reservation physical usage and Item registration quantity do not change. Item and balance placement pointers advance to the MOVE movement. Cell counters move atomically. The source allocation remains OCCUPIED if other stock remains and becomes RESERVED only when empty; the destination allocation becomes OCCUPIED. Allocations are not released.

## Manual Postman setup

Import `backend/postman/WDP_MI06B_Repeated_Inbound.postman_collection.json` and `backend/postman/WDP_MI06B_Development.postman_environment.json`. Set `baseUrl` to the actual development backend port, Staff and Customer tokens, Item/Facility/Reservation IDs, and source/destination Cell IDs. The destination must already be allocated to the same ACTIVE Managed Inventory Reservation. The environment template deliberately does not assume port 3000.

Enable both gates only on a disposable development/test application instance. Do not enable either gate in production. Use a fixture with positive canonical-compatible stock (including the canonical partial REMOVE path if verifying multi-batch provenance), an existing valid StockBalance/checkpoint, zero HeldQty, no pending outbound request, no unresolved repeated-inbound request, reconciled Cell/Rack/Reservation counters and sufficient same-reservation destination allocation capacity. For multiple units or receipt batches, set `physicalPackingConfirmed=true` only after staff physically verifies the packing plan.

The collection includes the successful relocation, Item and StockBalance placement checks, movement and batch lineage inspection, same-key replay, source/destination Warehouse Map counter and occupancy projections, pending hold rejection, wrong-Facility rejection, insufficient-capacity rejection, and a post-relocation canonical partial-outbound request. The hold and insufficient-capacity requests require separate prepared Item fixtures. The Warehouse Map DTO exposes physical counters and derived `bookingStatus`; it does not expose raw CellAllocation documents or their owner IDs. Continue through the existing outbound inspection/confirmation requests to verify the resulting REMOVE movement.

### End-to-end sequence through zero stock and re-inbound

Use a disposable development fixture with an ACTIVE, in-term Managed Inventory Reservation, a Customer-owned Item, valid Facility Staff, two Cells allocated to that Reservation, enabled development-only repeated-inbound/ledger/outbound/relocation gates, and no unrelated unresolved requests. Populate Postman variables from the real fixture and use a fresh idempotency key for every new operation. Do not assume a default backend port.

1. Customer `POST /inventory-items/{{itemId}}/inbound-requests` with `Idempotency-Key: {{createKey}}` (expect `201`), then Staff queue/detail, evidence upload and accepted inspection; capture the returned request version and evidence-linked inspection attempt.
2. Staff `POST /inbound-requests/{{requestId}}/confirm` using `{{confirmKey}}` and the current `If-Match` version (expect first confirmation success; same key replay must return the committed result without changing stock).
3. Customer creates a partial canonical outbound request for the Item and desired quantity (expect `201`; same-key replay `200`). This creates a hold; do not relocate while it exists.
4. Staff confirms the actual partial quantity through the canonical outbound confirmation request (expect `200`). Verify StockBalance `onHandQuantity` fell by actual delivered quantity and `heldQuantity` returned to zero.
5. Customer creates a new request for the then-remaining quantity (fresh key; expect `201`). Staff confirms `outboundSecondActualQty` where `0 < outboundSecondActualQty < requestedQuantity`; the request becomes PARTIALLY_FULFILLED and unused hold releases atomically (expect `200`). Verify positive on-hand remains and `heldQuantity=0`. In the collection, use “Create next request for all remaining stock”, set `outboundSecondActualQty` below that requested quantity, then use “Confirm second request partially to release hold before relocation” and “Read positive quantity after releasing second hold”.
6. After all outbound holds are released, Staff calls `POST /inventory-items/{{itemId}}/relocate-canonical` with `sourceCellId={{sourceCellId}}`, `destinationCellId={{destinationCellId}}`, packing confirmation and a fresh `{{relocationKey}}` (expect success). Verify exactly one schema-v2 `RELOCATION`/`MOVE`, unchanged on-hand quantity, and Item/StockBalance current Cell set to destination.
7. Verify the rental still owns its allocated Cells and reservation capacity allocation is retained with the authorized Managed Inventory read `GET /reservations/managed/{{reservationId}}` (Customer owner or authorized Facility management token); confirm `allocatedCellIds` still includes source and destination. Use the Warehouse Map DTO separately for physical counters/derived booking status. Do not infer allocation retention from an empty Cell alone.
8. Customer requests all remaining stock from the new Cell with a fresh key (expect `201`); Staff confirms the full actual delivery with the current request version and fresh confirmation key (expect `200`), bringing stock to zero. Verify zero `onHandQuantity`/`heldQuantity` and one final REMOVE movement.
9. Customer creates a new repeated-inbound request for the same Item after zero stock (fresh `{{zeroReInboundCreateKey}}`; expect `201`). Staff performs a new evidence upload and inspection attempt, then confirms with fresh `{{zeroReInboundConfirmKey}}` and the current request version (expect `200`). The service may select an eligible Cell allocated to the same Reservation; a positive-stock Item may not change Cells.
10. Verify the new ADD movement links to the new accepted inspection attempt, old receipt/REMOVE/MOVE history remains intact, and StockBalance reflects only the new on-hand quantity at the selected Cell. Replay the same confirmation key and verify no duplicate stock or movement.

The collection includes a separate post-relocation continuation folder (items 13–20 plus final readbacks) for a final outbound request/confirmation to zero, allocation read, zero-stock re-inbound CREATE, Staff evidence upload and acceptance, receipt confirmation, and final StockBalance/movement reads. Set `remainingCurrentQty` from StockBalance after relocation and choose `zeroReInboundDestinationCellId` from the Reservation's current allocated Cells before running it. The folder uses dedicated idempotency keys and captures request IDs/versions into the selected Postman environment; select the re-inbound destination only when the Item has zero stock and no current Cell.

## Limits and verification

Unit tests use deterministic Mongoose model/session mocks and validate rollback paths, but they do not prove MongoDB transaction, write-conflict, unknown-commit, or concurrent capacity behavior. Real MongoDB replica-set integration verification is deferred by explicit user direction. No database, Docker, migration, seed, or external Postman run is part of this change. Confirm counter reconciliation and concurrency in an authorized test replica set before enabling these writes beyond manual development verification.

