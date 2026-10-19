# MI-01 — Warehouse Map Foundation

MI-01 adds structural map data for Managed Inventory. MI-02B now tracks actual Staff-confirmed inbound through transactional Cell usage counters and immutable ItemMovement records. Only confirmed physical inventory contributes; REGISTERED and PENDING_INBOUND items do not. See [MI-02B](MI_02B_STAFF_INBOUND.md) for lifecycle and transaction details.

MI-02C adds customer-selected, date-range Cell holds during Managed reservation creation. See [MI-02C](MI_02C_CELL_RESERVATION.md) for allocation/display statuses, multi-Cell quota calculation and customer map behavior.

## Architecture and data relationships

```text
Facility (must be ACTIVE and include MANAGED_INVENTORY)
└── WarehouseZone
    └── WarehouseRack (Zone, aisle, 2D map coordinates)
        └── WarehouseCell (level, cell, dimensions, kg limit)
```

All three models use MongoDB ObjectIds, timestamps, and soft deletion. Codes stay reserved after deletion. Rack coordinates are unique within a Zone and aisle and remain reserved after deletion. Cells are generated with their parent Rack and are never physically removed. Indexes enforce Zone code per Facility, Rack code per Facility, Rack position per Zone/aisle, cell position per Rack, and cell code per Facility.

The default Rack is 2.0 m wide × 0.6 m deep × 2.0 m nominal height, with 4 levels, 4 cells per level, 500 kg per level, and 125 kg per cell: 16 cells and 2,000 kg nominal capacity. The usable height of a level is **not** inferred from rack height. Supply `usableHeightMByLevel` after measuring clearances; it may be omitted until measured. When configured, the sum of the usable clearances across all levels must fit within nominal rack height. This check does not invent beam or shelf thickness: teams must measure usable clearance separately. Each cell width is the Rack width divided by cells per level, and depth matches Rack depth.

Cells may have custom limits. For each level:

```text
sum(cell.maxWeightKg) <= rack.maxWeightKgPerLevel
ratedCapacityKg = rack.levelCount * rack.maxWeightKgPerLevel
allocatableCapacityKg = sum(all non-deleted cell.maxWeightKg)
cell.remainingWeightKg = max(0, cell.maxWeightKg - usedWeightKg)
```

The existing `maxWeightKg` DTO fields remain the rated structural limits for frontend compatibility. New `ratedCapacityKg` and `allocatableCapacityKg` fields distinguish the rack/tier rating from the sum of configured cell limits. For example, if one of sixteen cells is configured at 100 kg and the other fifteen remain at 125 kg, the rack reports 2,000 kg rated capacity and 1,975 kg allocatable capacity; the affected level reports 500 kg rated and 475 kg allocatable. Actual `usedWeightKg` and `usedVolumeM3` now sum persisted Cell counters, remaining weight clamps to zero, and the map reports `source: WAREHOUSE_CELL_COUNTERS`. Pre-inbound Cells default to zero; missing/failed usage reads are not represented as fabricated occupancy.

## API

Base path: `/api/v1`. All endpoints require a valid bearer token.

| Method and path | Purpose |
| --- | --- |
| `POST /warehouse-zones` | Create a Zone |
| `GET /warehouse-zones` | Paginated Zone list; filters: `facilityId`, `isActive`, `page`, `limit` |
| `GET /warehouse-zones/:id` | Zone detail |
| `PATCH /warehouse-zones/:id` | Update Zone name, description, color, sort order, or active flag |
| `DELETE /warehouse-zones/:id` | Soft-delete an empty Zone; returns 409 while any Rack remains |
| `POST /warehouse-zones/:id/restore` | Restore a Zone under an active Facility |
| `POST /racks` | Create a Rack and all its Cells in one transaction |
| `GET /racks` | Paginated Rack list; filters: `facilityId`, `zoneId`, `aisleCode`, `operationalStatus`, `page`, `limit` |
| `GET /racks/:id` | Rack detail |
| `PATCH /racks/:id` | Update aisle, dimensions, per-level capacity, map position, orientation, or operational status |
| `DELETE /racks/:id` | Soft-delete a Rack and its Cells only after all AVAILABLE cells are blocked or placed in maintenance |
| `POST /racks/:id/restore` | Restore a Rack and its Cells under an active Zone |
| `GET /rack-cells` | Paginated Cell list; filters: `facilityId`, `zoneId`, `rackId`, `levelNumber`, `operationalStatus`, `page`, `limit` |
| `GET /rack-cells/:id` | Cell detail |
| `PATCH /rack-cells/:id` | Update cell dimensions, kg limit, or operational status |
| `GET /warehouse-map?facilityId=:id` | Level 1 overview grouped Zone → aisle → Rack |
| `GET /racks/:id/detail-map` | Level 2 Rack → levels → Cells, displayed top to bottom |

Create Zone example:

```json
{
  "facilityId": "507f1f77bcf86cd799439011",
  "code": "HCM-A",
  "name": "Khu A",
  "description": "Khu lưu trữ phía bắc",
  "color": "#2563EB",
  "sortOrder": 1
}
```

Create a default 4 × 4 Rack. Coordinates are required and are integer grid positions:

```json
{
  "facilityId": "507f1f77bcf86cd799439011",
  "zoneId": "507f1f77bcf86cd799439012",
  "aisleCode": "A01",
  "rackCode": "A01-R01",
  "mapX": 0,
  "mapY": 0,
  "orientation": 0
}
```

Override one Cell to 100 kg and optionally record measured usable heights:

```json
{
  "facilityId": "507f1f77bcf86cd799439011",
  "zoneId": "507f1f77bcf86cd799439012",
  "aisleCode": "A01",
  "rackCode": "A01-R02",
  "mapX": 1,
  "mapY": 0,
  "cellCapacitiesKg": [
    [100, 125, 125, 125],
    [125, 125, 125, 125],
    [125, 125, 125, 125],
    [125, 125, 125, 125]
  ],
  "usableHeightMByLevel": [0.43, 0.45, 0.45, 0.42]
}
```

An overview response is an allowlisted read model. A Rack entry includes `_id`, `rackCode`, coordinates/orientation, nominal dimensions, operational status, cell counts, and utilization with legacy `maxWeightKg` plus `ratedCapacityKg` and `allocatableCapacityKg`. A detail response includes the Rack, overall rated/allocatable capacity, and levels in display order 4 → 1; each level reports rated and allocatable capacity while each cell includes `_id`, code, dimensions, max/used/remaining kg, operational status, and utilization status. Neither response contains soft-delete fields, layout version, ownership, or private customer data.

`GET /racks/:id/detail-map` response shape (the endpoint returns all four levels and every generated Cell):

```json
{
  "success": true,
  "data": {
    "rack": {
      "_id": "507f1f77bcf86cd799439013",
      "facilityId": "507f1f77bcf86cd799439011",
      "zoneId": "507f1f77bcf86cd799439012",
      "zoneCode": "HCM-A",
      "aisleCode": "A01",
      "rackCode": "A01-R01",
      "dimensions": { "widthM": 2, "depthM": 0.6, "heightM": 2 },
      "levelCount": 4,
      "cellsPerLevel": 4,
      "mapX": 0,
      "mapY": 0,
      "orientation": 0,
      "operationalStatus": "AVAILABLE"
    },
    "capacity": {
      "maxWeightKg": 2000,
      "ratedCapacityKg": 2000,
      "allocatableCapacityKg": 2000,
      "usedWeightKg": 0,
      "remainingWeightKg": 2000,
      "utilizationStatus": "EMPTY",
      "usedVolumeM3": 0,
      "source": "WAREHOUSE_CELL_COUNTERS"
    },
    "levels": [
      {
        "levelNumber": 4,
        "maxWeightKg": 500,
        "ratedCapacityKg": 500,
        "allocatableCapacityKg": 500,
        "usedWeightKg": 0,
        "remainingWeightKg": 500,
        "utilizationStatus": "EMPTY",
        "cells": [
          {
            "_id": "507f1f77bcf86cd799439014",
            "code": "A01-R01-L4-C1",
            "cellNumber": 1,
            "dimensions": { "widthM": 0.5, "depthM": 0.6 },
            "maxWeightKg": 125,
            "usedWeightKg": 0,
            "remainingWeightKg": 125,
            "operationalStatus": "AVAILABLE",
            "utilizationStatus": "EMPTY"
          }
        ]
      }
    ]
  }
}
```

The abbreviated JSON shows one Cell in the first level; production responses include every Cell in every level.

## Coordinates and status

- `mapX` increases left to right; `mapY` increases top to bottom. Coordinates are grid units, not meters. The FE positions Rack cards by these values and rotates them by `orientation` (0/90/180/270 degrees).
- `operationalStatus` is `AVAILABLE`, `BLOCKED`, or `MAINTENANCE` and describes whether a physical Rack/Cell may be used.
- `utilization.status` is computed separately: `EMPTY`, `PARTIAL`, `NEAR_FULL` (at least 90%), or `FULL`, based on actual Cell counter totals.
- Zone `isActive=false` hides it from the map but does not delete its structure.

## Authorization and lifecycle

| Role | Read management lists/details | Read overview/detail map | Create/update/delete structure |
| --- | --- | --- | --- |
| CUSTOMER | No | Yes, for any active Managed Inventory Facility before booking; sanitized DTO | No |
| FACILITY_STAFF | Assigned Facility only | Assigned Facility only | No |
| FACILITY_MANAGER | Assigned Facility only | Assigned Facility only | Assigned Facility only |
| BOM / ADMIN | Active Managed Inventory Facilities | Any eligible Facility | Any eligible Facility |

Authorization is checked in middleware and again in the service. Facility Managers and Staff must have a matching `assignedFacilityId`. Structural writes require an active Facility with `MANAGED_INVENTORY`; the selected Zone must be active and belong to that same Facility. Management RBAC remains strict: Customers cannot call management list/detail or write endpoints. Customers can browse the sanitized overview and rack detail before creating a reservation because MI-01 has no Managed Inventory reservation flow. These DTOs contain only structural map and capacity configuration fields; they never contain customer IDs, ownership, item details, movement history, or audit data.

Zone deletion returns 409 while any live Rack remains. A Zone with live Racks also cannot be deactivated; deactivate or delete its Racks first. Parent `structureVersion` writes serialize Rack creation against Zone deactivation/deletion, so a Rack cannot commit under a deleted or inactive Zone. Rack deletion returns 409 while any Cell is AVAILABLE; once all Cells are BLOCKED or in MAINTENANCE, the Rack and its Cells are soft-deleted in the same transaction. Restore requires the parent Facility/Zone to be active. No collection is physically deleted. Duplicate identifiers/positions and capacity conflicts return 409; malformed data returns 400; missing records return 404; unauthorized roles/scope return 401/403.

## Transactions and concurrency

Creating/restoring a Rack, generating/restoring all Cells, changing Cell limits, changing level capacity, and deleting a Rack run in a MongoDB transaction. The transaction boundary is required because a Rack must never be visible with a partial 4 × 4 layout. Zone updates/deactivation/deletion and Rack create/restore increment the Zone's internal `structureVersion` inside their transaction; concurrent operations conflict on that parent record and retry/check the resulting state. A Zone with any live Rack cannot be deactivated or deleted. Atlas supports transactions; this implementation does not require a local replica set. Unique MongoDB indexes arbitrate concurrent code/position collisions. Capacity changes also increment the parent Rack's `layoutVersion` inside the transaction so concurrent updates serialize on the same Rack document; after a transaction retry, limits are checked against the latest cell values. Cell and level capacity checks include all non-deleted Cells, independent of operational status.

## Frontend integration

1. Load the authorized Facility's `GET /warehouse-map?facilityId=...` response and draw Zone panels, aisle groups, and Rack cards at `mapX`,`mapY`.
2. Use `operationalStatus` for actionable availability and `utilization.status` for a separate utilization badge. MI-01 values are empty, not estimated stock.
3. On Rack selection call `GET /racks/:id/detail-map`; render the returned level array as top-to-bottom and each level's cells in `cellNumber` order.
4. Show configured kg limits and the explicit zero-usage baseline. Do not present a nominal rack height as measured usable clearance when `usableHeightM` is absent.
5. Management forms should send only allowlisted fields. Surface 409 conflicts and reload the map before retrying.

## MI-01 limitations

There are no separate InventoryStock, Location, or reservation-of-cell models, and no relocation reconciliation or image/upload service. Customer map access is pre-booking structural browsing only and does not create a reservation. Actual usage changes only after assigned Staff confirm inbound or outbound; pending requests preserve physical usage. The FE must distinguish empty cells from unconfirmed registrations. Category-policy config remains undefined, so inbound confirmation currently fails closed until the business decision is made. Customer map responses remain sanitized and never include items or movement history. See MI-04 for Managed outbound.

## Deterministic FE fixture

[`fixtures/mi-01-warehouse-map.mock.json`](./fixtures/mi-01-warehouse-map.mock.json) is a deterministic frontend fixture, not real database data. Its IDs, Facility, Zone, and Rack are mock values only; the fixture is never inserted into MongoDB and does not represent actual occupancy.
