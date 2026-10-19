# MI-03A — Managed check-in, contract and balance

MI-03A adds the pre-inbound handover stage for version 2 Managed Inventory reservations. The flow is development-gated by `NODE_ENV=development` and `MI_MANAGED_DEPOSIT_FLOW_ENABLED=true`; mock payment only is available. Records without `bookingFlowVersion: 2` remain on the legacy contract and payment routes.

## Lifecycle

```text
RESERVED + Cell HOLD
  -- successful DEPOSIT --> DEPOSIT_PAID + Cell RESERVED
  -- Staff inspection / initial contract / both signatures / BALANCE --> CHECKIN_READY + Cell RESERVED
  -- MI-03B Staff-confirmed first inbound (future) --> ACTIVE + physical Cell usage + INBOUND movement
```

`CHECKIN_READY` is intentionally not `ACTIVE`. MI-03A never assigns an item to a Cell, changes Cell or quota usage counters, creates an `INBOUND` movement, or promotes an item to `IN_STORAGE`. Capacity commitments include `CHECKIN_READY` reservations. Item registration is allowed while a v2 reservation is `DEPOSIT_PAID`; once check-in reaches `CHECKIN_READY`, its contract/payment snapshot is closed to new item registrations. Inbound requests remain descriptive/request records only. Legacy reservations are not migrated or reinterpreted.

Staff inspections are versioned by audit records. An accepted inspection records observed quantity, unit weight and dimensions, the allocated Cells that can fit the goods, whether staff physically verified the packing layout for multiple units, custody state, note and timestamp. Acceptance requires verified empty physical counters and geometry/capacity fit; mismatched goods must be recorded as `DISCREPANCY`. Goods held by the Facility use `RECEIVED_PENDING_ACCEPTANCE` and `IN_CUSTODY`, outside committed inventory accounting. Rejected goods are recorded as returned and may be corrected and requested again. Inspections use the existing Zone → Rack → Cell write-lock order and never increment physical counters.

## API

All endpoints use `/api/v1` and require Bearer authentication.

Staff records physical receiving and inspection:

```http
POST /inventory-items/{itemId}/receiving-inspection
```

```json
{
  "decision": "ACCEPTED",
  "observedQuantity": 1,
  "observedUnitWeightKg": 20,
  "observedUnitDimensionsM": { "widthM": 0.2, "depthM": 0.2, "heightM": 0.2 },
  "compatibleCellIds": ["507f1f77bcf86cd799439016"],
  "packingLayoutVerified": true,
  "note": "Seal and measurements checked",
  "custodyTaken": true
}
```

Only assigned `FACILITY_STAFF` may inspect. `ACCEPTED`, `DISCREPANCY`, and `REJECTED` are supported. A rejected good cannot remain in Facility custody. Multi-unit acceptance requires `packingLayoutVerified: true` from the physical inspection; aggregate volume alone is not treated as proof that units can be packed.

An assigned Staff or Manager creates or refreshes the single initial contract:

```http
POST /reservations/managed/{reservationId}/contract
```

The response contains `currentContentVersion`, immutable `contentVersions[]` with SHA-256 hashes, and `signatures[]`. Contract content snapshots the reservation period and selected Cells, pricing snapshot, successful deposit credit, calculated balance, facility and accepted inspected handover items. Repeating the request with unchanged content returns the same contract/version. Changed inspected content creates a new version; signatures on earlier versions remain auditable but do not count toward current status.

The owner signs the current version:

```http
PATCH /contracts/{contractId}/sign
```

An assigned Staff or Manager for the same Facility signs the same hash/version:

```http
PATCH /contracts/{contractId}/sign/facility
```

The contract remains `DRAFT` after one signature and becomes `SIGNED` only when both roles signed the exact current version/hash. The legacy customer-only signature behavior remains scoped to legacy contracts; the v2 path is versioned and dual-signature.

After both signatures, the owner initiates and confirms the development mock balance:

```http
POST /reservations/managed/{reservationId}/balance
POST /reservations/managed/{reservationId}/balance/mock-confirm
Content-Type: application/json

{ "idempotencyKey": "managed-balance-<reservation-id>" }
```

The amount is calculated server-side as `totalDue - successful DEPOSIT amount`. The client cannot select the amount or payment purpose. Confirmation is transactional and idempotent. A zero balance moves directly to `CHECKIN_READY`, records a zero-balance audit event, and does not create an invalid zero-value payment ledger row.

## Security and limitations

Customer ownership, Staff/Manager assigned Facility scope and service-role checks are enforced in the service. Customers see only their own inventory inspections. Other Customers never receive item or reservation details. Old `mock-pay`, approve and activate paths remain legacy-only and cannot advance v2 records. V2 balance confirmation cannot activate a rental. No PayOS callback, money receipt, balance reversal/refund, post-custody dispute workflow, or P3B first-inbound activation exists yet. Development mock settlement is not evidence of real payment.

The tests use deterministic Mongoose/model mocks. They verify application transaction boundaries and expected state changes, but do not establish real replica-set transaction or concurrent-write behavior. Do not connect to or write the shared Atlas cluster for these tests.
