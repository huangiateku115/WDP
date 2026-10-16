# MI-02C — Cell reservation and My Inventory map

MI-02C adds date-range Cell allocations to Managed Inventory booking. Customers may choose multiple Cells from the sanitized 2D map. Each Cell contributes configured geometric volume `widthM × depthM × usableHeightM`; `usableHeightM` must be measured/configured. The booking request sends `cellIds` and their summed `allocatedCapacityM3`. The server recomputes and validates the sum, then separately applies the existing Facility sellable-quota check.

## Allocation lifecycle

Creating a Managed reservation transactionally creates a temporary `HOLD` for every selected Cell, expiring with the existing Facility-configured reservation hold. Payment converts those allocations to `RESERVED`. Staff-confirmed inbound changes the matching allocation to `OCCUPIED` and still uses the existing atomic item, Cell counter, rental quota and movement transaction. Customer cancellation or Manager rejection before payment releases empty Cells. Expired holds are ignored for availability and become available in map results. No background expiry worker currently updates stale hold documents; the expiry timestamp is authoritative.

Rental intervals are half-open `[startDate, endDate)`. A Cell may be allocated to different reservations for non-overlapping periods if it has no physical inventory. A Cell with actual weight/volume usage is globally unavailable regardless of rental dates. Contract expiry or overdue status never releases physical occupancy. Because outbound/disposition is not implemented here, occupied allocations remain blocking until a future authorized workflow clears the physical counters and allocation.

## API and authorization

`GET /api/v1/warehouse-map?facilityId=...&startDate=...&endDate=...` and `GET /api/v1/racks/:id/detail-map?startDate=...&endDate=...` keep their existing fields and add per-Cell `bookingStatus` (current state), `periodStatus`, `isBookable`, `displayStatus`, `isMine`, `hasMyInventory`, `usedWeightKg`, `maxWeightKg`, `remainingWeightKg`, `usedVolumeM3`, `maxVolumeM3`, and `remainingVolumeM3`. Supplying both dates returns `requestedInterval`; omitting both dates shows current state and evaluates availability now. Date ranges use half-open overlap semantics. A future booking may therefore have `bookingStatus: AVAILABLE` and `periodStatus: RESERVED` at the same time. An occupied Cell stays unbookable for every requested period. Operational status stays independent from allocation/occupancy. Customer fields are booleans and aggregates only; responses do not include customer IDs, item data, reservations, or movement records. The map supports authenticated Customer browsing; structural management remains limited to Admin/BOM and assigned Facility Manager, and Staff keeps its existing read/operational permissions.

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

Managed booking now reuses the two-layer warehouse map to select multiple available Cells for the entered rental period. The frontend sums each Cell's configured geometric volume and sends the selected IDs and total; the backend independently recomputes both before quoting and booking. Booking selection is advisory until the create transaction commits. A conflict requires refreshing the period map and selecting again. My Inventory remains owner-scoped, and its map preference highlights/dims Cells based on server-derived ownership flags.

The map reports actual Cell weight/volume counters when available; it does not infer or fabricate item usage. Payment-provider integration, background hold cleanup, outbound, relocation and disposition remain outside MI-02C. Unit tests use deterministic Mongoose mocks. No live multi-client transaction or shared Atlas integration was run for this change.

### Legacy Cell counters

Older Cell documents may lack `usedWeightKg` or `usedVolumeM3`. The map keeps its numeric response fields normalized to zero for compatibility, but also returns `physicalUsageKnown: false`, hides remaining-capacity values, and marks the Cell unbookable until both counters are explicitly known. Reservation creation retains its transactional Cell write lock and matches only rows where both counters exist and equal zero; missing fields and any nonzero counter cannot pass the lock. It never writes zero over an existing value.

To normalize a legacy Cell, first verify it is physically empty through an authorized inventory reconciliation: inspect current item placements and inbound/movement history, then have facility staff confirm the empty Cell. Only after verification, use a reviewed migration that conditionally sets both counters to zero when both are still absent, scoped by Cell ID and expected versions, and records an audit entry. Do not blanket-backfill missing counters or modify any Cell with stock or uncertain history. This task does not run a migration or write database data.
