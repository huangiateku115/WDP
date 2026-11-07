# WDP Customer Self-Storage PayOS Hosted Checkout

## Scope and flow

The Customer Self-Storage flow uses the Backend-created PayOS Hosted Checkout URL as its primary payment experience. The React checkout page does not render a QR code. Backend QR data remains in the existing Payment DTO and persistence for compatibility, but is not shown as a payment instruction in the primary Customer UI.

1. The Customer explicitly confirms a Self-Storage Reservation.
2. `POST /api/v1/reservations` receives a stable `Idempotency-Key`. The key is scoped to the authenticated Customer and immutable request identity. A replay returns the original Reservation with HTTP 200; a new Reservation returns 201. Reusing a key with changed booking identity returns 409.
3. The Frontend stores the returned Reservation identity and a stable Deposit `Idempotency-Key`, then calls `POST /api/v1/reservations/:id/payments/payos`.
4. For a newly created or replayed Payment, the Frontend redirects only when it matches the route Reservation and expected purpose, is `PENDING` / `READY`, has no reconciliation requirement or verified settlement, and carries an HTTPS URL on `pay.payos.vn` under `/web/`.
5. If checkout creation is uncertain, the Frontend keeps the Reservation and original Payment attempt, opens the safe recovery page and never creates a new order code to bypass the unknown outcome.
6. PayOS returns to the configured per-Reservation path `/portal/payments/:reservationId`. Return/cancel query parameters are not settlement evidence. WDP reads the authenticated Backend Payment history/status and navigates to the owned Payment History entry.
7. Only `providerSettlementStatus=VERIFIED` plus `applicationStatus=APPLIED` is shown as successful. Settlement does not automatically activate, hand over or create access/PIN.

## Existing backend API contracts

- `POST /api/v1/reservations` — authenticated Customer. Existing body remains `facilityId`, `storageUnitId`, `startDate`, `endDate`, and `pricingPolicyId`. Optional `Idempotency-Key` is additive: 201 for new, 200 for same-key/same-payload replay, 409 when the same Customer key is reused for a different booking identity. Requests without the header preserve the existing 201 response behavior.
- `POST /api/v1/reservations/:id/payments/payos` — authenticated owner Customer. Body contains `purpose`; amount and currency remain Backend-derived. Requires the existing stable `Idempotency-Key` header. 201 means created; 200 means replay.
- `GET /api/v1/reservations/:id/payments/payos` — owner-scoped history, bounded cursor pagination.
- `GET /api/v1/reservations/:id/payments/:paymentId` — owner-scoped status. It may expose checkout URL only for a currently eligible READY Payment.
- `POST /api/v1/payments/payos/webhook` — public provider callback, signature verification remains mandatory. Return redirects never replace this evidence.

The Customer FE keeps the existing routes `/portal/payments/:reservationId` and `/portal/payments`. History selects a Reservation only after confirming that it appears in the authenticated Customer's `/reservations/me` collection.

## Reservation idempotency persistence

When the optional header is supplied, the Service hashes the canonical Customer, Facility, StorageUnit, date range, pricing rule and service type. It stores that hash with the immutable request key on the Reservation. A customer-scoped partial unique index on `{ customerId, bookingIdempotencyKey }` arbitrates concurrent requests. The transaction still takes the StorageUnit booking-version write token before overlap checks and Reservation/Contract inserts. The key lookup is read-only before that first write. On a duplicate insert or ambiguous transaction result, the Service may return a matching committed Reservation; a different hash is a stable 409. No change is made to legacy requests without an idempotency key or to Managed Inventory creation.

The schema defines the unique partial index; this implementation did not connect to a database or create an index. Before deployment, verify that the index is installed in the target database through the approved operational index rollout process. Do not treat mocks as proof of concurrent uniqueness or replica-set transaction behavior.

## URL and provider safety

The Frontend accepts a checkout destination only when it is HTTPS, has no user information or explicit port, and matches the official `pay.payos.vn` hostname with a `/web/` path. The Backend remains the authority that obtains and persists `checkoutUrl` from the PayOS SDK and validates provider response identity. No user-supplied redirect URL is accepted. If PayOS changes its official checkout domain, update the allowlist only after verifying the official provider contract and add tests.

The SDK create call remains `maxRetries: 0`; unknown results continue to be recovered using the original Payment intent and `orderCode`. Existing mock payment protections, Managed Inventory payment flows, signed webhook handling, payment accounting and Reservation lifecycle rules remain unchanged.

## Local Frontend with Render Backend

The Customer UI can remain on `http://localhost:5173` while calling the configured Backend API. The PayOS return origin is determined by the Backend's trusted `PAYOS_CUSTOMER_ORIGIN`, not by a Frontend query parameter. Browser storage is origin-scoped. If that origin is an HTTPS tunnel, a login established at `localhost` will not create a session on the tunnel origin. For an authenticated same-origin browser return test, open/login to the Frontend through the same HTTPS tunnel from the start. Do not place access tokens in URLs or weaken CORS/authentication to work around origin mismatch.

Before live verification, separately confirm the Render service version, server-side secret configuration, HTTPS webhook reachability, PayOS channel policy, unique index installation and real MongoDB replica-set transaction behavior. This code task makes no live PayOS request, transfer, database change or deployment.

## Verification boundary

Automated tests use mocked Backend/PayOS responses. They can verify DTO validation, redirect eligibility, UI source behavior and idempotency request headers. They do not verify PayOS credentials, provider-side checkout creation, webhook delivery, browser cross-origin authentication, installed production MongoDB indexes or transaction concurrency. Use a controlled browser run with synthetic endpoints first, then a separately authorized provider sandbox/live plan.
