# Customer V2 Phase 1 Implementation

Date: 16 October 2026. Scope: **CV2-002, CV2-003 and CV2-009 only**.

**Phase 1 status: PARTIAL.** The three scoped implementations and focused tests are completed. Source parsing, production build, new V2 UI fixtures, Self Storage and Warehouse Map regressions pass. The full existing MI-02C suite is not passing because its final legacy booking-entry scenario hits a **pre-existing `quota is not defined` runtime error**. This issue was independently confirmed in the source snapshot from before Phase 0 and has not been repaired by inventing quota-entry behavior outside this task.

No real backend acceptance is claimed. No Deposit/Balance API integration, V2 signing, Staff/Manager operations or Phase 2 work was implemented.

## 1. Baseline and source evidence

Before editing: independently parsed all **187** existing source files successfully and ran the production build successfully (1997 modules; existing >500 kB chunk warning). The earlier four Phase 0 syntax repairs remain intact.

Read AGENTS.md and relevant CustomerSRSV2GapAnalysis sections. The supplied 15-Oct SRS and Managed Inventory V2 Postman collection were available in Downloads. Rechecked SRS lifecycle/advance-rent/unknown-counter requirements and collection quote/create/rack requests. Original backend/ was never accessed.

Backend reference, strictly read-only:
- `BE-REF/src/types/reservation.type.ts:4–16,32–33`: explicit Managed bookingFlowVersion2, DEPOSIT_PAID/CHECKIN_READY and legacy states.
- `BE-REF/src/services/reservations/managed-reservation.service.ts:266–279`: quote uses **paymentBreakdown**, not amountBreakdown; totalDue/depositCredit/balanceDue and backend pricing currency/rent/tax.
- Same service :330–345: reservation contains **managedPricingSnapshot.amountBreakdown**, pricingRule.currency, estimatedRent/depositAmount/taxAmount/discountAmount; immutable booking snapshot.
- `BE-REF/src/services/payments/payment-accounting.ts:34–53`: credited advance rent, deposit<=total, balance=total−credit; finite nonnegative amounts.
- `BE-REF/src/services/warehouse-map/warehouse-map.service.ts:230–249`: explicit isBookable and physicalUsageKnown, projected numeric zero does not establish certainty, periodStatus differs from current bookingStatus.
- Existing FE `reservationApi.detailForCustomer` unwraps the actual owned DTO before the new helpers consume it. No guessed recursive DTO extraction was added.

## 2. Exact files modified

Application files modified:
1. `src/lib/customerReservationService.js`: centralized explicit flow interpretation, state descriptions and guards; legacy/Self preserved.
2. `src/components/customer/RentalLifecycleIntegration.jsx`: version-aware descriptions/grouping, legacy-only sign/payment guards, read-only V2 status and validated pricing display. Pre-existing incomplete deposit buttons were replaced with an honest unavailable notice; wrappers/endpoints were not changed.
3. `src/components/customer/RentalBackendUI.jsx`: contextual V2 status label, separate deposit-paid/checkin-ready labels, reusable validated ManagedFinancialSummary.
4. `src/components/customer/warehouse/ManagedCellBooking.jsx`: V2 total/advance/plan balance display, same-Facility selection guard; existing fresh quote/create/reconcile orchestration preserved.
5. `src/components/customer/ManagedReservationBooking.jsx`: validates/renders V2 quote finances; optional Cell callback applies shared eligibility, Facility, volume and 100-Cell guards. Existing unrelated quota-entry defect remains documented.
6. `src/lib/managedCellBooking.js`: strict explicit Cell flags, canonical interval and optional periodStatus/Facility consistency; V2 financial validation during quote verification.
7. `src/components/customer/warehouse/CellInformation.jsx`: visible bookability and verified/unknown physical usage fields; existing select button uses the shared helper.

New application file:
- `src/lib/managedRentalPricing.js`: pure read-only financial snapshot validators and display rows. No API client or payment logic.

Tests modified only to describe the newly required backend flags:
- `.design-reference/check-mi02c-contract.cjs`: valid Cell fixture now explicitly has both flags true.
- `.design-reference/check-mi02c-phase1.cjs`: first Cell fixture has physicalUsageKnown=true and date/hold-aware isBookable. No assertions were weakened; the full-suite failure is retained and reported.

New focused tests:
- `.design-reference/check-customer-v2-phase1.cjs`: eight node:test cases for the three authorized backlog items.
- `.design-reference/check-customer-v2-phase1-ui.cjs`: isolated browser/API fixtures; no screenshot or evidence file writes; blocks external traffic and rejects unexpected endpoints.

New documentation:
- `docs/CustomerV2Phase1Implementation.md` (this file).

## 3. CV2-002 lifecycle changes

**Completed.**
- isManagedV2 requires exact `serviceType === MANAGED_INVENTORY` and numeric `bookingFlowVersion === 2`.
- Missing/null version and explicit version1 preserve Managed legacy guards; unknown future/string versions are not upgraded and cannot reach legacy signing/payment mutations. Self Storage stays on existing behavior regardless of the Managed version field.
- Central reservationLifecycle distinguishes V2, Managed legacy, Self Storage and unknown. No backend status is renamed or mutated.
- V2 RESERVED: held, deposit pending, no initial approval or signature.
- DEPOSIT_PAID: advance confirmed; registration/intake preparation permitted only subject to backend guards. The registration feature itself is not changed here.
- CHECKIN_READY: contract/balance complete, physical first inbound still pending; never labeled ACTIVE.
- ACTIVE: Staff confirmed first physical inbound; no claim that first inbound is still pending.
- Legacy CONTRACTED/PAID descriptions and actual allowed actions remain.
- V2 signing and legacy mock-pay remain blocked, including inconsistent V2 CONTRACTED/PAID records. V2 unpaid RESERVED retains the existing cancellation capability; no paid-cancellation policy was invented.
- Direct V2 payment/contract URLs show read-only status/unavailable text instead of a functioning payment or signing button. No Manager activation control was added.
- Contract list copy now states approval is legacy-only, not a prerequisite for new V2 records.

This does not implement a new V2 contract-view/version-signing workflow, deposit initiation, balance, inventory registration or physical operations.

## 4. CV2-003 financial changes

**Completed for confirmed Managed V2 DTOs.**
- Read authoritative quote.paymentBreakdown and reservation.managedPricingSnapshot.amountBreakdown. Keep Backend currency; no VND fallback or policy rounding is invented.
- Display total rent payable, scheduled advance-rent deposit, balance after required deposit **(plan)** separately.
- Validate finite nonnegative safe-range amounts, deposit<=total, deposit matching the snapshot and balance=total−deposit. Quote total must match the current confirmed quote rent+tax contract; unexplained discount/difference fails closed. Reservation total must match its explicit rent+tax−discount fields; missing fields are not zero-filled.
- Quote and reservation source objects are never mutated or repriced. Existing quote key invalidation and comparison remain intact.
- A snapshot's scheduled depositCredit does **not** mean paid. RESERVED shows confirmed credit0 and remaining rent equal to total; DEPOSIT_PAID uses confirmed backend lifecycle to show deposited credit/remaining plan balance. CHECKIN_READY/ACTIVE indicate settled original rent. Terminal/unknown states do not infer a refundable/paid credit; unavailable is shown.
- Invalid/missing V2 data yields an unavailable/error state. An invalid V2 quote never becomes a usable review/create confirmation.
- Example fixtures: total100/deposit20 → plan balance80; total100/deposit100 → plan balance0; no 120 total for a 100 rent.
- V2 reservation/contract screens use the validated original reservation snapshot summary, not an unvalidated alternative contract total. This is original booking pricing display, not V2 signed-version implementation.

**Self Storage / legacy safeguard:** existing legacy request payloads, returned amounts and arithmetic remain unchanged. Its old rent+deposit arithmetic has ambiguous legacy backend semantics; it was not silently converted to advance-rent V2. A confirmed Self V2 accounting/payment contract is still required. Legacy quote/calculation behavior remains covered by existing fixtures.

## 5. CV2-009 Cell eligibility changes

**Completed.**
- Shared cellBookingReason now requires isBookable===true and physicalUsageKnown===true. Missing/null/undefined/false/numeric/string flags fail closed even with both projected counters0 or isMine=true.
- Retain AVAILABLE Rack/Cell, known allowed booking/display states, zero actual counters, positive usable dimensions and future canonical interval.
- Reject provided contradictory periodStatus and provided Cell Facility mismatch.
- selectedPayload retains same selected Facility, unique IDs, 1–100 limit, canonical date/term equality and usable geometric volume sum.
- Both the active basket toggle and the optional Managed-entry callback enforce eligibility. Scope guard exists before basket insertion, not only button styling.
- CellInformation displays physical certainty/bookability. Select controls, basket refresh, payload preparation, quote review and final create preflight share the same eligibility helper. A stale selected Cell stays inspectable but has a reason/invalid payload and cannot be bought.
- No counters or stock fields are changed by selection. Cross-Rack/Zone basket, cache/range/session ownership, fresh quote, duplicate prevention and uncertain-create reconciliation remain.
- When a Cell is RESERVED/OCCUPIED, preserve the original more specific reason before evaluating the new flags; this keeps existing diagnostics compatible without weakening eligibility.

## 6. Tests and actual results

All browser data below are **intercepted fixtures**, not real backend success.

| Check | Actual result |
|---|---|
| Independent baseline parse/build | PASS;187 source files,1997 build modules |
| Final source syntax parse | PASS;188 source files,0 failures (one new pure helper) |
| Final production build | PASS;1998 modules; main794.84 kB/gzip250.38 kB; >500 kB warning retained |
| New lifecycle tests | PASS;3 test cases: explicit identity, state/action separation, legacy/Self |
| New financial tests | PASS;3 test cases:100/20/80,full advance,invalid/missing/nonfinite/inconsistent data, scheduled vs confirmed credit |
| New Cell tests | PASS;2 test cases with positive/negative flag matrix,scope,Rack/Zone,100/101,duplicates,stale,date and immutability checks |
| New V2 UI suite | PASS;50 fixture requests;four lifecycle stages,no V2 mutation buttons,legacy signature retained,flags,financial errors,date invalidation,stale basket |
| check-mi02c-contract.cjs | PASS;fixtures updated with explicit flags |
| check-managed-contract.cjs | PASS;legacy service/guards/allowlist |
| check-self-storage-contract.cjs | PASS;exact Unit/date/request/estimate contracts |
| check-self-payment-contract.cjs | PASS;legacy signature/ownership/development/payment amounts |
| check-inventory-contract.cjs | PASS;existing registration/validation/allowlist |
| check-self-storage-completion.cjs | PASS;226 fixture requests;1440/1024/768/390/320;create/sign/payment/cancel/ownership/access/error/reconcile |
| check-digital-warehouse.cjs | PASS;five widths;layout/tooltip/cache/search/focus/zoom/refresh/read-only behavior |
| check-mi02c-phase1.cjs full suite | **FAIL — pre-existing legacy entry quota ReferenceError**, after basket/create/reconciliation scenarios; see section7 |
| MI-02C subset excluding only the known final legacy entry case | PASS;195 fixture requests;five widths;cross-Rack/Zone,basket,date refresh,quote/create,modal/focus,duplicate prevention,error/reconciliation,session/Facility;entry explicitly excluded |

The eight new node:test cases passed together. They contain multiple assertions each; counts are test cases, not fabricated assertion totals.

Browser regression scripts were loaded through an in-memory runner which suppresses screenshot writes and blocks unmatched external traffic; scripts' existing “screenshots” output is not evidence of refreshed screenshots. Their original fixture APIs retain priority and are fulfilled locally. No existing screenshot changed.

One initial new UI harness run intercepted /src/api modules too broadly; narrowing the fixture matcher to /api/v1 fixed the harness and the suite subsequently passed. An initial MI-02C attempt failed because a new generic unbookable reason replaced its expected RESERVED text; the more specific existing status diagnostic was restored while keeping both flags mandatory. An API-mode test server with mock flag enabled exposed an existing suite load-timing branch; the normal disabled-mock frontend was used for the definitive run. An in-memory subset runner initially had a quoting syntax error before executing; it was corrected. No such setup failure is relabeled as a product PASS.

## 7. Remaining regression blocker and limits

The complete legacy MI-02C suite's final scenario navigates to /portal/rent?service=managed. `ManagedReservationBooking.jsx:373–374` references quota/setQuota although neither is declared. A focused fixture diagnostic returned pageErrors=[“quota is not defined”] and an empty rendered body.

This defect existed in the retained source before Phase0: the old file already contained quota/setQuota references and had no corresponding state declaration. Build/syntax checks cannot detect this undeclared render variable, so the passing Phase0 build did not establish that page worked.

Repairing it would require deciding whether to restore arbitrary quota input or replace it with selected-Cell capacity presentation. That is not a new financial policy or UI behavior this Phase1 should invent. It remains unchanged and requires separately scoped correction/clarification. Therefore **overall status is PARTIAL**, not a claim all regressions pass. Direct Warehouse Map selection and the new V2 status/financial/eligibility paths were exercised successfully.

Other limits:
- No real backend E2E, transaction/index/Cell contention or actual payment was tested.
- No production PayOS/status/history, deposit/balance workflow, version-aware two-party signing, Staff first-inbound or Manager UI was implemented.
- Pre-activation inventory form eligibility still belongs to a later scoped phase.
- Unknown/legacy map records lacking explicit flags are deliberately unselectable; backend must supply confirmed values.
- Terminal/refund paid-credit details cannot be inferred from a pricing snapshot; a real ledger/reconciliation contract is still needed.
- No Self Storage V2 interpretation was invented. Legacy semantic debt remains explicitly documented.
- Bundle-size warning remains; no dependency/configuration/chunk refactor was attempted.

## 8. Regression risks and safeguards

Shared lifecycle code is service/version gated; legacy helper outputs and Self fixtures pass. No API path,method,body,client,token/session architecture or route changed. V2-specific UI does not submit old mock-pay or signing actions; original legacy checks still revalidate current owned records. Financial validation fails closed when a future DTO changes instead of silently inventing a missing amount. Strict eligibility may block old incomplete data; that is intentional safety behavior, not an automatic reconciliation.

Temporary frontend servers used only process-local flags for fixture runs; no .env file was changed. All temporary servers are stopped at completion.

## 9. Workspace compliance

Pre-edit snapshot:668 existing files including174 BE-REF files. Final SHA-256 comparison verifies application/test changes listed above only, plus the new helper/tests/report. All BE-REF files, existing reports, API files, routes, CSS/animations, auth/session, .env, dependency/configuration files and existing screenshots remain unchanged. No files were removed. dist was generated only by build and not committed. Original backend/ was never accessed, and no backend/database HTTP mutation,seed,migration or direct DB operation occurred.

## 10. Phase boundary

CV2-002: **Completed**. CV2-003: **Completed for confirmed Managed V2; Self V2 remains a documented dependency**. CV2-009: **Completed**.

Overall: **PARTIAL due to the independently confirmed baseline Managed booking-entry runtime defect and the resulting full-suite failure.**

Do not begin Phase2 automatically. Resolve the legacy entry defect under explicit scope, then rerun the complete MI-02C regression before declaring all frontend regressions green.

