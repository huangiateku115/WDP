# WDP-SEC-02 — Legacy Self-Storage Mock-Pay Production Containment

**Date:** 2026-10-28  
**Status:** Source guard and mocked regression coverage complete; not deployed.  
**Scope:** `ReservationController.mockPayReservation` and read-only PAID-status consumer audit.

## Authorization and boundaries

The Product Owner explicitly authorized WDP-SEC-02 in this conversation. This is a source-level containment change only. Existing dirty MI-06B/MI-07 changes were preserved. No database, real payment provider, Docker, migration, seed, commit, push, or deployment operation was performed. Managed Inventory payment behavior was not changed.

## Original issue and impact

`POST /api/v1/reservations/:id/mock-pay` is registered in `src/routes/reservation.routes.ts` behind authentication and role middleware. `ReservationController.mockPayReservation` additionally requires `CUSTOMER`. Before SEC-02, it had no environment guard and could update an owned Self-Storage Reservation matching `serviceType=SELF_STORAGE` and `status=CONTRACTED` to `PAID`, remove `expiresAt`, and append a `Mock Payment Webhook successful` status-history entry.

The handler did not create or verify a ReservationPayment or provider settlement. If vulnerable source were deployed, the status could be treated by downstream code as payment success. This is a source-level exposure, not evidence that exploitation occurred or that a vulnerable version is currently deployed.

## Exact mitigation and behavior

In `src/controllers/reservations/reservation.controller.ts`, the handler now permits execution only when `NODE_ENV` is exactly `development` or `test`. The existing Customer-role check runs first. All other environments—including `production`, staging, unset, empty, or unknown values—receive HTTP 404 with the existing `{ success: false, message }` envelope before Reservation reads/writes or Payment/Contract/status-history mutations.

In the allowed simulation environments, existing behavior remains: the conditional update still requires the caller's Reservation ownership, `SELF_STORAGE`, and `CONTRACTED`; it changes status to `PAID`, removes `expiresAt`, appends the existing status-history event, and returns the existing success response. It remains a mock and does not verify provider settlement. Request body fields and headers cannot bypass the environment guard, and the handler does not redirect callers to another payment endpoint.

## Authorization and scope preservation

- Route authentication and role middleware were not changed.
- Controller `CUSTOMER` enforcement remains.
- Owner, service type, and Reservation status filters remain in the single conditional update.
- No fake Payment record was added.
- Managed Inventory deposit, balance, and mock-pay flows were not changed by SEC-02.
- No unrelated route registration or consumer was changed.

## Regression coverage

`tests/reservation.test.cjs` verifies production, staging, and unset environment rejection, HTTP 404, and zero mocked Reservation reads/writes or Payment/Contract creates. It also verifies that a second simulation call cannot make another transition or append another status-history entry. `tests/managed-reservation.test.cjs` verifies the allowed development and test simulation paths retain the owner, service-type, and `CONTRACTED` filters and that a non-Customer role is denied.

Related focused verification was run with:

```text
npm run build
node --test tests/reservation.test.cjs tests/managed-reservation.test.cjs tests/managed-checkin.test.cjs tests/payment-accounting.test.cjs
git diff --check
git diff --cached --check
```

Results: backend build passed (exit 0); tests passed 113/113 (exit 0); both diff checks passed (exit 0). Tests use mocked models/controllers and do not establish real provider settlement, production deployment state, database rollback, or MongoDB concurrency.

## Related `PAID` consumer audit and separate findings

The broader consumer notes are in `WDP_SEC_02_SELF_STORAGE_MOCK_PAY.md`. The scoped audit found:

- Self-Storage `handoverReservation` requires `PAID`, then activates the Reservation and may mark its StorageUnit `OCCUPIED`. The handler does not visibly verify linked payment evidence, service type, or Facility scope. This is a separate trust-boundary finding; no consumer change is authorized here.
- Managed activation applies its existing Managed checks, including signed contract, rental interval, quota, and Facility.
- Reservation overlap/capacity logic treats `PAID` as occupying; the customer profile controller also uses `PAID` in its identity-card update guard. These are state consumers, not settlement verifiers.
- Generic Self-Storage deposit and balance mock endpoints have their own production-only guards; unknown-environment allowlisting differs from this strict SEC-02 guard and remains a separate review item.
- No provider callback/webhook capable of verifying these mock records was found in the reviewed Reservation routes. This was not a full payment-system audit.

## Deployment and historical payment risks

This change is not deployed. Operators must verify the patched backend version is running before considering the endpoint contained. No historical MOCK payments or Reservations already marked `PAID` were inspected, reversed, or reconciled. **No payment-provider settlement was verified.** Historical-record review and remediation require separate authorization and an approved financial policy.
