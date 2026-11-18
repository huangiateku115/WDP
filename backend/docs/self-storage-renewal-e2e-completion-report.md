# Self Storage Renewal Backend Completion Report

Task: `WDP_SELF_STORAGE_RENEWAL_PAYMENT_E2E_COMPLETION`  
Checkpoint: `WDP_SELF_STORAGE_RENEWAL_BACKEND_READY`

## Baseline and scope

The BE-1 implementation markers were present in the current source: `RENEWAL_MOCK_PAYMENT_DISABLED` and `LEGACY_RENEWAL_DISABLED`; no `RENEWAL_PAYMENT_NOT_READY` remains. Git branch, HEAD, and initial working-tree state could not be verified because Git reported `fatal: cannot change to 'C:/Users/laptop/Desktop/WDP'`. No reset, stash, clean, checkout, commit, or deploy was performed. Changes were confined to Backend source, Backend tests, and Backend docs/scripts.

No `.env` was read or changed. No database connection, database write, index migration, or real PayOS transaction was attempted.

## Changes

- Added Extension request idempotency identity and payload hash. Same key/same term replays; same key/different term conflicts. Matching in-progress requests replay; another in-progress request is rejected.
- Created Extension inside a MongoDB transaction. The transaction locks the Storage Unit using its existing `bookingVersion`, checks current Reservation/Unit/Contract state and overlapping bookings, then appends the Extension with a Reservation version fence.
- Restricted Renewal Quote and Extension Request routes to Customer role and retained Reservation ownership checks.
- Tightened eligibility to require a valid active Self Storage Reservation, verified signed current Contract, occupied non-deleted Unit in the same Facility, no pending checkout, and no overlapping booking. Pricing remains server-side and must match an active Facility/Unit/term rule.
- Changed month/year arithmetic to clamp the calendar day to the target month's last day (for example, January 31 plus one month becomes February 28/29).
- Tightened Payment intent replay/create and webhook application to require the signed current Contract and exact Extension/Payment linkage. Verified late or mismatched settlement remains in manual review; webhook application never changes `endDate`.
- Staff confirmation continues to require exact Facility scope, `PAID`, verified/applied PayOS Payment, valid dates and paper proof. The transaction updates Extension, Reservation end date/history, and only the matching signed Contract. Duplicate confirmation is rejected.
- Kept `/renew` at HTTP 410 `LEGACY_RENEWAL_DISABLED` and mock Extension payment at HTTP 410 `RENEWAL_MOCK_PAYMENT_DISABLED`.
- Added a read-only MongoDB index/data preflight script. It never creates, alters, drops, or syncs an index.

## Test and verification results

| Check | Result | Evidence |
|---|---|---|
| `npm run build` | PASS | TypeScript build completed |
| `npx tsc --noEmit` | PASS | Exit code 0 |
| `node --check scripts/self-storage-renewal-index-preflight.cjs` | PASS | Syntax check only; script was not connected to a database |
| Renewal, PayOS, accounting, Self Storage Extension/Phase 5, Phase 1/2, and contract handover tests | PASS | 157 tests, 157 passed, 0 failed, 0 skipped |
| MongoDB transaction concurrency / replica-set E2E | NOT_RUN | Requires a designated non-production MongoDB test database |
| Index preflight against MongoDB | NOT_RUN | No database URI or connection was used |
| Real PayOS hosted checkout/webhook | NOT_RUN | No provider transaction was created |

Additional Renewal assertions cover request replay and payload conflict, quote ownership, end-of-month dates, Extension-scoped intent and terminal retry, exact webhook application, duplicate callback, amount mismatch, late callback after cancellation/rejection, staff facility/payment guards, duplicate confirmation, and a later Extension after prior activation. Unit mocks verify source paths; they do not establish MongoDB transaction isolation or live index enforcement.

Two existing regression test fixtures were corrected based on current source contracts: the SLA test now checks the first Reservation query because the job performs a second Extension query, and the legacy mock Full Rent test now supplies a `CONTRACTED` Reservation and mocks its Payment-link update. These changes affect tests only.

## Index readiness

The schema declares `renewal_extension_single_success` on `{ reservationId, extensionId, purpose }`, unique and partial to successful Renewal Payments with an ObjectId `extensionId`. The existing Reservation/purpose successful-payment index covers only Deposit, Balance, and Full Rent; it does not block later Renewal Extensions. This is schema evidence only. MongoDB `getIndexes()` and historical duplicate data remain unverified: `INDEX_DEPLOYMENT_UNVERIFIED`.

Read-only PowerShell example (the script prints no URI or document identifiers):

```powershell
$previousMongoUrl = $env:MONGO_URL
try {
  $env:MONGO_URL = '<read-only URI for the designated test database>'
  node .\scripts\self-storage-renewal-index-preflight.cjs --expected-db test
} finally {
  if ($null -eq $previousMongoUrl) { Remove-Item Env:\MONGO_URL -ErrorAction SilentlyContinue }
  else { $env:MONGO_URL = $previousMongoUrl }
}
```

The migration definition and rollout/rollback notes are in [self-storage-renewal-backend-contract.md](self-storage-renewal-backend-contract.md). Do not apply it to production until the actual database's duplicate audit and existing index definitions have been reviewed and migration approval has been given.

## API contract

Customer-facing Renewal Quote, Extension Request, PayOS Checkout, Payment Status/Reconciliation, state transitions, errors, and retry guidance are documented in [self-storage-renewal-backend-contract.md](self-storage-renewal-backend-contract.md).

## Remaining verification

- Run the read-only preflight against an explicitly designated non-production replica set and verify both index options and successful-Renewal duplicate counts.
- Run controlled MongoDB integration tests for simultaneous Extension requests, simultaneous checkout requests, transaction rollback, and two sequential settled Extensions.
- Verify PayOS test-environment create/lookup/webhook behavior using a provider sandbox only, after explicit approval. No real payment should be made.
- Git branch/HEAD/working-tree baseline remains `NOT_VERIFIED`.

## Final status

`BACKEND_RENEWAL_CODE_READY_DEPLOYMENT_UNVERIFIED`

Source build and offline regression tests pass. This is not a claim of MongoDB E2E or production readiness. Stop at checkpoint `WDP_SELF_STORAGE_RENEWAL_BACKEND_READY`.
