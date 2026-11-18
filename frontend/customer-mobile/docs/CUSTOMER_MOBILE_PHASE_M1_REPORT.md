# Customer Mobile — Phase M1 Device Acceptance Review

**Checkpoint:** `WDP_CUSTOMER_MOBILE_PHASE_M1_REVIEW`  
**Scope:** `frontend/customer-mobile` audit, Mobile-only proven fix, offline verification.  
**Not performed:** device acceptance, MongoDB writes, IT01–IT10 reruns, real PayOS payment, backend/Web/config edits.

## Result

**PARTIAL — Mobile typecheck and native Expo export pass.** The Mobile inbound-operation response parser bug was fixed, and two stale V3 test fixtures were aligned to the current API contract. Full Jest has one remaining failure in an out-of-scope Customer Web containment test (`useMemo is not a function`); 641/642 tests pass. Physical Android/iOS interaction and authenticated live flows still need a device/session.

## Mobile screens and navigation found

The active Expo Router tree includes:

- Account: login, registration, profile, protected tab/session routing.
- Self Storage: facility explore/detail, storage-unit selection, booking review, rental detail, PayOS checkout/return, payment history/status, contract, rentals, extension/checkout request screens.
- Managed Inventory: managed facility discovery, mobile warehouse map/cell selection, reservation confirmation/payment, SKU registration/detail/edit, item specifications, stock, inbound preview/operation, outbound, relocation, movement history.
- Customer care: support request list/create/detail/messages and notifications.

The routes point to current `Live*` screens/adapters. Older fixture-oriented components under `src/screens` remain in the tree but are not the active route targets. Facility/storage catalogue and some explanatory data are explicitly marked sample/unverified in the UI; they must not be treated as live availability. `app/booking/[facilityId]/confirmation.tsx` is an Unavailable stub with no caller found in the current route search; current Self Storage review navigates directly to payment or rental detail.

This is a source/navigation audit, not evidence that every route was exercised on a physical device or against a signed-in production account.

## API source verification and blockers

Adapter paths and Backend route declarations were compared in source for authentication/profile, facility and reservation, contracts, PayOS history/status/checkout, checkout requests, managed booking/capacity, SKU/specification, stock/movements, V3 outbound, V3 relocation, inbound, access session, support and notifications.

- Auth/session uses the current customer login/register and `/users/me` profile contracts; native session storage uses SecureStore.
- Self Storage reservation, contract, checkout request and PayOS Hosted adapters have corresponding Backend routes. The app does not fake payment success; actual completion depends on hosted checkout and server reconciliation/webhook.
- Managed booking, SKU/specification, V3 stock/movement, outbound and relocation have corresponding Backend route declarations.
- Unified Inbound is still blocked by the Backend production 503 guard. The Mobile UI keeps the operation unavailable and does not bypass the guard.
- Legacy physical-unit / legacy inbound-write routes are fail-closed (410); Mobile does not treat them as a working substitute.
- IT03 historical `skuId không hợp lệ` remains a separate integration backlog item; it was not resolved or retried here.
- Renewal/extension behavior and actual ownership/payment safety require separate Backend review; this phase made no Backend change and does not certify those paths end-to-end.

Route presence only establishes source-level correspondence. It does not establish deployment version, authorization, database data availability, or successful runtime responses.

## Defect analysis and changes

| File | Finding | Change |
|---|---|---|
| `src/api/managedInboundPreview.ts` | Operation lookup received an API envelope, extracted `movement`, then incorrectly passed that inner object to `readData()`, which accepts only an envelope. Valid movement lookups were rejected. | Parse the nested movement with its actual movement schema at the correct envelope boundary. |
| `tests/live-managed-inventory.test.ts` | V3 reader fixture used a legacy inventory item without the required V3 discriminator/state fields, so the reader correctly rejected it. | Updated that test fixture to a valid V3 item shape; assertions remain intact. |
| `tests/managed-v3-booking-payment.test.ts` | SKU creation fixture expected a legacy body/response (`category` and stock-like fields); current V3 contract uses category metadata and returns an ACTIVE SKU DTO. | Updated fixture and expectation to the current V3 DTO; this did not alter production API behavior. |

The fourth prior failure was in `tests/customer-web-containment.test.ts`: the test's React hook mock omits `useMemo`. It is a Customer Web harness failure, so it was left unchanged.

## Verification

| Command | Result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript completed with exit code 0 after the Mobile changes. |
| `npm test -- tests/live-managed-inventory.test.ts tests/managed-v3-booking-payment.test.ts --runInBand --forceExit` | PASS | 2 suites, 28 tests passed. |
| `npm test -- --runInBand --forceExit` | PARTIAL | 27/28 suites passed; 641/642 tests passed. Only failure: Web containment test hook mock lacks `useMemo`. |
| `npm run export:native` | PASS | Metro bundled Android and iOS; artifacts emitted under `artifacts/native`. Bundle export does not prove device runtime behavior. |
| Phone/device interaction | NOT_RUN | No physical-device acceptance was performed in this phase. |

Jest printed its normal `--forceExit` open-handle notice after completion; it did not change the test result.

## Phone checklist

Use a development/staging Backend and a dedicated test customer. Do not use real PayOS funds or mutate real customer inventory.

1. Start Expo from `frontend/customer-mobile` with `npx expo start`; ensure the phone and development machine can reach the configured API host. Do not place credentials in a committed file.
2. Open on Android and iOS if both are acceptance targets. Confirm initial redirect, login, logout, session persistence, expired-token behavior, and profile refresh.
3. Browse facility list/detail. Verify sample/unverified availability labels are clear and no sample facility is presented as confirmed live capacity.
4. In an approved test environment, select a unit/dates and inspect quote/review. Stop before any real payment. For PayOS Hosted, verify redirect/return and server-reported status only with an approved sandbox account; never mark payment successful from the client.
5. Inspect rental, payment history/status, contract, and checkout request using owned test data. Verify loading, empty, and API error states.
6. Inspect managed facility/map, cell selection, managed booking, SKU/specification, and stock using approved test data.
7. Verify Inbound shows the Backend 503 unavailable state; verify legacy write paths do not bypass 410. Do not submit physical inventory operations on real data.
8. On an approved isolated test account, exercise outbound/relocation previews and operation history only under the separately approved test plan. Confirm scope/session/revision errors remain visible and no client success is fabricated.
9. Test support request/message flows, notification list/read state, offline/slow network, back navigation, keyboard behavior, safe areas, and small-screen scrolling.
10. Record device model, OS, Expo Go/dev-client version, app commit/build, API environment, route, sanitized response/error status, and screenshots. Do not record tokens, customer PII, payment secrets, or full payment URLs.

## Remaining acceptance blockers

- Physical-device run and real authenticated session evidence are absent.
- Backend Unified Inbound remains guarded with HTTP 503; the Mobile client cannot complete Inbound until Backend availability is explicitly resolved.
- Legacy physical-unit/inbound routes return 410 by design.
- IT03's prior invalid `skuId` integration failure remains unresolved and was not retried.
- Test/development catalogue data and deployment API behavior must be validated independently of source.
- Full Jest is not entirely green because the remaining Customer Web test mock failure is outside this task's permitted scope.
- Renewal/extension payment and ownership end-to-end safety were not certified here.

## Files changed

- `frontend/customer-mobile/src/api/managedInboundPreview.ts`
- `frontend/customer-mobile/tests/live-managed-inventory.test.ts`
- `frontend/customer-mobile/tests/managed-v3-booking-payment.test.ts`
- `frontend/customer-mobile/docs/CUSTOMER_MOBILE_PHASE_M1_REPORT.md` (this report)

No Backend, Customer Web, `.env`, PayOS webhook, MongoDB, or integration-write files were changed by this phase.
