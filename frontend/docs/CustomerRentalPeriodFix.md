# Customer rental-period dropdown fix — 2026-10-09

## Findings

The previous dropdown read only `GET /public/facilities/:facilityId/pricing`, then kept exact matching unitSize, `term.unit === 'MONTH'`, and integer term values. Backend `currentPublicPricing()` already filters active/effective records at **server now**, so future rules effective at the Customer's chosen move-in date could never reach this dropdown. DAY/YEAR were silently excluded despite the confirmed TermUnit enum. Numeric-string values were rejected. A duration default of 1 could leave the UI showing a term not present in the options. Pricing and deposit policy were resolved together with Promise.all, so a missing policy also blocked reviewing a valid rental price. An empty native select can show a browser-controlled dark strip; it did not have a real placeholder or themed popup.

Live read-only inspection: facility list returned 200; public pricing returned 200 for facilities `6ac29e8c72e5062a4e646ccd` and `6ac4561b9a1f0501dfd90243`, both with `{success:true,data:{selfStorage:[],managedInventory:[]}}`. This establishes **no currently published effective public prices** for those facilities at inspection time. It does **not** establish that the full database has no inactive/future pricing rules. GET pricing-rules without a session returned 401; no authenticated Customer test account was used, so full list and resolve are source-confirmed and browser-contract-tested, **not authenticated live verified**. No backend rules or seed data were created.

## Confirmed requests and responses

Source: backend pricing-policy routes, rule.controller, rule.validation, rule.service and pricing-policy/storage-unit types.

| API | Request | Response |
|---|---|---|
| GET /public/facilities/:id/pricing | Public, facility ID | `{success:true,data:{selfStorage?:rate[],managedInventory?:rate[]}}`; current effective rules, public projection without rule IDs |
| GET /pricing-rules | Bearer, `facilityId,serviceType=SELF_STORAGE,unitSize,isActive=true,page,limit=100` | `{success:true,data:PricingRule[],pagination:{page,limit,total,totalPages}}` |
| GET /pricing-rules/resolve | Bearer, `facilityId,serviceType,unitSize,termValue,termUnit,at` | `{success:true,data:PricingRule}`; 404 No effective rule, 409 ambiguous rules |
| GET /policies/resolve | Existing deposit request, separate from required price | Confirmed policy record or error; absence does not invent a deposit and does not block truthful review |

Full pricing record fields used: `_id,facilityId,serviceType,unitSize,isActive,term{value,unit},price,currency,effectiveFrom,effectiveTo?`. The confirmed list has a top-level data array and pagination. Unexpected nested objects are explicitly reported as mapping failure; no guessed `data.items` adapter was added.

## Implementation

- Fetch all actual pages for the selected facility/service/unit size. No MONTH-only server filter, no fallback durations. Date changes filter the fetched records locally rather than refetching the list. Requests use the existing API client and abort/session-aware useBackend. No automatic retry loop, including 429.
- Match actual scope, require isActive:true, effectiveFrom <= move-in UTC timestamp and effectiveTo > timestamp (exclusive). Before a date is selected, active terms are listed provisionally with a prompt to choose a date. Validate term, finite positive price, currency and effective dates. Deduplicate/sort DAY/MONTH/YEAR options. Normalize safe positive integer term strings while rejecting malformed values.
- Keep a selected term when it remains valid; clear invalid terms when effective date/scope changes. No implicit 1-month default; legacy draft.months is read only as a previously saved term and still must match actual rules. Changing unit rechecks its applicable rules; saved term is never accepted merely because it exists in the draft.
- Use the existing Radix Select dependency to add the project's missing shadcn-style Select primitives: white popup/viewport, green highlight/text, orange focus, portal z-index and bounded scrolling. Existing shared styles/configuration and other roles remain unchanged.
- End date uses UTC calendar arithmetic: DAY adds calendar days, MONTH adds calendar months with end-of-month clamp, YEAR adds 12 calendar months with leap-day clamp. There is no fixed 30-day conversion. Invalid dates return no end date. The backend has no separate end-date rounding/inclusive-day formula; the existing UTC start/end convention is preserved and resolver at is explicit UTC midnight.
- Required pricing resolves for the exact selected term/date/scope, then its returned record is revalidated. Known backend `No effective rule` is shown explicitly; 500 details remain masked. Price loading/error, list mapping/invalid data, no matching rules, inactive rules and non-effective dates have distinct states and manual Retry.
- Review requires real selected facility/unit, matching facility relationship, AVAILABLE unit, supported service, future valid start, valid effective term/end and confirmed resolved price. It saves the actual `{value,unit}` and dates to the existing memory-only draft; Review displays the selected commitment. Deposit policy is independent/optional for truthful review. **Create Reservation remains disabled** until authoritative rent/deposit calculation is confirmed; no fake amount, policy ID, discount or POST is introduced.

## Files in this task

Modified:

- `src/api/customerRentalApi.js`: pricingApi.list accepts optional request config for cancellation, preserving existing callers/client.
- `src/components/customer/RentalBookingIntegration.jsx`: period export points to the isolated implementation; review displays actual term. Storage-selection behavior preserved.

Created:

- `src/components/customer/RentalPeriodIntegration.jsx`.
- `src/lib/rentalPeriod.js`: term validation/filtering and UTC calendar date helpers.
- `src/components/ui/select.jsx`: existing Radix-based shadcn-style select primitives; no dependency installation.
- `.design-reference/check-rental-period.cjs`, screenshots `rental-period-{1440,1024,768,390,320}.png`, this report.

No routes, auth architecture, token storage, reservation submission, backend source, Admin/BOM/Manager/Staff code, package/configuration or dependency versions were changed in this task. Other working-tree changes predate it.

## Validation

- `npm run build`: passed. Existing main-chunk size warning remains non-fatal. Initial sandboxed build failed on Windows realpath permissions; same build succeeded with approved execution permissions.
- Browser contract suite: PASS. Tests explicit loading, paginated list, 1/3/6/12 MONTH plus DAY/YEAR, numeric term normalization, no matching/inactive/future/expired rules, malformed/nested mapping, different unit IDs/sizes, valid selection preservation and invalid clearing after scope/date changes, start changes, list 404/429/500, resolver 404, exact resolver arguments, deposit-independent Review, final submit disabled and zero POSTs. Fixtures are isolated tests, never production fallback.
- UTC date tests: Jan 31 → Feb 28/29, Feb 29 + YEAR → Feb 28, leap-day/day addition and invalid Feb 30.
- Dropdown opened and selected at widths 1440,1024,768,390,320: no horizontal overflow, popup within viewport, white background asserted, no page errors. Mobile screenshot visually inspected; no dark strip.
- Valid duration options and Review behavior are verified with confirmed-contract fixtures. Actual authenticated list/resolve remain NOT LIVE VERIFIED. If the real scoped list has no active effective records, the correct result is an explicit empty state; backend must configure real effective pricing, and FE does not seed or fabricate options.
