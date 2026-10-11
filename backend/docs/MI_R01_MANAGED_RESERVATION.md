# MI-R01 — Managed Inventory Reservation and Quota

MI-R01 rents a Facility-level Managed Inventory quota in cubic metres. It does not choose a Rack/Cell, create inventory, or update MI-01's map utilization. The existing Self Storage reservation routes keep their behavior and are explicitly restricted to `SELF_STORAGE` transitions.

## Configuration

Before accepting bookings, a Manager/Admin/BOM configures a Managed Facility capacity:

```http
PUT /api/v1/reservations/managed/capacity/{facilityId}
Authorization: Bearer <management token>
```

Initial JSON:

```json
{ "sellableCapacityM3": 100, "holdDurationMinutes": 60, "isActive": true }
```

`sellableCapacityM3` is an explicitly managed commercial quota; it is never inferred from Cell dimensions. `holdDurationMinutes` is required on first configuration. There is no default hold time. Updates may set one or more of `sellableCapacityM3`, `holdDurationMinutes`, and `isActive`. A capacity reduction below peak valid commitments is rejected. Admin/BOM can configure cross-Facility; a Facility Manager is restricted to `assignedFacilityId`.

An effective Managed price rule must match the exact term and use explicit `billingBasis: "PER_M3"`. `price` then means a rate per m3 for that exact configured term. Old Managed rules without the explicit basis are not used by this flow; Self Storage rules keep their existing shape and behavior.

An effective `DEPOSIT` Policy for `MANAGED_INVENTORY` must use:

```json
{ "calculation": "PERCENT_OF_RENT", "percentage": 20 }
```

The percentage is a per-Facility business setting; the application has no default. Unsupported, missing, or ambiguous policy/rule data fails quote and booking closed. Managed deposit policy creation/update validates this schema. Quote arithmetic is `rent = quotaM3 × ratePerM3` and `deposit = rent × percentage / 100`; no tax, discount, or additional deposit formula is applied by MI-R01.

## APIs and lifecycle

All routes require authentication. All dates are explicit ISO UTC. Rental periods are half-open `[startDate, endDate)`: adjacent periods do not overlap. DAY adds UTC calendar days; MONTH/YEAR add calendar months/years and clamp the day to the target month's last day (for example, Jan 31 + 1 month = Feb 28/29).

| Method | Path | Access |
|---|---|---|
| `POST` | `/reservations/managed/quote` | Customer |
| `POST` | `/reservations/managed` | Verified Customer |
| `GET` | `/reservations/managed/capacity/:facilityId?startDate=...&endDate=...` | Customer (aggregate availability), assigned Staff/Manager, Admin, BOM |
| `PUT` | `/reservations/managed/capacity/:facilityId` | Assigned Manager, Admin, BOM |
| `GET` | `/reservations/managed/:id` | Owner Customer or scoped Manager/Admin/BOM |
| `PATCH` | `/reservations/managed/:id/approve` | Assigned Manager or Admin |
| `PATCH` | `/reservations/managed/:id/reject` | Assigned Manager or Admin |
| `PATCH` | `/reservations/managed/:id/cancel` | Owner Customer, unpaid only |
| `PATCH` | `/contracts/:id/sign` | Contract owner; Managed contract requires valid hold |
| `POST` | `/reservations/managed/:id/mock-pay` | Owner Customer or test Admin/BOM, development flag only |
| `PATCH` | `/reservations/managed/:id/activate` | Assigned Manager or Admin |

Quote/create JSON:

```json
{
  "facilityId": "507f1f77bcf86cd799439011",
  "allocatedCapacityM3": 1.5,
  "startDate": "2030-01-01T00:00:00.000Z",
  "term": { "value": 1, "unit": "MONTH" }
}
```

The caller cannot provide owner, StorageUnit, price, deposit, status, payment result, or snapshot data. Create verifies the Customer Profile is `VERIFIED`, Facility is active and supports Managed Inventory, capacity is configured, and exactly one effective per-m3 rate and percent deposit policy apply. It returns a `RESERVED` reservation with `allocatedCapacity` in m3 and server snapshots. It never assigns a StorageUnit or Warehouse Cell.

Statuses are:

```text
RESERVED -> CONTRACTED -> PAID -> ACTIVE
    |            |
    +-> CANCELLED <-+
```

Manager approval verifies the live hold, creates exactly one DRAFT Contract and snapshots in one transaction. The Customer signs the contract via `/contracts/:id/sign`. Cancellation/rejection before payment releases the quota commitment. Payment consumes no real payment provider; it is recorded explicitly as simulated in reservation metadata/status history and append-only audit events. Activation is allowed only for a paid, signed reservation whose rental interval contains the current time. Activation enables quota only, not physical stock or a Cell assignment.

Development mock payment requires both `NODE_ENV` other than `production` and `MI_MOCK_PAYMENT_ENABLED=true`. It requires the signed Contract and unexpired hold, records `paymentSimulation.simulated=true`, provider `MOCK`, paid timestamp and status history. Production returns not found/disabled; this endpoint is not PayOS and must not be used to represent a real charge.

## Concurrency and quota availability

`ManagedFacilityCapacity` has a unique `facilityId` index and a `bookingVersion` write-lock counter. `ManagedReservationAudit` is an append-only event collection indexed by Facility/time and reservation/time. Create/configuration transactions increment that Facility record before checking/altering capacity commitments. MongoDB transactions use snapshot reads and majority writes. Contending bookings therefore serialize on one Facility quota document. Reservation/Contract transitions and their audit events commit or abort together.

Only Managed reservations in `RESERVED`, `CONTRACTED`, `PAID`, `ACTIVE`, or `OVERDUE` count. Unpaid `RESERVED`/`CONTRACTED` holds count only while `expiresAt > now`; expired unpaid records stop consuming quota without a fabricated expiry transition. Normal paid/active commitments use the half-open contractual interval `[startDate,endDate)`.

**Overdue release is intentionally conservative.** SRS says Managed overdue items remain stored until an authorized outbound or disposition resolves the physical obligation. `allocatedCapacity` represents contracted quota, not measured physical occupancy; MI-R01 has no authoritative measured occupied-m3, outbound-confirmation, disposition, or release record yet. Therefore an `OVERDUE` reservation retains its full contracted quota indefinitely for availability and blocks quota reductions below the unresolved obligation. An `ACTIVE` record whose `endDate` has passed is treated the same way even if an overdue transition job has not changed its status. Availability reports add `unresolvedOverdueObligationM3` as an aggregate; they never return reservation rows or customer identifiers. The commitment sweep uses the contractual start and extends unresolved obligations through the requested interval. Consequently, that amount is a protective commercial allocation, not a claim about actual occupied volume.

The concrete release model for a future phase should track three distinct measures: (1) contracted quota until the agreement is ended/amended; (2) measured physical occupancy from confirmed inbound/outbound movements; and (3) unresolved overdue/disposition obligations that block releasing the physical space until authorized outbound or disposition is audited. Release should require the appropriate authorized state transition plus evidence that no stock remains; a contract end date alone is insufficient. MI-R01 does not implement that release workflow because the SRS does not define the exact role, evidence, disposition outcomes, or whether unoccupied contracted quota can be released independently. Until that business decision and workflow exist, unresolved overdue capacity is not advertised as available.

The service clips regular commitments to the requested interval and sweeps start/end events to calculate peak simultaneous m3, then rejects if `peak + requested m3 > sellableCapacityM3`. Endpoints are half-open, so non-overdue capacity ending at the same instant another starts is reusable. An unresolved overdue obligation remains across adjacent/future intervals until separately resolved.

The capacity read endpoint and quote are advisory snapshots; only successful create atomically reserves a quota commitment. Cancellation and manager rejection acquire the same Facility lock in a transaction before changing status. Expiration is evaluated against the explicit configured hold timestamp.

## RBAC and integration boundaries

- Customer can quote/create their own verified reservation, read only their own details, cancel unpaid reservations, sign their Contract and use enabled development mock payment.
- Facility Manager and Facility Staff can read capacity only for their assigned Facility. Customer sees aggregate availability only; the response contains no reservation rows or ownership details. Admin/BOM retain authorized cross-Facility read scope.
- Facility Manager is scoped to assigned Facility for capacity management, review, and activation. Admin/BOM can configure capacity; approval/activation is Manager/Admin only. Staff receives no booking lifecycle changes.
- Existing generic reservation approve/reject/cancel/mock-pay and Self Storage inspections cannot transition a Managed reservation. Generic reservation detail routes expose only Self Storage data. Facility Manager reads also enforce assigned Facility scope.
- MI-02A's `requireActiveManagedInventoryReservation()` accepts this flow's `ACTIVE` record and its `allocatedCapacity` m3 value. Before activation it rejects item registration. After activation item registration still leaves `currentCellId=null`; MI-01 utilization remains unchanged until future Staff-confirmed inbound work.
- Commercial quota and actual Cell weight/volume/geometry are separate constraints. Passing the rental quota does not guarantee a physical Cell can hold the items.

## Postman walkthrough

1. Configure a Facility capacity and an effective Managed `PER_M3` price rule plus a Managed `PERCENT_OF_RENT` deposit policy.
2. Sign in as a verified Customer; quote then create with a future UTC start and exact term.
3. Sign in as assigned Manager/Admin; approve once and retain the created Contract ID.
4. Sign as the owning Customer using `/contracts/:id/sign`.
5. In development only, set `MI_MOCK_PAYMENT_ENABLED=true` and call mock-pay as the owner.
6. After the reservation start time, activate as assigned Manager/Admin.
7. Register an Inventory Item using this reservation. Verify item status `REGISTERED`, `currentCellId=null`, and unchanged warehouse-map utilization.

## Remaining limits and business decisions

- Per-Facility sellable quota, hold duration, exact per-m3 rates/terms, and deposit percentage must be configured by authorized staff; none is seeded or hardcoded.
- The selected deposit rule is percentage of rent. No currency rounding, tax, discount, cancellation/refund, or proration rule is defined here; these require a payment/accounting decision before production billing.
- The repository has no real payment entity/provider integration in this phase. PayOS signature verification, idempotent callbacks, settlement/refunds, and production payment activation remain future work.
- There is no automatic job transitioning expired holds to a terminal status. They are excluded from availability by `expiresAt`; a separate expiry workflow is still needed for clean lifecycle reporting.
- There is no authorized Managed outbound/disposition release API or measured occupancy aggregate yet. Expired ACTIVE and OVERDUE records conservatively retain full contracted quota; manual database status edits must not be used to release this capacity.
- Quota amendments, extensions, overdue/grace policies, physical inbound/outbound, and actual used-capacity aggregates are out of scope.
- Transaction/concurrency tests are mocks; a MongoDB replica set/Atlas was not used or written during implementation. Deployments must support MongoDB multi-document transactions.
- SRS still has unresolved rental/contract naming and date/time business details. This phase uses existing Reservation/Contract records and the deterministic UTC rules above.
