# MI-03B — Managed first inbound and rental activation

MI-03B extends the existing `POST /api/v1/inventory-items/:id/confirm-inbound` endpoint. Legacy records retain the prior ACTIVE-rental confirmation behavior. Version 2 Managed reservations may confirm their first physical inbound only after P3A has placed them in `CHECKIN_READY`.

## Lifecycle

```text
RESERVED + HOLD
  -- successful DEPOSIT --> DEPOSIT_PAID + RESERVED allocation
  -- inspection, signed current contract, settled BALANCE --> CHECKIN_READY + RESERVED allocation
  -- first Staff-confirmed inbound in rental period --> ACTIVE + destination OCCUPIED + item IN_STORAGE
  -- subsequent inbound --> ACTIVE + additional physical usage and INBOUND movement
```

The first inbound activates the rental in the same transaction that records physical occupancy. Only the selected destination allocation becomes `OCCUPIED`; every other selected allocation remains `RESERVED`. Subsequent inbound for v2 `ACTIVE` rentals does not repeat the initial signature or payment flow. Self Storage remains on its existing routes.

## Request and response

Only assigned `FACILITY_STAFF` can confirm inbound. The existing confirmation payload is retained:

```http
POST /api/v1/inventory-items/{itemId}/confirm-inbound
Authorization: Bearer <staff access token>
Content-Type: application/json
```

```json
{
  "cellId": "507f1f77bcf86cd799439016",
  "verifiedQuantity": 2,
  "actualUnitWeightKg": 20,
  "actualUnitDimensionsM": { "widthM": 0.25, "depthM": 0.3, "heightM": 0.2 },
  "physicalPackingConfirmed": true,
  "inspectionNote": "Two cartons physically checked",
  "idempotencyKey": "inbound-<stable-item-operation-key>"
}
```

The response shape is unchanged:

```json
{
  "success": true,
  "data": {
    "item": { "status": "IN_STORAGE", "currentCellId": "507f1f77bcf86cd799439016" },
    "movement": { "type": "INBOUND", "destinationCellId": "507f1f77bcf86cd799439016" },
    "idempotentReplay": false
  }
}
```

On the first v2 inbound, the persisted reservation transitions `CHECKIN_READY → ACTIVE`. A replay with the same idempotency key and identical measured payload returns the existing movement with `idempotentReplay: true`; it does not reapply counters or activation. Reusing the key with different content returns `409`.

## First-inbound checks

The service rechecks the assigned Staff Facility, active Managed Facility, rental interval `[startDate, endDate)`, and unresolved overdue restrictions. It verifies successful DEPOSIT and full BALANCE ledger settlement (or the explicit zero-balance settlement marker), both signatures for the current contract version/hash, and the contract snapshot for the inspected item. The item must still be `PENDING_INBOUND`; its ACCEPTED inspection must match current registration and final Staff measurements. The destination must be among both the reservation's selected Cells and the inspection-compatible Cells, and its allocation must belong to the same reservation/customer.

The Zone, Rack, Cell, and Facility must remain operational. Unknown or invalid physical counters fail closed, including counters of other Cells used to calculate the Rack/tier weight. Geometry, Cell weight/volume, level/Rack weight, category policy, and contracted reservation m3 limits are checked against persisted values. No client value can select or override quota or pricing.

## Transaction and idempotency

The transaction locks the item; for v2 it acquires the Facility booking-version lock before structural and reservation write locks, serializing against Managed contract, payment, and capacity operations. It then locks Zone → Reservation → Rack → Cell in deterministic order. Within that transaction it increments Cell weight/volume and reservation used m3, sets the reservation ACTIVE on first inbound, writes exactly one append-only `INBOUND` movement, marks only the destination allocation OCCUPIED, sets the item IN_STORAGE/currentCellId, and writes inbound/activation audit events. Any write failure aborts the transaction. MongoDB replica-set concurrency has not been verified by the mock tests.

## Limitations

Tests use deterministic model/session mocks. They verify the service transaction boundary and simulated serialization, not actual MongoDB transaction rollback or concurrent writes. No Atlas access or real database writes were used. Payment providers remain outside this patch; P3B only reads the P1 settlement ledger. Outbound, relocation, and Self Storage lifecycle changes are out of scope.
