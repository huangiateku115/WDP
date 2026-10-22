# Customer Rental & Warehouse Map UI Simplification

## Source files modified
1. src/components/customer/RentalBookingIntegration.jsx — remove service tab import/render; Self Storage heading; existing managed query entry redirects to existing Map or facility selection (valid facility ID retained). Existing Self Storage data/select/draft/API functions unchanged.
2. src/layouts/CustomerWarehouseLayout.jsx — remove white header/branding/back-to-Portal markup, retain themed Outlet.
3. src/components/customer/warehouse/DigitalWarehouseDashboard.jsx — remove visible Fullscreen button, eyebrow/description/breadcrumbs/last-updated/long overview. Keep main heading, facility once, errors, Refresh/back. Move concise UTC interval/physical occupancy explanation inside existing rental panel.
4. src/layouts/customer-warehouse.css — remove 60px height allowance, move booking overlay to 12px top and use recovered space for map. No global scaling or geometry changes.

Added fixture runners: .design-reference/check-simplified-map.cjs and check-self-storage-entry.cjs; this report and responsive screenshots. Generated dist is build output, not intended for commit.

## Navigation and Managed entry
/portal/rent opens Self Storage directly, preserving all four steps and existing draft. No segmented tabs. /portal/rent?service=managed redirects with replace to /portal/warehouse-map; valid facility query goes to /portal/warehouse-map/:facilityId. Public Facility actions already lead to the Map. Normal /portal/warehouse-map keeps CustomerLayout and nine navigation links. Actual Map/Rack keep dedicated layout with no white header/nav. Rack Back to Warehouse Map remains; main Map Back to Facility Selection restores normal Customer navigation.

Managed Cell selection, basket, UTC term/date validation, quote, customer confirmation and reservation creation already exist in ManagedCellBooking and remain intact. Existing reservation/contracts/inventory routes are untouched. Legacy ManagedReservationBooking and APIs/helpers are preserved but no longer rendered from Rent; no new workflow invented. No missing Cell-booking step was identified in the existing Map UI. Non-Cell legacy entry UI is intentionally no longer exposed by Rent.

Fullscreen inspection: toggleFullscreen has only its local former button caller; visible action removed. Dormant local helper/listeners/portal-target compatibility retained to avoid unrelated interaction cleanup. No new fullscreen action exposed.

## Verification
- Syntax 219 JS/JSX files PASS; production build PASS with existing >500 kB bundle warning.
- npm test 6/6 PASS; Self Storage contract helper checks PASS.
- Full Self Storage completion fixtures PASS (224 intercepted requests): unit/facility checks, UTC month clamp, estimate/payload, verified submit/double-click, cancel, contract/sign/payment/access, ownership/auth, changed price/unit, conflict/uncertain results. No live mutations.
- New Self Storage entry fixture PASS at 320/390/768/1024/1440/1920, no service tabs, 4 steps, no overflow.
- Simplified Map navigation fixtures PASS at all six widths: normal selection navigation, actual Map starts at viewport top with no white header/Fullscreen/breadcrumbs, full viewport width, no duplicated headers/overflow, Back/Forward/refresh, Rack deep link and old Managed URL redirects. 75 intercepted GETs, zero live requests.
- Cell filtering regression PASS: 5 badges, search/toggle/clear, selected state, unchanged grid/eligibility and six widths, GET fixtures only.
- Map regression PASS with removed Fullscreen tests adapted to assert button absent: cache/lazy details, sorted Cells, tooltip/focus/Escape, selection, zoom/reset/pan, search, retry/refresh/error/stale/facility, mobile drawer/auth invalidation. Prior fixture UNKNOWN label/zone scroll compatibility retained.
- Older check-rental-period.cjs stops at obsolete exact review-text assertion for '3 MONTH' (line 19); no production logic changed to satisfy it. Full Self Storage completion suite above passes. Initial navigation run timed out waiting for load during compilation; rerun PASS.

## Screenshots
.design-reference/simplified-rent-{320,390,768,1024,1440,1920}.png
.design-reference/simplified-facility-{320,390,768,1024,1440,1920}.png
.design-reference/simplified-map-{320,390,768,1024,1440,1920}.png

## Scope / limits
Customer frontend only. No API/payload/auth/business rule changes; no BE-REF or forbidden backend access. No Staff/Manager/Admin/BOM/Public edits. Tests use intercepted fixtures, not live authenticated E2E. Backend data was never written. No new reservation flow added.
