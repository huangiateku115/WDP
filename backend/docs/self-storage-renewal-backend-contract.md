# Self Storage Renewal Backend Contract

This document describes the backend contract for Customer Web/Mobile integration. Renewal changes are limited to Self Storage. A successful PayOS payment changes an Extension to `PAID`; it does not change the rental end date. Only an assigned Facility Staff/Manager confirming the paper addendum can activate the Extension.

## Quote

`POST /api/v1/reservations/:reservationId/renew-quote` (Customer role)

Request body:

```json
{ "termValue": 2, "termUnit": "MONTH" }
```

`termUnit` supports `DAY`, `MONTH`, or `YEAR`; the backend requires a matching active Facility/Unit Pricing Rule and does not accept a client price. Quote response is `{ success, data }`; `data` includes `reservationId`, `durationMonths`, `termValue`, `termUnit`, `pricingPolicyId`, `monthlyPrice`, `totalAmount`, `amount`, `currency`, `oldEndDate`, `newEndDate`, `canExtend`, and `reason`. `canExtend` is informational and must be checked again when creating the Extension.

Failure responses include 403 `RESERVATION_FORBIDDEN`, 404 missing Reservation, 409 `RENEWAL_NOT_SUPPORTED`, and 400 for invalid term/no matching Pricing Rule. Other eligibility failures return a quote with `canExtend: false` and a human readable `reason`.

## Create Extension Request

`POST /api/v1/reservations/:reservationId/extension-request` (Customer role)

Request body uses the same `termValue` / `termUnit` as Quote. `Idempotency-Key` is optional for compatibility; when supplied it must match `^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$`. Replaying the key with the same term returns HTTP 200 and `outcome: "REPLAYED"`. Reusing it with a different term returns 409 `IDEMPOTENCY_KEY_CONFLICT`. A matching in-progress request is replayed; a different in-progress request returns 409 `EXTENSION_ALREADY_IN_PROGRESS`.

A newly created request returns HTTP 201 with `{ success, message, data: { reservationId, extension } }`. Extension starts as `PENDING_PAYMENT` and contains the server-calculated amount, dates, duration, and a unique subdocument `_id`. The Reservation end date remains unchanged. Creation rechecks current Reservation/Contract/Unit eligibility and booking overlap inside a MongoDB transaction. The Unit `bookingVersion` write serializes extension creation against new bookings.

## PayOS Renewal Checkout

`POST /api/v1/reservations/:reservationId/extension-payments/payos` (Customer role)

Headers:

- `Idempotency-Key`: required payment identity key.
- `X-WDP-Payment-Client`: `WEB` or `MOBILE`; defaults to `WEB`.

Body:

```json
{ "extensionId": "<Extension ObjectId>" }
```

Client supplied amount, currency, return URL, and provider metadata are rejected. Success returns `{ success, outcome, data }`, including `id`, `reservationId`, `extensionId`, `purpose: "RENEWAL"`, `amount`, `currency: "VND"`, `provider: "PAYOS"`, `status`, `providerSettlementStatus`, `applicationStatus`, `checkoutStatus`, `checkoutUrl`, and available `orderCode` / `paymentLinkId`. The URL is returned only after PayOS response identity checks and persistence readback. Provider failure or uncertain response returns a structured error; retry the same key or query/reconcile the existing Payment rather than creating a new payment.

Same key and same identity replays the existing Payment. Key reuse with a different Reservation, Customer, purpose, or Extension returns 409 `IDEMPOTENCY_KEY_CONFLICT`. A terminal intent can be replaced only with a new key after the provider outcome is authoritatively terminal and no capture/outcome event exists. Old Payment rows remain auditable; a late webhook for an old Payment is never assigned to the replacement Extension intent.

## Payment Status and Reconciliation

- `GET /api/v1/reservations/:reservationId/payments/:paymentId`
- `POST /api/v1/reservations/:reservationId/payments/:paymentId/reconcile`

Both are Customer-owned reads/actions. Payment statuses include `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, and `RECONCILIATION_REQUIRED`. Checkout states include `NOT_CREATED`, `CREATING`, `READY`, `UNKNOWN`, `FAILED`, `CANCELLED`, and `RECONCILIATION_REQUIRED`. Settlement is authoritative only when `providerSettlementStatus: "VERIFIED"`; business application is complete only when `applicationStatus: "APPLIED"`. `MANUAL_REVIEW` or `reconciliationRequired: true` is not success. A redirect from PayOS is never settlement evidence.

The Reservation response contains its `extendContract` history. Renewal transitions are `PENDING_PAYMENT → PAID → ACTIVE`; a rejected or cancelled Extension remains terminal. `signingDeadline` is set after verified settlement. Only Staff confirmation updates `Reservation.endDate` and `Contract.pricingSnapshot.endDate`.

## Customer behavior

- Double-tap: reuse the same payment Idempotency-Key. Do not create a second intent.
- Customer leaves PayOS: query Payment status; do not infer failure from the redirect/cancel page.
- Payment may be captured before webhook delivery: show pending verification and poll/reconcile the same Payment.
- Explicitly verified failure/cancellation: show that outcome. A new attempt requires a new key after backend `retryAllowed` and authoritative provider reconciliation.
- Unknown/provider timeout: retain the current intent, show “đang xác minh”, and retry status/reconciliation with the same payment identity. Do not resubmit a new Extension or Payment.
- `SUCCEEDED + VERIFIED + APPLIED` with Extension `PAID`: payment is complete, but tell the Customer to visit the Facility to sign the paper addendum.
- Extension `ACTIVE`: display the updated Reservation end date from the backend Reservation.

## Index readiness — not applied by this change

Schema index:

```javascript
db.reservationpayments.createIndex(
  { reservationId: 1, extensionId: 1, purpose: 1 },
  {
    name: "renewal_extension_single_success",
    unique: true,
    partialFilterExpression: {
      purpose: "RENEWAL",
      status: "SUCCEEDED",
      extensionId: { $type: "objectId" }
    }
  }
)
```

The existing Reservation/purpose unique index is partial to `DEPOSIT`, `BALANCE`, and `FULL_RENT`, so it does not constrain `RENEWAL`. The Renewal index keys include `extensionId`, allowing a Reservation to have successful payments for different Extensions while preventing two successful Renewal rows for one Extension. Existing historical Renewal rows without `extensionId` are excluded from this new partial index and remain legacy audit records.

Read-only preflight (PowerShell; set `MONGO_URL` in the current process without printing it):

```powershell
$env:MONGO_URL = '<read-only test database URI>'
node .\scripts\self-storage-renewal-index-preflight.cjs --expected-db test
Remove-Item Env:\MONGO_URL
```

The script only lists indexes and aggregates duplicate/missing-extension counts. It never creates, drops, or syncs indexes. Review output and backup/rollback requirements before any controlled migration. After an approved migration, rerun the preflight and independently verify `db.reservationpayments.getIndexes()`; rollback would remove only the newly named index and must be reviewed because it removes the database uniqueness fence. No cleanup of historical payment data is automated.

Current status: `INDEX_DEPLOYMENT_UNVERIFIED`. No MongoDB URI was read, no database was contacted, and no index was created or dropped during this task.
