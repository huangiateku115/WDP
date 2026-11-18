# Customer Mobile Self Storage Renewal — Implementation Report

**Task:** `WDP_CUSTOMER_MOBILE_SELF_STORAGE_RENEWAL_E2E`  
**Checkpoint:** `WDP_CUSTOMER_MOBILE_SELF_STORAGE_RENEWAL_E2E`  
**Result:** `MOBILE_RENEWAL_PARTIAL`

## A. Baseline and scope

- Mobile source: `frontend/customer-mobile/`.
- Backend contract reviewed: `backend/docs/self-storage-renewal-backend-contract.md` and `backend/docs/self-storage-renewal-e2e-completion-report.md`, then compared with current Reservation routes/controller, PayOS controller/service, Reservation model and types.
- Backend source contains the Customer quote, extension request, Renewal PayOS intent, payment status and reconcile routes. Its reported status remains `BACKEND_RENEWAL_CODE_READY_DEPLOYMENT_UNVERIFIED`.
- Git branch, HEAD and dirty-file baseline: `NOT_VERIFIED`. Git reported `fatal: cannot change to 'C:/Users/laptop/Desktop/WDP'`. No reset, stash, clean, checkout, commit or deploy was performed.
- No Backend, Web, `.env`, MongoDB, index, or PayOS configuration was changed. Expo export loaded the project’s configured public API environment variable; its value was not printed or inspected.

## B. Implementation

| File | Change |
|---|---|
| `app/rentals/[id]/renewal.tsx` | Added the canonical Expo Router Renewal route. |
| `src/screens/LiveRental.tsx` | Added “Gia hạn hợp đồng” to the active Self Storage Rental Detail and displayed Backend-provided Renewal history. |
| `src/screens/RentalRenewalScreen.tsx` | Added separate quote, request, hosted payment, status, reconciliation, paper addendum, and updated-term UI. |
| `src/api/selfStorageRenewal.ts` | Added typed adapters for current Facility pricing terms, quote, Extension request, Renewal payment, payment status and reconcile. |
| `src/api/contracts/customer.ts` | Added a tolerant typed `extendContract` history field to the existing Reservation response contract. |
| `src/state/attemptJournal.ts` | Added account/API-scoped `renewal-request` and `renewal-payment` journal scopes. |
| `src/screens/PayosPaymentReturn.tsx` | Routed the shared payment return reconcile response by its Backend `purpose`, preserving existing payment mapping and adding Renewal handling. |
| `tests/self-storage-renewal.test.ts` | Added quote, pricing-term, idempotency request shape, payment identity, hosted URL safety and callback reconcile tests. |
| `tests/rental-detail-render.test.tsx` | Added active Rental Detail Renewal button and Reservation ID navigation assertion. |

### API and behavior

- Pricing terms are read from the authenticated `/pricing-rules` endpoint for the actual facility/unit and effective date. The Mobile app does not hardcode a term list or price.
- Quote uses `POST /reservations/:id/renew-quote`. The displayed amount, current end date, proposed end date and eligibility reason are Backend response values. A `canExtend: false` quote cannot be submitted.
- Extension creation uses `POST /reservations/:id/extension-request` with only `termValue`/`termUnit` plus an `Idempotency-Key`. A new key is journaled before the request; an ambiguous result retries with that same key. The API rechecks eligibility on creation.
- Renewal checkout uses `POST /reservations/:id/extension-payments/payos`, `Idempotency-Key`, `X-WDP-Payment-Client: MOBILE`, and body `{ extensionId }`. No client amount, currency, or return URL is sent.
- Existing Extension/payment IDs are read and reconciled before another intent can be created. A new payment key is allowed only when Backend reports an authoritative terminal `FAILED`/`CANCELLED`, `retryAllowed: true`, and no unresolved reconciliation. No automatic checkout or retry occurs.
- A hosted URL is opened only when Backend reports a matching Reservation/Extension, `PENDING`, `READY`, `NOT_VERIFIED`, `NOT_APPLIED`, no reconciliation flag, a non-expired URL on `https://pay.payos.vn/web/...`, and the full identity/amount checks pass.
- PayOS redirects are not treated as evidence. Shared return handling reconciles the payment with Backend. Payment is presented as complete only for `SUCCEEDED + VERIFIED + APPLIED` without reconciliation. An Extension in `PAID` still instructs the Customer to sign the paper addendum; only Backend `ACTIVE`/Reservation values show the new effective end date.
- Renewal state is recovered from the account-scoped Attempt Journal and Reservation `extendContract` history. The app does not add time to `endDate` locally.
- One screen-local in-flight guard prevents repeated taps from starting concurrent Extension or Payment requests.

## C. UI and Stitch mapping

Referenced recovered Stitch HTML screens:

- `design-reference/stitch-recovered-20261118/screens/batch01_screen02.html` — My Rentals & Lifecycle.
- `design-reference/stitch-recovered-20261118/screens/batch01_screen09.html` — Rental Term & Quote.
- `design-reference/stitch-recovered-20261118/screens/batch01_screen13.html` — Payment detail.
- `design-reference/stitch-recovered-20261118/screens/batch01_screen14.html` — Contract & Rental Lifecycle.

The recovered design pack has no dedicated Renewal screen. The new screen combines those patterns using existing Mobile typography, green/white tokens, cards, status chips, fixed safe-area footer CTA, refresh behavior and loading/error states. Prototype prices, dates, QR data, Smart Pass/PIN/NFC and mock payment presentation were not reused. No screenshot/device comparison was available, so visual verification is at component/source and export level; this is not a pixel-perfect claim.

## D. Verification

| Command/check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | `tsc --noEmit`, exit code 0. |
| Focused Renewal/return/Rental Detail tests | PASS | 3 suites, 9 tests passed. |
| Full `npm test` | PARTIAL | 36 of 37 suites passed; 679 of 680 tests passed. One failure is in `tests/customer-web-containment.test.ts`: `InventoryItemForm` test harness throws `useMemo is not a function`. Re-running that file alone reproduces it. No code in that Web containment test/source was changed; baseline status is unavailable, so it is recorded as an unresolved suite failure rather than asserted to be pre-existing. |
| `npx expo export --platform web --max-workers 2 --output-dir $env:TEMP\wdp-renewal-web-final` | PASS | Bundled the Renewal route and produced the `renewal-*.js` route bundle. |
| `npm run export:native` | PASS | Android and iOS bundles exported to `artifacts/native`. |
| MongoDB writes / migration | NOT_RUN | No database write or migration performed. |
| PayOS test/live transaction | NOT_RUN | No provider transaction was created. |
| Physical Android/iOS device and deep-link return | NOT_RUN | Expo export is bundle validation, not device acceptance. |

The Renewal route is `app/rentals/[id]/renewal.tsx`, reached with the Reservation ObjectId from the active Rental Detail. Expo Web and native export completed without route collision.

## E. Direct verification steps

1. Start Mobile with `cd C:\Users\laptop\Desktop\WDP\frontend\customer-mobile; npx expo start` and sign in to a Customer test account.
2. Open **Đơn thuê**, select a Self Storage Reservation in `ACTIVE`, then open **Gia hạn hợp đồng**.
3. Confirm the term choices match the current Facility/Unit Pricing Rules. Select a term and verify the quoted amount and dates come from the Backend. An ineligible quote must show its Backend reason.
4. Confirm the Extension request. Verify it appears as `PENDING_PAYMENT` before creating a payment intent.
5. In an approved Backend test environment only, request Renewal payment and verify the hosted PayOS link opens. Do not use a live payment account for this review.
6. Return to the app. Check that pending/unknown/reconciliation states remain unconfirmed and that retry does not create a new intent unless Backend authoritatively allows it.
7. After a test payment, verify Backend settlement/application state and the “chờ ký phụ lục giấy” message. Verify the rental end date changes only after Staff activates the Extension.
8. Review Renewal history on both the Renewal screen and Rental Detail.

Steps 1–4 can be checked against a safe Backend test environment with a qualifying Rental. Steps 5–7 require deployed Renewal routes, verified MongoDB indexes/transactions, and PayOS sandbox readiness; these were not verified here. Physical navigation, app suspension/relaunch and deep links still require Android/iOS device acceptance.

## Remaining blockers and status

- Backend Renewal deployment, MongoDB index state and transaction/concurrency behavior remain unverified per the Backend checkpoint.
- PayOS sandbox create/return/webhook/reconciliation behavior remains unverified. The Mobile app does not claim payment production readiness.
- The full Jest suite has one independently reproducible `customer-web-containment` harness failure; all focused Renewal and affected Payment/Rental tests pass.
- On-device Android/iOS acceptance and Stitch screenshot comparison remain outstanding.

Final: `MOBILE_RENEWAL_PARTIAL` — Renewal UI and current-source API integration are implemented, focused tests and exports pass, but the full suite and Backend/provider/device verification gates are not all green.
