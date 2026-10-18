# Customer V2 Deposit Web Audit

Audit date: 2026-10-18. Deposit implementation was inspected only and was not modified.

Evidence roots: FE = `C:/Users/laptop/Desktop/WDP/frontend/`; BE = `C:/Users/laptop/Desktop/WDP/BE-REF/`. References below are relative to those absolute roots. No original backend directory, environment secrets, live mutations or Postman execution was used.

## Findings

| Request | Classification | Implemented on Web? | Evidence |
| --- | --- | --- | --- |
| POST 04 initiate Deposit | API CLIENT ONLY; network execution BLOCKED BY BACKEND CONTRACT allowlist in FE | PARTIAL: wrapper exists, Customer action NO | FE `src/api/managedReservationApi.js:12`, function `initiateDeposit`; FE `src/api/confirmedContract.js:7` does not admit deposit routes |
| POST 05 mock-confirm Deposit | API CLIENT ONLY; network execution BLOCKED BY BACKEND CONTRACT allowlist in FE | PARTIAL: wrapper exists, Customer action NO | FE `src/api/managedReservationApi.js:13`, function `confirmMockDeposit`; same unchanged allowlist restriction |

The APIs themselves exist in Backend; the FE restriction is the confirmed-request allowlist, not absence of a Backend route. No status above means that a network request was executed during this audit.

### POST 04

- Exact request: `POST /api/v1/reservations/managed/:id/deposit`, JSON `{idempotencyKey}` via the existing authenticated Axios client. The key is in the body, not a custom header. It must be a trimmed nonempty string, maximum 160 characters.
- Backend auth: CUSTOMER owner; service MANAGED_INVENTORY, numeric bookingFlowVersion 2, live RESERVED hold. Positive deposit, VND, matching accounting and idempotency identity are enforced server-side.
- Route evidence: BE `src/routes/reservation.routes.ts:26`; controller `src/controllers/reservations/managed-reservation.controller.ts` function `initiateDeposit`; BE `src/services/reservations/managed-reservation.service.ts:514–547`.
- Expected 201 envelope: `{success:true,data:{payment,reservationId,amount,currency,idempotent}}`; payment purpose DEPOSIT, provider MOCK, normally PENDING. This does not advance reservation status to DEPOSIT_PAID.
- Customer route: `/portal/payments/:reservationId`; FE `src/components/customer/RentalLifecycleIntegration.jsx`, `PaymentIntegration` renders the V2 **read-only** Advance rent deposit card. There is no initiate button and no wrapper invocation in Customer components.
- `depositKey` and `depositInitiated` variables remain in that component but do not trigger requests. A key in unused component state is not a wired idempotency mechanism.
- PENDING display, explicit submission, duplicate protection and Deposit-specific response/error handling are not implemented as a Web mutation flow. Existing generic load/error UI handles reservation GET only.
- Missing: approved bounded Deposit action and recovery contract. This task does not implement them.

### POST 05

- Exact request: `POST /api/v1/reservations/managed/:id/deposit/mock-confirm`, JSON `{idempotencyKey}`. BE route `reservation.routes.ts:27`; service `managed-reservation.service.ts:549–595`; controller `confirmMockDeposit`.
- Both route and service authorize CUSTOMER owner. This is **not a privileged Staff/Manager endpoint** and is not a real provider callback. It is an explicit development MOCK confirmation operation suitable for the test harness/Postman. Authorization alone does not make it a production payment interface.
- Development gate: BE `managed-reservation.service.ts:29`: `NODE_ENV === 'development' && MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true'`. The gate also applies to POST 04. No environment values were read or changed.
- Finds the matching Customer/Reservation DEPOSIT ledger by key, requires MOCK, correct service, amount and currency. Successful confirmation sets SUCCEEDED and DEPOSIT_PAID, converts live allocation HOLDs into RESERVED, clears their hold expiry and removes reservation expiresAt. It does not activate the rental or create physical occupancy.
- Late/changed hold can return HTTP 200 with `reconciliationRequired:true` and payment RECONCILIATION_REQUIRED; it must not be treated as payment success.
- No Customer component calls this wrapper. No automatic confirmation or post-confirm GET sequence is wired. The existing Refresh payment status button performs GET and can show externally confirmed DEPOSIT_PAID through `RentalSummary`/`reservationLifecycle`.

## Read synchronization and missing recovery

BE `managed-reservation.service.ts:415–422`, GET `/reservations/managed/:id`, returns an owner-checked raw reservation. Existing FE `reservationApi.detailForCustomer` first verifies `/reservations/me` ownership then reads this detail. DEPOSIT_PAID is displayed from Backend lifecycle, not inferred from snapshot depositCredit.

BE `src/routes/index.ts` mounts no payment-status/history route. Reservation GET does not embed the payment ledger, idempotency key, provider receipt or failure/reconciliation status. It can confirm aggregate DEPOSIT_PAID but cannot distinguish no payment/PENDING/FAILED/RECONCILIATION_REQUIRED while still RESERVED. The generic demo `paymentApi.getStatus` is not a confirmed V2 read contract and must not substitute for it. Full Deposit recovery remains BLOCKED; see existing `docs/CustomerV2DepositAudit.md` for the earlier audit.

## Preservation verification

No change to `managedReservationApi.js`, `paymentApi.js`, Deposit card, Deposit state variables, Deposit routes, request bodies or eligibility. The new Balance-only allowlist entry admits neither `/deposit` nor `/deposit/mock-confirm`. Fixture tests verify that both remain rejected and that Balance UI never invokes them. No Deposit was created or confirmed.
