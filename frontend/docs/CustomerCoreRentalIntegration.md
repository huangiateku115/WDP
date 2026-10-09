# Customer Core Rental Integration — 2026-10-08

## Result and limits

Verified request contracts are integrated into existing Customer routes, using the existing Axios client/session. **The complete booking-to-signing-to-payment E2E is not complete:** deposit/total calculation, pricingPolicyId meaning/requirement, contradictory signing method/body and payment eligibility prevent safe submission. These steps are explicitly disabled, not replaced with successful demo operations. No backend changes, Manager/Staff actions, real payments or invented APIs were added.

Read AGENTS.md, the task attachment, WDP.postman_collectionV2.json and docs_rental_workflow.md. Documents were used as contract evidence; their Admin/FM setup instructions were not executed. Local backend source was inspected read-only. The current backend checkout contains storage/pricing/facility implementations but no newer reservation/contract/customer/support controllers. Postman V2 has no saved response examples for these new operations. HTTP probes to public/facilities and health could not connect.

## A. Customer pages audited/reused

Auth/Profile already use real Auth/User APIs. Core booking pages and My Storage previously use hardcoded units/prices/browser reservations/contracts and mock payment. Public Facilities is static. Customer Access uses isolated demo rental data. Customer Support renders the public FAQ; its API module has legacy mock/unconfirmed paths. Inventory, extension, notifications, payment history and refund screens remain isolated demo/API-ready features.

Existing route/page files reused and modified:
- Public Facilities.
- SelectStorage, RentalPeriod, ReviewReservation, ReservationStatus.
- MyStorage, Contracts, Contract, Payment, RentalAccess.
- Profile and Support.

No new page route is created. Existing URL paths are preserved. Core page exports now render small Customer integration fragments, using existing CustomerScreen, Card, Details, Steps, Inputs, Buttons, Badges and green/orange theme. Original preview implementations are retained in their files, but are not fallback data sources or rendered by core routes. Profile's existing contact/password forms remain unchanged; identity information is a separate form. Support's existing public FAQ/help remains available below the backend request list.

CustomerLayout adds truthful labels to remaining demo navigation and removes the fabricated fallback customer name. CustomerGate redirects unauthenticated portal access to Login and blocks an explicitly non-Customer cached role. Cached roles are not an authorization boundary; the backend must enforce scope/ownership. No changes to other roles' route subtrees or functionality.

## B. API integration matrix

All authenticated calls use the existing current Bearer token. Public calls use skipAuth. Core calls always use real HTTP, independent of VITE_USE_MOCK; errors never return browser fixtures.

| Method | Endpoint under /api/v1 | Consumer | Status |
| --- | --- | --- | --- |
| PUT | /customers/me/profile | Profile identity form | Wired; exact identityCard/address/taxCode; no automatic verification |
| GET | /public/facilities | Public Facilities / unit selection | Wired |
| GET | /public/facilities/:facilityId | Unit selection | Wired |
| GET | /public/facilities/:facilityId/storage-options | Unit selection | Requested; exact option DTO unverified, never used as unit IDs |
| GET | /public/facilities/:facilityId/pricing | Unit selection | Requested; exact DTO unverified, not used to fabricate totals |
| GET | /facilities/:facilityId/storage-units | Unit selection | Wired; source-confirmed pagination and actual unit IDs |
| GET | /storage-units/:id | Selection freshness check | Wired; requires AVAILABLE and exact facility scope |
| GET | /pricing-rules | pricingApi.list | API-ready; not needed by current resolver UI |
| GET | /pricing-rules/resolve | Rental period | Wired with facilityId/serviceType/unitSize/termValue/termUnit/at |
| GET | /policies | pricingApi.policies | API-ready |
| GET | /policies/resolve | Rental period | Wired with facilityId/serviceType/type/at; DEPOSIT config not interpreted |
| POST | /reservations | reservationApi.createReal | Exact DTO ready; UI disabled pending verified amount/policy contract |
| GET | /reservations/me | MyStorage/history | Wired |
| GET | /reservations/:id | Detail/payment/access | Wired |
| GET | /contracts/me | Contract list/detail | Wired; no invented GET contract detail |
| POST or PATCH | /contracts/:id/sign | Contract detail | Blocked: contradictory sources; no signing HTTP is sent/allowlisted |
| POST | /reservations/:id/mock-pay | paymentApi.mockPayReal | API-ready; UI disabled until eligibility confirmed; no PayOS/QR/card UI |
| POST | /access/simulate-unlock | Access form | Wired; exact reservationCode/pinCode; outcome mapping still unverified |
| GET | /support-requests | Customer Support | Wired; subject/status only |
| GET | /support-requests/:id | Customer Support | Wired; no raw/internal message rendering |
| GET | /support-requests/:id/messages | supportApi.messagesReal | API-ready; content withheld until visibility DTO confirmed |
| POST | /support-requests | Support | Blocked pending create DTO; original FAQ preserved |
| POST | /support-requests/:id/messages | Support | Blocked pending reply DTO/visibility rules |

Original PUT /users/me/profile remains responsible only for displayName/phone. Original Auth/login/logout/password/session architecture and Axios instance remain unchanged.

## C. Reservation workflow behavior

1. Real public facility list/details and authenticated available units are read. IDs must be Mongo ObjectId strings, matching available backend validation. A public category is never converted into a unit ID. Unit detail is checked before advancing.
2. Live draft is memory-only and scoped to the existing session token, separate from original browser demo state. Session changes hide the previous draft and resource results; request effects abort/discard stale loads.
3. Customer selects move-in date and 1/3/6/12-month commitment, with computed calendar end date and past-date validation. These are date choices, not hardcoded discounts/prices.
4. Backend effective price and deposit policy are resolved. The source defines price for an exact term and free-form policy config. Raw rule price is displayed as a rule price, not claimed as an authoritative rental total. No deposit percentage is invented.
5. Review checkbox is functional. Create is disabled until verified rent/deposit/pricingPolicyId mapping exists. createReal sends only facilityId/storageUnitId/startDate/endDate/pricingPolicyId/estimatedRent/depositAmount, never legacy tenant/storageId/pricing objects. Successful booking is not claimed or fabricated.
6. Existing MyStorage uses reservations/me for active/overdue rentals, PAID awaiting handover, checkout/closed history and pending/cancelled reservations. Status filters use returned statuses. Detail uses actual IDs, populated fields and returned paymentDeadline only. No local status countdown or approval/handover operation.
7. Central Vietnamese labels cover all eight documented states. ACTIVE alone exposes access navigation; OVERDUE/CHECKED_OUT/CANCELLED disable access. PAID shows waiting for handover. No real cancellation/renewal endpoint is invented.
8. Contracts are retrieved only from contracts/me; DRAFT is shown if returned. Content/terms are displayed only if present as strings. Signing is disabled pending method/body confirmation. No legal terms or fake signatures generated.
9. Mock payment is explicitly simulated. The request method is ready and tested using synthetic transport; production UI remains disabled pending signing/payment eligibility. No manual PAID mutation occurs.
10. Access rechecks real reservation status/code before posting. No fixed PIN in the integration source/default/URL/storage/logs; PIN clears after every attempt. success:true is required even to acknowledge a response. Exact UNLOCK_SUCCESS outcome schema remains unverified, so UI acknowledges the response without claiming unlock or physical access.
11. Identity form sends its separate confirmed PUT; clears fields after success, never persists CCCD/address/taxCode or assumes approval. No confirmed identity/status retrieval endpoint exists.
12. Support reads the confirmed collection/detail paths and whitelists subject/status. Unmapped messages/internal notes are withheld; no Staff management actions.

All operations provide loading/error/retry or pending states where enabled. Duplicate ref guards apply to unit selection, identity save and access. Error handling distinguishes 401/403/404/409/429 and masks 500/technical trace text; 400/422 use bounded human messages. The existing protected 401 cleanup is retained. No new tokens, Axios client, global-state library, dependency or router architecture.

## D. Missing backend contracts / required confirmations

- **pricingPolicyId:** mandatory versus optional and what model it references. V2 includes it; workflow creation body omits it. No reservation validator is available locally.
- **Amounts:** deposit config keys/formula and authoritative estimatedRent/total calculation. Current source allows arbitrary config; do not infer amounts or multiply rule price without confirmation.
- **Customer verification read:** identity/status retrieval and reservation enforcement. Saving is not approval.
- **Signing:** V2 POST contains an unrelated login body; documentation specifies PATCH without body. Controller/DTO required before enabling.
- **DRAFT retrieval:** documentation calls contracts/me signed contracts; actual all-status response/controller must confirm DRAFT availability.
- **Payment eligibility:** whether signature is required and which backend reservation/contract states allow mock-pay. No Customer button is enabled by a guessed rule.
- **Response DTOs:** new reservation/contract/public/support/access wrappers and field names have no saved examples. Current strict reader accepts success:true plus data and fails unsupported envelopes instead of substituting data. Only explicitly returned fields are rendered; this is a guarded common-envelope boundary, not a claim of verified live DTOs.
- **Unlock outcome:** exact response field for UNLOCK_SUCCESS/denial; cannot claim success merely on HTTP 200.
- **Support:** create/reply bodies, Customer ownership enforcement and internal/public message flags.
- Unconfirmed cancellation, real PayOS, payment receipts/history, extension, renewal, notifications, inventory movements, refund/settlement stay separate and are not connected to unrelated APIs.

The missing-contract clarification was requested during work. No unconfirmed values were supplied as a result of elapsed time.

## E. Files changed by this task

Created production files:
- src/api/customerRentalApi.js
- src/components/customer/CustomerGate.jsx
- src/components/customer/CustomerSupportIntegration.jsx
- src/components/customer/CustomerVerificationForm.jsx
- src/components/customer/RentalBackendUI.jsx
- src/components/customer/RentalBookingIntegration.jsx
- src/components/customer/RentalLifecycleIntegration.jsx

Modified production files:
- src/api/confirmedContract.js, contractApi.js, facilityApi.js, paymentApi.js, reservationApi.js, storageApi.js, supportApi.js
- src/contexts/ReservationContext.jsx
- src/layouts/CustomerLayout.jsx
- src/routes/AppRoutes.jsx
- src/pages/public/FacilitiesPage.jsx
- src/pages/customer/SelectStoragePage.jsx, RentalPeriodPage.jsx, ReviewReservationPage.jsx, ReservationStatusPage.jsx
- src/pages/customer/MyStoragePage.jsx, ContractsPage.jsx, ContractPage.jsx, PaymentPage.jsx, RentalAccessPage.jsx
- src/pages/customer/ProfilePage.jsx, SupportPage.jsx

Docs/tests/artifacts:
- docs/CustomerCoreRentalIntegration.md; appended docs/BackendApiAudit.md
- .design-reference/check-customer-rental.cjs
- .design-reference/check-confirmed-auth-core.cjs (adapted regression copy; existing helper unchanged)
- .design-reference/customer-core-support-1440.png, -768.png, -390.png
- Existing auth-audit-profile-signed-out.png refreshed by regression.

Pre-existing staged Auth recovery changes were present at task start and preserved. No files under Admin/BOM/Manager/Staff pages or route subtrees changed; no backend files modified.

## F. Executed validation and blocked E2E

### Executed with intercepted synthetic responses
- check-customer-rental.cjs: public/real unit selection, exact pricing query, invalid past date and blocked price submission, backend reservations and state labels, ACTIVE access and blocked OVERDUE/CHECKED_OUT/CANCELLED/PAID/RESERVED states, PIN clear/no storage or URL persistence, duplicate access guard, identity exact DTO/no persistence, support internal-content masking, 403 private record, masked 500/no mock fallback/retry.
- Direct API contract checks: reservation exact seven fields and 409 propagation; mock-pay POST with no body followed by real detail refresh confirming synthetic PAID; blocked signing sends no HTTP. These are request-module checks, not an enabled production checkout scenario.
- 12 representative Customer/Public pages at 1440/768/390: 36 overflow checks passed. Mobile support screenshot visually inspected.
- Manager/Staff/BOM/Admin dashboard route smoke tests passed with synthetic backend data where needed; no claim that their full workflow suites were rerun.
- check-confirmed-auth-core.cjs: existing registration/consent, Login/token keys, Profile read/edit, password change, Logout failure/success, Manager redirect, unconfirmed endpoint rejection and protected 401 cleanup all passed. Adapted selectors account for the additional identity form; expired Customer session now returns to Login through the guard.

### Not passed / blocked
No actual authenticated backend E2E was performed: localhost:5000 was unreachable. No real reservation, identity mutation, contract signature, payment or unlock was executed. FM verification/approval/inspection and prerequisite ACTIVE records remain external backend/test-data dependencies. Backend ownership, conflict locking and actual DTO/delivery cannot be certified from intercepted tests.

Full creation/signing/payment steps are contract-blocked as listed above. Error paths 400/422/429 and cancellation/extension behavior have handling or disabled UI but no individual real-backend test claim.

### Build
Final npm run build passed after fixing the introduced regex escaping issue. Existing main chunk warning above 500 kB remains non-fatal. No package/config changes.
