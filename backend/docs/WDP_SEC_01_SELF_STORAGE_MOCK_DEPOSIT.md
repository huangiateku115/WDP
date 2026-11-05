# WDP-SEC-01 — Self-Storage MOCK Deposit Production Containment

**Date:** 2026-10-28  
**Scope:** Generic Self-Storage deposit confirmation only.

## Finding

`POST /api/v1/reservations/:id/deposit/mock-confirm` is authenticated and Customer-role restricted. Before this fix, its Self-Storage branch accepted an owned `RESERVED` Reservation, created a `ReservationPayment` with `provider=MOCK` and `status=SUCCEEDED`, transitioned the Reservation to `DEPOSIT_PAID`, and created a draft Contract without verifying a real provider settlement or rejecting production.

## Mitigation

`ReservationController.confirmMockDeposit` now rejects a `SELF_STORAGE` reservation when `NODE_ENV=production` with HTTP 404 before payment creation, Reservation mutation, or Contract creation. Development and test behavior remains available as before. The Managed branch keeps its prior protections: production denial, v2 routing to the dedicated versioned endpoint, and the explicit development/test simulation gate for legacy v1.

This is containment of an unverified mock settlement path. It does not verify historical MOCK payments, introduce a payment provider, or establish real settlement.

## Adjacent endpoint audit

At the time of this SEC-01 note, the separate generic `POST /api/v1/reservations/:id/mock-pay` (`ReservationController.mockPayReservation`) had no environment guard. WDP-SEC-02 subsequently restricts it to explicit development/test environments; see `WDP_SEC_02_SELF_STORAGE_MOCK_PAY.md` for details and the PAID-consumer audit.

Generic `confirmMockBalance` already rejects in production. Dedicated Managed mock deposit/balance endpoints are guarded by their respective Managed flow checks; these findings are not a full payment-system audit.

## Verification limits

Regression tests use mocked models/controller calls and prove the production guard returns before mocked writes. They do not prove database rollback or concurrency. No database, Docker, migration, seed, deployment, or production data operation was performed.
