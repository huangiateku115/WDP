# PAYOS-04A.3 — Customer PayOS Payment Recovery

## Endpoint

`GET /api/v1/reservations/:id/payments/payos`

The endpoint requires authentication and the `CUSTOMER` role. It first resolves the Reservation using both its ID and the authenticated Customer ID, and only for `SELF_STORAGE`. Missing, foreign, and non-Self-Storage Reservations return the same 404 response. Payment history is then filtered by Reservation, Customer, Self-Storage service type and `PAYOS` provider. Facility ID is intentionally not part of the history authorization filter so historical payments remain readable after a Facility metadata change.

Example:

```http
GET /api/v1/reservations/507f1f77bcf86cd799439011/payments/payos?limit=10
Authorization: Bearer <customer-token>
```

```json
{
  "success": true,
  "data": {
    "items": [{
      "id": "507f1f77bcf86cd799439012",
      "reservationId": "507f1f77bcf86cd799439011",
      "purpose": "DEPOSIT",
      "amount": 100000,
      "currency": "VND",
      "provider": "PAYOS",
      "providerSettlementStatus": "NOT_VERIFIED",
      "status": "PENDING",
      "applicationStatus": "NOT_APPLIED",
      "checkoutStatus": "READY",
      "checkoutUrl": "https://pay.payos.vn/web/example",
      "createdAt": "2026-10-30T00:00:00.000Z",
      "succeededAt": null,
      "reconciliationRequired": false
    }],
    "nextCursor": null
  }
}
```

`limit` defaults to 10 and accepts integers from 1 to 25. `nextCursor` is an opaque base64url encoding of the last row's creation timestamp and ObjectId; supply it as `cursor` to continue the stable newest-first order (`createdAt DESC, _id DESC`). The query fetches at most `limit + 1` documents, applies a 2-second MongoDB `maxTimeMS`, and fails rather than doing an unbounded-duration scan. Invalid limit/cursor returns HTTP 400. The existing single-payment GET route is unchanged and is registered after this literal `payos` route.

The existing `{ customerId, createdAt }` index can assist customer-scoped newest-first reads. For larger histories, evaluate a compound index on `{ reservationId: 1, customerId: 1, serviceType: 1, provider: 1, createdAt: -1, _id: -1 }`. No database index was created or migrated in this change; production index rollout needs separate review and authorization.

## Checkout URL policy

History remains readable when a Reservation's Facility, price, state, contract, or payment eligibility changed. `checkoutUrl` is returned only if the payment is PENDING, checkout is READY, provider settlement is not verified, application is not MANUAL_REVIEW, and the current Reservation still matches the immutable intent's Facility, purpose, amount/currency and eligibility. A hidden or stale URL is not deleted from the historical Payment record. The endpoint never calls PayOS, creates an intent, mutates payment/reservation state, or treats redirect query parameters as evidence.

The DTO excludes idempotency keys, order codes/provider references, credentials, webhook signatures, raw provider payloads and internal reconciliation diagnostics.

## Customer recovery behavior

The `/portal/payments/:reservationId` page reads local attempt tracking when available and also queries this owner-scoped Backend list. Server history is merged by immutable payment identity and displayed newest first; older records are fetched on demand with the bounded cursor. Pending safe checkouts can be continued directly without POSTing another intent. Any pending, uncertain, verified-but-unapplied or reconciliation-required attempt blocks a new attempt. A new attempt is considered only after Backend history establishes that prior attempts are terminally failed and the Customer explicitly starts checkout; the Backend remains authoritative and enforces its own unresolved-intent checks.

The original idempotency key is not returned or reconstructed by this endpoint. If local tracking is lost, existing payment identity/status/checkout may be recovered, but an uncertain intent with no safe URL cannot be retried by inventing its original key. If history lookup fails, the page fails closed and disables new checkout. An empty history page alone does not trigger automatic checkout or imply a previous uncertain request definitely did not commit.

## Verification and remaining gates

Focused Backend and Frontend tests use mocks; no database or PayOS provider is contacted. The Customer checkout and return flow still needs an authorized same-tab browser smoke test with mocked HTTP traffic. Real settlement requires separate approval, configured public HTTPS Customer origin and webhook endpoint, authorized provider setup, and a disposable authorized MongoDB replica set for transaction verification. No live provider verification is claimed.
