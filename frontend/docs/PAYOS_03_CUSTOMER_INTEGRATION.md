# PAYOS-03 — Customer Self-Storage Frontend

## PAYOS-04A.3 — Lost tracking recovery

The Customer payment page now reads local session attempt tracking when available and also retrieves payment history from the authenticated Backend route:

`GET /api/v1/reservations/:reservationId/payments/payos?limit=10&cursor=<opaque-cursor>`

This route is Customer-owner-scoped and Self-Storage-only. It returns PayOS payment DTOs newest first, with bounded pages (default 10, maximum 25). The FE merges records by immutable payment ID/economic identity and loads older history on demand. Payment IDs and statuses can therefore be rediscovered after session storage has been cleared. The Backend does not return original idempotency keys.

The FE can continue an existing checkout only when the recovered DTO includes a safe checkout URL. Pending, unknown, succeeded-but-unapplied, and reconciliation-required intents block a second intent. A new attempt is considered only after authoritative history shows prior attempts failed without verified funds and the Customer explicitly starts it. If history cannot be loaded, checkout is disabled. Empty history does not trigger an automatic retry; an uncertain old key cannot be reconstructed.

VERIFIED + APPLIED is the only condition that causes the FE to refresh Reservation state. PayOS return/cancel query parameters are never settlement evidence. No payment state, activation, PIN, access or handover is inferred from navigation.

The Backend bounds each history page and query duration. A compound history index may be required as volume grows; no index migration was performed. Tests are mocked. A browser E2E with mocked HTTP, real HTTPS webhook verification, and authorized MongoDB replica-set transaction checks remain outstanding.

## Scope

This phase connects the existing Customer Self-Storage payment page to the PAYOS-02B.1 Backend Hosted Checkout APIs. The Frontend never calls PayOS directly and never marks a payment successful. Managed Inventory payment, Staff screens, Backend code, provider credentials, database operations and deployment are outside this phase.

## API contract

- `POST /api/v1/reservations/:reservationId/payments/payos`
  - Auth: existing Customer session bearer token.
  - Header: stable `Idempotency-Key` for the current Customer, Reservation, purpose and unresolved attempt.
  - Body: `{ "purpose": "DEPOSIT" | "BALANCE" }` only.
  - `201` means a newly created checkout; `200` means the same intent was replayed. The amount, currency and checkout URL come only from the Backend.
- `GET /api/v1/reservations/:reservationId/payments/:paymentId`
  - Auth: existing Customer session bearer token.
  - The Backend verifies ownership. The Frontend verifies the returned Payment and Reservation IDs match the request.
- `POST /api/v1/payments/payos/webhook` remains Backend-only and is not called by the browser.

The Axios authentication interceptor is reused. The request allowlist permits only the exact Customer POST and GET patterns. No amount, order code, Customer ID, currency or payment status is submitted by the Frontend.

## Lifecycle and display

- Deposit is available for a Self-Storage `CONTRACTED` Reservation with a valid payment window and its existing `DRAFT` Contract. The UI calls it advance rent credited toward rent, not a refundable security deposit.
- After `DEPOSIT_PAID`, the payment CTA is replaced with the existing contract next step.
- Balance is available only in `CHECKIN_READY` with a `SIGNED` Contract and verified signed-paper proof. The Backend also checks for the applied PayOS Deposit and calculates the amount.
- Customer-facing actions are labelled `Thanh toán tiền thuê trả trước` and `Thanh toán số tiền thuê còn lại`.
- Only `providerSettlementStatus=VERIFIED` plus `applicationStatus=APPLIED` is shown as applied payment. A verified payment requiring `MANUAL_REVIEW`, or `SUCCEEDED` without `APPLIED`, is never presented as fully paid.
- No payment result activates the Reservation or routes directly to handover.

## Hosted checkout and return

On the explicit Pay action, the page reloads the owned Reservation and Contract, checks eligibility for display, and asks the Backend to create/replay the checkout. It opens only an HTTPS URL returned with a `PENDING` + `READY` Payment. A missing or malformed URL fails closed.

Payment tracking uses `sessionStorage`, scoped by Customer ID, Reservation ID and purpose. It stores only the stable idempotency key and Backend payment ID. A retry after timeout, HTTP 503 or a lost response reuses the same key. A new key is created only after the status API authoritatively returns `FAILED` with no verified settlement or application. Storage errors prevent opening the checkout.

Return and cancel query parameters are ignored as payment evidence and are never used to invent a payment ID. On return, the page recovers the tracked payment ID and reads status from the Backend. If the reference is missing, it displays a recovery message and does not create another checkout automatically.

## Customer payment cutover

The Customer Self-Storage payment route always uses PayOS. There is no Customer mock-payment fallback or payment-specific frontend feature selector. If the Backend PayOS feature is disabled, the Customer sees an unavailable/error response without simulated success. Managed Inventory Customer payment remains unsupported and read-only. See [CUSTOMER_PAYMENT_CUTOVER.md](CUSTOMER_PAYMENT_CUTOVER.md) for the current route and role boundaries.

## Verification and remaining blockers

Frontend tests use mocked API responses and local test doubles. They do not call PayOS or prove browser E2E, webhook, real money, MongoDB transaction or replica-set concurrency behavior. The historical test counts in this implementation note describe the earlier PAYOS-03 run, not the later Customer payment cutover.

Before live payment verification, the Backend deployment must provide approved server-side PayOS configuration and `PAYOS_ENABLED=true` only after separate approval. `PAYOS_RETURN_URL` and `PAYOS_CANCEL_URL` must return to `/portal/payments/:reservationId` on the deployed Customer site. The public HTTPS webhook registration and provider credentials remain deployment/operator work and were not accessed or changed in PAYOS-03.

## PAYOS-LIVE-READY-04 — local browser verification (2026-11-03)

The Backend compilation/import issue reported for PAYOS-LIVE-READY-03 is resolved in the current source baseline; the Backend build completed successfully in this verification. No Backend source was changed here.

Browser verification used Chrome 156.0.8078.76 and Node 22.23.3 with a dedicated disposable Chrome profile. Vite and a synthetic authenticated API fixture were bound to `127.0.0.1`; the browser test intercepted requests and failed any destination outside the local UI/API fixture. No real PayOS, production service, credential, or database was contacted.

**Deposit — partially verified in Chrome.** Synthetic Customer login and the `CONTRACTED` / `DRAFT` Deposit page rendered. A checkout action produced one `201` POST with `purpose=DEPOSIT` and an `Idempotency-Key`; the mocked DTO supplied 500,000 VND and its QR payload. The page rendered a local `data:image` QR with the Deposit accessible label and showed an explicit Hosted Checkout button without redirecting. A return URL containing `status=PAID` continued to show the mocked Backend `PENDING` state. After clearing `sessionStorage`, signing in again and reloading, payment history recovered the existing intent and the fixture observed no duplicate checkout POST.

**Balance — not completed end to end.** The browser reached the synthetic `CHECKIN_READY` / signed-proof reservation and displayed the Balance-eligible page after its data finished loading. The isolated smoke script did not complete a Balance checkout POST and QR assertion reliably: route loading raced the test helper and the action lookup failed on some runs. No Balance QR browser pass is claimed.

**Polling and QR payload.** Source inspection confirms the authenticated poll interval is five seconds and only `VERIFIED` + `APPLIED` triggers Reservation refresh. A browser page displayed the synthetic verified/applied presentation in one run, but the complete `PENDING → PENDING → VERIFIED + APPLIED` timing, non-overlap, hidden-tab pause, and terminal-stop behavior were not captured as a passing browser assertion. The browser checked that an image element was rendered from a local data URL; no independent QR decoder was available, so payload-to-image decoding was not verified.

Failure scenarios including 401/403/404/409/503, network timeout, invalid/missing QR, UNKNOWN, MANUAL_REVIEW, logout/account switch, duplicate clicks, and Backend recovery failure were not all executed in the browser. Existing Node tests and source review are separate evidence and do not substitute for those browser cases. Frontend `npm test` passed 40/40; Frontend build passed; Backend build passed; focused PayOS tests passed 47/47; selected payment/Reservation/inspection regressions passed 79/79. `git diff --check` and `git diff --cached --check` passed. `npm audit` could not reach `registry.npmjs.org` because DNS resolution returned `ENOTFOUND`; this is not a clean audit result.

MongoDB replica-set transaction/concurrency verification, real HTTPS webhook delivery, real provider checkout, live QR decoding/bank scanning, and production configuration remain unverified. Result: **PARTIAL / REVISE before PAYOS-LIVE-READY-05 or live payment activity.**
