# Customer Mobile Home Redesign & Rental Parity Audit

**TASK_ID:** `WDP_CUSTOMER_MOBILE_HOME_REDESIGN_RENTAL_PARITY_PIN_AUDIT`  
**STATE:** PARTIAL — Home redesign and source verification are complete; safe PIN display is blocked on a purpose-built Backend endpoint, and runtime UI review remains manual.

## A. Audit before implementation

### Home entry and data flow

- Route: `app/(tabs)/index.tsx` renders `Dashboard` from `src/screens/LiveAccount.tsx`; the older fixture `DashboardScreen` is not the live tab Home.
- Rentals: `mobileRepo.rentals(owner)` calls authenticated `GET /reservations/me`; `mapReservations` validates ownership. The backend sorts newest first and populates `facilityId` with name/address and `storageUnitId` with unitCode/size/volumeM3.
- Home also reads `GET /notifications/me` through `mobileRepo.notifications`; the response contains an unread count for the header badge.
- Rental detail uses the existing `rentalDetailTarget()` navigation and `mobileRepo.rental()` flow. These routes and API calls were preserved.
- Pull-to-refresh reloads the Home rental and notification resources; `useResource` aborts stale requests and refreshes on screen focus/resume.
- The existing project instructions in `frontend/AGENTS.md` were followed. Git status could not be read: repository metadata redirects Git to `C:/Users/laptop/Desktop/WDP`, where Git reports “cannot change to” that path. No Git metadata was modified. The current Home and related files were read before editing.

### Source field inventory

| Field | Self Storage | Managed Inventory |
|---|---|---|
| Reservation code / status | AVAILABLE from `/reservations/me` | AVAILABLE from `/reservations/me` |
| Facility name | AVAILABLE; populated on list | AVAILABLE; populated on list |
| Rental dates | AVAILABLE | AVAILABLE |
| Rental price | AVAILABLE as `estimatedRent` in reservation model/list; treated as total estimate | AVAILABLE as `estimatedRent`; treated as total estimate |
| Unit / cell count | AVAILABLE: one unit when `storageUnitId` exists | AVAILABLE as count of returned `allocatedCellIds` |
| Unit code / size / volume | AVAILABLE from list population | NOT APPLICABLE |
| Unit dimensions | MISSING from list population; reservation detail endpoint populates dimensions | REDACTED / not provided for Home; capacity and utilization are intentionally not displayed |
| Area | DERIVABLE only from validated unit dimensions; those are absent from the Home list | REDACTED / not applicable |
| Cell/rack labels | NOT APPLICABLE | MISSING from reservation list; only allocated cell IDs are returned |
| PIN/access credential | No dedicated customer read endpoint | No PIN; Managed V3 uses staff-verified access visits/sessions |
| Source | `/reservations/me` mapper plus backend reservation/unit population | `/reservations/me` mapper plus backend reservation fields |

The Home does not fetch each rental detail or storage unit separately. That avoids an unbounded detail request per card. Accordingly, missing Self Storage dimensions/area and Managed Inventory cell labels are omitted rather than fabricated. Managed capacity/utilization is not shown or inferred.

## B. Home redesign

Updated the live Home to use a compact greeting header with a customer name and notification button/badge, a higher-contrast service discovery panel, four rental summary metrics, and a “Đơn thuê của bạn” section with “Xem tất cả”. The five-tab navigation remains unchanged.

The shared live rental card now uses one hierarchy for both services: service icon/name, reservation code, lifecycle status badge, facility, resource summary, rental dates, total estimated rent when returned, and a prominent “Xem chi tiết” button. Active rentals ending within 30 days receive a clear reminder. Card text wraps/truncates safely and information rows align for small screens.

## C. Rental parity

- **Self Storage:** code, status, facility, unit code, localized size label, returned volume, unit count, rental period, and returned estimated rent. Dimensions and area are omitted because `/reservations/me` does not populate dimensions. The existing reservation detail source does return dimensions, but Home does not issue one extra detail call per card.
- **Managed Inventory:** code, status, facility, allocated cell count when provided, rental period, and returned estimated rent. The card does not show cell IDs as customer-facing labels and does not expose allocated capacity or used capacity.
- The contract/payment business flows, rental transitions, detail routes, and bottom navigation were not changed.

## D. Backend PIN audit

| Check | Result |
|---|---|
| Dedicated customer API to retrieve a PIN | **NO** |
| Staff handover route | `POST /reservations/:id/handover`, staff/manager/admin authorized; the Self Storage full-upfront branch creates a six-digit PIN and returns it in the staff handover response with `accessProvisioning: SIMULATED`. |
| Customer unlock simulation | `POST /access/simulate-unlock`, customer role is allowed; it accepts a PIN and reservation identifier to verify/simulate access. It does not return a PIN and is not called by Home. It checks ownership, active status, rental dates, contract (when present), unit status, and overdue conditions. |
| Customer reservation list/detail | `/reservations/me` and `GET /reservations/:id` are customer routes with ownership checks. Backend model has `accessPinCode`, and these handlers serialize reservation documents without an explicit field projection/redaction in the inspected code. This appears to expose the stored PIN incidentally, not through a documented credential API. |
| Managed V3 access | Customer visit/session routes exist; access is staff-verified and session-based. They are not a shared storage PIN retrieval path. |
| PIN type / expiry | Self Storage handover PIN is simulated; inspected reservation model has the PIN field but no PIN expiry field. |
| Mobile integration | **Not added.** Reading the incidental reservation field could reveal a PIN for an ineligible or expired rental; there is no dedicated response that proves eligibility, expiry, or revocation. |

Recommended Backend follow-up: redact `accessPinCode` from ordinary reservation list/detail payloads and add an authenticated customer-scoped read endpoint that confirms ownership, Self Storage service, completed handover, signed/valid contract, active date window, non-overdue state, provisioned credential, and expiry/revocation. Return an explicit `simulated` marker and `expiresAt`. No Backend edits were made.

## E. Files changed in this task

- `src/screens/LiveAccount.tsx` — live Home header, rental summary metrics, notification badge, and recent rental section.
- `src/screens/LiveRental.tsx` — shared Self Storage/Managed Inventory rental card layout and status/expiry presentation.
- `src/api/contracts/customer.ts` — types the existing list fields `estimatedRent` and populated unit `volumeM3` for validated display.
- `tests/customer-home-parity.test.tsx` — card parity, available Self Storage fields, Managed Inventory capacity restraint, Home overview/badge/navigation, and no PIN action.
- `HOME_REDESIGN_RENTAL_PARITY_PIN_AUDIT_REPORT.md` — this report.

No Backend, Customer Web, Staff/Manager/Admin/BOM frontend, `.env`, dependencies, or data were changed.

## F. Verification

- `npm run typecheck` — PASS.
- `npm test -- --runInBand` — PASS, 50 suites and 781 tests.
- `npm run export:native` — first attempt encountered a Metro resolution error for an existing source module while using stale cache. The file was present; no source correction was needed. `npm run export:native -- --clear` then passed for Android and iOS (about 4.9 MB and 4.7 MB bundles).
- ESLint / `npm run build` — NOT RUN; no corresponding script is defined in this package.
- Expo Web/device runtime walkthrough — NOT RUN. Bundle export is not runtime UI evidence.
- No PIN retrieval or unlock endpoint was called.

## G. Manual QA checklist

1. Sign in as a customer with Self Storage and Managed Inventory reservations; verify Home counts and newest three cards against `/reservations/me`.
2. Pull to refresh and confirm cards and unread badge update without duplicate requests.
3. Verify unread badge navigation opens notifications; “Xem tất cả” opens the existing rentals tab.
4. Check a Self Storage rental with populated unit code/size/volume and a rental with missing optional unit fields; no dimensions/area should be invented.
5. Check a Managed Inventory rental with allocated cell IDs and redacted capacity; confirm only the count is shown, with no capacity/utilization inference.
6. Check ACTIVE, expiring-within-30-days, pending, overdue, closed, and cancelled status presentation.
7. Test narrow and larger Android/iOS layouts for wrapped reservation codes, status badges, buttons, and tab-bar clearance.
8. Confirm rental detail navigation remains correct for both service types.
9. Do not test/show a PIN in Mobile until Backend provides a customer-scoped, eligibility-checked read endpoint.

## H. Remaining issues

- Safe PIN display awaits the Backend endpoint and redaction contract above.
- Home-list response lacks Self Storage dimensions (therefore area is also unavailable) and Managed cell labels. The current Home avoids per-rental detail calls; a future batch/read-model endpoint would enable these without N+1 requests.
- Customer reservation endpoints appear to serialize the model’s stored `accessPinCode` incidentally. Backend should redact this sensitive field even though Mobile does not render or intentionally request it.
- Runtime UI and responsive screenshots remain to be reviewed on device/simulator.
