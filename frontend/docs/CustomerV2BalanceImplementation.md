# Customer V2 Balance implementation

Date: 2026-10-18. Scope: Customer Managed Inventory V2 Reservation Detail only. No Phase 5 / Staff First Inbound, live payment or database operation.

## Result and boundaries

Customer route `/portal/reservations/:reservationId` now has a Balance Payment section using the existing theme, components, auth and Axios client. Explicit initiation and GET-only settlement reconciliation are implemented. **Full payment ledger recovery remains BLOCKED BY BACKEND CONTRACT**: no confirmed Customer payment-status/history GET exists. Unknown results remain disabled, never retried by POST as a lookup. No new endpoint was invented.

## Backend evidence and API decisions

All references are under `C:/Users/laptop/Desktop/WDP/BE-REF/`, read-only.

| API | Verified contract | Customer behavior |
| --- | --- | --- |
| POST 09 `/api/v1/reservations/managed/:id/balance` | `src/routes/reservation.routes.ts:29`, controller `managed-checkin.controller.ts` `initiateBalance`, service `managed-checkin.service.ts:267–306`. CUSTOMER owner; numeric V2; DEPOSIT_PAID/CHECKIN_READY supported server-side; current contract SIGNED with both matching version/hash signatures; matching successful Deposit ledger. JSON `{idempotencyKey}` only, <=160 characters. 201 `{success:true,data:{payment,reservation,amount,currency,idempotent}}`. | Explicit Pay Balance (MOCK), restricted further to unpaid DEPOSIT_PAID. Stable `wdp-balance-<reservationId>` body key. No amount, provider, customer ID or Deposit included in request. |
| POST 10 `/api/v1/reservations/managed/:id/balance/mock-confirm` | Route line30; service lines309–333. CUSTOMER owner explicitly allowed. JSON `{idempotencyKey}`; matching PENDING BALANCE/MOCK/VND ledger and current signed contract; advances to CHECKIN_READY with balanceSettledAt. | **POSTMAN / DEVELOPMENT-ONLY — NOT CUSTOMER UI**. Backend does permit a Customer in development; this optional browser action is deliberately omitted. No wrapper, allowlist addition or automatic confirmation. External Postman confirmation remains the chosen workflow. |
| GET 11 `/api/v1/reservations/managed/:id` | `managed-reservation.service.ts:415–422` and reservation route22. CUSTOMER owner. Raw reservation, no payment ledger. | Existing `reservationApi.detailForCustomer` reused through existing `contractContext`: owned reservation list, Managed GET, owned contracts list and current contract GET. Explicit Refresh balance status (GET); no writes. |

Both Balance mutations require Backend `NODE_ENV === 'development'` AND `MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true'` (`managed-checkin.service.ts:30`). No FE flag or Backend configuration was changed. If the gate is closed, Backend returns404 and FE shows an error/locked outcome. This is a MOCK feature, not a production banking/payment integration. All Backend writes stay within its existing transaction rules; FE does not reproduce those operations.

Zero balance is supported by the existing Backend POST09 branch: verified `{zeroBalance:true,payment:null,amount:0,currency:'VND',reservation:CHECKIN_READY+balanceSettledAt}` triggers GET synchronization. FE does not charge a Deposit or manufacture a payment for it.

## State and safety

- Source amounts: `reservation.managedPricingSnapshot.amountBreakdown.totalDue/depositCredit/balanceDue`; currency `managedPricingSnapshot.pricingRule.currency`. Direct formatting only, no recalculation. These historical values remain displayed after settlement; they are not payment status.
- Eligibility: verified CUSTOMER owner, Managed numeric V2, unpaid DEPOSIT_PAID, fully SIGNED current contract with both current version/hash signatures via existing shared signature validation. Signed snapshot amounts must match reservation amounts; missing/mismatched data disables the action.
- Unsigned/partial contract: disabled with explicit explanation; Customer signed shows awaiting Facility signature. Refresh remains available.
- A fresh GET context is checked before each explicit attempt. Busy ref prevents rapid double clicks. Existing auth token identity is checked around awaits; unmounted/stale identity responses do not update UI.
- Before POST, a non-secret attempt marker keyed by Customer/reservation is saved to localStorage. No credentials or tokens are stored there. This survives route remount/reload; stored marker means UNKNOWN, never proof of PENDING or success. Existing token storage is unchanged. Unavailable attempt storage fails closed.
- A verified POST response validates payment/reservation IDs, Customer, service, purpose BALANCE, provider MOCK, amount, currency, stable key and state. PENDING means awaiting external confirmation, not success.
- Any sent POST error, timeout or malformed response keeps the marker and locks resubmission. There is no automatic retry, new attempt key, or POST-based reconciliation. GET still DEPOSIT_PAID cannot prove payment failure or absence and never unlocks the button.
- Manual GET CHECKIN_READY with valid `balanceSettledAt`: “Balance payment confirmed. Awaiting first physical inbound.” Pay is disabled and parent Reservation Detail refreshes. No ACTIVE/Cell occupancy inference.
- GET ACTIVE with settlement timestamp: “Rental activated after physical inbound.” This requires actual Backend ACTIVE, never a local transition.
- Stage/timestamp inconsistencies stay disabled with explanation. Refresh errors do not clear the attempt marker or imply failure.

## Files changed

All paths under `C:/Users/laptop/Desktop/WDP/frontend/`:

1. `src/api/customerBalanceApi.js` — new Customer-only POST09 wrapper using existing client.
2. `src/api/confirmedContract.js` — one exact POST `/reservations/managed/<24hex>/balance` allowlist addition; Deposit and mock-confirm remain blocked.
3. `src/lib/customerBalance.js` — eligibility, fixed idempotency key and strict response binding helpers.
4. `src/components/customer/CustomerBalancePayment.jsx` — isolated summary/action/PENDING/GET refresh/uncertainty UI.
5. `src/components/customer/RentalLifecycleIntegration.jsx` — import, Customer auth hook and V2-only Reservation Detail insertion; existing `contractContext` reused. Deposit UI and other branches untouched.
6. `.design-reference/check-customer-balance.cjs` — pure and browser fixture regression; all external traffic blocked.
7. `docs/CustomerV2DepositWebAudit.md` — read-only Deposit audit.
8. `docs/CustomerV2BalanceImplementation.md` — this report.

## Tests

Fixture Balance suite PASS: 64 intercepted fixture API requests, 2 explicit POSTs in separate success/timeout scenarios, zero live requests. Covers unsigned/partial/full/stale/hash mismatch signatures, wrong Customer, Self/legacy exclusion, stage guards, correct ID/body/key, double click (one POST), PENDING, reload lock, network failure (no retry), GET CHECKIN_READY/ACTIVE distinctions, historical amounts, no Deposit/mock-confirm invocation and responsive1440/768/390/320.

Existing Customer contract signing suite PASS: 41 fixture requests, one explicit signature PATCH; signed/partial/draft, content/version checks and GET countersign refresh remain functional.

Syntax parse: PASS all202 source JS/JSX/TS/TSX files. Production build: PASS; existing Vite >500kB chunk warning remains. Existing phase1 unit tests8/8, Managed contract, Self payment contract and MI02C contract suites PASS. Existing phase3 Customer registration/inbound workflow PASS (106 fixture requests), and Self Storage full workflow PASS (227 fixture requests); these runs blocked external traffic and disabled screenshot writes. No live request was made.

Initial Edge launch was blocked inside the Windows sandbox; rerun with the local Vite server and fixture Edge in the same approved host environment passed. This was a test environment issue, not a Frontend test failure requiring a code workaround.

Final SHA256 comparison: exactly the eight listed Frontend files changed, no deleted files; all174 BE-REF files unchanged. Existing Deposit API client/payment implementation, Staff/Manager/BOM, auth/config/dependencies remained unchanged. Generated dist files are build artifacts only and were not staged or committed. Git status/diff was unavailable because the existing repository metadata points to an inaccessible parent worktree; content hashes were used for scope verification instead. The original backend directory was never accessed.

## Remaining limitations

- No live E2E or payment was executed. User-supplied Postman observations are context, not new acceptance testing against a live database.
- Full recovery/receipt/status display for an interrupted or externally initiated pending/failed/reconciliation-required payment is BLOCKED until Backend supplies a confirmed owner-scoped read contract. GET reservation can safely confirm settlement but not all intermediate ledger states. Do not clear markers or enable another attempt based solely on DEPOSIT_PAID.
- Attempt markers intentionally remain after errors; there is no Customer retry/reset control. Across another device or cleared browser storage, the stable key still delegates payment deduplication to Backend. Server validates current ledger/state, not FE storage.
- Existing `/portal/payments/:id` Deposit page remains read-only by explicit scope; its historical “balance actions unavailable in this phase” wording applies to that page and was not edited as part of the Deposit audit. Balance is now located on Reservation Detail.
- Staff/Manager/BOM, Backend/DB, configuration, dependencies, auth, routes and physical occupancy behavior are unchanged.
