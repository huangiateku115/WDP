# WDP reservation payment foundation — P0/P1

This document records the approved redesign decision and the limited P1 foundation. It does not activate the redesigned lifecycle. Existing API workflows remain in place until a reviewed service-by-service patch.

## Repository impact review

The working tree already contains MI-02C backend changes and frontend booking/map work. Those changes were present before this pass and are preserved. The reservation aggregate is shared by SELF_STORAGE and MANAGED_INVENTORY. It currently has `estimatedRent`, `depositAmount`, optional `taxAmount`/`discountAmount`, one lifecycle status, and a legacy simulated-payment marker. There is no payment ledger or PayOS webhook route. `RentalContract` is unique per reservation and currently snapshots customer/pricing at Manager approval; contract signing is customer-only in the current route/controller. Self Storage booking currently creates a 24-hour `RESERVED` hold, then requires Manager approval (`CONTRACTED`) before contract signature and mock payment. Managed booking currently creates `RESERVED` plus Cell `HOLD`s, requires Manager approval and customer signature, mock payment changes the reservation to `PAID` and allocations to `RESERVED`, and Manager activation makes the quota `ACTIVE`. Inventory registration currently requires `ACTIVE`.

`managed-reservation.service.ts` previously wrote `totalDue = estimatedRent + depositAmount`, which treats the advance rent deposit as an extra charge. P1 changes this snapshot calculation to the final rental obligation (`rent + tax - discount`) and exposes the credited deposit and remaining balance separately. It does not initiate payments or move either workflow's lifecycle.

The SRS (`backend/docs/PROJECT_CONTEXT.md`, CF-01/02/09 and BR-01/06) describes an approval/contract-before-payment flow and says deposit/refund values need policy configuration, so it conflicts with this newer product decision. The product decision in this task takes precedence for future work. The SRS contains no currency rounding rule, no provider callback design, no post-deposit cancellation/refund decision, and no representative co-signature authorization detail.

## Proposed new lifecycle matrix

| Stage | SELF_STORAGE | MANAGED_INVENTORY | Payment/resource effect |
| --- | --- | --- | --- |
| Booking | Customer creates reservation | Customer creates reservation and selects one or more Cells | Reservation `RESERVED`; Unit or Cell allocations held temporarily; no approval or contract |
| Deposit succeeds | Reservation confirmed | Reservation confirmed; Cell allocations `HOLD` → `RESERVED` | Record one `DEPOSIT` payment; hold deadline no longer applies |
| Before handover | Wait for inspection/handover | Customer may register items and request inbound; Staff inspects goods | No physical occupancy counter, inventory location, movement, or rental activation yet |
| Handover agreement | Customer and authorized Facility representative sign the same contract version | Same contract-signing rule after goods inspection | Contract version and signers are recorded; representative authority and signature method still need detailed authorization rules |
| Balance succeeds | Reservation awaits physical handover | Reservation awaits initial inbound confirmation | Record `BALANCE` for `totalDue - successful deposit credit`; never charge deposit on top of rent |
| First handover/check-in | Staff hands over simulated access credential; reservation becomes `ACTIVE` | Staff-confirmed first inbound atomically updates reservation, allocation, item, physical counters and one movement; rental becomes `ACTIVE` | No activation or physical write before the specified handover/check-in action |
| Later operations | Existing lifecycle | Subsequent inbound follows the normal `ACTIVE` flow and does not require another initial contract/payment | Outbound/relocation remain out of scope |

For both services, the proposed new status should distinguish deposit confirmation from fully paid (`DEPOSIT_PAID`, or an equivalent explicit payment milestone); existing `PAID` must not be reinterpreted as deposit-only. Managed Cell exclusivity remains date-range based and transactional. A Cell with unknown physical counters stays unbookable; the payment foundation does not alter occupancy predicates.

## Shared accounting contract

`totalDue = estimatedRent + taxAmount - discountAmount`.

`depositCredit = successful DEPOSIT payment, capped by validation at totalDue`.

`balanceDue = totalDue - depositCredit`.

The quote helper rejects negative/non-finite amounts, discounts exceeding rent plus tax, and a deposit above the final rental amount. The version 2 Managed development path adds whole-VND half-up rounding; other currencies and live provider precision are not implemented. A zero balance does not require a zero-value payment record.

P1 adds a shared `ReservationPayment` record with purpose `DEPOSIT` or `BALANCE`, immutable economic identity, an idempotency key, provider reference, and pending/succeeded/failed status; P2 adds `RECONCILIATION_REQUIRED`. Unique indexes prevent reuse of an idempotency key, duplicate provider references, or more than one successful deposit/balance per reservation. Pure accounting helpers define amount calculation, same-key request matching, VND rounding and payment-state transitions. The version 2 Managed handler now creates/replays and confirms development MOCK deposit records. No live provider callback exists; database index behavior and atomic payment/reservation transitions still need isolated replica-set integration tests.

## Existing data compatibility

| Legacy data | Compatibility treatment |
| --- | --- |
| `RESERVED` | Preserve as the existing reservation/temporary-hold status; do not infer that any payment was made |
| `CONTRACTED` and existing DRAFT/SIGNED contracts | Preserve existing approval and signature history; do not auto-convert or recreate contracts |
| `PAID` | Preserve as the legacy paid milestone. `paymentSimulation` or status alone cannot be split into deposit and balance ledger rows |
| `ACTIVE`/`OVERDUE` and `usedCapacityM3` | Preserve rental and physical inventory state; do not activate, release or rewrite occupancy during payment migration |
| Cell `HOLD`/`RESERVED`/`OCCUPIED` allocations | Preserve date interval and physical occupancy safety; no payment status may release an occupied Cell |
| Missing payment ledger | Means purpose-level payment detail is unknown for a legacy reservation, not that the amount is unpaid or paid; no automatic ledger backfill |

No database migration or legacy-record rewrite is included in P1.

## Original P1 follow-up outline

1. Add an explicit `DEPOSIT_PAID` milestone without changing the meaning of legacy `PAID`.
2. In one transaction, validate the held reservation and selected Cells, persist/replay the `DEPOSIT` payment by idempotency key, move allocations `HOLD` → `RESERVED`, and record the deposit-confirmed status. Do not create a contract, activate the rental, or touch physical counters.
3. Permit owner item registration and inbound requests against deposit-confirmed Managed reservations while keeping Staff confirmation gated on signed contract, successful balance payment, category policy, quota and physical checks.
4. At initial Staff confirmation, atomically persist the `BALANCE` result (or verify its successful ledger row), first inbound movement, item/location, counters, allocation occupancy and `ACTIVE` transition. Replays must not double-charge or double-count.
5. Add isolated replica-set tests for duplicate provider callbacks, competing booking/payment transactions, abort rollback and unknown legacy Cell counters. Keep the current mock-only tests as unit coverage.

## P2 implementation status: gated Managed deposit path

The new Managed path is opt-in only when the backend runs with `NODE_ENV=development` and `MI_MANAGED_DEPOSIT_FLOW_ENABLED=true`. The frontend also requires `DEV` and `VITE_MI_MANAGED_DEPOSIT_FLOW_ENABLED=true` to show mock-payment controls. With either gate off, Managed booking keeps the legacy Manager/contract/payment workflow. New-path reservations are stamped with `bookingFlowVersion: 2`; the field is optional and absent from legacy rows. Legacy `CONTRACTED` and `PAID` records are never converted or treated as deposit-paid.

With the gate on, `POST /api/v1/reservations/managed` creates `RESERVED` plus temporary Cell `HOLD` allocations after existing customer, facility, quota, date-overlap, Cell lock, physical-counter, and pricing checks. It does not approve the reservation, create a contract, charge money, or write inventory. Version 2 quotes require VND pricing; rent and percentage deposit are rounded to whole đồng using non-negative half-up rounding. A zero deposit is rejected for this flow. `totalDue = rent + tax - discount`, `depositCredit = successful DEPOSIT`, and `balanceDue = totalDue - depositCredit`.

The customer calls `POST /api/v1/reservations/managed/{id}/deposit` with `{"idempotencyKey":"managed-deposit-{reservationId}"}` to create/replay a `PENDING` `DEPOSIT` ledger row, followed by `POST /api/v1/reservations/managed/{id}/deposit/mock-confirm` with the same body. These endpoints are customer-owner only, use a MOCK provider, and are not PayOS integration. A successful confirmation atomically records `SUCCEEDED`, transitions `RESERVED` → `DEPOSIT_PAID`, changes all live allocations `HOLD` → `RESERVED`, clears hold expiry and reservation expiry, and writes an audit event. It never sets `ACTIVE` or `OCCUPIED`, creates inventory/movements, or creates a contract. `DEPOSIT_PAID` consumes commercial quota and reserved Cells continue blocking overlapping bookings.

If mock confirmation arrives after the hold expired or reservation state changed, the ledger becomes `RECONCILIATION_REQUIRED`; the reservation and allocations are not promoted or reclaimed. This is a bookkeeping safeguard, not proof of real funds receipt. Resolution/refund workflow is absent. A version 2 `DEPOSIT_PAID` owner may register item metadata and queue an inbound request, but item edits, Staff confirmation, contract signing, balance collection and rental activation remain follow-up work. Staff confirmation still requires `ACTIVE`; the deposit itself creates no items, movement, or physical usage. Self Storage is unchanged.

Example initiation request:

```http
POST /api/v1/reservations/managed/66a100000000000000000001/deposit
Authorization: Bearer <customer access token>
Content-Type: application/json

{"idempotencyKey":"managed-deposit-66a100000000000000000001"}
```

```json
{"success":true,"data":{"payment":{"purpose":"DEPOSIT","amount":30000,"currency":"VND","status":"PENDING","provider":"MOCK"},"reservationId":"66a100000000000000000001","amount":30000,"currency":"VND","idempotent":false}}
```

Confirmation uses the same URL suffix `/deposit/mock-confirm` and the same JSON body. On success the response data contains `payment.status: "SUCCEEDED"`, `reservation.status: "DEPOSIT_PAID"`, and `idempotent: false`. A replay returns `idempotent: true`; a late result returns `reconciliationRequired: true` with payment status `RECONCILIATION_REQUIRED` and leaves reservation/Cell allocations unchanged.

Sequential and concurrent confirmation behavior has deterministic mock coverage, but no real MongoDB transaction, unique-index race, or replica-set concurrency test has been run. No migration, Atlas access, or record rewrite is included.

Cancellation after a successful deposit, refunds, provider timeout/late-success reconciliation, exact hold expiry policy after payment, currency rounding, representative signing authorization, and zero-balance completion still require product/payment-provider decisions before production integration.
