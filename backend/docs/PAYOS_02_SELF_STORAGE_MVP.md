# PAYOS-02 — Self-Storage Hosted Checkout MVP

## Scope and safety

This backend-only implementation supports PayOS Hosted Checkout for Self-Storage Deposit and Balance. It does not change Managed Inventory payment flows, activate physical handover, or make a Reservation ACTIVE. PayOS success is applied only to the existing Reservation transitions documented below. Return/cancel URLs are informational; their query parameters never establish payment success.

The feature is disabled unless `PAYOS_ENABLED=true`. Keep it unset or `false` until an operator separately approves deployment and live transactions. No credentials or external PayOS calls are included in the test suite.

## API contract

### Create or replay a checkout

`POST /api/v1/reservations/:id/payments/payos`

- Role: authenticated `CUSTOMER`; the service scopes the Reservation to `req.user._id` and `SELF_STORAGE`.
- Header: `Idempotency-Key` (required; 1–120 visible characters, no CR/LF).
- JSON body: exactly `{ "purpose": "DEPOSIT" }` or `{ "purpose": "BALANCE" }`. Amount, currency, provider and payment status are server controlled.
- New intent/link: `201`; same identity replay: `200`; conflicting identity/state: `409`; disabled feature: `404`; provider/configuration uncertainty: `503`.
- Response envelope: `{ "success": true, "outcome": "CREATED"|"REPLAYED", "data": { "id", "reservationId", "purpose", "amount", "currency", "provider", "status", "applicationStatus", "providerSettlementStatus", "checkoutStatus", "checkoutUrl", "succeededAt", "reconciliationRequired" } }`.

Deposit requires an unexpired `CONTRACTED` Self-Storage Reservation and reuses its existing `DRAFT` Contract. The amount is the server-calculated advance-rent credit. Balance requires `CHECKIN_READY`, the existing `SIGNED` Contract and verified signed-paper proof, plus an applied verified PayOS Deposit. Balance is the server-calculated remainder.

### Customer payment status

`GET /api/v1/reservations/:id/payments/:paymentId`

Authenticated Customer ownership is enforced by Reservation, payment, provider and service type. A non-owned or missing payment returns `404`.

### PayOS webhook

`POST /api/v1/payments/payos/webhook`

Public route by design; the official SDK verifies the signed webhook before database lookup or mutation. A valid callback is matched to the immutable local order code, Reservation-scoped Payment, amount, VND currency and payment-link ID. Invalid signatures return `400`. The handler returns HTTP `200` only after a valid callback is applied, recorded for manual reconciliation, or identified as a duplicate. A `503` outcome-unknown response lets PayOS retry.

## Payment state and exceptional outcomes

The Payment has separate provider settlement evidence and business application state:

- `providerSettlementStatus=VERIFIED` records that the signed provider callback confirms funds.
- `applicationStatus=APPLIED` means the corresponding allowed Reservation transition committed.
- `applicationStatus=MANUAL_REVIEW` means verified funds were retained as evidence but could not be applied to the current business state.
- `PaymentStatus.RECONCILIATION_REQUIRED` prevents a conflicting second success from colliding with the existing unique one-success-per-Reservation/purpose index. Its verified callback remains in `providerCaptures` with `providerSettlementStatus=VERIFIED`.

An eligible verified Deposit atomically changes `CONTRACTED` to `DEPOSIT_PAID` and sets `depositPaymentId`. An eligible verified Balance atomically changes `CHECKIN_READY` to `PAID` and sets `balancePaymentId`/`balanceSettledAt`. Both use `Reservation.inventoryVersion` CAS and append one status-history entry. There is no automatic activation or handover.

Late success, expired/cancelled Reservation, changed contract state, mismatched amount/currency/link, already-successful competing payment and multiple distinct captures are recorded for manual reconciliation. No automatic refund, revival, reallocation or overpayment application occurs. An expired/cancelled PayOS link alone does not prove no funds arrived. A new attempt is blocked while a prior attempt remains pending or unresolved; only an authoritative failure with zero paid amount permits a new attempt.

## Idempotency and transaction behavior

The client key is namespaced with `PAYOS-SS-` and stored under the existing unique `ReservationPayment.idempotencyKey` index. The existing `providerReference` unique index stores a random numeric PayOS `orderCode`; it is immutable after creation. A transaction acquires the Reservation lifecycle CAS before writing the Payment intent, then the provider call occurs after intent commit. A separate CAS claim (`NOT_CREATED → CREATING`) prevents concurrent provider-link creation. Unknown provider outcomes become `UNKNOWN` and are looked up by the same order code; a second order code is never generated for a replay.

Verified webhook event hashes are stored with the Payment in the same transaction as any Reservation CAS/status-history write. Replayed hashes are no-ops. Driver transient retries are bounded by `ClientSession.withTransaction`; after an unknown commit result, the service checks for the durable event hash and otherwise returns `503`. These transaction and concurrency guarantees are source-level only until verified against an authorized MongoDB replica set.

## Server configuration

Set only in the backend runtime, never in Vite/frontend configuration:

- `PAYOS_ENABLED=false` (default/rollout gate)
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `PAYOS_CUSTOMER_ORIGIN` (public Customer origin; Backend appends `/portal/payments/:reservationId` for both return and cancel)
- `PAYOS_WEBHOOK_URL` (public HTTPS URL in production; PayOS webhook registration is a separate operator action)

The repository `.env.example` contains names/placeholders only. Do not copy real values into source, docs, reports or tests. The hosted PayOS API fixes VND; the service verifies `VND` from PayOS rather than accepting currency from the client.

## Verification and remaining gates

`tests/payos-payment.test.cjs` uses deterministic mocked gateway and Mongoose operations. It does not contact PayOS or a database and cannot prove MongoDB transaction/concurrency behavior. Before live use, separately authorize the runtime/deployment operation, configure secrets in the backend secret manager, register the HTTPS webhook, run approved replica-set transaction tests, and perform a separately authorized low-value sandbox/provider verification. No production handover is enabled by this integration.
