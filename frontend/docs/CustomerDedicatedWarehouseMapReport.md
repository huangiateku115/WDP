# Dedicated Customer Warehouse Map — validation

## Changes
- `src/layouts/CustomerWarehouseLayout.jsx` (new): standalone Customer workspace with compact brand/back header and Outlet; no Portal tabs, standard breadcrumbs or animation container.
- `src/layouts/customer-warehouse.css` (new): scoped full-width workspace, responsive canvas, scrollable details and collapsible booking panel. Facility selector also fills the workspace.
- `src/routes/AppRoutes.jsx`: move only the three existing warehouse URLs under the new layout, retaining CustomerGate and identical URLs/components.
- `src/components/customer/warehouse/DigitalWarehouseDashboard.jsx`: wrap existing CellBookingPanel in native keyboard-accessible details. No booking hooks, state, API calls or payloads changed.

## Verification
- Syntax parse: 219 JS/JSX source files PASS.
- Production build PASS; existing >500 kB bundle warning remains.
- npm test: 6/6 PASS. Managed warehouse booking tests: 3/3 PASS.
- Dedicated map fixtures: PASS at 320, 390, 768, 1024, 1440, 1920 px; full-width canvas, no Portal navigation, no document overflow, booking panel within viewport. Item/register/contract layout smoke checks also PASS. 38 fixture GETs; zero live Backend requests/writes.
- Cell status/eligibility regression: 14 cases PASS, including RESERVED/YOURS and disabled selection; responsive checks PASS.
- Digital dashboard regression: PASS lazy detail/cache, tooltip/focus/Escape, selection, zoom/reset/fullscreen, search, failed detail/retry/refresh, stale selection/facility checks, mobile drawer/pan/auth invalidation. Adapted the obsolete scrollTop>0 assertion to visible map because full-width geometry differs, and old fixture status label to UNKNOWN. This does not claim fixed-offset zone scrolling validation.
- Source hashes compared with pre-task baseline: only the two existing source files above changed; two layout files added. API/auth/lib/Public/Staff/Manager/Admin/BOM source unchanged. Neither BE-REF nor backend was accessed.

## Screenshots
Before/after files for all six widths: `.design-reference/dedicated-map-{before|after}-warehouse-{width}.png`.
Open booking panels: `.design-reference/dedicated-map-panel-{width}.png`.
These use fixtures, not authenticated live E2E data. Map-related breadcrumbs are retained inside the map for facility/rack navigation; standard Portal breadcrumbs are absent.

## Limits
No live Backend E2E performed. Browser checks used Edge headless with reduced motion and intercepted fixtures. Existing map animations and APIs remain unchanged. Build output is generated under dist and is not intended for commit.
