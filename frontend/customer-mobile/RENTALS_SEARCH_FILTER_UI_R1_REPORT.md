# Customer Mobile Rentals Search and Filter R1

**TASK_ID:** `WDP_CUSTOMER_MOBILE_RENTALS_SEARCH_FILTER_UI_R1`  
**STATE:** PARTIAL (implementation and automated validation complete; physical-device QA remains)

## A. Screen and API audit

- Tab route: `app/(tabs)/rentals.tsx` re-exports `Rentals` from `src/screens/LiveRental.tsx`.
- The live list uses `mobileRepo.rentals(owner)` → `GET /reservations/me` → `mapReservations`. The mapper verifies every reservation belongs to the authenticated customer.
- Backend `ReservationController.getMyReservations` queries `{ customerId: req.user._id }`, populates facility `name/address` and storage unit `unitCode/size/volumeM3`, sorts by `createdAt` descending, and returns the full array in `{ success: true, data }`. There is no pagination in this endpoint, so client-side search/filter/sort sees the complete returned customer list.
- The same `RentalCard` is used by Home through `LiveAccount.tsx`; it defaults to compact presentation. The rentals list passes the detailed variant. Signing notice and expiry notice remain in the shared component.
- Supported Backend reservation statuses are `RESERVED`, `CONTRACTED`, `DEPOSIT_PAID`, `CHECKIN_READY`, `PAID`, `ACTIVE`, `OVERDUE`, `CHECKED_OUT`, `CLOSED`, and `CANCELLED`. Their meanings depend on service and managed booking flow; the filter uses the existing lifecycle mapping and limits ambiguous legacy statuses instead of assuming they mean the same thing.
- Git branch/status could not be read: this workspace's git redirect points to a missing `C:\Users\laptop\Desktop\WDP` directory. No Git metadata or existing changes were reset/discarded.

## B. Search

Added immediate client-side search below the page heading. It trims whitespace, ignores case and Vietnamese diacritics, and matches reservation code, populated facility name, and populated customer-facing storage unit code. It has an explicit clear control. No sensitive/internal fields are searched, and no API requests are made per keystroke.

## C. Filters

- Immediate service chips: All, Self Storage, Managed Inventory.
- Advanced modal bottom sheet with multi-select status groups, data-derived facility IDs/names, rental end-date conditions, and sorting controls.
- Advanced selections are held as a draft and only change applied filters on Apply; Reset affects the draft; closing without Apply leaves active advanced filters unchanged.
- Facility options come from current reservation data; duplicate facilities are deduplicated by ID.
- Time filters use `endDate`, never `signingDeadline`. “Ending in 30 days” requires `ACTIVE` and an end date in the next 30 days. Expired term uses `endDate` only.
- “Newest/Oldest” sort by `createdAt`; end-date sorts use `endDate`. Missing `createdAt` values sort after known dates.
- Search, service, advanced filters, and sort compose over the same full loaded list. Pull-to-refresh keeps screen-local search and filter state. Returning from Rental Detail preserves tab state.

## D. Rental card and screen states

Rental list uses the detailed card variant with status on a separate line and clearer unit/facility information. Home retains its compact card arrangement. Existing signing deadline/countdown and expiry notices are preserved. Empty account state offers Explore; no-results state offers Clear filters. Existing loading and API error/retry remain distinct through `ResourceState`.

## E. Files changed

- `src/domain/rentalList.ts` — search normalization, status/time filtering, facility helpers, sorting.
- `src/screens/LiveRental.tsx` — search/filter UI, bottom sheet, results, card variant.
- `tests/rental-list.test.ts` — domain search/filter/sort coverage.
- `tests/rentals-screen-search-filter.test.tsx` — search, clear, and service chip screen coverage.
- This report.

No API, Backend, route, payment, contract, notification, or PIN code was changed.

## F. Automated verification

- `npm run typecheck`: PASS.
- Full Jest: PASS, 55 suites and 807 tests.
- Focused rental filter tests: PASS, 2 suites and 6 tests.
- Expo export for Android and iOS: PASS; both bundles generated successfully.
- Expo output was written to `artifacts/rentals-search-filter-r1-export` for validation.

## G. Manual QA and remaining limits

No Android/iOS device or emulator interaction was available in this run. Verify on small and large phone layouts: keyboard/search visibility, bottom-sheet scrolling and Apply/Reset/close behavior, multiple facilities/statuses, 1/5/20+ rows, rental detail back navigation, pull-to-refresh, and Home card parity. In particular, confirm Vietnamese filter labels and dynamic Facility names with real account data. The result remains PARTIAL until this device QA is completed.
