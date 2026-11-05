# WDP-SEC-03B.1 — Unsafe Activation Containment

**Date:** 2026-10-28  
**Status:** BLOCKED / PARTIAL — fail-closed guards are present, but end-to-end safe activation cannot be claimed until the separately authorized transaction/CAS hardening is approved.  
**Branch / HEAD:** `feat/mi07-managed-rental-closure` / `7a5cd84b7f1ba7e5076f268276fc49dbee0b138e`.

## A. Authorization and operational impact

Product Owner authorization is present in this conversation and explicitly accepts that legitimate production Self-Storage handovers may be temporarily rejected. Generic Self-Storage handover and legacy CHECK_IN activation are restricted to exact `NODE_ENV=development|test`. This is intentional fail-closed behavior and is not deployed. Existing dirty work was preserved; no payment provider, database, Docker, migration, seed, commit, push, or deployment operation was performed.

## B. Before/after route behavior

| Route/path | Current containment behavior | Consequence |
|---|---|---|
| `POST /api/v1/reservations/:id/handover` | Outside development/test returns 404 before Reservation access. In development/test, only a scoped Self-Storage `PAID` Reservation with a same-Facility linked non-deleted StorageUnit may proceed. | Production/unknown legitimate handovers are unavailable until settlement verification and continuity approval. Managed Inventory is rejected and must use its dedicated activation path. |
| `PATCH /api/v1/inspections/:id/complete` for `CHECK_IN` | Outside development/test returns 404 before activation writes. In development/test, requires a `PAID` Self-Storage Reservation and matching Inspection/Reservation/StorageUnit Facility and identity, plus actor assigned Facility match. | Production/unknown legacy CHECK_IN activation is unavailable. `CHECK_OUT` remains unchanged. |

## C. Facility authorization and service isolation

Handover preserves existing route role middleware and rejects all actors without `assignedFacilityId` equal to the Reservation Facility. This also prevents unassigned Admin cross-Facility access. Inspection completion is routed to Staff/Manager/Admin/BOM; the CHECK_IN branch requires assigned Facility equality for all of them, so unassigned Admin/BOM and all cross-Facility attempts fail closed. Handover rejects Managed Inventory; legacy inspection completion retains its Managed Inventory rejection. Dedicated Managed activation was not changed.

Handover validates `Reservation.facilityId` against `StorageUnit.facilityId`, uses the Reservation's `storageUnitId`, rejects missing/deleted unit records, and applies a conditional Reservation update for Self-Storage + PAID + exact Facility/unit. CHECK_IN validates `Inspection.reservationId`, `facilityId`, `storageUnitId` against the loaded Reservation and unit, then conditions Inspection and Reservation writes on their expected identities and statuses.

## D. Payment and status trust

`PAID` is not treated as proof of provider settlement. No PAYOS verification/callback, financial settlement, or historical payment remediation was implemented. MOCK/SUCCEEDED remains simulation evidence only. Existing generic mock deposit/balance and SEC-01/02 protections were not changed by this patch.

## E. Development/test compatibility and regression results

Approved development/test simulations remain available subject to the new scope/state/link checks. Mock tests cover production/unknown early rejection, Managed handover denial, cross-Facility Staff denial, missing/mismatched StorageUnit in handover, CHECK_IN linkage rejection, an eligible development CHECK_IN, existing handover success/non-PAID behavior, and Managed payment regressions. Tests are mocks; they do not prove real database atomicity or concurrency.

Verification run:

```text
npm run build
node --test tests/reservation.test.cjs tests/inspection.test.cjs tests/managed-reservation.test.cjs tests/managed-checkin.test.cjs
git diff --check
git diff --cached --check
```

Backend build passed (exit 0). Focused suite passed 114/114 (exit 0). Both diff checks passed (exit 0). MongoDB replica-set and provider tests were not run.

## F. SEC-03B.2 blocker: transaction atomicity and CAS

Current writes remain split:

- Handover conditionally sets Reservation ACTIVE first, then updates StorageUnit OCCUPIED. If the later unit write fails or no longer matches, the endpoint returns 409 after Reservation is already ACTIVE.
- CHECK_IN marks Inspection COMPLETED first, then conditionally activates Reservation, then occupies StorageUnit. If Reservation CAS loses a race, the request returns 409 but the Inspection is already completed. If the unit update fails, Reservation can remain ACTIVE while the unit is not OCCUPIED.

The required guarantee “a denied CHECK_IN must not become COMPLETED” and “no successful activation when a linked mutation fails” cannot be guaranteed by sequential writes and pre-reads. Fixing this requires a single transaction spanning all involved documents with a reviewed StorageUnit-first lock/CAS protocol and rollback tests. The SEC-03B.1 instructions explicitly reserve that redesign for SEC-03B.2 and prohibit an unreviewed partial transaction workaround. Therefore this report does **not** certify end-to-end safe activation and does not mark the task COMPLETE.

Additional focused tests still needed include cross-Facility Manager, Admin/BOM scope behavior, missing Reservation/unit in CHECK_IN, CHECK_IN Managed denial, repeated CHECK_IN/handover history behavior, and deterministic failure injection for each late write.

## G. Other limitations and operational release

- `CHECK_OUT` was not changed; the SEC-03A audit's authorization and non-atomicity concerns remain.
- `createInspection` authorization/input-integrity findings remain separate and unchanged.
- Static response PIN `1234` remains; no new credential policy was authorized.
- Production release requires an approved operational continuity plan, authoritative payment verification, SEC-03B.2 transactional/CAS implementation, and real disposable MongoDB replica-set verification. This code has not been deployed.

**Final status: BLOCKED / PARTIAL containment.** The production/unknown environment block and development/test scope checks are present, but the non-atomic failure mode prevents a complete SEC-03B.1 safety claim without the separately authorized SEC-03B.2 work.

## SEC-03B.2 implementation follow-up (2026-10-28)

The Product Owner subsequently authorized transactional hardening. Generic handover now writes StorageUnit then Reservation in one session transaction; Self-Storage `CHECK_IN` writes StorageUnit, Reservation, then Inspection in one session transaction. Both use conditional version/status/link predicates, increment their version tokens, preserve the existing development/test-only activation guard, and verify durable state before treating an escaped unknown commit outcome as success. The CHECK_OUT path and Managed activation were not changed.

The implementation and mock verification are documented in `WDP_SEC_03B_2_TRANSACTIONAL_ACTIVATION.md`. This supersedes the non-atomicity limitation above for current source behavior, but **does not** certify real database atomicity or concurrency. MongoDB replica-set tests remain unverified. Production activation remains disabled pending trusted settlement verification and the separately approved operational continuity plan.
