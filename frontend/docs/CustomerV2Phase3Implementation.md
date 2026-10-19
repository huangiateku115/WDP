# Customer V2 Phase 3 — Inventory Registration & Inbound Request

Date: 2026-10-17. Scope: CV2-007 and CV2-008 only.

Status: frontend implementation and isolated fixture acceptance PASS. Live backend/database acceptance has NOT been performed. Phase 4, payments, Staff inspection and physical inbound confirmation are outside this implementation.

## 1. Contract audit completed before implementation

Reference files under `C:/Users/laptop/Desktop/WDP/BE-REF/` were read only:

- `src/routes/inventory-item.routes.ts`: authenticated Customer create/inbound, Customer-owned reads.
- `src/controllers/inventory-items/inventory-item.controller.ts`: create returns HTTP 201 `{success:true,data:item}`; inbound and detail return HTTP 200 with the same envelope; list includes pagination.
- `src/services/inventory-items/inventory-item.validation.ts`: strict input allowlists, IDs, measurements, text lengths and image validation.
- `src/services/inventory-items/inventory-item.service.ts`: DTO, ownership, registration, preferred Cell validation, inbound transitions, transaction and interval guards.
- `src/services/reservations/managed-inventory-reservation.guard.ts`: registration eligibility and active Managed Facility validation.
- `src/services/warehouse-map/warehouse-map.service.ts`: Customer map includes active Zones; rack detail validates active Zone and Facility.

Postman reference: `C:/Users/laptop/Downloads/WDP-Managed-Inventory-v2-Deposit-Checkin-Inbound.postman_collection.json`, requests “Customer REGISTER ITEM (sau DEPOSIT_PAID)”, “Customer REQUEST INBOUND → PENDING_INBOUND”, and Customer My Inventory. No collection/environment requests were executed.

Existing inventory API client, owned-reservation reader, lifecycle guards, registration/edit forms, map preferences, inventory details and demo movement routes were inspected. The existing Axios client, session handling and route definitions are retained.

### Confirmed API contracts

| Method / path, relative to `/api/v1` | Usage |
| --- | --- |
| POST `/inventory-items` | Existing create method; V2 registration now available after confirmed deposit |
| POST `/inventory-items/:id/inbound-request` | Added exact wrapper and allowlist entry; body `{}` |
| GET `/inventory-items/me?page=1&limit=20` | Existing owned list and registration reconciliation |
| GET `/inventory-items/:id` | Existing owned detail; pre-submit check and explicit status refresh |
| GET `/reservations/me` | Existing owned reservation scope |
| GET `/reservations/managed/:id` | Existing service-specific detail, following owned-list verification |
| GET `/public/facilities/:id` | Existing Facility information and eligibility |
| GET `/warehouse-map?facilityId=...` | Existing verified active-Zone map |
| GET `/racks/:id/detail-map` | Existing verified Cell/Rack data for preference choices |

No required Phase 3 endpoint is missing. No payment, Staff mutation, generic inventory management or invented endpoint was added.

### Create payload and response

Required: `managedReservationId` (24 hex ID), `itemCode` (1–48 characters, uppercase on submission, `[A-Z0-9][A-Z0-9_-]*`), `name` (1–160), `category` (1–80), positive safe-integer `quantity`, `quantityUnit` (1–32), finite positive numeric `unitWeightKg`, and `unitDimensionsM` containing finite positive `widthM`, `depthM`, `heightM` only.

Optional: `description` (up to 2000), `preferredCellId` (ID; omitted when no preference), `images` (at most 10 valid HTTP(S) URLs, no URL credentials). The existing form sends empty description/images explicitly. Weight/volume products must remain finite and positive. Customer ID, Facility ID, stock counters, computed totals, status and location are not supplied by the form.

The backend returns item IDs, immutable code, supplied metadata, computed unit/total weight and volume, images, status, current Cell, optional preferred Cell, timestamps and optional receiving metadata. Existing strict response parsing is reused. Create success must match the requested reservation, Facility and code, and confirm `REGISTERED` with `currentCellId:null`.

Category is free text under the **registration** validator; there is no confirmed category enum at this boundary. Empty/overlength/non-string categories are invalid. The effective CATEGORY allowed/blocked policy is enforced by the backend during physical receiving, not by create or inbound-request. This implementation does not invent an enum or claim that registration confirms category acceptance.

### Ownership, lifecycle and failures

- Customer role required by backend routes and services. Existing Customer route gate remains; inbound additionally requires the cached role to be explicitly CUSTOMER. Owned item GET and owned reservation lookup precede inbound submission.
- First V2 registration: `DEPOSIT_PAID`, numeric `bookingFlowVersion:2`, unexpired `endDate`, positive allocated capacity and active Managed Facility. `RESERVED` is blocked. Existing ACTIVE registration remains supported as confirmed by source.
- Existing edit/placement-preview eligibility remains ACTIVE-only. Deposit-paid registration does not silently enable editing or preview.
- Inbound: unplaced `REGISTERED` item; matching reservation and Facility; V2 `DEPOSIT_PAID` or `CHECKIN_READY` with future end date, or ACTIVE during `[startDate,endDate)`. Backend additionally rejects unresolved overdue Managed rentals at the same Facility. It owns the authoritative transaction/concurrency check.
- Inbound changes only the receiving request state to `PENDING_INBOUND`. It does not mark stock IN_STORAGE, assign a physical Cell, sign a contract, pay a balance or activate a rental.
- HTTP 400 covers malformed data/IDs, 401 authentication, 403 role/scope, 404 missing/foreign-owned records or unavailable eligible rental, 409 duplicate code/state/concurrency/Facility/interval conflicts. Unexpected server failures are sanitized. Failure is never displayed as success.
- Both operations require an explicit user action. Busy refs block double clicks. Before POST, current owned data is read again. Network errors, 5xx and unverified success responses lock resubmission; there is no automatic POST retry. Inbound offers GET-only refresh and retains the submission lock for that page instance. Registration retains the existing My Inventory reconciliation link.

### Preferred Cell verification

V2 preference choices are the intersection of `allocatedCellIds` and verified AVAILABLE Cells in an AVAILABLE Rack in the reservation Facility's active-Zone map. The reservation detail, map, Rack and Cell response identities are checked. The verification repeats immediately before submission. Unknown/missing map data produces an error and no fabricated choices; an optional preference can be omitted. An injected foreign Cell ID is rejected before POST.

Booking `isBookable` is intentionally not used as a preference guard: an allocated Cell can already be reserved for this customer. A preference is not a new reservation or physical-placement guarantee. The existing ACTIVE V2 map preference action now also checks reservation membership. Legacy map behavior is preserved.

Backend gap: `validatePreferredCell` currently checks Facility/Zone/Rack/Cell availability but not membership in `allocatedCellIds`. The FE enforces the requested V2 membership rule, but server-side enforcement remains a backend concern; BE-REF was not changed.

## 2. Files changed

All paths below are relative to `C:/Users/laptop/Desktop/WDP/frontend/`.

| File | Change |
| --- | --- |
| `src/api/inventoryApi.js` | Add exact inbound-request POST with empty body, reuse existing Axios instance |
| `src/api/confirmedContract.js` | Allow only the confirmed ID-qualified inbound-request POST |
| `src/lib/inventoryRegistration.js` | Separate registration and V2 inbound eligibility helpers; retain existing edit guard |
| `src/components/customer/inventory/InventoryBackendUI.jsx` | Reuse existing rental loader with explicit eligibility predicate; add registration loader |
| `src/components/customer/inventory/managedInventoryContext.js` (new) | Owned reservation context and verified allocated/preferred Cell reader |
| `src/components/customer/inventory/InventoryItemForm.jsx` | V2 deposit-paid entry, query preselection, context/capacity display, verified preference selection, fresh guards |
| `src/components/customer/inventory/InventoryIntegration.jsx` | V2 inbound entry from real item detail; preserve ACTIVE preview guard |
| `src/components/customer/inventory/InventoryMapPreference.jsx` | Restrict V2 preferred Cell save to allocated IDs, including fresh-action check |
| `src/components/customer/inventory/ManagedInboundRequest.jsx` (new) | Explicit shadcn confirmation, fresh reads, single POST, real resulting state, errors and read-only reconciliation |
| `src/pages/customer/InventoryMovementRequestPage.jsx` | Existing INBOUND route delegates real IDs to verified V2 integration; demo IDs and outbound retain existing component |
| `src/components/customer/RentalLifecycleIntegration.jsx` | V2-only Register inventory / View inventory links and RESERVED guidance |
| `.design-reference/check-customer-v2-phase3.cjs` (new) | Isolated API/browser fixtures and pure validation checks |
| `docs/CustomerV2Phase3Implementation.md` (new) | This audit, implementation and acceptance report |

No route definition, auth, pricing/credit/balance calculation, dependency, package manifest, environment file or CSS was changed. Existing Self Storage and legacy signing/payment behavior is preserved. Green/orange styling and shared UI components are reused.

## 3. Customer screens

1. `/portal/reservations/:id`: eligible V2 reservation links to `/portal/inventory/register?reservationId=:id`; RESERVED has no registration link.
2. `/portal/inventory/register`: existing registration form, selected reservation/Facility, allocated Cell summary and capacity; optional verified preferred Cell selector for V2.
3. `/portal/inventory/:id`: existing real item detail shows REGISTERED/PENDING_INBOUND and a V2 inbound entry.
4. `/portal/inventory/:id/inbound`: explicit confirmation and backend request, real status display, refresh and item link. A real legacy record is read but has no V2 mutation control. Existing fixture/demo IDs retain their old demo flow; outbound remains unchanged.
5. `/portal/inventory`: existing paginated owner list supports checking uncertain registration results.

## 4. Verification

All browser API requests were fulfilled by fixtures. Unmatched external traffic was blocked, including requests to the configured backend. No live backend requests or database writes were made.

| Check | Result |
| --- | --- |
| Syntax transform of all 190 source JS/JSX/TS/TSX files | PASS |
| `npm run build` | PASS; existing Vite large-chunk warning remains |
| `check-customer-v2-phase3.cjs` | PASS; 104 intercepted API requests, 0 real backend requests |
| `check-inventory-contract.cjs` | PASS |
| `check-customer-v2-phase1.cjs` | PASS, 8 tests |
| `check-managed-contract.cjs` | PASS |
| `check-self-storage-contract.cjs` | PASS |
| `check-self-payment-contract.cjs` | PASS |
| `check-mi02c-contract.cjs` | PASS |
| `check-customer-v2-phase1-ui.cjs` | PASS, 50 fixture requests |
| `check-inventory-mi02a.cjs` | PASS, 72 fixture requests |
| `check-mi02c-phase1.cjs` | PASS, 200 fixture requests |
| `check-self-storage-completion.cjs` | PASS, 227 fixture requests |

Phase 3 fixtures verify RESERVED blocking, DEPOSIT_PAID registration, ACTIVE compatibility, expired/incorrect-service/version/Facility and future ACTIVE inbound guards, REGISTERED data, explicit single create/inbound POST, PENDING_INBOUND duplicate guard, invalid quantity/weight/dimensions/category/ID, foreign/injected preferred Cell rejection, stale Cell availability, 400/401/403/404/409 responses, network timeout without retry, GET refresh, no writes on page opening and legacy isolation. Registration and inbound layout overflow is checked at desktop/tablet/mobile widths including 320px. Existing suites cover legacy edit/map/preview, Self Storage and Phase 1/1.1 regressions.

Browser launch and local-server visibility were blocked within the initial sandbox; the suites were rerun outside that process sandbox with API interception and external-network blocking intact. Two test-only waits were corrected (native option visibility and absence of a V2 button for legacy); final fixture runs pass. Existing screenshot-producing suites ran through an in-memory wrapper with screenshot writes disabled; their layout assertions still ran.

## 5. Manual acceptance on an approved test environment

1. Sign in as Customer. Open an existing owned V2 RESERVED reservation: no Register inventory action; direct form entry cannot submit.
2. Use an existing backend-confirmed, unexpired DEPOSIT_PAID fixture/test reservation. Do not manufacture this state with payment/database changes. Open Register inventory from its detail.
3. Verify reservation, Facility, capacity and allocated IDs. Enter the confirmed fields above and optionally select an offered preferred Cell. Empty or invalid positive measurements/category/code must not submit.
4. Explicitly register once; verify owned item detail shows backend-confirmed REGISTERED and no current physical Cell.
5. Open Request Inbound, tick confirmation, submit once. Verify PENDING_INBOUND and a disabled repeat action. No Staff receiving or activation occurs here.
6. Simulate a network failure in an approved fixture environment; verify no automatic POST retry and use Refresh item status / My Inventory to reconcile.
7. Check existing ACTIVE legacy registration/edit/preview, Self Storage signing/payment and map navigation remain intact.

For reproducible fixture-only checks: start the existing Vite dev command on `127.0.0.1:5189`, then run `node .design-reference/check-customer-v2-phase3.cjs`. The fixture suite never falls through to the live backend.

## 6. Boundaries and remaining acceptance blockers

- No missing required Phase 3 API; Customer inventory registration/inbound frontend is integrated with the confirmed contracts.
- Live mutation/E2E acceptance remains BLOCKED until a separate approved writable test database, test accounts, eligible reservations/Cells, transaction-capable MongoDB deployment and record-retention/cleanup plan are supplied. Inbound uses backend transactions; no deployment capability was assumed or exercised here.
- CATEGORY policy acceptance and physical packing/capacity remain backend/Staff receiving responsibilities. Preferred Cell membership enforcement is still absent server-side as described above.
- No payment recovery API or earlier Phase 2 blocker was worked around. No deposit/balance/refund/PayOS, mock payment, Staff inspection, physical confirmation or Phase 4 work was added.
- SHA-256 comparison against the pre-edit snapshot confirms all 174 BE-REF files are unchanged. The original `backend/` directory was never accessed. Frontend source/docs/test changes are limited to the 13 files listed above. `dist/` was generated by the production build and was not committed.
