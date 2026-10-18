# Customer V2 development Mock Confirm Deposit

Date: 2026-10-18. Status: **IMPLEMENTED**, development opt-in only. No live Backend mutation or payment was executed.

## Verified POST05 contract

Reference root: `C:/Users/laptop/Desktop/WDP/BE-REF/` (read-only).

- POST `/api/v1/reservations/managed/:reservationId/deposit/mock-confirm`.
- `src/routes/reservation.routes.ts:27`: authenticated CUSTOMER. Service `src/services/reservations/managed-reservation.service.ts:549–595` independently checks CUSTOMER ownership, Managed Inventory numeric bookingFlowVersion2 and the matching ledger. No privileged token/proxy is needed or used.
- Body **`{idempotencyKey:"wdp-deposit-<reservationId>"}`** only. Trimmed nonempty string, maximum160 characters. Payment is found server-side by key; payment ID is not a request parameter. FE keeps the returned payment ID for receipt validation only.
- Backend gate at service line29: `NODE_ENV === 'development' && MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true'`. The reference configuration was inspected as source code; no environment secret/value was read or changed.
- Existing matching DEPOSIT/MOCK payment must be PENDING, have correct Customer/reservation/service/currency/amount and live allocations. Backend transaction validates actual ledger state; FE does not emulate that transaction.
- Success HTTP200: `{success:true,data:{payment,reservation,idempotent}}`; payment SUCCEEDED and reservation DEPOSIT_PAID. A same-key replay is supported narrowly while payment SUCCEEDED and reservation DEPOSIT_PAID.
- Late/changed reservation can return **HTTP200** with `payment.status:RECONCILIATION_REQUIRED`, `reconciliationRequired:true`, reservation not advanced. This is not success.
- Errors:400 invalid ID/body/key;401 unauthenticated (existing logout behavior);403 unauthorized role/account;404 disabled development gate/nonowned reservation/missing payment;409 wrong ledger/service/provider/amount/currency/status/allocations or transaction conflict;500 infrastructure failure. Timeout does not prove no commit occurred.

Postman source inspected without execution: `C:/Users/laptop/Downloads/WDP-Managed-Inventory-v2-Deposit-Checkin-Inbound.postman_collection.json`, request **05 | MOCK CONFIRM DEPOSIT → DEPOSIT_PAID [GHI DB]**, under the CREATE & DEPOSIT V2 folder. It confirms POST, bearer auth and body `{"idempotencyKey":"{{miDepositKey}}"}`. No saved response examples exist; response interpretation follows BE-REF source, not conditional Postman scripts.

## Enable for local development

Set the public FE opt-in **`VITE_ENABLE_MANAGED_DEPOSIT_MOCK=true`** before starting Vite. `import.meta.env.DEV` must also be exactly true. For example, in a local PowerShell terminal at `C:/Users/laptop/Desktop/WDP/frontend`:

```powershell
$env:VITE_ENABLE_MANAGED_DEPOSIT_MOCK='true'
npm run dev
```

Restart Vite when changing the flag. Omitting it or setting it to any value other than the string `true` hides/disables this feature. The Backend team must already have enabled its separate development gate above. No Backend flags are inferred from the frontend flag and no secrets belong in Vite variables. Implementation/tests did not edit `.env` or other configuration files; test flags were passed only to temporary test processes.

Production builds have DEV=false: UI, API wrapper and allowlist deny mock-confirm even if the VITE flag was set true at build time. A production build with that flag true was explicitly tested in local preview.

## Where and how to test

1. Use an authorized Customer in an approved Backend development/test environment with a Customer-owned, unexpired RESERVED Managed V2 reservation. This implementation itself did not create or mutate such a live record.
2. Open the existing `/portal/reservations/:id` Deposit Payment section.
3. Without a verified PENDING response, the DEVELOPMENT ONLY Mock Confirm Deposit button is disabled. RESERVED alone is insufficient.
4. Explicitly click Pay Deposit. Existing POST04 uses its unchanged stable `wdp-deposit-${reservationId}` key. After a verified PENDING receipt, the development button becomes available.
5. Click Mock Confirm Deposit; the existing shared Dialog explains that this is a development-only simulated Deposit, not Balance/contract signing/activation. Cancel makes no request.
6. Confirm simulated Deposit. A busy ref and durable mock-attempt marker prevent repeated sends. Fresh supported GET reservation checks owner/V2/status/expiry/pricing and revalidates the retained POST04 receipt against it before one POST05.
7. The exact request contains the receipt's already-validated key only. Response validation checks payment identity, Customer/reservation/service/provider/currency/amount/key and SUCCEEDED versus RECONCILIATION_REQUIRED. HTTP200 alone never shows Deposit Paid.
8. After a verified response, GET owned Managed reservation again. Only GET-confirmed paid lifecycle enables paid presentation/parent detail refresh. For the normal flow this is DEPOSIT_PAID, and the existing Inventory Registration action becomes available under its unchanged rules.
9. CHECKIN_READY/ACTIVE/DEPOSIT_PAID hide the development button. No code signs contracts, settles Balance, changes pricing or Cell status, creates inbound, or locally activates a rental.

## Receipt/recovery constraints

There is still no supported individual-payment GET in BE-REF. Reservation GET cannot independently refresh a PENDING ledger or prove payment failure. The development action therefore uses **only a Backend-validated PENDING receipt from POST04 retained in current component memory**. The Backend rechecks its current ledger atomically. It does not restore receipts from localStorage, infer them from RESERVED, or invent a payment lookup.

- Unknown initiation or reload: receipt unavailable, mock button disabled; GET reconciliation/development tooling remains available.
- Sent mock-confirm error/timeout/unverified response: mock action locked, receipt cleared and durable marker retained. No automatic POST retry or alternative key. Refresh Payment Status remains GET-only.
- If a fresh preflight finds changed state, POST05 is not sent. If Backend returns reconciliationRequired, explain reconciliation and keep the action locked.
- If POST05 reports SUCCEEDED but GET still RESERVED or fails, show that reservation completion is unverified; no Deposit Paid from response alone. A later manual GET may reconcile a genuinely paid lifecycle.
- Cross-tab markers reduce repeated sends; Backend ownership/idempotency/state checks remain authoritative. Storage is not authentication or payment proof.

## Files changed

All paths under `C:/Users/laptop/Desktop/WDP/frontend/`:

1. `src/components/customer/CustomerDepositPayment.jsx` — development flag visibility, current pending receipt, confirmation Dialog, busy/uncertainty guards, POST05 and GET synchronization. Existing POST04/GET safeguards retained.
2. `src/lib/customerDeposit.js` — pending-receipt eligibility and strict POST05 response binding; existing pricing/lifecycle helpers unchanged.
3. `src/api/managedReservationApi.js` — add DEV+opt-in guard to existing `confirmMockDeposit` wrapper; same Axios/auth/body/path.
4. `src/api/confirmedContract.js` — narrowly allow only POST `/reservations/managed/<24hex>/deposit/mock-confirm` under DEV+explicit opt-in. No Balance mock-confirm permission or arbitrary forwarding.
5. `.design-reference/check-customer-deposit-mock.cjs` — new local fixture helper/browser acceptance suite across enabled dev, disabled dev and production preview.
6. `docs/CustomerV2DepositMockConfirm.md` — this report.

Earlier Deposit audit/implementation docs describe their prior phase where mock-confirm was deliberately omitted; this report records the newly authorized development addition. Balance, Contract, Inventory and other interfaces were not edited.

## Verification

- Source syntax: PASS all204 JS/JSX/TS/TSX files via existing esbuild.
- Production build: PASS,2014 modules, built with FE opt-in=true to verify DEV isolation. Existing >500kB bundle warning remains.
- New mock-confirm suite: PASS,226 fixture API requests,6 explicit mock-confirm POSTs across independent success/failure scenarios,zero live Backend requests. Covers enabled/disabled flag, production absence even with flag, pending-only receipt, confirmation Cancel, double click→one POST, success→GET→paid+Inventory link, wrong owner, paid stages, reload lock, fresh preflight race,409/timeout/malformed response/reconciliationRequired, no success from200 while GET RESERVED, and1440/768/390/320 widths.
- Existing Deposit fixture PASS230 requests; Balance PASS78 requests; Customer Contract signing PASS41 requests; Inventory/Inbound PASS106 requests; Self Storage full workflow PASS227 requests. Existing phase1 unit tests8/8, Managed contract and Self payment contract suites PASS. All browser APIs were locally intercepted, other external traffic blocked; no Postman collection was run. Existing regression files were not edited; Inventory/Self runs disabled screenshot writes through an in-memory test wrapper.

## Security/scope

No privileged credentials, new Axios instance, proxy, environment secret, package/config change or live DB write. Only the Customer-authorized development endpoint is exposed under opt-in. Backend permissions cannot be bypassed by UI flags. BE-REF is read-only and the original forbidden backend directory was never accessed. Generated dist files are build artifacts only, not staged or committed.

Final SHA256 verification: exactly the six listed Frontend files changed, no files deleted, all174 BE-REF files unchanged. Balance/Contract/Inventory/Self implementations and all Staff/Manager/Admin/BOM files remained unchanged.
