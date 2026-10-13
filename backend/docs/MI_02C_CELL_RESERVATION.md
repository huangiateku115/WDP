# MI-02C — Cell reservation and My Inventory map

MI-02C adds date-range Cell allocations to Managed Inventory booking. Customers may choose multiple Cells from the sanitized 2D map. Each Cell contributes configured geometric volume `widthM × depthM × usableHeightM`; `usableHeightM` must be measured/configured. The booking request sends `cellIds` and their summed `allocatedCapacityM3`. The server recomputes and validates the sum, then separately applies the existing Facility sellable-quota check.

## Allocation lifecycle

Creating a Managed reservation transactionally creates a temporary `HOLD` for every selected Cell, expiring with the existing Facility-configured reservation hold. Payment converts those allocations to `RESERVED`. Staff-confirmed inbound changes the matching allocation to `OCCUPIED` and still uses the existing atomic item, Cell counter, rental quota and movement transaction. Customer cancellation or Manager rejection before payment releases empty Cells. Expired holds are ignored for availability and become available in map results. No background expiry worker currently updates stale hold documents; the expiry timestamp is authoritative.

Rental intervals are half-open `[startDate, endDate)`. A Cell may be allocated to different reservations for non-overlapping periods if it has no physical inventory. A Cell with actual weight/volume usage is globally unavailable regardless of rental dates. Contract expiry or overdue status never releases physical occupancy. Because outbound/disposition is not implemented here, occupied allocations remain blocking until a future authorized workflow clears the physical counters and allocation.

## API and authorization

`GET /api/v1/warehouse-map?facilityId=...&startDate=...&endDate=...` and `GET /api/v1/racks/:id/detail-map?startDate=...&endDate=...` keep their existing fields and add per-Cell `bookingStatus`, `displayStatus`, `isMine`, `hasMyInventory`, `usedWeightKg`, `maxWeightKg`, `remainingWeightKg`, `usedVolumeM3`, `maxVolumeM3`, and `remainingVolumeM3`. Operational status stays independent from allocation/occupancy. Customer fields are booleans and aggregates only; responses do not include customer IDs, item data, reservations, or movement records. The map supports authenticated Customer browsing; structural management remains limited to Admin/BOM and assigned Facility Manager, and Staff keeps its existing read/operational permissions.

`POST /api/v1/reservations/managed` accepts:

```json
{
  "facilityId": "507f1f77bcf86cd799439011",
  "cellIds": ["507f1f77bcf86cd799439014", "507f1f77bcf86cd799439015"],
  "allocatedCapacityM3": 0.24,
  "startDate": "2030-01-01T00:00:00.000Z",
  "term": { "value": 1, "unit": "MONTH" }
}
```

The example assumes each selected Cell has 0.12m³ of configured usable volume. Customers can read only their own InventoryItems; only eligible REGISTERED items may be edited, while IN_STORAGE items remain Staff-managed. Staff can confirm inbound only to a Cell allocated to that item’s Managed Reservation.

## Concurrency and limits

Creation locks Facility quota, Zones, Racks and selected Cells in deterministic order inside one MongoDB transaction. Cell write tokens serialize competing selections; date-overlap checks and allocation inserts commit with the Reservation or all changes roll back. Inbound follows the existing item → Zone → Reservation → Rack → Cell ordering and validates the cell/reservation allocation before changing usage. Unit tests mock transaction behavior; they do not prove Atlas transaction retries or live multi-client contention.

The current frontend previously had no real warehouse map component. MI-02C adds a customer map panel to My Inventory and uses the backend APIs when backend mode is enabled. The existing demo data pages remain demo-backed. Payment-provider integration, background hold cleanup, outbound, relocation, disposition and real database integration remain outside MI-02C.
