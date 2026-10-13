# Customer Reservation Completion — Self Storage & Managed Inventory

## 1. Summary and audited implementation checklist

This task completes the supported Customer Self Storage create flow and preserves the existing MI-R01 Managed flow. Initial Frontend-only git status was recorded before edits; earlier map, layout, authentication and Managed integration changes remain intact.

| Area | Verified Backend contract / rule | Frontend implementation |
|---|---|---|
| Facility eligibility | Public catalog filters ACTIVE, non-deleted facilities; DTO returns serviceTypes but omits status | Self Storage selection loads all pages and filters SELF_STORAGE. Managed retains its active-catalog service filter. Review/submission re-read public detail |
| Unit availability | Authenticated storage-unit list/detail; create locks unit and checks overlap | Available unit required; facility association checked on selection, review and immediately before create |
| Self Storage estimation | POST `/reservations/estimate` calls the same `ReservationService.calculatePricing()` as create | Authoritative estimate in period and review; no FE financial formula |
| Managed quota/quote | MI-R01 interval capacity, effective PER_M3 pricing, percent-of-rent policy, transactionally rechecked on create | Existing capacity → quote → confirm → create preserved |
| Create | Verified Customer, future start; service-specific body and response envelope | Self Storage sends 5 exact fields; Managed sends quota/term body and maps nested reservation/quote |
| Owner list/detail | GET `/reservations/me` returns both service types | Existing service filter/summary; owner discovery before Managed detail; generic Self Storage detail avoided |
| Cancel | Both services permit own unpaid RESERVED/CONTRACTED, including expired unpaid records | Correct service dispatcher, explicit confirmation, state refresh only after server confirmation |
| Contract creation | Management approval creates DRAFT, not Customer create | Waiting-for-approval messaging; no fabricated contract |
| Sign | Owner/DRAFT for Self Storage; Managed additionally requires CONTRACTED with valid hold | Existing service guards, fresh contract/reservation reads, PATCH sign and refresh |
| Payment | Legacy Self Storage owner/CONTRACTED mock; Managed requires signature, hold and development flags | Correct service endpoints; Managed disabled by default and in production |
| Lifecycle | Self Storage PAID awaits Staff/Manager inspection/handover; Managed PAID awaits authorized activation | Separate next-action messages; contract remains accessible after signing/payment/activation |
| Customer authorization | requireAuth/role plus service ownership checks | Customer gate, current token/abort guards and unknown-service mutation refusal preserved |
| Hold/expiration | Managed hold required for signing/payment; no automatic terminal expiry API | Expiration is shown separately from server status; FE never expires or activates records |
| Errors / concurrency | Conflict and authorization responses; create has no idempotency contract | Safe Backend messages, busy refs, re-review after price changes, no automatic mutation retries, ambiguous create lock |

Primary source references inspected read-only: `BE-REF/src/routes/reservation.routes.ts`, `controllers/reservations/reservation.controller.ts`, `services/reservations/reservation.service.ts`, `services/reservations/managed-reservation.service.ts`, `controllers/contracts/contract.controller.ts`, `routes/contract.routes.ts`, `controllers/inspections/inspection.controller.ts`, `routes/inspection.routes.ts`, storage-unit services, pricing-rule services/validation, public-catalog services and reservation types/models.

## 2. Fixed Self Storage Submit blocker

The previous review always disabled Create Reservation and stated that authoritative rent/deposit calculation was unconfirmed. The actual Backend has POST `/reservations/estimate`, and both estimate and create call the same `calculatePricing(pricingPolicyId,startDate,endDate)` function.

The estimate body contains only `startDate`, `endDate`, `pricingPolicyId`. Response is `{success:true,data:{estimatedRent,depositAmount,taxAmount,durationDays,basePrice}}`. The selected, effective matching Pricing Rule `_id` is the verified pricingPolicyId. A separate deposit Policy is not required by the existing Self Storage calculation; failure to resolve that optional policy no longer implies that authoritative estimate is unavailable.

Create is enabled only after valid facility/unit/period/rule, a valid server estimate, VERIFIED Customer Profile and explicit accuracy confirmation. Re-review is required if the current server estimate or selected rule changes before submission.

## 3. Complete Self Storage flow

`/portal/rent` → eligible Facility → AVAILABLE unit → `/portal/rent/period` → effective term/date → server estimate → `/portal/rent/review` → explicit confirmation → POST `/reservations` → `/portal/reservations/:id`.

Review re-loads Facility, unit, Customer Profile and the effective Pricing Rule, validates the scope, then estimates again. Submit repeats these reads before create. It sends only:

```json
{
  "facilityId": "<ObjectId>",
  "storageUnitId": "<ObjectId>",
  "startDate": "<ISO UTC>",
  "endDate": "<ISO UTC>",
  "pricingPolicyId": "<verified Pricing Rule ObjectId>"
}
```

It does not send customerId, estimatedRent, deposit, tax, discount or status. Backend derives owner and recalculates money. Response must confirm the requested Self Storage service, RESERVED state, valid ID, facility/unit and rental dates. Success clears the live draft and opens detail with a server-confirmed creation notice.

Future UTC start and calendar-clamped end dates are checked; the existing DAY/MONTH/YEAR helper is retained. A maintained/occupied/wrong-facility unit cannot be selected or submitted through this flow. A race after preflight is still decided by Backend overlap/transaction validation.

Definitive create 4xx clears confirmation and refreshes review. Network, 5xx or malformed success response may conceal a committed booking: creation remains disabled in that form, and My Storage is offered before any intentional new attempt. No create is automatically retried. Double clicks produce one create request.

## 4. Verified Managed flow

`/portal/rent?service=managed` retains Facility → effective PER_M3 term → requested m³ → capacity → quote → confirmation → create → detail. No unit or Cell is allocated. Quote remains advisory; create checks commitments within a transaction. Both service types stay visible through `/reservations/me` and its existing service filter.

Managed money, cancellation, signature/hold checks and development payment gate remain unchanged. MI-01 baseline occupancy is untouched. MI-02A and physical stock/movement workflows are outside this task.

## 5. API mapping

All requests use the existing Axios instance, base URL, Bearer interceptor and auth storage.

| Method | API | Scope |
|---|---|---|
| GET | `/public/facilities`, `/public/facilities/:id` | Eligible catalog / fresh facility |
| GET | `/facilities/:id/storage-units`, `/storage-units/:id` | Actual unit selection and preflight |
| GET | `/pricing-rules`, `/pricing-rules/resolve` | Effective service/size/term selection |
| GET | `/policies/resolve` | Existing optional Self Storage policy display |
| GET | `/customers/me/profile` | VERIFIED create gate |
| POST | `/reservations/estimate` | Authoritative Self Storage estimate; newly allowlisted exact POST |
| POST | `/reservations` | Self Storage create |
| GET | `/reservations/me` | Owner collection, both services |
| PATCH | `/reservations/:id/cancel` | Own unpaid Self Storage cancellation |
| POST | `/reservations/:id/mock-pay` | Self Storage simulation |
| GET | `/reservations/managed/capacity/:facilityId` | Commercial interval capacity |
| POST | `/reservations/managed/quote`, `/reservations/managed` | Managed quote/create |
| GET | `/reservations/managed/:id` | Own Managed detail |
| PATCH | `/reservations/managed/:id/cancel` | Own unpaid Managed cancellation |
| POST | `/reservations/managed/:id/mock-pay` | Enabled development Managed simulation |
| GET | `/contracts/me`, `/contracts/:id` | Owner contract context |
| PATCH | `/contracts/:id/sign` | Customer signature, no body |
| GET / POST | `/access/me`, `/access/simulate-unlock` | Existing Self Storage simulated access |

No management approve/reject/activate, capacity-write or inspection endpoints are called by Customer. Unknown services cannot trigger service-specific mutations.

## 6. Reservation and contract lifecycle

RESERVED waits for management approval. CONTRACTED exposes the actual DRAFT contract. Signed contracts remain visible; reservation details now retain contract navigation for PAID/ACTIVE/OVERDUE/CHECKED_OUT/CLOSED instead of hiding it after payment. Payment review/status remains accessible for CONTRACTED and PAID.

Self Storage PAID awaits handover; ACTIVE permits the existing simulated unit access. Managed PAID awaits Manager/Admin quota activation; ACTIVE is quota only, not Cell occupancy or inbound stock. No Customer action fabricates these management transitions.

Cancellation uses each service's confirmed unpaid statuses. Contract snapshots support flat Self Storage money and Managed `amountBreakdown`. Missing totals/fees are omitted rather than manufactured. Signing and payment refresh state after confirmation.

## 7. Payment status

No production payment provider exists in the inspected reference. Both supported payment actions are explicitly simulated; no real receipt/refund/transaction is created locally.

Managed simulation requires Frontend DEV and `VITE_MI_MOCK_PAYMENT_ENABLED=true`; default and production disable it. Backend separately requires non-production mode, `MI_MOCK_PAYMENT_ENABLED=true`, signed contract and a live CONTRACTED hold. Backend-disabled responses are handled without optimistic success.

Legacy Self Storage mock behavior is preserved and its weaker signature/hold enforcement is reported below. No unconfirmed PayOS endpoint is introduced.

## 8. Files changed in this task

Created:

- `src/lib/selfStorageReservation.js`
- `src/components/customer/SelfStorageReservationReview.jsx`
- `.design-reference/check-self-storage-contract.cjs`
- `.design-reference/check-self-storage-completion.cjs`
- `docs/CustomerReservationCompletion.md`

Modified:

- `src/api/confirmedContract.js`: exact estimate POST allowlist.
- `src/api/reservationApi.js`: estimate adapter and 5-field Self Storage create body; clarification of safe owner detail reads.
- `src/components/customer/RentalBookingIntegration.jsx`: all eligible Facility pages, fresh unit eligibility and new review integration.
- `src/components/customer/RentalPeriodIntegration.jsx`: authoritative estimate and review gating; updated optional-policy explanation.
- `src/components/customer/RentalLifecycleIntegration.jsx`: Self Storage creation notice and contract/payment navigation after lifecycle transitions.
- `src/components/customer/RentalBackendUI.jsx`: allowlisted safe Self Storage business-error messages.
- `.design-reference/check-rental-period.cjs`: estimate/profile fixtures and confirmed Submit assertions; only estimate POSTs allowed during period regression.

New screenshot artifacts:

- `.design-reference/self-reservation-review-1440.png`
- `.design-reference/self-reservation-review-1024.png`
- `.design-reference/self-reservation-review-768.png`
- `.design-reference/self-reservation-review-390.png`
- `.design-reference/self-reservation-review-320.png`

Regression scripts regenerate existing `rental-period-{1440,1024,768,390,320}.png`, `managed-booking-{1440,1024,768,390,320}.png`, and `digital-warehouse-{desktop,tooltip,selected-cell,mobile}.png`. Build output is generated under ignored `dist/`. Earlier changes in the initial working tree are preserved and are not claimed as changes from this task.

## 9. Actual build/test results

| Validation | Result |
|---|---|
| `npm run build` | PASS, 1972 modules; main chunk ~744 kB, existing large-chunk warning |
| `check-self-storage-contract.cjs` | PASS: scope/unit/date/rule, exact payload, estimate and creation mapping |
| `check-self-storage-completion.cjs` | PASS: 208 intercepted fixture requests; complete Customer flow, double click, unverified/401/ownership, price/unit changes, conflicts and ambiguous responses |
| Updated `check-rental-period.cjs` | PASS: existing terms/calendar/scope/errors, estimate and confirmed Submit enabled |
| `check-managed-contract.cjs` | PASS: service routing, request/envelope, snapshot schemas, hold/signature, production/default gate and management endpoint denial |
| `check-managed-reservations.cjs` development | PASS: 105 fixture requests; existing quote/create/detail/cancel/sign/payment/hold/error checks |
| `check-digital-warehouse.cjs` | PASS: MI-01 read-only detail/cache/selection/search/tooltip/zoom/fullscreen/error regression |
| Production Managed browser fixture | PASS: 91 intercepted fixture requests; Managed mock action hidden in production |

Browser fixtures check 1440, 1024, 768, 390 and 320 pixels for document overflow. Self Storage review screenshots at 1440 and 320 were visually inspected; confirmation and enabled Create remain visible, with the existing green/orange layout. All test HTTP traffic is intercepted. Mutation responses are fixtures, not proof of a real database transaction.

## 10. Outstanding Backend dependencies and exact conflicts

- **Production payments:** no provider, callback settlement, real receipt/refund or capability discovery API is implemented.
- **Self Storage pricing semantics:** `calculatePricing()` interprets any selected base price with 30-day proration (`round(durationDays/30 × basePrice)`) and its legacy deposit rule. It does not interpret Pricing Rule DAY/MONTH/YEAR as an exact-term total or use the separately resolved deposit Policy. Estimate and create are consistent with each other, so FE displays the actual estimate, but business owners must reconcile this with exact-term pricing semantics before production accounting. FE does not replicate or change the formula.
- **Missing financial fields:** Self Storage estimate returns taxAmount=0 but no payable total, fee breakdown, currency, pricing version or quote token. FE takes currency from the verified selected rule and does not infer missing totals/fees. Create can reprice after preflight; stored server reservation values remain final.
- **Server validation scope:** Self Storage create checks unit/facility association and overlap, but does not comprehensively revalidate the Facility's ACTIVE/service state or the Pricing Rule's facility/service/size/term/effectivity. FE checks these for the supported UI, but cannot replace server-side validation against malicious callers.
- **Generic Self Storage detail ownership:** the route permits CUSTOMER, but its controller does not enforce Customer owner. FE continues using `/reservations/me`, never that unsafe detail endpoint.
- **Legacy Self Storage sign/payment:** signing requires owner/DRAFT but does not validate reservation hold/status; mock-pay requires owner/CONTRACTED but does not require SIGNED/unexpired hold or the Managed development flags. These are Backend limitations, not new FE business rules.
- **Management approval reliability:** Self Storage approval changes reservation and creates contract outside one combined transaction; a failure could leave CONTRACTED without a contract. FE shows only the actual owned contract, never synthesizes one.
- **Hold processing/idempotency:** no create idempotency key/lookup token or automatic terminal expiry transition exists. FE prevents automatic repeats and directs ambiguous results to My Storage; it cannot guarantee exactly-once creation after a user deliberately restarts a form.
- **Managed release/physical workflows:** overdue quota release, physical inbound/outbound/disposition and measured occupancy remain unavailable. MI-02A eligibility date discrepancy from the earlier audit is unchanged.
- **Deployment prerequisites:** configured effective rules/policies, verified profiles and MongoDB transaction support are required. No such data is fabricated by Frontend.

## 11. Unverified live E2E

No approved Customer credentials or isolated live test data were provided. No live create/cancel/sign/payment/activation was executed. Tests do not claim real approval/contract generation, Mongo transaction/concurrency behavior, actual provider payments or production data correctness. Backend original directory and running original Backend were not accessed.

## 12. Source protection verification

All edits are inside `frontend/`. Existing authentication, token storage, Axios instance/interceptors, route architecture, Customer layout/animations, MI-01, MI-02A and other role source remain unchanged by this task. No Backend migrations, seeds, database writes or resets were performed.

BE-REF baseline: 155 files; SHA-256 aggregate `cf8b4f4e6054a2789f9eb672ec8556a6dc38693053de38d9c1f08f0d90330ec4`. Final comparison matched the baseline across all 155 files; BE-REF is unchanged. Hash scope excludes `.git`, `node_modules` and symlinks. No original `backend/` contents were read or modified.
