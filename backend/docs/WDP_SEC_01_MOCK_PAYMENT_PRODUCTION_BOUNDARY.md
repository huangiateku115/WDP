# WDP-SEC-01 — MOCK Payment Production Boundary

**Date:** 2026-10-28  
**Status:** Source change and mock regression coverage complete; not deployed.  
**Scope:** Self-Storage generic MOCK deposit containment plus read-only review of adjacent MOCK endpoints.

## Approval and baseline

The Product Owner explicitly authorized WDP-SEC-01. Implementation preserves the current branch and all pre-existing staged, unstaged and untracked changes. No database, Docker, migration, seed, commit, push, deployment, or real payment operation was performed.

## Confirmed exposure and affected writes

Route `POST /api/v1/reservations/:id/deposit/mock-confirm` is registered in `src/routes/reservation.routes.ts` behind `requireAuth` and `requireRole(CUSTOMER)`. In `ReservationController.confirmMockDeposit`, the handler loads the Reservation, checks Customer ownership, then the Self-Storage path previously accepted `RESERVED` and:

1. Created a `ReservationPayment` with `purpose=DEPOSIT`, `provider=MOCK`, and `status=SUCCEEDED`.
2. Changed Reservation to `DEPOSIT_PAID`, linked `depositPaymentId`, removed `expiresAt`, and appended status history.
3. Created a DRAFT Contract if one did not already exist.

The generic path did not call a payment provider or verify a provider callback. Before WDP-SEC-01, no production guard existed, so production source could take this path. This confirms source reachability, not evidence that an exploit occurred.

## Change and runtime behavior

`src/controllers/reservations/reservation.controller.ts`, in `confirmMockDeposit`, now checks for `serviceType=SELF_STORAGE` and `NODE_ENV=production` after the existing ownership check and before the `RESERVED` validation or any Payment, Reservation, or Contract write. It returns the existing `{ success: false, message }` response envelope with HTTP 404.

Development and test simulation behavior is preserved. The request body still does not select provider, payment status, or amount; the controller derives the payment and writes the MOCK simulation as before. No API payload requirement was introduced.

### Managed Inventory compatibility

The Managed branch remains before the Self-Storage guard and was not modified by WDP-SEC-01:

- Managed v2 generic confirmation remains HTTP 409 and must use the dedicated versioned route.
- Managed legacy generic confirmation remains production-disabled and requires the existing explicit development/test simulation gate.
- The approved Managed legacy Reservation lifecycle CAS and `activeClosureRequestId` predicate remain unchanged.

No Self-Storage lifecycle fence or Managed stock workflow was introduced.

## Adjacent MOCK endpoint audit

| Endpoint / implementation | Classification | Source-level finding |
|---|---|---|
| `POST /:id/deposit/mock-confirm` → `ReservationController.confirmMockDeposit` | Production-blocked after this patch for Self-Storage; Managed v1/v2 retain their existing restrictions | Self-Storage non-production path remains a simulation, not provider verification. |
| `POST /:id/balance/mock-confirm` → `ReservationController.confirmMockBalance` | Production-blocked | The handler rejects `NODE_ENV=production` before loading Reservation. Non-production Self-Storage balance remains a MOCK simulation gated by signed contract proof. |
| `POST /:id/mock-pay` → `ReservationController.mockPayReservation` | Development/test-only after WDP-SEC-02; otherwise HTTP 404 before Reservation reads/writes | Owner-scoped Self-Storage `CONTRACTED` transition remains a mock and is not provider-verified. |
| `POST /managed/:id/deposit/mock-confirm` → `ManagedReservationService.confirmMockDeposit` | Development-only simulation with feature gate | Requires `NODE_ENV=development` and `MI_MANAGED_DEPOSIT_FLOW_ENABLED=true`; Managed v2 dedicated path. |
| `POST /managed/:id/balance/mock-confirm` → `ManagedCheckinService.confirmMockBalance` | Development-only simulation with feature gate | Requires the same Managed check-in gate; transitions the Managed mock payment and Reservation in its existing transaction. |
| `POST /managed/:id/mock-pay` → `ManagedReservationService.mockPay` | Production-blocked and feature-gated | Rejects production and requires `MI_MOCK_PAYMENT_ENABLED=true`; legacy Managed only. |

This targeted source review did not find an external provider webhook/callback route in the Reservation routes. It is not a complete payment-system or historical-record audit.

## Regression verification

`tests/reservation.test.cjs` covers the production rejection before payment creation and Reservation/Contract transition, preserved test simulation, owner rejection, invalid Reservation state, ignored client provider/status/amount fields, and existing Managed v1/v2 behavior. These are mocked controller/model tests. They do not prove provider settlement, database rollback, or MongoDB concurrency.

## Deployment and historical records

The fix is not deployed. Release operators must verify the patched backend version is running before treating the production endpoint as contained. This change does not inspect, reverse, or reconcile historical `MOCK/SUCCEEDED` payments or Reservations already marked `DEPOSIT_PAID`/`PAID`. Historical payment verification and remediation require a separately authorized, read-only first pass and an approved financial policy. No real provider settlement is established by MOCK records.

WDP-SEC-02 (2026-10-28) subsequently contained the adjacent generic `mock-pay` path to explicit `development`/`test` environments. The PAID-status consumer review and remaining trust-boundary questions are documented in `WDP_SEC_02_SELF_STORAGE_MOCK_PAY.md`.
