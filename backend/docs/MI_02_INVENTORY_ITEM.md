# MI-02A — Inventory Item Registration and Capacity Preview

MI-02A registers customer-declared item lots and exposes a read-only placement estimate. Registration records a description of intended inventory; it does not create physical stock, occupy a Cell, consume rental quota, or reserve capacity. Physical receipt and placement remain Staff-confirmed future work.

## Model and relationships

```text
User (CUSTOMER) ── owns ── InventoryItem
Facility ───────── scopes ─ InventoryItem
Reservation (ACTIVE, MANAGED_INVENTORY) ── authorizes ─ InventoryItem
InventoryItem ── preferredCellId? ── WarehouseCell
InventoryItem ── currentCellId=null until a later confirmed inbound
```

`InventoryItem` stores stable `itemCode` (unique per Facility, reserved after deletion), customer and Facility ownership, the Managed Inventory reservation reference, item metadata, quantity, per-unit physical values, server-derived totals, optional URL images, a preferred Cell, and its Managed Inventory lifecycle status. A unique Facility/itemCode index arbitrates duplicates. Registration and inbound request leave `currentCellId` null. Staff-confirmed inbound places the entire lot and creates actual usage; staff-confirmed outbound checks the entire lot out and releases measured physical usage. See [MI-02B Staff Inbound](MI_02B_STAFF_INBOUND.md) and [MI-04 Managed Inventory Outbound](MI_04_MANAGED_OUTBOUND.md).

`quantity` means a count of identical handling units in one registered lot. For example, quantity 2, quantityUnit `carton`, and unitWeightKg 20 means two identical cartons, 40 kg total. Partial handling of the lot is not supported by MI-02A.

## Managed rental eligibility

The shared read-only guard requires an existing Reservation with all of the following:

- `customerId` equals the authenticated customer;
- `serviceType` is `MANAGED_INVENTORY`;
- `status` is `ACTIVE`;
- `allocatedCapacity` is finite and greater than zero, interpreted as cubic metres (`m3`) per the SRS;
- its Facility is active, not soft-deleted, and supports `MANAGED_INVENTORY`.

The guard never creates or changes a Reservation. A Self Storage reservation, another customer's reservation, an inactive/expired Managed reservation, or a reservation without a valid capacity is rejected. The current Reservation creation service only creates Self Storage reservations, so MI-02A customers need an already-existing active Managed Inventory reservation. The Managed rental activation flow must provide these records before customer registration can succeed; this task intentionally does not fabricate them or change Self Storage booking behavior.

## API

Base path: `/api/v1`. All endpoints require authentication. JSON success responses use `{ "success": true, "data": ... }`; errors use the backend's standard error middleware.

| Method and path | Access |
| --- | --- |
| `POST /inventory-items` | Customer with an eligible Managed Inventory Reservation |
| `GET /inventory-items/me` | Customer; own non-deleted registration history, including closed rentals |
| `GET /inventory-items` | Staff/Manager assigned Facility; Admin/BOM according to existing global scope |
| `GET /inventory-items/:id` | Owner customer or scoped Staff/Manager/Admin/BOM |
| `PATCH /inventory-items/:id` | Owning customer; editable only while unplaced and `REGISTERED` |
| `GET /inventory-items/:id/placement-preview?cellId=:id` | Owner customer or scoped operational/management roles; advisory only |

Customers cannot choose `customerId`, `facilityId`, `createdBy`, status, current location, or derived totals. Facility comes from the eligible Reservation. `itemCode` is immutable after creation. Update accepts descriptive metadata only; there is no status transition, delete, inbound, relocation, outbound, or reservation endpoint here.

### Register an item lot

```http
POST /api/v1/inventory-items
Authorization: Bearer <customer access token>
Content-Type: application/json
```

```json
{
  "managedReservationId": "507f1f77bcf86cd799439021",
  "itemCode": "DOC-LOT-01",
  "name": "Archive cartons",
  "category": "DOCUMENTS",
  "description": "Two identical sealed cartons",
  "quantity": 2,
  "quantityUnit": "carton",
  "unitWeightKg": 20,
  "unitDimensionsM": { "widthM": 0.25, "depthM": 0.3, "heightM": 0.2 },
  "preferredCellId": "507f1f77bcf86cd799439041",
  "images": ["https://example.test/archive-carton.jpg"]
}
```

The service calculates volume and weight; client-supplied totals or ownership fields are rejected.

```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439031",
    "facilityId": "507f1f77bcf86cd799439011",
    "managedReservationId": "507f1f77bcf86cd799439021",
    "itemCode": "DOC-LOT-01",
    "quantity": 2,
    "quantityUnit": "carton",
    "unitWeightKg": 20,
    "unitDimensionsM": { "widthM": 0.25, "depthM": 0.3, "heightM": 0.2 },
    "unitVolumeM3": 0.015,
    "totalWeightKg": 40,
    "totalVolumeM3": 0.03,
    "preferredCellId": "507f1f77bcf86cd799439041",
    "currentCellId": null,
    "status": "REGISTERED"
  }
}
```

### Formulas

```text
unitVolumeM3 = widthM × depthM × heightM
totalWeightKg = quantity × unitWeightKg
totalVolumeM3 = quantity × unitVolumeM3
```

All dimensions and unit weight must be finite and strictly positive; quantity must be a positive safe integer. Derived results must also remain finite and positive. URL image references follow the shared HTTP/HTTPS validation and maximum count of ten.

### List and update

`GET /inventory-items/me?page=1&limit=20` returns the authenticated customer's non-deleted item registration history, including records whose Managed reservation is now closed or otherwise inactive. Individual reads verify the stored owner relationship; another customer's records remain hidden as 404. Customers cannot override identity or Facility scope with query parameters. Operational list filters include `facilityId`, `customerId`, `category`, `status`, `search`, `page`, and `limit`; Staff/Manager facility filters are forced to their assigned Facility.

`PATCH /inventory-items/:id` accepts only `name`, `category`, `description`, `quantity`, `quantityUnit`, `unitWeightKg`, `unitDimensionsM`, `preferredCellId`, and `images`. Totals are recomputed. The service denies changes once the item is not `REGISTERED` or has a physical current Cell.

## Placement preview

```http
GET /api/v1/inventory-items/507f1f77bcf86cd799439031/placement-preview?cellId=507f1f77bcf86cd799439041
Authorization: Bearer <customer access token>
```

If `cellId` is omitted, the item's preferred Cell is used. The candidate Cell must be in the item's Facility; its Zone must be active and its Rack/Cell must be `AVAILABLE`. The preview checks horizontal unit fit (including swapping width/depth), known usable height, total lot weight against Cell/level/rack rated limits, lot volume against known Cell volume, and the item's volume against its rental quota. It does not subtract registered items from quota: registration is not placement.

Example response for a 100 kg Cell:

```json
{
  "success": true,
  "data": {
    "itemId": "507f1f77bcf86cd799439031",
    "cellId": "507f1f77bcf86cd799439041",
    "advisory": true,
    "advisoryStatus": "NEEDS_MEASUREMENT",
    "estimatedFit": null,
    "allocationConfirmed": false,
    "reservationCreated": false,
    "stockWritten": false,
    "staffConfirmationRequired": true,
    "actualUsageKnown": false,
    "itemEstimate": { "quantity": 2, "unitWeightKg": 20, "totalWeightKg": 40, "unitVolumeM3": 0.015, "totalVolumeM3": 0.03 },
    "cellCapacity": { "maxWeightKg": 100, "maxVolumeM3": 0.15 },
    "rentalQuota": { "allocatedCapacityM3": 1.5, "itemVolumeWithinQuota": true },
    "checks": {
      "unitGeometryFits": true,
      "unitHorizontalDimensionsFit": true,
      "unitHeightFitsKnownClearance": true,
      "totalLotWeightWithinCellCapacity": true,
      "totalLotWeightWithinLevelRatedCapacity": true,
      "totalLotWeightWithinRackRatedCapacity": true,
      "totalLotVolumeWithinKnownCellVolume": true,
      "totalLotVolumeWithinAllocatedRentalQuota": true,
      "multiUnitPackingLayoutValidated": null
    },
    "uncertainty": [
      "ACTUAL_CELL_USAGE_NOT_AVAILABLE_IN_MI_01",
      "MULTI_UNIT_PACKING_LAYOUT_NOT_CHECKED"
    ],
    "notes": ["Advisory geometry/capacity preview only; no capacity is reserved and availability is not guaranteed."],
    "quantityPackingLayoutChecked": false
  }
}
```

This is explicitly an estimate, not a confirmed allocation, reservation, or availability promise. MI-01's `MI_01_EMPTY` utilization is a placeholder baseline, not measured stock. Therefore this preview reports `actualUsageKnown: false` and does not claim remaining Cell capacity. For quantity greater than one, the service does not calculate a physical packing layout or prove that units can be arranged within the Cell. Even when aggregate lot volume fits, `multiUnitPackingLayoutValidated` is `null`, `quantityPackingLayoutChecked` is `false`, uncertainty includes `MULTI_UNIT_PACKING_LAYOUT_NOT_CHECKED`, and the preview cannot return `ESTIMATED_FIT` solely from aggregate volume. If a Cell has no measured `usableHeightM`, height and volume checks return `null`, `estimatedFit` is `null` unless a known check already fails, and the response includes `USABLE_CELL_HEIGHT_NOT_MEASURED`. Blocked/Maintenance Cells, unavailable Rack/Zone, missing records, and cross-Facility candidates are rejected.

### CATEGORY policy gap

The backend defines `PolicyType.CATEGORY`, but `Policy.config` is a generic JSON object. The existing creation/update validator checks JSON safety and size only; it defines no category list shape, allowed/prohibited semantics, category identifier vocabulary, or conflict/precedence behavior. The resolver returns the effective policy document without applying category rules. Project requirements mention supported/prohibited categories only at a high level. MI-02A therefore does not validate item categories against a CATEGORY policy. The product/business owner must define: (1) canonical category IDs and whether they are extensible, (2) the exact config schema for allowed and prohibited categories, (3) behavior when both lists contain a category or neither list is present, and (4) policy scope/precedence across Managed Inventory and Facilities. Once decided, policy schema validation and item-registration enforcement can be added together.

## Ownership and authorization

- Customer identity and Facility are derived from the authenticated user and eligible Reservation. Another customer's item is returned as not found.
- Customer create/list/get/update and preview apply owner checks. Get and `/me` retain owner history after a reservation closes; creating, editing, and requesting a new placement preview still require an eligible active Managed reservation. Only `REGISTERED`, unplaced metadata is editable.
- Staff/Manager reads and preview are scoped to `assignedFacilityId` at service level. No item placement, mutation, or status-changing permission is added for staff in MI-02A.
- Admin/BOM follow the backend's existing cross-Facility management scope.
- The DTO is allowlisted. Customer responses omit internal `createdBy`, soft-delete fields, and Mongo `__v`; operational/management DTOs include `customerId` for facility handling but no other user profile data.

## Lifecycle and boundaries

Registration still starts at `REGISTERED`; an owner may request physical inbound to move the item to `PENDING_INBOUND`, and only assigned Staff may confirm it into `IN_STORAGE`. For normal in-term Managed rentals, the owner may request whole-lot outbound to move `IN_STORAGE` to `PENDING_OUTBOUND`; Staff confirmation moves it to `CHECKED_OUT`, while Staff rejection returns it to `IN_STORAGE`. Pending outbound retains its Cell. Customer metadata edits remain limited to unplaced `REGISTERED` items. `preferredCellId` is only a customer preference, is validated against the current active structure, and is not a reservation. A preferred Cell may become unavailable later.

Inbound and outbound atomically verify Managed ownership, physical location, immutable movement evidence, and usage aggregates. Outbound subtracts the measured dimensions and weight persisted by inbound, never editable Item metadata. An OVERDUE rental has no customer self-service outbound path; an explicitly authorized controlled-outbound policy remains future work. Relocation remains out of scope.

## SRS alignment and deviations

- SRS defines Managed rental quota in cubic metres. MI-02A interprets the existing `Reservation.allocatedCapacity` number as `m3`, validates it as finite and positive, and checks an individual lot against it only in the advisory preview.
- SRS physical placement is Staff-confirmed. MI-02A does not assign the preferred Cell or consume quota on registration; staff confirmation and inbound inventory writes remain future work.
- SRS reference diagrams describe six shelf levels, while the user-approved MI-01 implementation chose a 4-level × 4-cell Rack. MI-02A preserves that approved 4 × 4 layout; it does not change MI-01 or claim that the two physical layouts are equivalent.
- Quantity is treated as a lot of identical handling units. SRS does not fully specify split quantities; partial-unit handling remains unresolved and is not implemented.
- The current reservation creation API creates Self Storage reservations only. Active Managed reservations must be provisioned by a future Managed rental activation flow; MI-02A never fabricates one.
- No AI forecasting, auto-reordering, relocation, payment changes, or deployment is included. Managed outbound behavior is defined in MI-04.

## Frontend sequence and Postman scenarios

1. Obtain a customer access token and an existing active Managed Inventory Reservation ID.
2. Register the lot; use returned `totalWeightKg`, `totalVolumeM3`, `status`, and `currentCellId` as descriptive data.
3. Show the preferred Cell as a preference only. List own records with `/me`.
4. Call placement preview for a candidate Cell and display advisory/uncertainty prominently. Never show it as booked or placed.
5. Owner may request inbound and assigned Staff may review/reject. Physical confirmation routes are present, but successful confirmation remains blocked until the CATEGORY policy configuration decision is approved.

Postman coverage should include: no active Managed rental; Self Storage rental ID; inactive Facility/rental; spoofed owner/Facility/totals/status; duplicate itemCode; cross-customer item read; Manager/Staff wrong-Facility list; 100 kg Cell preview; blocked and Maintenance Cell; cross-Facility Cell; missing usable height; and assertions that `currentCellId` remains null and preview creates no writes.
