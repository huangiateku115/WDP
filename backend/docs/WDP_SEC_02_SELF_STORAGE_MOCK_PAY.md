# WDP-SEC-02 — Self-Storage Legacy MOCK-Pay Containment

**Date:** 2026-10-28  
**Status:** Source guard and mock regression coverage complete; not deployed.  
**Scope:** `ReservationController.mockPayReservation` only, plus read-only PAID-status consumer audit.

## Authorization and boundaries

The Product Owner explicitly authorized WDP-SEC-02. Existing dirty MI-06B/MI-07 work was preserved. No database, real payment, Docker, migration, seed, commit, push, or deployment operation was performed. Managed deposit, balance, and mock-pay workflows were not changed.

## Confirmed endpoint behavior before the fix

`POST /api/v1/reservations/:id/mock-pay` is registered in `src/routes/reservation.routes.ts` with authentication and role middleware. `ReservationController.mockPayReservation` additionally requires `CUSTOMER` and performs one owner-scoped conditional update matching:

- the requested Reservation ID;
- `customerId` equal to the caller;
- `serviceType=SELF_STORAGE`;
- `status=CONTRACTED`.

Before WDP-SEC-02, the handler had no environment check. It could transition the matching Reservation to `PAID`, clear `expiresAt`, and append a `Mock Payment Webhook successful` status-history event. It did not create or verify a ReservationPayment/provider settlement. This is a source-level production exposure if that code is deployed; it is not evidence that an exploit occurred.

## Mitigation

`src/controllers/reservations/reservation.controller.ts`, in `mockPayReservation`, now permits execution only when `NODE_ENV` is exactly `development` or `test`. For production, staging, missing/empty, or any other value, it returns HTTP 404 with the existing `{ success: false, message }` response shape before any Reservation read or write. Existing Customer-role enforcement, owner filter, Self-Storage service-type filter, and `CONTRACTED` status predicate remain unchanged in allowed environments.

The endpoint remains a development/test mock and does not represent real provider verification.

## Regression verification

`tests/reservation.test.cjs` verifies that `production`, `staging`, and unset `NODE_ENV` return 404 before Reservation query/update and before any mocked Payment/Contract writes. `tests/managed-reservation.test.cjs` verifies the generic Self-Storage mock-pay continues to work in both development and test, with the original owner, service-type, and `CONTRACTED` predicates. Existing non-owner rejection remains covered.

These are mocked tests. They do not verify a real payment provider or database transaction.

## PAID-status consumer audit

| Consumer | Source | Behavior / trust-boundary note |
|---|---|---|
| Self-Storage handover | `src/controllers/reservations/reservation.controller.ts`, `handoverReservation` | Requires `PAID`, then changes Reservation to `ACTIVE` and optionally marks its StorageUnit `OCCUPIED`. This method does not visibly verify linked deposit/balance Payment records, service type, or assigned Facility scope. The route is role-gated for Staff/Manager/Admin, but Facility scoping is not visible in this handler. This is a separate authorization/settlement review finding; not modified under SEC-02. |
| Managed quota activation | `src/services/reservations/managed-reservation.service.ts`, `activate` | Requires Managed `PAID`, a signed contract, active rental interval, valid quota, and active Managed Facility before setting `ACTIVE`. Managed mock-pay remains production-blocked and feature-gated. This review did not change that flow. |
| Reservation overlap and capacity accounting | `src/services/reservations/reservation.service.ts`; `src/services/reservations/managed-reservation.service.ts` | `PAID` is treated as an occupying/overlapping Reservation state. A mock-created `PAID` state can therefore affect later booking availability, reinforcing the need to keep mock transitions out of production. |
| Customer identity-card update guard | `src/controllers/users/customer-profile.controller.ts` | `PAID` Reservations block identity-card changes. This is a downstream policy effect, not a payment verifier. |
| Generic balance confirmation | `src/controllers/reservations/reservation.controller.ts`, `confirmMockBalance` | Production is rejected before Reservation lookup. Non-production Self-Storage mock balance still writes `MOCK/SUCCEEDED` and `PAID` after signed-proof checks. It was not changed under SEC-02. Its current guard is production-specific rather than a strict `development`/`test` allowlist; deployment environment policy should be reviewed separately. |
| Generic deposit confirmation | `src/controllers/reservations/reservation.controller.ts`, `confirmMockDeposit` | SEC-01 blocks Self-Storage in production and preserves non-production simulation. Unlike SEC-02's mock-pay endpoint, its Self-Storage guard is production-specific; missing or nonstandard `NODE_ENV` values are not explicitly denied. It remains outside SEC-02's narrow change. Managed v1/v2 restrictions remain unchanged. |
| Managed legacy mock-pay | `src/services/reservations/managed-reservation.service.ts`, `mockPay` | Rejects production and requires `MI_MOCK_PAYMENT_ENABLED=true`; its own Managed state and feature-gate logic remain unchanged. |

No provider callback/webhook capable of verifying these MOCK records was found in the reviewed Reservation routes. This is a targeted source audit, not a complete financial audit.

## Deployment and historical records

The fix is not deployed. Operators must verify the patched backend is running before considering the endpoint contained. This work does not inspect, reverse, reconcile, or alter historical MOCK payments or `PAID` Reservations. Real settlement must be confirmed through an approved provider-backed process; MOCK records alone are not settlement evidence.
