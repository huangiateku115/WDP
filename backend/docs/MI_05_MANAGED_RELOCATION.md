# MI-05 — Managed Inventory Relocation

MI-05 lets assigned Facility Staff move a complete, physically stored `MANAGED_INVENTORY` lot between two distinct Cells in the same Facility. It leaves Self-Storage, reservation status, and contracted capacity unchanged.

## Lifecycle and API

Relocation leaves the item in `IN_STORAGE`, changes `currentCellId` from source to destination, frees the source allocation only when no other stored item occupies it, and marks the destination allocation `OCCUPIED`. Source Cell counters decrease and destination counters increase by the committed INBOUND movement's weight and volume. Reservation `usedCapacityM3` is reconciled but does not change.

```http
POST /api/v1/inventory-items/:id/relocate
Authorization: Bearer <facility staff access token>
Content-Type: application/json
```

```json
{
  "sourceCellId": "507f1f77bcf86cd799439031",
  "destinationCellId": "507f1f77bcf86cd799439032",
  "verifiedQuantity": 2,
  "physicalPackingConfirmed": true,
  "relocationNote": "Move the complete lot to the assigned Cell",
  "idempotencyKey": "relocation-job-2026-001"
}
```

`verifiedQuantity` must equal the item's complete lot. Multi-unit lots require `physicalPackingConfirmed: true`. The server does not accept client measurements. It loads the immutable inbound evidence, verifies the complete relocation chain, and uses those original measurements for all Cell counter changes. The destination must satisfy active Facility/Zone/Rack/Cell, geometry, category, per-Cell, Rack, and structural capacity checks. Both Cell allocations must belong to the item's ACTIVE Managed reservation; source must be occupied and destination reserved or occupied.

An identical replay with the same key returns the recorded relocation without applying counters again. Reusing a key with a different payload returns 409. Each successful move creates one immutable `RELOCATION` movement with source, destination, previous placement movement, staff actor, note, packing attestation, persisted quantity/measurements, and idempotency key. `InventoryItem.currentPlacementMovementId` points to the latest placement. The chain supports repeated relocation and outbound after relocation; older records without this pointer use the original INBOUND placement when it still matches the current Cell.

## Transaction and locking

The operation uses one MongoDB transaction. It serializes the item first, acquires the Managed v2 Facility booking version lock when applicable, then locks unique Zones, Reservation, unique Racks, and Cells/allocations in ascending ID order. It validates reconciled persisted usage, conditionally adjusts source and destination counters, updates allocation states and item location, writes one immutable movement, and appends the reservation audit event. Any failed check aborts the transaction. The Reservation remains `ACTIVE`; this operation does not release contracted allocation or close/check out the rental.

## Verification limits

Automated tests use deterministic Mongoose/session mocks. They exercise service sequencing, replay, lineage, and rollback paths but do not establish behavior against a live MongoDB replica set or prove real database transaction/concurrency guarantees. No migration/backfill is provided; invalid or incomplete historical movement evidence fails closed.

## Postman

Import `backend/postman/MI_05_Managed_Inventory_Relocation.postman_collection.json`. Set `baseUrl` in a Postman environment to `http://localhost:<actual backend PORT>/api/v1` (or the deployed API base URL). The backend reads `PORT` from its environment and falls back to 3000 only when unset; determine the port from the running process configuration rather than assuming it. Fill in `itemId`, source/destination Cell IDs, access tokens, and a fresh `relocationKey` before sending requests. The collection includes relocation, history, replay, validation, map read, and outbound-after-relocation calls.
