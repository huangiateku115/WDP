# WDP PAYOS-02B — Pre-live Backend Corrections

## Scope and approval

This note records the narrowly approved Self-Storage PayOS pre-live corrections. It supplements and supersedes earlier PAYOS-02 implementation notes where they describe replay eligibility or unknown webhook registration orders differently. It does not authorize live PayOS requests, webhook registration, database deployment, production activation, Managed Inventory payments, or automatic refunds.

The approved policies preserve the original payment intent (idempotency identity, Reservation, owner, Facility, purpose, amount, currency, and provider order code). If the Reservation's current economic identity or eligibility no longer matches, an old checkout must not be offered as a new eligible payment. Provider-confirmed money remains recorded when WDP can no longer apply it, with `MANUAL_REVIEW` and no Reservation transition.

## Webhook URL registration probe

The service verifies the webhook with the configured PayOS SDK gateway before looking up a local Payment. Only after successful SDK verification can the service acknowledge the exact documented PayOS sample tuple:

- `orderCode=123`, `amount=3000`, `currency=VND`
- `paymentLinkId=124c33293c43417ab7879e14c8d9eb18`
- `reference=TF230204212323`, `description=VQRIO123`
- `transactionDateTime=2023-02-04 18:25:00`
- `code=00`, `desc=Thành công`

This is deliberately more restrictive than matching `orderCode` and amount. WDP order codes are generated in a range starting at 1,000,000,000. The exact sample returns an acknowledgment-only result; it does not create or update a Payment or Reservation. A bad signature is rejected before any Payment lookup. Any other unmatched order code, including one with only the sample order and amount, remains `PAYMENT_NOT_FOUND` and is not acknowledged as an applied payment.

This supports the currently documented registration sample, not an inferred universal probe protocol. If PayOS changes or varies its signed sample tuple, registration fails closed until that exact contract is reviewed. The behavior has only been verified with an SDK test double; no real PayOS registration was performed. Do not treat this as evidence that a live endpoint has been registered.

## Immutable replay and stale checkout behavior

An idempotency replay remains bound to the original immutable intent. Pending replay revalidates owner, Reservation, Facility, `SELF_STORAGE`, purpose, current status and expiry/contract requirements, current server-derived amount, and VND. An economic or Facility mismatch produces a conflict; an ineligible Reservation produces a conflict directing the customer to query the original status. No replacement order code is generated for an unresolved attempt.

Owner-scoped status remains available for the original payment even if Reservation Facility metadata later differs. For a still-pending Payment, status lookup rechecks current eligibility and amount; when stale, it returns the payment's status but suppresses `checkoutUrl`. Completed/reconciliation history remains readable without presenting an old checkout link.

## Verified settlement mismatch

On a signed successful webhook, the service validates the original order identity, amount and currency. Before applying a Deposit, it rechecks the Reservation's current Facility, `CONTRACTED` state, unexpired eligibility, existing DRAFT Contract, and expected Deposit derived from current authoritative pricing. If amount or business identity no longer agrees, it stores the verified provider capture and marks the Payment for manual reconciliation; it does not change the Reservation or automatically refund/reissue. Balance policy and its existing signed-paper Contract requirement remain unchanged.

## Verification coverage

Focused mocked tests cover exact documented sample acknowledgment, sample-shaped invalid signature rejection, unknown and altered sample identities, replay after price/Facility/state changes, stale pending status URL suppression, Deposit amount/Facility mismatch retaining verified funds evidence, and early webhook delivery before checkout link ID persistence. Existing tests also cover duplicate and contradictory provider events, replay, provider uncertainty, production handover denial, and Managed payment isolation. These are service/controller mock tests; they do not prove MongoDB replica-set concurrency or live PayOS behavior.

## Dependency evidence and limits

The backend declares `@payos/node` as a direct production dependency at `^2.0.5`; the local lockfile resolves `2.0.5`. Its lockfile entry declares no transitive dependencies. The installed SDK package manifest likewise lists development tools only and no runtime dependencies. This does not prove that the SDK or its dependency-free code is vulnerability-free.

The previously reported aggregate count of 13 vulnerabilities could not be attributed to `@payos/node` from the locally available evidence. An offline npm audit, when available, only reflects cached advisory data and must not be represented as a current complete audit. No package was upgraded or modified as part of this correction. For a current package-level advisory assessment, run an authorized online audit in CI or another approved network-enabled environment and review the production dependency paths before changing versions.

## Remaining pre-live requirements

- Review the exact probe tuple against the PayOS account's current registration behavior before live webhook registration.
- Run a current dependency audit in an approved network-enabled environment.
- Run payment and transaction concurrency tests against an authorized disposable MongoDB replica set.
- Separately authorize provider credentials, live checkout, webhook registration, deployment, and production operation.
- Keep `PAYOS_ENABLED` disabled until those approvals and operational controls are complete.

## Local verification record

On the implementation workspace, `npm run build` exited 0. `node --test tests/payos-payment.test.cjs` exited 0 with 32/32 tests passing (30 top-level tests and 2 nested cases). The related regression command `node --test tests/payment-accounting.test.cjs tests/reservation.test.cjs tests/inspection.test.cjs tests/managed-reservation.test.cjs tests/managed-checkin.test.cjs` exited 0 with 134/134 tests passing (130 top-level tests and 4 nested cases). `git diff --check` and `git diff --cached --check` both exited 0. These tests are local/mock-based; MongoDB replica-set and live-provider behavior remain unverified.

`npm audit --offline --json` exited 0 and reported zero advisories from the locally available offline audit data. This is not a current online audit and does not resolve the separately reported aggregate 13-vulnerability count. `npm ls @payos/node --all` reports the direct production dependency `@payos/node@2.0.5`; its lockfile entry has no dependency list. No dependency changes were made for this review.

## PAYOS-02B.1 checkout response safety

The path where the idempotency lookup inside `createIntentTransaction()` finds a concurrently committed intent now routes through `replayExisting()` after the transaction. This applies the same owner, Reservation, Facility, service, provider, purpose, current pricing/currency, and lifecycle checks as ordinary replay. It preserves the original order code and does not create another provider link for a READY replay or an unresolved UNKNOWN outcome.

The status DTO suppresses `checkoutUrl` unless the Payment is still `PENDING`, checkout state is `READY`, and no manual-review/verified-settlement flag exists. `getCustomerStatus()` additionally revalidates current Reservation eligibility and economic identity before returning the URL. Completed, reconciliation, manual-review, expired, cancelled, changed-price, and changed-Facility cases preserve owner-scoped payment status but do not return a checkout URL. The stored historical URL is not erased.

PAYOS-02B.1 verification: `npm run build` exited 0; `node --test tests/payos-payment.test.cjs` exited 0 with 37/37 tests passing (35 top-level tests and 2 nested cases); the related payment/accounting, Reservation, inspection, Managed Reservation and check-in suites exited 0 with 134/134 tests passing (130 top-level tests and 4 nested cases). Both Git diff checks exited 0. All verification remains mocked/local; PayOS and MongoDB replica-set behavior are unverified.
