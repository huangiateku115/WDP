# MI-02B — Staff Inbound and Actual Usage

MI-02B adds physical receipt for a whole registered lot and replaces MI-01's empty-usage adapter with transactional Cell counters. It does not implement outbound, relocation, transfer, partial intake, quota extensions, payments, or inventory forecasting. No legacy REGISTERED item is backfilled as physical stock.

## Lifecycle and API

```text
REGISTERED -- customer request --> PENDING_INBOUND
PENDING_INBOUND -- assigned Staff confirms --> IN_STORAGE
PENDING_INBOUND -- assigned Staff rejects --> REGISTERED
```

All paths use `/api/v1` and require authentication.

| Method and path | Access and effect |
| --- | --- |
| `POST /inventory-items/:id/inbound-request` | Owner CUSTOMER; requires an ACTIVE, in-term Managed Inventory rental and active Managed Inventory Facility. Sets pending only; no Cell or quota usage changes. |
| `POST /inventory-items/:id/confirm-inbound` | FACILITY_STAFF assigned to the item's Facility only. Confirms the entire lot into one Cell. |
| `POST /inventory-items/:id/reject-inbound` | Assigned FACILITY_STAFF only; requires a non-empty reason and returns pending item to REGISTERED. |
| `GET /inventory-items/:id/movements` | Owner CUSTOMER or authorized operational/management reader. Returns an allowlisted immutable history. |

Confirmation example:

```json
{
  "cellId": "507f1f77bcf86cd799439041",
  "verifiedQuantity": 2,
  "actualUnitWeightKg": 20,
  "actualUnitDimensionsM": { "widthM": 0.25, "depthM": 0.3, "heightM": 0.2 },
  "physicalPackingConfirmed": true,
  "inspectionNote": "Two cartons weighed and measured",
  "idempotencyKey": "receipt-2026-0001"
}
```

The server derives item ownership, Facility, Managed reservation, quantity unit, quota, rack/cell hierarchy, and final lifecycle state. Actual unit weight must match the registered value rounded to 0.001 kg; dimensions match rounded to 0.000001 m. Any discrepancy returns 409 and leaves the item pending for correction/rejection. Quantity greater than one requires an explicit Staff packing attestation. It is an operational attestation, not an automatic physical packing calculation.

The read-only placement preview subtracts persisted `WarehouseCell.usedWeightKg` / `usedVolumeM3` and `Reservation.usedCapacityM3` from their respective limits. The response includes current and remaining usage and sets `actualUsageKnown: true` when these stored counters are valid. A missing measured usable height remains unknown. For quantity greater than one, preview remains advisory and explicitly returns `multiUnitPackingLayoutValidated: null`; aggregate volume does not prove a physical packing arrangement.

## Fit and usage invariants

One InventoryItem is an indivisible lot of identical handling units placed in exactly one Cell. Unit width/depth may be rotated by swapping those two dimensions; no other rotation is assumed. Measured `usableHeightM` is mandatory. Nominal Rack height is not treated as usable clearance.

```text
unitVolumeM3 = actual widthM × depthM × heightM
lotWeightKg = actual unitWeightKg × quantity
lotVolumeM3 = unitVolumeM3 × quantity
```

The whole lot must fit the Cell geometry and volume, Cell kg maximum, aggregate level kg rating, aggregate Rack kg rating, and the Managed reservation's remaining contracted m3 quota. Values are rounded for persisted counters to 0.001 kg and 0.000001 m3. A lot is not split across Cells. Managed `allocatedCapacity` remains contracted quota; `usedCapacityM3` is the separate physical consumption and inbound never releases or changes the contracted quota. An OVERDUE Managed rental blocks new inbound until authorized disposition resolves it; time passing alone never releases physical occupancy.

`WarehouseCell.usedWeightKg` and `usedVolumeM3` are transactional materialized counters with zero defaults. `Reservation.usedCapacityM3` is the matching physical quota aggregate. `InventoryItem.currentCellId` plus append-only `ItemMovement` records are the reconciliation evidence. Only successful inbound increments these counters; REGISTERED and PENDING_INBOUND records contribute zero. Movement rows are protected by update/delete middleware, indexed for item/Facility/reservation history, and have a unique item/idempotency-key index.

## Transactions and concurrent writes

Confirmation uses a MongoDB multi-document transaction. It serializes locks in this order: item state token, active Zone `structureVersion`, Managed Reservation `inventoryVersion`, Rack `layoutVersion`, Cell conditional capacity update, then the matching Cell allocation. The destination must be allocated to the item's Managed reservation. The Reservation token serializes different Rack placements against one quota; Rack token serializes different Cells on that Rack; Cell update includes atomic kg and m3 capacity predicates. Item status, location, counters, reservation usage, allocation status, and the unique movement commit together or roll back. Replays with the same key and same destination return the prior movement; another key or location after confirmation returns a conflict. Transaction contention is surfaced as a safe 409/retry response.

Warehouse structural changes use Zone then Rack lock order. Rack deletion and capacity/dimension reductions reject occupied structures. Blocked or Maintenance state prevents new inbound but does not erase or hide stored usage. All counters are read from Cell documents; a read/aggregate error is not replaced with a synthetic empty result.

## Warehouse map response

The existing overview and rack detail keep their legacy capacity fields and add actual Cell-counter usage with `source: "WAREHOUSE_CELL_COUNTERS"`. Detail cells include `usedWeightKg`, `remainingWeightKg`, `usedVolumeM3`, and measured-volume limits when height is known. Levels and Racks aggregate the same Cell counters and retain rated/allocatable capacity values. Customer map DTOs contain spatial/capacity data only; they omit customer IDs, item metadata, ownership, reservation records, and movement history.

Example for a 100 kg Cell after a hypothetical committed 40 kg inbound:

```json
{
  "maxWeightKg": 100,
  "usedWeightKg": 40,
  "remainingWeightKg": 60,
  "usedVolumeM3": 0.03,
  "utilizationStatus": "PARTIAL"
}
```

No current customer receipt is represented by this documentation example. Tests construct deterministic in-memory fixtures; no Atlas writes or seed runs were performed.

## CATEGORY policy

An effective `PolicyType.CATEGORY` policy must be configured for the same Facility and `MANAGED_INVENTORY` service. Its `config` has exactly two fields:

```json
{
  "allowedCategories": ["DOCUMENTS", "FURNITURE"],
  "blockedCategories": ["HAZARDOUS"]
}
```

Both arrays are required; the allowlist must be non-empty. Values are trimmed and normalized to uppercase, with no duplicates. A blocked category is denied even if also present in the allowlist. Any category absent from the allowlist is denied. Staff-confirmed inbound resolves the effective policy inside the same transaction; no effective policy, invalid legacy config, or multiple effective policies fails closed with 409 before writes. Policy creation and config updates validate this schema. Customer item registration remains compatible and does not resolve policy; enforcement happens at inbound confirmation.

## Postman acceptance walkthrough and integration limits

1. Configure one effective CATEGORY policy for the active Managed Inventory Facility, then register an item against an already provisioned ACTIVE Managed reservation.
2. As the owner, submit inbound request and verify PENDING_INBOUND while map usage is unchanged.
3. As assigned Staff, inspect actual quantity/weight/dimensions, measure usable Cell clearance, and submit confirmation fields. Test mismatch, no clearance, blocked state, expired rental, overdue rental, cross-Facility destination, quota/capacity conflict, category denied by blocklist, category absent from allowlist, and multi-unit attestation.
4. Verify one IN_STORAGE item, one INBOUND movement, matching Cell and Reservation counters, matching idempotent replay, and map usage. A reused key with a different destination, measurements, quantity, or inspection note returns a conflict.
5. As Staff reject a pending item with a reason; verify it returns to REGISTERED and usage remains unchanged.

The Managed reservation provisioning and resolution of overdue inventory depend on MI-R01/business workflows. MongoDB multi-document transactions require a transaction-capable deployment; deterministic Node tests cannot prove live Atlas contention behavior. No Atlas connection, live transaction, Postman run against a live backend, or shared-database integration was performed for this task.
