# MI-02C Real Backend E2E Test Report

## A. Executive Summary

Date: 2026-10-13. Overall result: **BLOCKED**.

**BLOCKED — TEST DATABASE SAFETY NOT VERIFIED**

Executed all safely available connectivity and frontend regression checks. Real backend health and unauthenticated access protection were verified. No authenticated real rental workflow, database mutation, payment, or concurrency test was performed. Fixture results below do not establish real backend acceptance.

No application integration defect was confirmed. One existing test harness was corrected without modifying application code.

## B. Environment Verification

| Check | Evidence | Result |
|---|---|---|
| API URL | http://localhost:5000/api/v1 | Identified |
| Backend reachable | Real GET /health: 200, success true | VERIFIED AGAINST REAL BACKEND |
| MongoDB connection | Health reports database connected | Connected; isolation unknown |
| Browser connectivity | Browser on http://127.0.0.1:5173 reached the real API | Verified |
| CORS | Health allowed origin http://127.0.0.1:5173 | Verified for this origin |
| Dedicated test database / no production data | No approved environment evidence supplied | NOT VERIFIED |
| Authorization for test writes | No approved test configuration supplied | NOT VERIFIED |
| Authorized Customer A/B, Manager, Staff | No authorized accounts supplied or used | NOT VERIFIED |
| Authorized test Facility / Cells | No approved identifiers supplied | NOT VERIFIED |
| Transaction-capable database | No runtime topology/transaction evidence | NOT VERIFIED |
| Record retention / supported cleanup authorization | Not supplied | NOT VERIFIED |
| Runtime managed mock payment flag | Reference flag exists; deployed runtime not established | NOT VERIFIED |

Safe reference configuration metadata showed development mode, port 5000, managed mock payment enabled, and a configured mongodb+srv connection. These are reference settings, not affirmative evidence about the running database's isolation, authorization, or transaction capabilities. Connection strings and credentials were not logged.

Existing frontend configuration uses http://localhost:5000/api, normalized by the existing client, with VITE_USE_MOCK=true and no frontend managed mock payment flag. No production/environment file was changed.

The first browser attempt failed with ERR_CONNECTION_REFUSED because frontend port 5173 was not running. A temporary frontend server was started and the read-only check then passed. A separate temporary server on 5189 used process-only API-mode flags for intercepted regression tests. Neither server changed environment files or started a backend.

Evidence: [sanitized real GET results](../.design-reference/mi02c-real-readonly-evidence.json), [public login connectivity screenshot](../.design-reference/mi02c-real-login-connectivity.png).

## C. Test Matrix

| Test | Mode | Expected | Actual | Result |
|---|---|---|---|---|
| Health | Real Backend | Reachable, connected | GET 200; database connected | VERIFIED AGAINST REAL BACKEND |
| Unauthenticated reservations / map | Real Backend | Protected | GET /reservations/me 401; GET /warehouse-map 401 | VERIFIED AGAINST REAL BACKEND |
| Map availability / rack / capacity DTO | Real Backend | Date-aware fields, valid identifiers and ownership | Authorized account and Facility unavailable | BLOCKED |
| Multi-Cell selection across Racks / Zones | Browser + Backend | Correct eligible selection | No authorized real map data | BLOCKED |
| 100 / 101 Cell live cases | Browser + Backend | 100 accepted when enough eligible Cells; 101 rejected | Real eligible Cell count unknown | NOT TESTED |
| Quote | Real Backend | Accurate pricing, no writes or holds | Reference implementation inspected; no authorized inputs | BLOCKED |
| Reservation Create | Real Backend | One RESERVED record, correct allocations | Safety gate not passed | BLOCKED |
| Manager Approval | Real Backend | CONTRACTED and DRAFT contract | No authorized accounts or created record | BLOCKED |
| Contract Signing | Real Backend | SIGNED; no automatic payment | No owned real test contract | BLOCKED |
| Managed Mock Payment | Real Backend | PAID; HOLD to RESERVED; usage unchanged | Isolation, runtime flags and payment authorization unverified | BLOCKED |
| Activation | Real Backend | ACTIVE when interval permits | No real record created; eligibility cannot be evaluated | NOT TESTED |
| Sequential conflict | Real Backend | Second overlapping allocation rejected | Safety gate not passed | BLOCKED |
| Concurrent conflict | Real Backend | At most one winner, no partial loser writes | Safety gate / transaction support not verified | BLOCKED |
| Cancellation / release | Real Backend | Eligible cancellation releases empty holds | No authorized real test reservation | BLOCKED |
| Authenticated ownership / role enforcement | Real Backend | Correct ownership and denied cross-role access | No authorized accounts or test-owned records | BLOCKED |
| Frontend regression | Local intercepted fixtures / units | Existing features preserved | Suites below passed | VERIFIED WITH INTERCEPTED FIXTURES |

Executed regression results:

| Suite | Result | Scope and limits |
|---|---|---|
| npm run build | PASS | 1995 modules; existing chunk-size warning remains |
| check-mi02c-contract.cjs | PASS | Pure contract/unit checks; no real backend |
| check-mi02c-phase1.cjs | PASS | 209 intercepted requests; five widths; selection, quote/create bodies, reconciliation and guards |
| check-self-storage-completion.cjs | PASS | 227 intercepted requests; reservation/signing/payment/access; five widths |
| check-self-storage-payment.cjs | PASS | 180 intercepted requests; explicit payment, errors/reconciliation; five widths |
| check-inventory-mi02a.cjs | PASS | 71 intercepted requests; registration/edit/ownership; five widths |
| check-digital-warehouse.cjs | PASS | Map interaction, cache, accessibility, responsive/error checks; fixtures |
| check-login-logout-pricing.cjs | PASS | Synthetic authentication errors/logout/session and pricing responsiveness |
| check-profile-avatar.cjs | PASS | Intercepted API/Cloudinary; abort/stale-session/profile behavior; four widths |
| check-mi02c-role-regression.cjs | PASS | Manager approval guard and five Staff route smoke checks; zero Staff mutations |
| check-facility-review-api.cjs | PASS | API-mode fixtures; customer review, approval, rejection/errors, role/session gates |
| check-mi02c-live-readonly.cjs | PASS after frontend start | Real GET connectivity only; no fixtures, no authenticated accounts, no mutation attempts |

No executed regression remains failing. The initial frontend connectivity failure is recorded above and was resolved by starting the temporary frontend server.

400/403/404/409, network/timeout, duplicate actions and uncertain mutation recovery were covered by fixtures where supported by these suites. Only unauthenticated 401 was observed live. No live allocation conflict or rollback result is claimed.

## D. API Contract Findings

No authenticated business DTO was received, so real identifier, dimensions, capacity, pricing, ownership, Facility assignment and date-aware projection compatibility remain unverified.

The BE-REF managed reservation quote implementation was re-inspected: it parses inputs, reads records, calculates volume/effective quote and returns the public quote without persistent writes. This is source evidence only; no real quote request was made and no live no-hold assertion is established.

The reference managed payment guard requires nonproduction mode, the managed mock flag and the appropriate signed/live-hold lifecycle. Runtime flags and lifecycle were not tested. Existing API client, token storage, routes and request/response adapters were preserved. No endpoint was invented.

## E. Database Transaction Findings

Health confirms connectivity only. Transaction topology, deployed indexes, concurrent conflict behavior, allocation uniqueness, losing-request rollback, quota consistency and physical usage counters were **NOT TESTED** against the real database.

Test-data ledger for this run:

| Item | Recorded value |
|---|---|
| Run identifier | MI02C-2026-10-13-readonly |
| Authorized accounts used | 0 |
| Test Facility / Cells | None supplied |
| Reservations created | None |
| Contracts created | None |
| Allocation records created | None |
| State-changing real requests | None |
| Cleanup performed | None |

No database connection, migrations, seeds, manual document edits, destructive commands or cleanup were performed. Database restoration is not claimed.

## F. Frontend Bugs Found and Fixed

No application bug was confirmed; application source was not changed.

The prior Manager harness failure was diagnosed as a demo/API-mode mismatch. CustomersPage selects the demo interface when VITE_USE_MOCK=true; CustomerApiView in API mode still correctly uses the expected Vietnamese search label. The label itself is not stale in API mode. A separate stale Windows runtime path also prevented portable execution.

Only check-facility-review-api.cjs was changed to use the available Playwright runtime (with PLAYWRIGHT_MODULE override) and assert API mode with a clear diagnostic. The full suite passed before the edit using an in-memory runtime correction and again directly after the edit. No production label or Manager logic was changed.

New files:
- .design-reference/check-mi02c-live-readonly.cjs — real GET-only browser check; all non-GET/OPTIONS API traffic aborted, no response fixtures.
- .design-reference/mi02c-real-readonly-evidence.json — sanitized connectivity evidence.
- .design-reference/mi02c-real-login-connectivity.png — public login screenshot.
- docs/MI02CRealBackendE2ETestReport.md — this report.

Changed existing files (test harness and screenshots refreshed by regression runs):
- `.design-reference/check-facility-review-api.cjs`
- `.design-reference/digital-warehouse-desktop.png`
- `.design-reference/digital-warehouse-mobile.png`
- `.design-reference/digital-warehouse-selected-cell.png`
- `.design-reference/digital-warehouse-tooltip.png`
- `.design-reference/inventory-map-preference-mobile.png`
- `.design-reference/inventory-register-1440.png`
- `.design-reference/mi02c-popup-1024.png`
- `.design-reference/mi02c-popup-1440.png`
- `.design-reference/mi02c-popup-320.png`
- `.design-reference/mi02c-popup-390.png`
- `.design-reference/mi02c-popup-768.png`
- `.design-reference/pricing-fix-1440.png`
- `.design-reference/pricing-fix-320.png`
- `.design-reference/pricing-fix-768.png`
- `.design-reference/self-mock-payment-1440.png`
- `.design-reference/self-reservation-review-1024.png`
- `.design-reference/self-reservation-review-1440.png`
- `.design-reference/self-reservation-review-320.png`
- `.design-reference/self-reservation-review-390.png`
- `.design-reference/self-reservation-review-768.png`

Preservation verification compared SHA-256 hashes of 651 existing files against the pre-test snapshot. All 164 BE-REF files were unchanged. Frontend src, existing documentation, root environment/configuration/dependency files were unchanged. No tracked snapshot file was missing. Original backend/ was never accessed. All written files are inside frontend/.

## G. Backend Issues Requiring Separate Work

No real backend business defect was established by the permitted GET checks. Missing environment evidence is a testing prerequisite blocker, not proof of a backend defect.

A separately authorized test environment must provide isolation and write authorization evidence, secure Customer A/B and Manager configuration, assigned Facility/Cells, transaction-capable runtime evidence, mock payment authorization/flags and a retention or supported cancellation policy before real acceptance testing resumes.

## H. Remaining Risks

The full authenticated rental lifecycle, live map fields, actual pricing/deposit, capacity calculation, payment counters, activation eligibility, cancellation release and ownership remain untested. Sequential and concurrent database conflicts are untested.

Outbound/checkout behavior, cleanup worker behavior and deployed/production index verification remain outside verified evidence. Do not infer support or safety from source-only inspection or fixture success. Staff coverage is route smoke only, not full operational acceptance.

Evidence intentionally omits credentials, authorization headers, JWTs, cookies, database URI and customer private information. Regression users and responses are synthetic; no live customer record was accessed.

## I. Final Recommendation

**BLOCKED PENDING TEST ENVIRONMENT**

Frontend build and fixture regressions passed. Real health/connectivity and unauthenticated protection were verified. Resume real E2E only after the mandatory safety gate and authorized test prerequisites are established; retain the existing frontend implementation until a real defect is demonstrated.
## Follow-up verification after environment clarification

The user confirmed that a dedicated backend/test database has **not yet been established** and explicitly prohibited any backend writes. The mutation gate remains **BLOCKED — TEST DATABASE SAFETY NOT VERIFIED**. This follow-up did not read secret backend environment values, run backend code, seed data, start services or change environment configuration.

### Verified source requirements and available fixtures

- BE-REF uses Express/TypeScript/Mongoose and existing Keycloak authentication. Configuration validation in `src/config/env.ts` requires `MONGO_URL`, `KEYCLOAK_BASE_URL` and `KEYCLOAK_CLIENT_SECRET`; validates PORT and NODE_ENV; derives optional realm/client/issuer/JWKS and exact-origin CORS settings. Variable names and validation logic were inspected; secret values were not needed for this follow-up.
- Frontend's configured public base is `http://localhost:5000/api`; the existing `apiBaseURL` normalizes it to `http://localhost:5000/api/v1`. No second API client or configuration was introduced.
- `BE-REF/src/services/reservations/managed-reservation.service.ts:170–179` starts a session and uses multi-document transactions with snapshot reads and majority writes. MI-R01 documentation explicitly requires a transaction-capable deployment. A standalone MongoDB server is insufficient for these operations; an approved replica-set deployment or transaction-capable Atlas/sharded deployment must be provided. Source transaction usage does not establish runtime support.
- `BE-REF/README.md` describes a **shared development Atlas** environment, not a dedicated E2E database. No isolation proof is available. README seed instructions also differ from the newer FE_DEMO_SEED guide concerning the target database; neither is authorization to seed or evidence of isolation.
- Available reference materials include `docs/FE_DEMO_SEED.md`, `docs/MI_02C_CELL_RESERVATION.md`, `docs/MI_R01_MANAGED_RESERVATION.md`, `docs/MI_01_WAREHOUSE_MAP.md` and `docs/fixtures/mi-01-warehouse-map.mock.json`. Backend tests mock persistence/transactions; they are not live database fixtures.
- FE_DEMO_SEED refers to existing accounts via optional SEED_CUSTOMER_EMAIL, SEED_STAFF_EMAIL, SEED_MANAGER_EMAIL and SEED_BOM_EMAIL. It does not create users, roles, assignments or verification. Its dataset does not seed Reservations/Contracts, and omits Managed Inventory pricing. It is not a complete MI-02C acceptance environment. No seed or dry-run was executed.
- Frontend `src/mocks/` and intercepted E2E scripts contain synthetic demo/fixture identities and facilities. They are not usable evidence of authorized live accounts, Cell IDs or backend records.
- Managed mock payment's source guard is NODE_ENV other than production and MI_MOCK_PAYMENT_ENABLED exactly true; it additionally requires an owned signed contract, unexpired CONTRACTED reservation and live hold. Frontend requires DEV exactly true and VITE_MI_MOCK_PAYMENT_ENABLED exactly true. Explicit confirmation remains required; payment transitions HOLD to RESERVED without physical stock increments. These guards were read, not invoked.

### Refreshed safe checks

A sandbox GET initially failed with Node TypeError / EACCES. This is a local execution permission failure, not evidence of backend downtime. Retrying only the same authorized GET checks with network permission returned:
- GET /health: 200, database connected.
- GET /reservations/me: 401.
- GET /warehouse-map: 401.

No credentials were used and no business response/customer record was retrieved.

Additional pure frontend suites passed: check-inventory-contract.cjs, check-managed-contract.cjs, check-self-storage-contract.cjs and check-self-payment-contract.cjs. They validate DTO/allowlist, eligibility, calendar and payment guards using local inputs; they do not contact the backend.

All full frontend regression suites and build listed in section C already passed during this same task. Application/configuration code has not changed since those passes, so their results remain valid; they were not relabeled as live tests or unnecessarily rerun. Historic scripts for earlier API contracts/live login are not automatically executed against real services. No backend test suite was run.

### Environment preparation required from the authorized environment owner

1. Supply a secure local test configuration path and non-secret confirmation tying the running API deployment to a dedicated, disposable or explicitly retained test database, excluding production/shared production data. Confirm test-write authorization and approved retention/cancellation policy. Do not send URI, password or tokens in chat.
2. Provide runtime evidence of a transaction-capable replica set/Atlas deployment and required indexes installed. Health connected alone is insufficient. This preparation must be performed by the authorized owner; no database was created or configured here.
3. Supply authorized active Customer A and B, verified customer profiles, an active Facility Manager assigned to the test Facility, and optional assigned Staff. Use the existing Keycloak realm/client and secure local credentials; no privileged impersonation or arbitrary account creation.
4. Prepare an ACTIVE MANAGED_INVENTORY Facility with active quota/hold configuration, effective PER_M3 pricing for the chosen term/date, deposit policy, usable Zones/Racks and valid dimensioned/weighted Cells. Identify a minimal eligible Cell set for writes and separate Cells for cancellation/concurrency; identify at least 100 eligible Cells only if testing the live limit is required.
5. Configure exact frontend CORS origins and confirm real authentication. For explicitly approved mock payment, use a nonproduction test backend with MI_MOCK_PAYMENT_ENABLED=true and a development frontend with VITE_MI_MOCK_PAYMENT_ENABLED=true. Do not change production flags.
6. Confirm a test record ledger and retention policy for paid/active records which may not be cancellable. Use supported eligible cancellation only; no direct document deletion/status editing/reset.

### What can run next

**Now:** real unauthenticated health/denial checks and local unit/intercepted regressions. Read-only authenticated map/rack/capacity/owned-reservation checks can follow once secure authorized test accounts and scoped Facility identifiers are supplied; they must not expose other customer data. Real quote additionally needs verified no-write deployed implementation and approved actual inputs.

**After all mutation safety prerequisites are verified:** record the ledger, run small-cell UI Create → assigned Manager Approval → owner Signing → explicitly authorized Mock Payment → Activation only when interval eligible. Then run separate sequential/concurrent conflict tests and eligible cancellation/release checks, stopping immediately on allocation inconsistency. Confirm actual responses and database outcomes; do not infer them from fixtures. No backend clock changes, unsupported checkout, automatic retries of uncertain mutations or automatic cleanup are permitted.

Only this report was edited during the follow-up. BE-REF remains read only; original backend/ was not accessed. No reservation, contract, payment or backend record was created.

