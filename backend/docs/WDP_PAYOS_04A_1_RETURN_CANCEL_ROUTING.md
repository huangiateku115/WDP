# PAYOS-04A.1 — Per-Reservation Return and Cancel Routing

## Original blocker

PAYOS-02B.1 supplied static `PAYOS_RETURN_URL` and `PAYOS_CANCEL_URL` values to the PayOS SDK. The Customer payment page is `/portal/payments/:reservationId`, so generic `/payments/return` and `/payments/cancel` values could not identify the reservation to reload after Hosted Checkout.

## Source change

`createProviderLink()` now creates both PayOS destinations from the immutable `Payment.reservationId`:

```text
https://your-customer-domain.example/portal/payments/<reservationId>
```

The return and cancel URLs are intentionally the same route. The browser reloads the owned Reservation and Contract, recovers payment IDs from its Customer/Reservation/purpose-scoped session storage, and reads payment status through the owner-scoped Backend status API. PayOS return/cancel query parameters remain navigation metadata and are never payment evidence.

The Backend validates the stored reservation ID as a 24-character Mongo ObjectId. No redirect URL is accepted from the Customer request, Host, Origin, Referer, or query parameters.

## Configuration contract

Configure only the Customer site's origin:

```dotenv
PAYOS_CUSTOMER_ORIGIN=https://your-customer-domain.example
PAYOS_WEBHOOK_URL=https://your-api-domain.example/api/v1/payments/payos/webhook
```

`PAYOS_CUSTOMER_ORIGIN` must be an absolute HTTP(S) origin with no credentials, path, query, or fragment. HTTPS is required when `NODE_ENV=production`; local non-production environments may use HTTP. The service appends the fixed Customer route and Reservation ID. The deployed domain must be supplied by the operator; no production domain is hardcoded.

The webhook URL remains separately configured and its route/verification behavior is unchanged.

## Existing checkout links and replay

Existing Payment intents and provider order codes are unchanged. A READY replay returns the existing checkout link and does not call PayOS again to replace its redirect destinations. An UNKNOWN outcome continues reconciliation against its original order code; no replacement order code or link is generated. Links created before this fix may still return to their original configured URLs and cannot be repaired automatically without provider interaction.

## Verification

`npm run build` passed (exit 0). `node --test tests/payos-payment.test.cjs` passed 40/40 (exit 0, including nested cases). The adjacent regression command `node --test tests/payment-accounting.test.cjs tests/reservation.test.cjs tests/inspection.test.cjs tests/managed-reservation.test.cjs tests/managed-checkin.test.cjs` passed 134/134 (exit 0). Tests mock the PayOS SDK and Mongoose operations; no live provider request or database operation is part of these tests.

## Remaining operational requirements

- Set `PAYOS_CUSTOMER_ORIGIN` to the actual deployed Customer site's public HTTPS origin.
- Set `PAYOS_WEBHOOK_URL` to the public HTTPS API endpoint and register it with PayOS only through the separately authorized deployment procedure.
- Verify return routing in a real same-tab Hosted Checkout flow and verify settlement on an authorized MongoDB replica set before any real-money activation.
- Existing checkout links retain their old destinations; guide users to the Backend payment status flow if an old link returns elsewhere.
