# WDP PAYOS-02 — Self-Storage Backend MVP

## Approval and scope

PAYOS-02 has explicit Product Owner approval for genuine PayOS Hosted Checkout on Self-Storage only. This implementation does not call PayOS, process real funds, deploy, change Managed Inventory payment behavior, or activate physical occupancy. The feature gate defaults off. Keep `PAYOS_ENABLED` unset or `false` until runtime configuration and live operation receive separate approval.

The PAYOS-01 audit was recorded in the project conversation; no standalone PAYOS-01 audit document was present in the repository at implementation time. This MVP preserves the existing Self-Storage Manager approval and signed-paper contract flow and the SEC-01/02/03 guards.

## API contract

All routes are under `/api/v1`.

### Create or replay a Hosted Checkout intent

`POST /reservations/:id/payments/payos`

- Auth: `requireAuth` and `CUSTOMER`; service query scopes Reservation to authenticated customer and `SELF_STORAGE`.
- Headers: `Idempotency-Key` required (1–120 characters; no CR/LF).
- Body: exactly `{ "purpose": "DEPOSIT" }` or `{ "purpose": "BALANCE" }`.
- Client cannot submit amount, currency, provider, order code, success state or Reservation identity.
- New checkout returns `201` with `outcome: CREATED`; same identity replay returns `200` with `outcome: REPLAYED`; changed owner/Reservation/purpose identity returns `409`; disabled feature returns `404`; unresolved/unknown provider outcome returns `503`.
- Success shape: `{ "success": true, "outcome": "CREATED|REPLAYED", "data": { "id", "reservationId", "purpose", "amount", "currency", "provider", "status", "applicationStatus", "providerSettlementStatus", "checkoutStatus", "checkoutUrl", "succeededAt", "reconciliationRequired" } }`.

### Read Customer payment status

`GET /reservations/:id/payments/:paymentId`

- Auth: `requireAuth` and `CUSTOMER`.
- Query is scoped by payment ID, Reservation ID, customer ID, `SELF_STORAGE` and `PAYOS` provider. The service also re-reads the owned Self-Storage Reservation and requires its Facility ID to match the immutable Payment Facility ID.
- Missing, cross-owner, cross-Reservation or Facility-mismatched records return `404` to avoid disclosing another Customer's payment.
- This is a status read; it may reconcile `UNKNOWN` provider-link state by querying the same PayOS order code. It never trusts browser return URL parameters.

### PayOS webhook

`POST /payments/payos/webhook`

- Public route required for provider callback delivery. The official SDK signature verification occurs before payment lookup or mutation.
- Signed data is matched against the local immutable numeric order code and PayOS Payment. Reservation, customer, facility, service type, purpose, amount, VND currency, and payment-link identity are verified before applying a business transition.
- Invalid signature/payload returns `400`; unknown order code returns `404`; successful application, durable reconciliation evidence, or duplicate delivery returns `200`; unknown transaction outcome returns `503` so the provider can retry.
- Webhook registration with PayOS and exposing an HTTPS endpoint are external rollout actions and were not performed.

## Approved payment lifecycle

### Deposit

Eligible only for an owned, unexpired `SELF_STORAGE` Reservation in `CONTRACTED`, with its existing `DRAFT` Contract. The backend computes the VND amount from authoritative Reservation pricing; the existing Deposit is advance rent credited against total rent, not a security deposit. On a valid signed PayOS success, a transaction and Reservation `inventoryVersion` CAS move `CONTRACTED → DEPOSIT_PAID`, link the Payment, and append one status-history entry. The existing Contract is reused; no duplicate Contract is created.

### Balance

Eligible only for `SELF_STORAGE` in `CHECKIN_READY`, with the existing `SIGNED` Contract, uploaded signed-paper proof and verified timestamp, plus an applied verified PayOS Deposit. Backend calculates total due less the applied Deposit. A valid signed success transactionally changes `CHECKIN_READY → PAID`, links the Balance Payment and records `balanceSettledAt`. No automatic activation or handover occurs.

### Provider funds versus business application

`providerSettlementStatus=VERIFIED` plus the signed provider capture/outcome evidence records provider-confirmed funds. `applicationStatus=APPLIED` means funds were applied to the approved Reservation transition. `MANUAL_REVIEW` means provider evidence is retained but eligibility or consistency prevented application. This is deliberately separate from Reservation status.

Late success after expiry/cancellation, wrong amount/currency/link, payment after a previous failure, a second successful payment, multiple captures, or contradictory signed provider outcomes are recorded for manual reconciliation and never revive/activate the Reservation, automatically refund or allocate funds. A link marked expired/cancelled does not prove no funds arrived. A new attempt is blocked until the earlier attempt is authoritatively known to have failed with no funds or separately reconciled.

## Durable intent, idempotency and transaction design

- Client key is namespaced `PAYOS-SS-` and protected by existing unique `ReservationPayment.idempotencyKey` index. Same key replays the original intent only for the same Customer/Reservation/service/purpose identity; another identity receives `409`.
- A random numeric PayOS `orderCode` is stored in immutable `providerReference`, protected by existing unique `{ provider, providerReference }` index. It is never replaced on retries.
- The intent is persisted inside a Reservation lifecycle CAS transaction before provider link creation. `NOT_CREATED → CREATING` is a conditional claim. Provider calls happen outside the MongoDB transaction. A timeout becomes `UNKNOWN`; retry/status lookup queries the same order code and will not mint another attempt.
- Checkout URL/link identity must be confirmed persisted before returning creation success. If provider outcome or persistence is uncertain, return `503`.
- Webhook success captures and non-success signed outcome snapshots are appended to the Payment. Event hashes deduplicate callbacks. Conflicting outcomes are retained and force manual review. Payment evidence and Reservation CAS/status history commit together for application.
- Mongoose/MongoDB `ClientSession.withTransaction` retries transient transaction errors and unknown commit results within the driver transaction retry window; the repository currently sets `serverSelectionTimeoutMS=10000` but does not set a custom transaction `timeoutMS` (MongoDB Node driver 7.6 default `withTransaction` retry window is 120 seconds when no timeout is configured). The service re-reads durable event hashes after unknown commit; absence is never reported as success.
- Mock tests validate service behavior only. No mocks establish replica-set atomicity, write-conflict handling, or concurrent unique-index enforcement.

## Server environment and credentials

Configure only in an approved backend secret manager/environment, never Vite or mobile clients:

| Variable | Purpose |
| --- | --- |
| `PAYOS_ENABLED` | Feature gate; default false |
| `PAYOS_CLIENT_ID` | Official SDK client ID |
| `PAYOS_API_KEY` | Official SDK API credential |
| `PAYOS_CHECKSUM_KEY` | Webhook signature verification key |
| `PAYOS_CUSTOMER_ORIGIN` | Validated Customer origin; Backend appends the reservation payment route for return and cancel |
| `PAYOS_WEBHOOK_URL` | Public HTTPS endpoint registered separately with PayOS |

`.env.example` uses placeholders only. Do not place real credentials in source, fixtures, docs or reports. The official Hosted Checkout request uses server-generated amount/order code and verifies VND from PayOS.

## Verification performed

All provider responses are mocked; no PayOS network request or live transaction was made. Tests run:

- `npm run build` — passed (exit 0).
- `node --test --test-reporter=spec tests/payos-payment.test.cjs` — 23/23 passed, including nested EXPIRED/CANCELLED cases.
- `node --test --test-reporter=spec tests/payment-accounting.test.cjs tests/reservation.test.cjs tests/managed-reservation.test.cjs tests/managed-checkin.test.cjs tests/inspection.test.cjs` — 134/134 passed. Contract regressions are included in `managed-checkin.test.cjs`.
- `git diff --check` and `git diff --cached --check` — passed. Existing LF/CRLF warnings may be emitted for unrelated dirty files.

## Outstanding rollout and verification gates

1. Keep PayOS disabled until a separately approved deployment/runtime change. No frontend integration is included in this Backend MVP.
2. Configure backend-only secrets without exposing them; register the HTTPS webhook and verify callback reachability in a separately authorized environment.
3. Run a disposable authorized MongoDB replica-set integration suite for unique indexes, concurrent intent creation/callbacks, rollback and unknown commit recovery. This has not been run.
4. Perform provider sandbox verification only under separate authorization; no live or sandbox API call occurred in this implementation.
5. Production Self-Storage handover remains disabled by SEC-03B policy. PayOS `PAID` does not authorize physical handover by itself.
6. `npm install` reported 13 vulnerabilities in the dependency tree (4 low, 3 moderate, 6 high); attribution to this SDK versus pre-existing dependencies has not been audited here.
