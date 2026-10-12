# Public & Customer API integration audit

Audit date: 2026-10-09. Scope: Public/Auth/Customer only. This report supersedes the Customer blockers in the older BackendApiAudit and CustomerCoreRentalIntegration reports where new backend source supplies a contract.

## Evidence and classification

Both actual supplied files were inspected recursively: `C:/Users/laptop/Downloads/WDP.postman_collectionV2.json` (32 requests) and `C:/Users/laptop/Downloads/WDP-Backend.postman_collection.json` (75 requests). The task text calls the latter `(1).json`; the user supplied the filename without `(1)`, which is the file used. Collections are complementary. Neither contains saved example responses. Descriptions, query metadata, inherited/request auth and pre-request/test events were read; scripted assertions are expectations, not live evidence. Credential values, bearer values and PIN examples were not copied into application code or audit artifacts.

CONFIRMED means route/controller/validation/service/model verified in `../backend/src`, or successful live response. DOCUMENTED means collection only. AMBIGUOUS means conflicting or incomplete operational semantics. MISSING means absent from both collections and mounted backend source. CONFIRMED does not mean authenticated E2E was executed.

Frontend review server remains available at http://127.0.0.1:5173; isolated test server 5189 was stopped after validation.

All requests use the existing environment-based Axios client and `/api/v1` normalization. No second client, dependency, configuration, token-storage or role architecture was introduced. Public CTA colors are explicitly green where bg-brand only applies to the Customer theme; Header/Footer use facility-contact links instead of unverified hotline values. Existing user changes, including the formatted RentalLifecycleIntegration file, were preserved with targeted edits. Admin/BOM/Manager/Staff functionality was not changed.

Full 107-request inventory: [CustomerApiEndpointInventory.md](CustomerApiEndpointInventory.md). Sanitized machine-readable shapes and confidence are retained under `.design-reference/customer-api-inventory.json`.

## Before/after page inventory

| Page / existing UI | Before: source and issue | After / required API | Status / blocker |
|---|---|---|---|
| Home: hero, editorial sections, facility cards | Fabricated facility cards, availability and five-location claim; generic navigation | Shared GET public facilities for selector/cards, actual IDs and detail links; static solution prices replaced by published-pricing link, editorial sections/effects retained | Integrated; first six active facilities preview, complete list via Facilities |
| Find Storage / Facilities | Public backend list with local search, no pagination/detail | Server search/serviceType/page/limit, pagination and real detail links | Integrated, no ratings/capacity invented |
| Facility Detail | No public detail route | Added `/facilities/:facilityId`; three public GETs, address/contact/hours/options/pricing, booking link | Integrated; informational category counts are not unit IDs |
| Pricing | Real grouped rates from previous fix, selected facility, month/long-term toggles | Existing public pricing retained; all returned non-long-term terms displayed, 6/12-month groups retained | Integrated; no arithmetic discount or deposit guess |
| How It Works, Home workflow | Promised instant verification, smartphone keys and move-in | Static content now describes verification, reservation, approval, signing, demo pay, handover, ACTIVE simulation | Editorial, no unnecessary HTTP |
| Public Support | Unverified hotline/24h/live-chat claims; dead article/card buttons | Actual facility contacts on detail; FAQ links, guides and authenticated support link | Anonymous submission unavailable; portal gate requires login |
| Login/Register/Forgot/Reset | Existing real forms/session/consent/role routing | Preserved confirmed Auth/User APIs; unsupported social login already removed | Integrated; authenticated live test account unavailable |
| Customer Profile | Real User API; identity submit real but read/status blocked | Existing general profile/password unchanged; source-confirmed identity GET displays only verification status; identity PUT resets PENDING | Integrated; no sensitive identity caching |
| My Storage / Rentals | Backend-owned list, eight status groups | GET reservations/me retained | Integrated, no separate fabricated rental records |
| Reservation Detail | Called GET reservations/:id, which source makes management-only | Customer adapter selects requested ID from GET reservations/me; cancel PATCH only RESERVED/CONTRACTED | Integrated using confirmed owned collection, manager endpoint never called |
| Rent New Unit | Public detail/options/pricing + actual unit list/detail | Preserved live authenticated units, availability/facility recheck; public monthly terms drive commitments | Selection/period integrated; authoritative booking quote blocked |
| Reservation Review | Permanently disabled unsafe amount submission | Consent label toggles checkbox; explicit authoritative rent/deposit blocker, create stays disabled | Endpoint confirmed, amount semantics AMBIGUOUS; no fake POST |
| Contracts & Sign / Contract Detail | GET contracts/me, signing blocked by POST/PATCH mismatch; wrong contractNumber field | Actual contractCode/signedByCustomerAt/pricingSnapshot/termsVersion; PATCH no body for owned DRAFT | Integrated, status changes only after confirmed SIGNED response/refetch |
| Payment | Disabled demo-pay eligibility | POST mock-pay, no body, owned CONTRACTED recheck, explicit confirm, PAID response verification/refetch | Integrated demo only; backend does not enforce signed contract or ownership |
| Handover | Hardcoded facility/pass/arrival from legacy context | Existing route now displays owned backend reservation status | Integrated status display; Customer cannot complete inspection/check-in |
| Access | Actual user-entered PIN but called management detail; generic success | Owned ACTIVE rental, current status recheck, exact UNLOCK_SUCCESS action and reservation matching; GET access/me own logs | Integrated simulation only; PIN cleared/not persisted; no physical unlock promise |
| Notifications | Browser demo list | GET notifications/me and PATCH owned id/read, filter and confirmed refresh | Integrated from backend source, no polling or fabricated notifications |
| Inventory overview/register/detail/inbound/outbound/history | Isolated customer demo store | Preserved explicit demo notice and API-pending live mode | Missing Customer inventory contracts |
| Payment History / Receipt / Refund / Charge | Customer/Manager/Staff fixtures with demo notice | Preserved explicitly labeled demos, no fake financial HTTP | Missing history/receipt/refund/charge checkout contracts |
| Rental Extension | Explicit browser demo / live-disabled request | Preserved | Missing extension/capacity/renewal contracts |

All customer routes and nested inventory/financial paths were inspected, including preserved legacy preview components whose default exports now point to the real integration components. Demo stores remain isolated and are never used as fallback after failed real requests.

## FE-to-BE integration matrix

Sources: V2 = first collection; Backend = second; BE = mounted backend source; Live = read-only HTTP results recorded in `.design-reference/customer-api-live-results.json`.

| Page | Feature | Required API | Found In | Contract Status | FE Status | Blocker | BE Action |
|---|---|---|---|---|---|---|---|
| Home/Facilities | Active facility list/search/filter/pagination | GET /public/facilities | Backend, BE, Live | CONFIRMED | Integrated | None | Preserve pagination contract |
| Detail | Name/address/contact/hours | GET /public/facilities/:id | Backend, BE, Live | CONFIRMED | Integrated | None | Keep public projection |
| Detail/Booking | Size/count options | GET /public/facilities/:id/storage-options | Backend, BE, Live | CONFIRMED | Integrated | Informational counts only, SELF_STORAGE only | Do not treat category as a reservable ID |
| Detail/Pricing/Period | Published effective rates | GET /public/facilities/:id/pricing | Backend, BE, Live | CONFIRMED | Integrated | May be empty | Configure effective rules |
| Booking | Actual units/list/detail | GET /facilities/:id/storage-units; GET /storage-units/:id | Backend, BE | CONFIRMED | Integrated | Auth/live account | Seed reservable test unit |
| Period | Resolve effective rule | GET /pricing-rules/resolve | Backend, BE | CONFIRMED | Integrated | Not a full reservation quote | Define authoritative total |
| Period | Resolve deposit policy | GET /policies/resolve | Backend, BE | CONFIRMED for resolution; AMBIGUOUS calculation | Integrated resolution, no calculated deposit | Arbitrary policy config | Define formula/meaning/currency |
| Auth | Login/register/logout/recovery | POST /auth/login, /users/register, /auth/logout, /auth/forgot-password, /auth/reset-password | V2 (reset omitted), Backend, BE | CONFIRMED | Existing integration preserved | Authenticated live account | Provide test account/OTP path |
| Profile | General account and password | GET /users/me; PUT /users/me/profile; PUT /users/me/password | V2, Backend, BE | CONFIRMED | Preserved | Authenticated live account | None |
| Profile | Submit identity | PUT /customers/me/profile | V2, BE | CONFIRMED | Integrated, memory-only fields | Manager verification external | Preserve pending/lock safeguard |
| Profile | Verification status | GET /customers/me/profile | BE only | CONFIRMED | Integrated, status projection only | GET creates profile if absent | Consider removing write side effect from GET |
| Booking | Create reservation | POST /reservations | V2, BE | CONFIRMED endpoint; AMBIGUOUS authoritative amounts | Adapter retained, submit blocked | No verified total/deposit formula; estimate stub | Return verified quote with unit/dates/policy/currency/amounts |
| Rentals/Detail/Handover | Own reservation lifecycle | GET /reservations/me | V2, BE | CONFIRMED | Integrated; detail via own list | Per-id GET is not Customer authorized | Add owner-aware detail if needed |
| Detail | Direct reservation detail | GET /reservations/:id | V2 FStaff folder, BE | CONFIRMED management-only | No Customer request | Not eligible for Customer | Enforce owner route for Customer |
| Detail | Cancellation | PATCH /reservations/:id/cancel | BE only | CONFIRMED | Integrated with confirmation | Only owned RESERVED/CONTRACTED | None |
| Contracts | List including drafts | GET /contracts/me | V2, BE | CONFIRMED | Integrated | Draft exists after FM approval | Provide draft test fixture |
| Contracts | Sign owned DRAFT | PATCH /contracts/:id/sign | BE; V2 incorrectly POST | CONFIRMED resolved by source | Integrated, no request body | Live account/draft | Correct Postman method/body |
| Payment | Demo payment | POST /reservations/:id/mock-pay | V2, BE | CONFIRMED method/body/state; backend safeguards incomplete | Integrated demo with own-list recheck | Server lacks ownership/SIGNED requirement | Enforce ownership and intended sign rule |
| Access | Simulated unlock | POST /access/simulate-unlock | V2, BE | CONFIRMED action/status/body | Integrated ACTIVE own rental | Server has fixed simulation PIN, no owner check | Validate owner, provision secure credentials |
| Access | Own access history | GET /access/me | BE only | CONFIRMED | Integrated; action/time whitelist | No credential provision | Add authorized access-information capability |
| Support | Create/list/detail | POST/GET /support-requests; GET /support-requests/:id | Backend, BE | CONFIRMED | Integrated with pagination | Live account | Preserve owner filtering |
| Support | Messages/reply | GET/POST /support-requests/:id/messages | Backend, BE | CONFIRMED | Integrated | None in contract | Preserve backend internal-message exclusion |
| Notifications | Own list/read | GET /notifications/me; PATCH /notifications/:id/read | BE only | CONFIRMED | Integrated | Not in collections | Add collection coverage |
| Public Support | Anonymous submission | No confirmed public endpoint | Neither/BE | MISSING | Login required | Authenticated support only | No anonymous route proposed by FE |
| Inventory | Six Customer item/movement capabilities | No confirmed endpoint | Neither/BE | MISSING | Explicit isolated demo | No item/movement service | See capability requirements below |
| Financial/Extension | History/receipts/refunds/extensions/renewals/PayOS | No confirmed endpoint | Neither/BE | MISSING | Explicit demo/unavailable | No financial/extension service | See capability requirements below |

## Verified DTOs and operational rules

- Public list: `{success:true,data:PublicFacility[],pagination:{page,limit,total,totalPages}}`; query only page/limit/serviceType/search. Facility projection contains `_id,code,name,address{line1,ward,district,city,country},contact{phone,email},serviceTypes,description,operatingHours`. Public detail shares projection. Options `{availabilityIsInformational:true,options:[{size,availableCount}]}`. Public prices grouped `selfStorage`/`managedInventory`, only supported groups; rule entries have serviceType/unitSize/term/value/unit/price/currency/effective dates, **no rule ID** in public projection. Resolve supplies the actual rule record.
- Reservation create fields are facilityId/storageUnitId/startDate/endDate/optional pricingPolicyId/estimatedRent/depositAmount. Model confirms pricingPolicyId references **Policy**, not PricingRule. Service requires VERIFIED identity, future start, later end, unit/facility match, non-maintenance/non-inactive unit, no overlapping active hold/rental; creates RESERVED with expiresAt 24h. It accepts FE money values without an authoritative pricing calculation. Controller passes raw JSON dates into a service typed as Date without explicit conversion. `/reservations/estimate` is a TODO returning fixed amounts; **not used**. These findings block enabling submission even though the route is confirmed.
- GET reservations/me filters authenticated customerId and populates facility name/address and unit code/size/volume. Per-ID GET is gated to FM/Admin/BOM. No Customer approval/reject/inspection/check-in action is implemented. Cancellation atomically filters owner plus RESERVED/CONTRACTED and returns CANCELLED.
- GET contracts/me has no status exclusion; **DRAFT retrieval confirmed**. Contract DTO uses contractCode/reservationId/customerId/status/customerSnapshot/pricingSnapshot/signedByCustomerAt/signedByFMAt/pdfUrl/termsVersion. UI does not dump identity snapshots. PATCH sign atomically filters owner and DRAFT, ignores body, returns SIGNED plus timestamp. V2 POST and unrelated login body are wrong; no email/password sent. No legal content is generated locally.
- Mock-pay POST has **no body**, requires CONTRACTED, sets PAID and removes expiresAt. **SIGNED is not checked**, nor customerId ownership in controller. FE selects/refetches own reservation; this is not a server authorization fix. Intended sign-before-pay behavior must be settled and enforced by BE.
- Access POST body exactly reservationCode/pinCode; only ACTIVE succeeds, OVERDUE denied. Success envelope carries access log action UNLOCK_SUCCESS. UI verifies action and matching reservationId, clears PIN on completion/status change/unmount, never stores/logs it. BE uses a fixed simulation PIN and omits ownership comparison: audit gap, no fixed PIN in FE. Wrong PIN returns 401 with action UNLOCK_FAILED after auth; targeted interceptor exception preserves session for this response only. Auth-middleware 401 and other APIs still clear the current matching session. Access/me filters logs by authenticated customerId.
- Support create UI sends category/subject/description (all required); optional facility/priority/relatedEntity omitted rather than guessed. Backend supports six categories, subject 1–200, description/message 1–5000 characters. Customer identity derived from auth, customerId overrides rejected. List filters owner; detail/messages require ownership; Customer-visible messages filter isInternal:false. Reply body exactly `{message,isInternal:false}`. No management actions or internal-message toggle exposed. UI additionally excludes every record whose isInternal is not false.
- Identity GET returns current profile/status, may create it if absent. UI extracts only status, never repopulates sensitive identity values or caches them. PUT has identityCard/address/taxCode and resets PENDING; active CONTRACTED/PAID/ACTIVE reservations restrict CCCD updates. A save never fabricates VERIFIED.
- Notifications list filters userId, PATCH read filters both _id/userId and returns isRead:true. UI uses title/content/type/isRead/createdAt; no fixture notifications or polling.

## Required gap checklist and minimum capabilities

All suggested capabilities here are **PROPOSALS**, not existing endpoints. No proposed HTTP path is implemented. Minimum response includes explicit success/error, ownership enforcement and real IDs. Money requires currency and authoritative integer/decimal convention.

| # | Capability / contract status | Minimum request | Minimum response / intended function | Why blocked / backend action |
|---|---|---|---|---|
| 1 | Identity status — CONFIRMED source | Authenticated user, no body | verificationStatus; optional reviewer-safe note | Implemented; add Postman coverage, remove GET write side effect |
| 2 | Cancellation — CONFIRMED source | Owned reservation ID, no body | CANCELLED reservation | Implemented, atomically limited to RESERVED/CONTRACTED |
| 3 | Extension — MISSING | reservationId,newEndDate,request reason | requestId,status,authoritative quote,newEndDate | Proposal: owned extension request and FM decision workflow |
| 4 | Renewal payment — MISSING | approvedExtensionId,idempotency key | paymentId,status,amount,currency,settled end date | Proposal: renewal settlement; never change FE end date locally |
| 5 | Real PayOS — MISSING | reservationId,approved quoteId,idempotency key | authorized paymentId,checkout URL,amount,currency,status | Proposal: provider integration/webhook; current mock-pay is not PayOS |
| 6 | Payment history — MISSING | auth,page,limit,status | owned transactions with ids/references/amount/currency/dates/provider,pagination | Proposal: financial transaction ledger |
| 7 | Receipts — MISSING | owned settled paymentId | receiptId,issuedAt,line items,total,currency,document URL | Proposal: verified receipt issuance; preserve demo label |
| 8 | Refund tracking — MISSING | owned refundId or paymentId | amount,currency,reason,approval/transfer status and timestamps | Proposal: authorized refund read; no fictional transfers |
| 9 | DRAFT contract retrieval — CONFIRMED source | auth, no body | own DRAFT/SIGNED contract records | Implemented; FM approval creates draft, test fixture required |
| 10 | Inventory list — MISSING | auth,rentalId,page,limit,search,status | owned itemId/code/name/quantity/volume/status/location,pagination | Proposal: Customer managed-inventory read service |
| 11 | Inventory registration — MISSING | rentalId,name,category,quantity,unit,dimensions/volume | itemId,validated total volume,status | Proposal: capacity-aware registration; cannot allocate shelf locally |
| 12 | Item detail — MISSING | owned itemId | item record,current location,rental,allowed actions | Proposal: ownership-aware item detail |
| 13 | Inbound request — MISSING | owned itemId,quantity/requested date,notes | requestId,status,projected capacity | Proposal: capacity check and Staff assignment workflow |
| 14 | Outbound request — MISSING | owned itemId,quantity/requested date,notes | requestId,status,pickup confirmation | Proposal: authorized outbound workflow |
| 15 | Movement history — MISSING | owned itemId,page,limit | movements/type/time/from/to/quantity/actor-safe fields,pagination | Proposal: Customer-visible movement ledger |
| 16 | Notifications — CONFIRMED source | auth; owned notificationId for PATCH | title/content/type/isRead/createdAt | Implemented; add collection coverage; no bulk mark endpoint guessed |
| 17 | Access information — PARTIAL | owned active reservationId | provisioned method/authorized credential instructions/allowedActions | Simulation and own logs implemented; credential provisioning still MISSING, server ownership must be enforced |
| 18 | Pricing policy ID — PARTIAL | facility/service/type/at | actual Policy _id + typed policy semantics | Policy model reference and resolver confirmed; arbitrary config does not establish reservation formula |
| 19 | Deposit calculation — AMBIGUOUS | real unit,start/end,term,pricing/policy scope | quoteId,policyId,rent,deposit,tax/discount,total,currency,expiry | Proposal: authoritative reservation quote; config.amount example alone is not a formula |
| 20 | Payment eligibility — CONFIRMED current, lifecycle incomplete | owned reservationId | current eligible action/status, signed requirement | Current CONTRACTED rule implemented; BE must enforce owner and decide SIGNED requirement |
| 21 | Reservation total — AMBIGUOUS | unit and dates/term, identity eligibility | validated total,deposit,currency,policyId,quote expiry | Creation trusts FE amounts; estimate TODO fixed values excluded |
| 22 | Customer detail endpoint — UNAVAILABLE FOR ACTOR | own reservationId | owner-scoped populated reservation | Existing management route cannot be called by Customer; FE uses own list |
| 23 | Extra-charge checkout — MISSING | approved owned chargeId,idempotency key | verified amount/currency/payment status | Proposal: owned extra-charge read and settlement |

## Testing and limitations

- `npm run build`: passed; existing >500 kB main-chunk warning is non-fatal. No dependency/config changes.
- Contract browser tests in `.design-reference/check-customer-api-audit.cjs` use isolated synthetic API responses, never production fallback. Cover server search/pagination, public detail/options/pricing, owned reservation detail, PATCH sign/no body, cancel, mock-pay/no body/refetch, support create/reply/internal-message exclusion, notification read, ACTIVE simulation/result/PIN cleanup, no unsafe reservation POST. Follow-up adds unit selection/commitment/consent and rejected-PIN session preservation.
- Auth/pricing regression helper `.design-reference/check-auth-pricing-audit.cjs`: passed login simplification, logout success/error/network/401/dedup/Back guards, unrelated storage preservation, keyboard menu, rate/error integrity and 15 responsive checks. Existing auth forms/session were preserved.
- Initial core responsive audit: **115 views passed** at 1440/1024/768/390/320, no document overflow or page errors. Expanded final run after Header/Footer/CTA fixes: **165 views passed**; explicit CTA green background and absence of fabricated hotline links confirmed, including inventory/financial/extension demo routes, unit selection/term/consent, access history, and rejected-PIN session preservation. Invalid/unowned IDs render unavailable states; synthetic fixture flows test supported actions.
- Auth recovery/consent regression: passed body/error/retry/duplicate/secret isolation and 10 responsive views.
- Live browser on the allowed 5173 CORS origin: **30 Public views passed**, 35 successful public API responses, no overflow/page errors, zero mutations.
- A repeated live Public run after final Header/CTA edits reached backend HTTP **429**. Live requests were stopped; final visual changes were checked with isolated fixtures. Earlier successful 30-view runs remain recorded separately. No rate-limit bypass or backend configuration change was made.
- Live read-only HTTP: health 200; facility list/search/service filter 200; detail/pricing/options for two actual facilities 200; invalid facility ID 400. Customer endpoints without auth returned 401. This verifies reachability/public contracts/auth gates, **not authenticated Customer success**.
- No live account credentials were used from Postman. No reservation, signature, payment, identity update, support message, PIN simulation or FM mutation was executed against the real backend. Authenticated end-to-end is **NOT LIVE VERIFIED**. It also requires an approved identity, priced available unit, authoritative quote, external FM approval/draft and handover; Customer cannot execute FM actions.
- Production error paths render errors/retry or unavailable states, never silently substitute demo facilities/prices/reservations/contracts. Explicit legacy inventory/financial/extension demos remain browser-only.

## Changed files in this task

Modified: `src/api/axiosClient.js` (only rejected-simulation-PIN 401 exception), `confirmedContract.js`, `contractApi.js`, `customerRentalApi.js`, `reservationApi.js`, `supportApi.js`; `src/components/customer/CustomerSupportIntegration.jsx`, `CustomerVerificationForm.jsx`, `RentalBackendUI.jsx`, `RentalBookingIntegration.jsx`, `RentalLifecycleIntegration.jsx`; `src/components/home/HeroSection.jsx`, `FacilitiesSection.jsx`, `HowItWorksSection.jsx`, `StorageSolutionsSection.jsx`, `FAQSection.jsx`, `SizeGuideSection.jsx`, `CTASection.jsx`; `src/layouts/PublicLayout.jsx` (unverified hotline/location claims), `src/components/common/PublicHeader.jsx` (unverified hotline), `src/layouts/CustomerLayout.jsx` (only notification demo label); `src/pages/public/HomePage.jsx`, `HowItWorksPage.jsx`, `PricingPage.jsx`, `SupportPublicPage.jsx`; `src/pages/customer/HandoverPage.jsx`, `NotificationsPage.jsx`; `src/routes/AppRoutes.jsx` (one new public detail route, all existing routes preserved).

Created: `src/components/customer/PublicFacilityCatalog.jsx`, `CustomerNotificationsIntegration.jsx`; this report and `docs/CustomerApiEndpointInventory.md`; `.design-reference/customer-api-inventory.json`, `customer-api-live-results.json`, `check-customer-api-audit.cjs`, `check-auth-pricing-audit.cjs`, `check-customer-public-live.cjs`, `customer-live-facility-390.png`, `customer-facility-contract-390.png`. Existing LoginPage, LogoutButton, CustomerUserMenu and previous screenshots/docs were already modified before this task and were not rewritten here.

## Prioritized remaining work

1. BE: provide authoritative reservation quote/deposit semantics and proper input/date conversion; enforce owner on mock-pay and simulate-unlock; settle sign-before-pay rule; remove fixed PIN dependency. FE create intentionally stays blocked until actual amounts can be verified.
2. QA/BE: supply approved development Customer identity, actual priced unit and draft; perform authenticated flow with external FM approval/handover. Correct V2 signing/payment examples and include identity/notification/cancel/access-history source contracts.
3. BE: real payment/renewal/history/receipt/refund/charge contracts with idempotency and currency; then replace explicit financial demos.
4. BE: inventory/capacity/inbound/outbound/movement and extension workflows; then replace isolated demo workspaces. Add secure access-information provision.

There are no identified Customer-eligible fully verified contracts left intentionally unimplemented in the requested core flows. Booking is a confirmed route with incomplete authoritative amount semantics, not a completed booking integration. Public/source confirmation, unavailable authenticated live testing and absent capabilities remain separate categories above.
