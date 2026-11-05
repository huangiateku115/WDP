# WDP-SEC-03B.2 — Transactional Self-Storage Activation

**Date:** 2026-10-28  
**Scope:** Generic Self-Storage handover and legacy Self-Storage `CHECK_IN` completion only.  
**Environment policy:** Both activation paths remain disabled unless `NODE_ENV` is exactly `development` or `test`.  
**Verification status:** Mock/unit verification only; real MongoDB replica-set atomicity and concurrency remain unverified.

## Changes

### Generic handover

`ReservationController.handoverReservation` now commits the StorageUnit and Reservation transitions in one MongoDB transaction. Its sequential writes are: (1) conditional StorageUnit token acquisition, scoped by id, Facility, non-deleted state and observed `bookingVersion`, which increments `bookingVersion`; (2) conditional `SELF_STORAGE` Reservation transition from `PAID` to `ACTIVE`, linked to the exact Facility and StorageUnit and matched at the observed Mongoose `__v`, with one history entry and handover metadata; (3) conditional StorageUnit `OCCUPIED` update matched against the acquired `bookingVersion` in the same session. A failed final occupancy update aborts the Reservation transition and token increment.

An existing Reservation whose legacy version is absent is matched as version zero or missing; successful activation writes version one. No StorageUnit prior-status requirement was introduced. That business policy remains unchanged/unresolved, as required by SEC-03B.2 authorization.

An activation replay returns the existing result only when the Reservation is already `ACTIVE`, records the same handover Staff identity and timestamp, and the linked same-Facility StorageUnit is `OCCUPIED`. It performs no new writes. A Reservation in another state is rejected before transaction creation.

### Legacy `CHECK_IN`

`InspectionController.completeInspection` changes only its `CHECK_IN` branch. In the same Facility-scoped transaction, writes occur sequentially:

1. Conditional StorageUnit `bookingVersion` token acquisition.
2. Conditional `PAID` Self-Storage Reservation CAS to `ACTIVE`, for the same Facility and StorageUnit, with `__v` increment and one status-history event.
3. Conditional `DRAFT` `CHECK_IN` Inspection CAS to `COMPLETED`, linked to the exact Reservation, Facility and StorageUnit, with `__v` increment.
4. Conditional StorageUnit `OCCUPIED` update matched against the acquired `bookingVersion`.

`CHECK_OUT` continues through its existing path and was not redesigned. Managed Inventory activation remains on its dedicated flow.

All database operations inside each transaction are awaited sequentially using the same session. Both flows acquire the StorageUnit write token first, matching the booking writer's existing StorageUnit-first order. Pre-transaction reads retain the SEC-03B.1 service, role/Facility, environment and relationship checks; transactional predicates revalidate the state and linkage that must still hold at commit.

## Conflict and uncertain commit handling

- A failed StorageUnit, Inspection or Reservation CAS aborts the transaction and maps to HTTP 409.
- MongoDB write conflicts, transient transaction labels and Mongoose version conflicts map to 409 after the transaction helper's retry handling is exhausted.
- If `UnknownTransactionCommitResult` escapes the driver helper, the controller verifies all expected durable records. It returns success only if the complete state is visible; otherwise it returns HTTP 503 and does not claim success.
- Unexpected transaction failures remain server errors.

Tests use mocked Mongoose models and a mocked session. Rollback assertions simulate transaction rollback; they do not demonstrate actual MongoDB rollback, lock contention, or driver retry behavior.

## Verification

Run from `backend/`:

```text
npm run build
node --test tests/reservation.test.cjs tests/inspection.test.cjs tests/managed-reservation.test.cjs tests/managed-checkin.test.cjs
node --test --test-name-pattern="schema compound uniqueness|storage-unit images|storage-unit create/update|create validates active|same facility duplicate|invalid/missing/inactive|validation rejects unsafe|get by ID|list scopes query|update recalculates|storage-unit update accepts|concurrent write returns|resource status transitions|administrative APIs|scope denies unassigned|persistence failures|soft delete permits|deleted Storage Unit" tests/storage-unit.test.cjs
git diff --check
git diff --cached --check
```

Captured results for this implementation:

- `npm run build` — PASS, exit code 0.
- `node --test tests/reservation.test.cjs tests/inspection.test.cjs tests/managed-reservation.test.cjs tests/managed-checkin.test.cjs` — PASS, 129/129 tests, exit code 0.
- `node --test --test-name-pattern="schema compound uniqueness|storage-unit images|storage-unit create/update|create validates active|same facility duplicate|invalid/missing/inactive|validation rejects unsafe|get by ID|list scopes query|update recalculates|storage-unit update accepts|concurrent write returns|resource status transitions|administrative APIs|scope denies unassigned|persistence failures|soft delete permits|deleted Storage Unit" tests/storage-unit.test.cjs` — PASS, 18/18 tests, exit code 0.
- Running the four focused suites plus all of `tests/storage-unit.test.cjs` produced 147/148 passes, exit code 1. The remaining test failed with `TypeError: fetch failed` at `tests/storage-unit.test.cjs:347` while attempting local HTTP access. The test server bound to `127.0.0.1`, but fetch could not connect; the underlying socket error was not exposed. This is a loopback HTTP verification blocker, not a pass or a proven `EACCES`.
- `git diff --check` — PASS, exit code 0.
- `git diff --cached --check` — PASS, exit code 0.

No database, Docker, migration, seed, payment provider, production configuration, commit, push, or deployment operation was used.

## Remaining verification gate

Before any production activation, run an authorized disposable MongoDB replica-set suite covering: concurrent handover versus booking/cancellation; two Staff confirming the same Reservation; `CHECK_IN` versus competing Reservation and StorageUnit updates; transaction rollback after each late write; duplicate/repeated requests; and both visible and unresolved unknown-commit outcomes. The existing production/unknown environment block remains in force, and `PAID`/`MOCK` is not provider settlement evidence.
