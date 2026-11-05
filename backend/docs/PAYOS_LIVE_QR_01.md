# PAYOS-LIVE-QR-01 — Provider-Generated Dynamic QR

## Scope and current implementation

This change adds pass-through support for the QR payload returned by the PayOS Hosted Checkout API for Self-Storage Deposit and Balance intents. The backend persists the provider-returned payload on the existing Payment intent, and exposes it only when the payment is pending, checkout is ready, the customer still owns the eligible Self-Storage Reservation, and the original economic identity still matches current pricing and Facility data. The API does not generate a QR payload locally and does not interpret it as payment evidence. Only an authenticated, verified PayOS webhook can establish provider settlement.

`qrCode` is optional for compatibility with existing READY links and is limited to 4096 printable ASCII characters with the EMV payload prefix `000201`. Missing or malformed provider QR data is not synthesized; the existing Hosted Checkout URL remains available when its normal safety checks pass. Stored historical QR data is retained, while API material is suppressed for completed, stale, ineligible, or reconciliation-required payments.

## Customer display and polling

The Customer React checkout now renders the validated provider payload locally as a PNG data URL using the pinned `qrcode@1.5.4` package. It does not send the payload to a public QR-image service. Payment creation keeps the Customer on the payment page and offers an explicit Hosted Checkout button. If the backend does not return a usable QR, no QR is fabricated and the safe Hosted Checkout option remains available.

While an eligible pending READY payment is present, the page polls the authenticated Backend status endpoint every five seconds. Polling is skipped while the tab is hidden, does not overlap itself or a user initiated payment/status action, and is cleaned up on unmount/session change. Only `providerSettlementStatus=VERIFIED` with `applicationStatus=APPLIED` refreshes the Reservation as successfully paid. Query parameters, QR rendering, and provider-return navigation are not settlement evidence.

## Security and lifecycle invariants

- QR contents are provider-generated payment instructions, not evidence that funds arrived.
- Never mark a Payment settled from QR display, Hosted Checkout return/cancel query parameters, or browser state.
- Keep the original intent, PayOS order code, amount, currency, idempotency identity, and provider evidence immutable.
- Do not issue a new order code to resolve an unknown provider outcome.
- Do not expose QR data for completed or MANUAL_REVIEW payments, or if the Reservation has expired, been cancelled, changed Facility, or no longer matches the stored economic identity.
- Provider secrets remain server-side. Never place secrets in QR, URLs, logs, fixtures, or API responses.
- Keep production payment activation gated until separate operational authorization and provider verification are completed.

## Verification performed

- Frontend QR and polling tests run under Node's test runner. They test local QR encoding and mocked Backend status responses; they are not browser or provider integration tests.
- Backend build passed in PAYOS-LIVE-READY-03 after the missing `StorageUnitModel` and `StorageUnitStatus` imports in `reservation.controller.ts` were repaired. That prior build/regression result is recorded separately; this browser-verification phase reran Backend build.
- No live PayOS request, credential access, database operation, migration, or deployment was performed.

## PAYOS-LIVE-READY-04 browser verification (2026-11-02)

An installed Microsoft Edge executable was driven by the already-installed Playwright runtime against a disposable Vite instance bound to `127.0.0.1:5191`. `VITE_USE_MOCK=false` was set. Every API request was fulfilled from synthetic fixtures; requests to all other origins were aborted. No PayOS, bank, or application Backend service was contacted.

- Deposit browser path reached `POST .../payments/payos` with `purpose=DEPOSIT` and an `Idempotency-Key`; the mocked `201 CREATED` supplied VND 500,000 and a synthetic provider QR payload. The Customer page rendered a PNG data URL, stayed on the Reservation payment route, and showed the explicit Hosted Checkout action. Reload restored the same QR and did not issue another POST. A return URL containing `status=PAID` and an unknown order code did not produce a success state.
- Mock status polling advanced to `VERIFIED + APPLIED`; the fixture changed Reservation status to `DEPOSIT_PAID`. The UI displayed Backend-verified application and did not move the Reservation to ACTIVE or trigger handover/PIN. The five-second interval and hidden-tab suspension were NOT independently verified.
- Balance verification was BLOCKED by repeated Reservation/Contract/history reads while recovering a prior `VERIFIED + APPLIED` Deposit on the next payment page; the Balance action and its QR were not verified. The observed pattern is consistent with the `loadStatuses` effect being retriggered after `onReservationRefresh` changes its Reservation-status dependency. This requires a focused Frontend correctness fix and a rerun before PAYOS-LIVE-READY-04 can pass.
- An isolated Edge QR decode check was attempted with its built-in `BarcodeDetector`; the runtime reported `available: false`. No independent decoder was installed, so exact decoded payload comparison remains NOT RUN. QR image rendering was verified, but payload decoding is not claimed.
- Logout/account switching, pagination, 409/503/timeout, stale/invalid/missing QR, UNKNOWN/MANUAL_REVIEW, hidden-tab suspension, and no-session-history recovery were NOT RUN in the browser session.

Frontend unit tests passed 40/40. Frontend `npm run build` passed (2,133 modules transformed; 4m12s) with Vite's large-chunk warning for the 853.62 kB main JS chunk. Backend `npm run build` passed (exit 0). The selected Backend mocked regression command passed 126/126 (including nested subtests). `git diff --check` and `git diff --cached --check` passed. `npm audit --json` exited 1 because the runner could not resolve `registry.npmjs.org` (`ENOTFOUND`); no advisory report was obtained. No real provider webhook, MongoDB replica-set transaction, or bank QR scan was tested.

## Before production use

1. Run browser verification against synthetic API fixtures; do not treat it as settlement verification.
2. Configure an HTTPS public webhook endpoint and server-side PayOS credentials through the approved secret manager.
3. Verify provider webhook authenticity and settlement using an authorized PayOS test environment and an authorized disposable MongoDB replica set.
4. Complete separate operational and production rollout approvals. This implementation does not authorize live transactions or enable production payment processing.
