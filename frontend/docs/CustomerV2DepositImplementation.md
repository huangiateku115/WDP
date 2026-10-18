# Customer Managed Inventory V2 Deposit Payment

Date: 2026-10-18. Status: **IMPLEMENTED** for the requested Customer initiation and GET lifecycle reconciliation flow. Full individual-payment recovery is not claimed; the Backend payment-lookup gap remains.

## Root cause and location

The existing `managedReservationApi.initiateDeposit` wrapper was present, but no Customer component called it and `assertConfirmedRequest` rejected the Deposit path. The older V2 payment screen was deliberately read-only. The new action is on the existing `/portal/reservations/:id` route (`src/routes/AppRoutes.jsx:91`, `ReservationStatusPage` exports `ReservationDetailIntegration`); no route was added or changed.

The earlier `CustomerV2DepositWebAudit.md` records the pre-implementation state and remains historical evidence. Deposit is now wired on Reservation Detail; the separate `/portal/payments/:id` screen is preserved unchanged.

## Files changed

All files are under `C:/Users/laptop/Desktop/WDP/frontend/`:

| File | Change |
| --- | --- |
| `src/components/customer/CustomerDepositPayment.jsx` | New isolated Deposit summary, explicit Pay Deposit, PENDING/uncertainty, paid-stage display and GET refresh using existing UI components/theme. |
| `src/lib/customerDeposit.js` | Pure Deposit eligibility and strict initiation-response validation, stable `wdp-deposit-<reservationId>` key. Reuses existing financial validation, IDs and V2 predicates. |
| `src/components/customer/RentalLifecycleIntegration.jsx` | One import and V2-only Deposit component insertion on Reservation Detail. Existing Balance, Contract, Inventory actions and other branches preserved. |
| `src/api/confirmedContract.js` | One exact POST `/reservations/managed/<24hex>/deposit` allowlist addition. Mock-confirm remains rejected. |
| `.design-reference/check-customer-deposit.cjs` | New fixture-only helper/browser acceptance tests. |
| `.design-reference/check-customer-balance.cjs` | Updated the old allowlist assertion to allow the now-confirmed Deposit initiation; both mock-confirm paths still rejected. Balance scenarios unchanged. |
| `docs/CustomerV2DepositImplementation.md` | This implementation and verification report. |

No new API wrapper was necessary. The existing `src/api/managedReservationApi.js` wrapper, Axios instance, token storage, authentication and API base normalization were reused without modification. No new dependency, CSS, animation, config or environment change.

## Confirmed API contract

Evidence root: `C:/Users/laptop/Desktop/WDP/BE-REF/`, inspected read-only.

- `src/routes/reservation.routes.ts:26`: POST `/reservations/managed/:id/deposit`, authenticated CUSTOMER.
- `src/controllers/reservations/managed-reservation.controller.ts:22`: `initiateDeposit` returns HTTP201 with `{success:true,data:...}`.
- `src/services/reservations/managed-reservation.service.ts:514–547`: Customer-owned Managed numeric bookingFlowVersion2, RESERVED, unexpired expiresAt; positive deposit, VND, capacity lock and idempotency checks enforced by Backend transaction.
- Request JSON: **`{idempotencyKey:"wdp-deposit-<reservationId>"}`** only. Nonempty trimmed key <=160 characters. No amount, provider, Customer, purpose or allocation data supplied by FE.
- Actual source response: `{payment,reservationId,amount,currency,idempotent}`. Payment includes IDs, Customer/facility, service, DEPOSIT purpose, MOCK provider, amount/currency/status and key. FE binds these fields to the current reservation/Customer/snapshot; malformed or conflicting data stays locked.
- `managedDepositFlowEnabled` at service line29 requires Backend `NODE_ENV === 'development'` and `MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true'`. Environment values were not read or changed. Closed gate yields404; UI handles it without claiming a successful payment or retrying.
- GET `/reservations/managed/:id`: service lines415–422 checks Customer ownership and returns the raw reservation. Existing `reservationApi.detailForCustomer` is reused, including its owned `/reservations/me` check before Managed detail GET.
- POST `/reservations/managed/:id/deposit/mock-confirm` (route27, service549–595) is Customer-authorized but development-only. **No Customer button calls it, no new wrapper was added, and the FE allowlist still rejects it.** Confirmation remains in Postman/development tooling. No test collection was executed.

## Eligibility and presentation

- Exact service MANAGED_INVENTORY and numeric version2, valid reservation ID and authenticated Customer owner.
- Existing `managedReservationFinancials` validates snapshot consistency; initiation also requires positive Deposit and VND.
- RESERVED and a valid future `expiresAt`. Time comes from the same UTC instant represented by Backend expiry; no timezone conversion or date rewriting. The button updates each second; fresh preflight validation uses the current clock again.
- Backend alone verifies its transaction/capacity/ledger/environment rules. FE never fabricates those checks or changes a hold.
- Display values are direct snapshot `amountBreakdown.totalDue`, `depositCredit`, `balanceDue`, formatted through existing VND presentation. Deposit is explicitly described as advance rent credited toward total, not refundable security. No recomputed total or double charge.
- Shows reservation code/current status. Existing allocated Cell summary, map links, Contract/Balance sections and Customer navigation remain unchanged.
- Deposit completion is read from DEPOSIT_PAID/CHECKIN_READY/ACTIVE, with verified owner/V2/pricing. Paid stages hide Pay Deposit. Existing `eligibleInventoryRegistration` controls the next registration link after parent reservation refresh; no new Inventory eligibility rule was introduced.

## Initiation, reconciliation and idempotency

1. Opening a page makes GET requests only.
2. Explicit Pay Deposit immediately locks via a busy ref and disabled button, then fetches the owned reservation again and validates current eligibility/expiry.
3. Before sending POST, saves a non-secret localStorage uncertainty marker keyed by Customer+reservation. Credentials and auth storage are unchanged. Failure to save prevents POST.
4. Calls the existing wrapper once with deterministic `wdp-deposit-${reservationId}`. Backend deduplication uses that same body key, including across devices/tabs. There is no generated key per click/render.
5. Verified PENDING displays **“Deposit payment initiated. Waiting for confirmation.”** It is not displayed as Deposit Paid, does not activate the rental and does not alter Cell status.
6. SUCCEEDED in an initiation replay still requires GET reservation confirmation before paid UI. RECONCILIATION_REQUIRED is explained as unresolved, never success.
7. Refresh Payment Status uses GET only. GET DEPOSIT_PAID triggers parent detail refresh, shows Deposit Paid and allows the existing eligible Inventory Registration action. CHECKIN_READY/ACTIVE also show Deposit completed, without offering another payment.
8. No auto POST retry, no POST status lookup and no mock-confirm. Any sent POST timeout/error/malformed response keeps the marker and action locked. Reloaded marker means UNKNOWN, never payment proof. Existing auth/unmount guards ignore stale responses; 401 retains existing logout handling.

Errors400/401/403/404/409, network failure, malformed responses and invalid pricing use the existing error UI. An unexpired form can become expired before click; the preflight prevents POST in that case. GET errors do not unlock an unresolved attempt.

## Recovery limitation

BE-REF `src/routes/index.ts` mounts no Customer individual-payment lookup/history route. Managed reservation GET does not expose the Deposit ledger. RESERVED does **not** distinguish no payment, PENDING, FAILED or RECONCILIATION_REQUIRED. Therefore:

- No missing endpoint was invented.
- A pending/unknown attempt remains locked while reservation remains RESERVED.
- Explicit GET can confirm paid lifecycle but cannot recover every ledger outcome.
- There is no Customer reset/retry control for a sent attempt, including server errors. Confirmation/reconciliation must happen through approved development tooling; full self-service recovery remains unavailable until a supported read contract exists.
- A cleared browser/new device may not know the local marker; the deterministic key still delegates matching and state validation to Backend. Browser storage is only an uncertainty guard, not the authorization/payment ledger.

No physical stock, Cell status, reservation ACTIVE transition or Backend data is changed by this UI. Only Backend physical first inbound may establish occupancy/activation; FE preserves the returned lifecycle.

## Actual tests

All browser tests used intercepted fixture APIs; external traffic was blocked. No live POST/PATCH/DELETE, database mutation or real payment occurred.

| Verification | Result |
| --- | --- |
| Parse all source JS/JSX/TS/TSX using existing esbuild | PASS,204 files |
| `npm run build` | PASS,2014 modules; existing >500kB bundle warning remains |
| `check-customer-deposit.cjs` | PASS,230 fixture requests,8 explicit Deposit POSTs across independent success/error scenarios,zero live requests |
| Deposit cases | Eligible RESERVED; correct breakdown/ID/body/key; double click sends one POST; PENDING is not paid; GET-only refresh; GET DEPOSIT_PAID+Inventory link; CHECKIN_READY/ACTIVE no Pay; wrong Customer; non-V2/Self helper exclusion; missing pricing; expiry boundary and stale-form preflight;400/401/403/404/409; timeout/malformed response; reload lock; no mock-confirm; widths1440/768/390/320 |
| `check-customer-balance.cjs` | PASS,78 fixture requests,2 explicit fixture Balance POSTs; no Deposit POSTs, no live requests |
| `check-customer-contract-signed-ui.cjs` | PASS,41 fixture requests,one explicit fixture signature PATCH; no live requests |
| `check-customer-v2-phase1-ui.cjs` | PASS,74 fixture requests; legacy isolation, lifecycle, pricing and Cell checks |
| `check-customer-v2-phase3.cjs` | PASS,106 fixture requests; registration/inbound, permissions, errors and safe recovery |
| `check-self-storage-completion.cjs` | PASS,227 fixture requests; existing full Self Storage workflow |
| `check-customer-v2-phase1.cjs` | PASS,8/8 unit tests |
| `check-managed-contract.cjs`, `check-self-payment-contract.cjs`, `check-mi02c-contract.cjs` | PASS |

One initial new test selector matched both Deposit and Balance owner warnings; the fixture selector was scoped to the Deposit section and rerun successfully. No application behavior was changed to accommodate that test. Existing regression scripts were run in memory with external-network blocking and screenshot writes disabled, without modifying those scripts (apart from the necessary Balance allowlist assertion noted above).

## Scope verification

Final content-hash verification covers Frontend source/docs/fixture files and BE-REF. Only the seven listed Frontend files changed. BE-REF remained unchanged; the forbidden original backend directory was not accessed, inspected, run or modified. Balance implementation, Contract, Inventory/Inbound, Warehouse Map, Staff/Manager/Admin/BOM, auth, routes, package/config/environment files remain unchanged. Build output under dist is generated only, not staged or committed. No claim of live FE–BE E2E acceptance is made.
