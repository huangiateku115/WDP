# MI-04 — Managed Inventory Outbound

MI-04 adds whole-lot outbound for `MANAGED_INVENTORY`. It does not change Self-Storage routes or lifecycle. Partial outbound, overdue/forced disposition, rental closure, and contracted quota release remain out of scope. Relocation is covered by [MI-05](MI_05_MANAGED_RELOCATION.md).

## Lifecycle and boundaries

```text
IN_STORAGE -- owner requests outbound --> PENDING_OUTBOUND
PENDING_OUTBOUND -- assigned FACILITY_STAFF confirms handover --> CHECKED_OUT
PENDING_OUTBOUND -- assigned FACILITY_STAFF rejects with reason --> IN_STORAGE
```

`PENDING_OUTBOUND` retains its original `currentCellId`; Cell weight/volume, reservation `usedCapacityM3`, and allocation remain unchanged until Staff confirms handover. Rejection restores `IN_STORAGE` and leaves location and counters untouched. A successful outbound clears the location and never changes `Reservation.status`, contracted `allocatedCapacity`, other Cell allocations, deposit, contract, or balance state.

Normal customer outbound is allowed only for the owning customer, a physically stored Managed Inventory item, its matching occupied Cell allocation, and a current in-term `ACTIVE` Managed rental. `OVERDUE` (and expired ACTIVE) reservations do not use this customer path. An authorized controlled-outbound policy for overdue rentals is a future workflow.

## API

All endpoints use `/api/v1`, require authentication, and return `{ "success": true, "data": ... }` on success.

| Method and path | Access | Effect |
| --- | --- | --- |
| `POST /inventory-items/:id/outbound-request` | Owning CUSTOMER | Move `IN_STORAGE` to `PENDING_OUTBOUND`; preserve Cell and counters. No body is accepted. |
| `POST /inventory-items/:id/confirm-outbound` | FACILITY_STAFF assigned to item's Facility | Confirm whole-lot handover; atomically subtract persisted inbound usage, write one OUTBOUND movement, and set `CHECKED_OUT`. |
| `POST /inventory-items/:id/reject-outbound` | FACILITY_STAFF assigned to item's Facility | Require a reason; restore `IN_STORAGE` without physical writes. |
| `GET /inventory-items/:id/movements` | Owner CUSTOMER or existing authorized reader | Return append-only INBOUND/OUTBOUND movement history. |

### Customer request

```http
POST /api/v1/inventory-items/507f1f77bcf86cd799439031/outbound-request
Authorization: Bearer <customer access token>
```

Example response:

```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439031",
    "managedReservationId": "507f1f77bcf86cd799439021",
    "currentCellId": "507f1f77bcf86cd799439041",
    "status": "PENDING_OUTBOUND",
    "outboundRequestedAt": "2026-10-16T04:00:00.000Z"
  }
}
```

The request is rejected with `409` for a duplicate pending request, an ineligible rental, or an item without a valid current Cell. Another customer's item remains hidden as `404`; Self-Storage is rejected. There is no partial-lot request shape.

### Staff confirmation

```http
POST /api/v1/inventory-items/507f1f77bcf86cd799439031/confirm-outbound
Authorization: Bearer <assigned staff access token>
Content-Type: application/json
```

```json
{
  "verifiedQuantity": 2,
  "handoverConfirmed": true,
  "handoverNote": "Two cartons handed to the customer",
  "idempotencyKey": "outbound-2026-0001"
}
```

`verifiedQuantity` must equal the complete registered lot, and `handoverConfirmed` must be exactly `true`. The server checks Staff Facility assignment, item/reservation/customer/Facility relationships, current Cell, and occupied allocation. It requires the item's persisted authoritative INBOUND movement and reconciles the Cell's and reservation's physical usage counters against all currently stored Managed lots. Missing, malformed, or inconsistent evidence fails closed.

The amount subtracted comes from the committed INBOUND movement's `actualTotalWeightKg` and `actualTotalVolumeM3`, never from mutable Item metadata or client input. The service follows `currentPlacementMovementId` and the immutable RELOCATION lineage to determine the current Cell, so outbound remains correct after one or more moves. OUTBOUND movement fields contain the current `sourceCellId`, `destinationCellId: null`, persisted quantity and measurements, Staff actor, handover note, and idempotency key. Existing INBOUND movement fields and history response remain compatible; outbound DTOs use `sourceCellId` plus a null destination.

```json
{
  "success": true,
  "data": {
    "item": { "status": "CHECKED_OUT", "currentCellId": null },
    "movement": {
      "type": "OUTBOUND",
      "sourceCellId": "507f1f77bcf86cd799439041",
      "destinationCellId": null,
      "quantity": 2,
      "actualTotalWeightKg": 40,
      "actualTotalVolumeM3": 0.03,
      "handoverNote": "Two cartons handed to the customer"
    },
    "idempotentReplay": false
  }
}
```

The existing unique `{ itemId, idempotencyKey }` index applies to both directions. A repeat using the same key and identical payload returns the original result without another decrement. Reusing the key with a different payload returns `409`; another key after checkout also returns `409`. Rejection requires `{ "reason": "..." }` and writes an immutable reservation audit event.

## Transaction and Cell allocation

Write locks follow the inbound order: **InventoryItem → Zone → Reservation → Rack → Cell/allocation**. The transaction revalidates the stored current location and allocation, verifies authoritative INBOUND movements, reconciles counters with all physically stored lots, conditionally decrements the Cell, decrements reservation physical usage, creates exactly one immutable OUTBOUND movement, updates the item and allocation, and appends an audit event. Any failure aborts all writes. Same-item concurrent confirmation is serialized by the item write token; shared reservation and Cell locks serialize other physical operations.

After checkout, an allocation remains `OCCUPIED` if another physically stored item remains in that Cell. If the Cell is empty, its allocation becomes `RESERVED` under the same reservation. Other selected Cells remain unchanged. The Cell never becomes bookable under another reservation merely because this lot left.

## Audit and limitations

The system appends `OUTBOUND_REQUESTED`, `OUTBOUND_CONFIRMED`, or `OUTBOUND_REJECTED` to Managed reservation audit history. ItemMovement remains append-only. No migration or backfill is provided; a physically stored item without valid inbound movement evidence cannot be checked out through this endpoint. Legacy version 1 Managed reservations remain supported when ACTIVE and in term.

Tests use deterministic Mongoose/session mocks. They cover authorization, request preservation, whole-lot confirmation, idempotency, concurrency serialization, allocation behavior, counter reconciliation, movement rollback, rejection, and legacy ACTIVE Managed eligibility. They do not prove live replica-set transaction behavior. No Atlas/production database is accessed.

## Verification and Postman

Run the focused backend tests with:

```powershell
cd backend
npm run build
node --test tests/managed-inbound.test.cjs tests/managed-outbound.test.cjs
```

The Postman collection is [`postman/MI_04_Managed_Inventory_Outbound.postman_collection.json`](../postman/MI_04_Managed_Inventory_Outbound.postman_collection.json). Use dedicated test identities and an already ACTIVE Managed reservation; do not point it at production.
