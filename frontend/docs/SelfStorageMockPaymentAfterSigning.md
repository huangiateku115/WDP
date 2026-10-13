# Self Storage Contract Signing → Mock Payment

## A. Files changed

Initial Frontend git status was clean. Existing architecture and current UI copy outside this task were preserved.

Created:

- `src/lib/selfStoragePayment.js`: signed-contract association, lifecycle/development guards, strict PAID response normalization, safe errors and complete-field arithmetic summary.
- `src/components/customer/SelfStorageMockPayment.jsx`: payment page, explicit confirmation, reconciliation and reusable Self Storage payment navigation.
- `.design-reference/check-self-payment-contract.cjs`: pure guard/response/summary tests.
- `.design-reference/check-self-storage-payment.cjs`: intercepted browser flow/error/responsive/production fixtures.
- `docs/SelfStorageMockPaymentAfterSigning.md`: this report.

Modified:

- `src/api/paymentApi.js`: reuse existing Self Storage mock endpoint with `{}` body; add normalized development-only client method.
- `src/components/customer/RentalLifecycleIntegration.jsx`: Self Storage-only dispatch, sign-to-payment navigation/recovery, signed/paid contract navigation and reservation entry points. Managed handlers are retained.
- `.design-reference/check-self-storage-completion.cjs`: assert the requested sign-to-payment step and Confirm Mock Payment action.
- `.design-reference/check-managed-reservations.cjs`: existing Self Storage regression case now supplies an associated SIGNED contract; production checks disable Self Storage simulation too.

New screenshots: `.design-reference/self-mock-payment-1440.png`, `self-mock-payment-1024.png`, `self-mock-payment-768.png`, `self-mock-payment-390.png`, `self-mock-payment-320.png`.

Regression harnesses regenerate existing Self Storage review, Managed booking, inventory registration/preview/preference and digital-warehouse evidence. Build outputs are generated under ignored `dist/`. No route, dependency, config, environment, auth/token, payment-history or role workspace source was changed.

## B. Verified API integration

Source inspected only in BE-REF: reservation routes/controller, contract routes/controller, owner reservation collection, route mounts and existing DTOs. The user's observed Postman response is treated as an example, never hardcoded data.

`paymentApi.mockPaySelfStorageReservation(reservationId)` uses the existing Axios client, configured base URL and Bearer interceptor. It calls the existing `mockPayReal()` with:

```http
POST /api/v1/reservations/:reservationId/mock-pay
Content-Type: application/json
Authorization: Bearer <existing session token>
```

```json
{}
```

It returns the actual reservation only if success=true, `_id` matches, serviceType=SELF_STORAGE and status=PAID. Missing/mismatched responses do not fabricate success. Managed payment continues calling its separate Managed endpoint and existing guards.

Fresh context reuses the existing `contractContext()` loader: own `/contracts/me`, own `/reservations/me` through `detailForCustomer()`, then authorized `/contracts/:id`. Generic Self Storage ID detail is not used because its owner enforcement is weaker than the collection. No payment entity/history endpoint exists in the reference route mounts; no fake transaction is created.

## C. Navigation flow

An eligible Self Storage contract is signed via the existing PATCH `/contracts/:id/sign`. After confirmed SIGNED, the actual association is resolved from the returned contract or previously verified owned contract; fresh contract/reservation context is read before navigating to `/portal/payments/:reservationId`. Signing never invokes mock-pay.

The signed Contract page remains available. Contracts & Sign, Contract Detail and Reservation Detail expose Proceed to Payment for a SIGNED associated Self Storage contract in CONTRACTED state. PAID displays Payment Completed and reservation navigation without another payment action. My Units continues reading server statuses on entry.

If post-sign reads fail, the successful server signature remains visible and a recoverable refresh message is shown. Fresh SIGNED context takes precedence over the temporary confirmed signature snapshot. Unresolved/mismatched associations never produce a fabricated reservation ID. Route/account changes clear recovery state.

Payment supports direct navigation, refresh/back navigation, View Signed Contract/Review and Sign Contract, View Reservation and Back to My Units. Route paths are unchanged.

## D. Lifecycle and submission validation

The new payment page requires actual SELF_STORAGE, a valid owned reservation/associated contract, reservation CONTRACTED and contract SIGNED. Unsigned, approval-pending, cancelled/rejected, unknown, mismatched, missing and already-paid states cannot submit. Client and UI gate new Self Storage simulation to Vite development mode; production shows an unavailable state.

Confirmation is an explicit button click. A synchronous busy ref and pending spinner/disabled button protect double clicks. Fresh owned context is read again before the POST. The page never executes payment on mount or after signing, never activates the reservation and never changes unit occupancy.

After a valid server PAID response, the page displays the confirmed status, then re-reads contract/reservation. No local PAID status is manufactured. Contract status is shown from server reads; the payment endpoint does not modify it.

On failure, safe actual Backend messages or fallback messages are displayed. The reservation is re-read before any explicit retry. A network failure that actually committed PAID is discovered by that read and disables repeat payment. If readback fails, the action remains disabled until a successful refresh. Malformed/wrong-ID success responses are treated as uncertain, not successful payments. No automatic POST retries occur.

## Payment amounts and history

Rent, deposit, tax and discount are shown only when returned as valid non-negative numbers, using the existing VND formatter. The reference exposes no definitive Self Storage payable total. Only when all four fields are present is rent + deposit + tax − discount displayed as **Arithmetic summary**, explicitly not a confirmed charge or receipt. Missing fields are marked unavailable and no missing tax/discount is defaulted to zero.

The development explanation states that no real money is charged. PAID is a confirmed reservation status, not proof of a provider transaction. Payment History (demo) is unchanged; no localStorage/sessionStorage payment, receipt, refund or provider record is added.

## E. Actual validation results

- `npm run build`: PASS; existing main-chunk warning remains (~765 kB), no dependency/config changes.
- `check-self-payment-contract.cjs`: PASS — association/SIGNED/status/development guards, strict PAID ID/service binding, complete/incomplete/invalid arithmetic fields.
- `check-self-storage-payment.cjs`: PASS — 180 intercepted requests. Sign navigation with zero auto-payment, signed-state readback failure/recovery, reopening, current summary, exact POST ID/body, double click, PAID reload/My Units, unsigned/pending/cancelled/unknown, missing money fields, 400/401/403/404/409/500, wrong response, network committed/uncommitted outcomes and failed reconciliation readback.
- Production bundle fixture: PASS — mock action disabled and no POST.
- `check-self-storage-completion.cjs`: PASS — 227 intercepted requests; reservation creation/date/estimate/cancellation/contracts/payment/handover/access/ownership/session/error regression.
- `check-managed-reservations.cjs`: PASS — 115 intercepted requests; Managed quota/quote/create/cancel/sign/mock-pay/hold preserved. Self Storage cross-service case now requires SIGNED.
- `check-inventory-mi02a.cjs`: PASS — 71 intercepted requests; registration/edit/preview/preference/ownership/session/no-stock-write regression.
- `check-digital-warehouse.cjs`: PASS — unchanged MI-01 cache/selection/search/tooltip/zoom/fullscreen/errors/read-only calls.
- Responsive: 1440, 1024, 768, 390, 320; no document overflow. Payment desktop/mobile screenshots visually inspected; green/orange design, explicit action and navigation preserved.

Initial payment fixture failures were assertions matching both paid-status paragraphs and assertions running before the summary loaded. Selectors/waits were corrected; they are not unresolved implementation failures. Existing regression expectations were updated only for the requested separate payment step. Final notice/evidence refresh also passed all 180 fixture requests.

Not executed: live Backend mutation E2E, real Postman collection payment runs, real provider payments, migrations/seeds or database writes. All browser API calls were intercepted fixtures, including payment/signature responses. No live paid record was created.

## F. Backend dependencies / limits

- Self Storage mock-pay enforces CUSTOMER owner, SELF_STORAGE and CONTRACTED atomically. The inspected controller does **not** require SIGNED or a valid hold and does not enforce a production/environment flag. The new FE follows the user's requested signed/development workflow; this does not replace server-side enforcement. Backend hardening is outside the allowed edit scope.
- Self Storage signing checks owner/DRAFT but has weaker reservation/hold validation than Managed signing. Existing signing rules are preserved; no management approval is fabricated.
- No production provider, payment record API, settled receipt/refund, capability discovery or definitive Self Storage payable total is present.
- No payment idempotency key is exposed. UI prevents double clicks and reconciles uncertain responses; the Backend's CONTRACTED→PAID filter rejects repeat state transitions.
- Generic Self Storage detail lacks the Customer owner check; FE continues avoiding it.
- Payment and handover/activation are separate. Real approval, contract creation and check-in still require authorized management/operations.
- Live E2E with approved credentials/isolated data remains unverified. Passing fixtures do not establish real database transaction behavior.

## G. Source protection

Only `frontend/` files were edited. BE-REF stayed read only. Original `backend/` was not accessed, no Backend environment/schema/API was changed, and no real database mutation was performed during implementation/testing.

BE-REF initial hash: 155 files, aggregate SHA-256 `cf8b4f4e6054a2789f9eb672ec8556a6dc38693053de38d9c1f08f0d90330ec4`; final comparison matched across all 155 files; BE-REF is unchanged. Scope excludes `.git`, `node_modules`, symlinks. Existing Self Storage creation, Managed features, MI-01, MI-02A, authentication, layouts/animations and other role source are preserved.
