# MI-01 Customer Warehouse Map integration

Implemented 2026-10-12. Frontend integration and fixture validation are complete. **Authenticated real Backend overview/detail acceptance remains unverified:** the supplied acceptance collection has empty facilityId/customerToken/adminToken variables, and no Customer test credentials were supplied. No Backend code or data was modified.

## A. Implementation summary

Added the read-only Customer warehouse overview and Rack Detail to the existing portal. Zone sections retain aisle grouping while rack cards share a coordinate plane within each Zone, so racks in different aisles retain their relative positions. Available, Blocked and Maintenance operational states remain separate from utilization. Capacities are displayed directly from response values, without estimates or occupancy percentages.

Levels are rendered descending by levelNumber and Cells ascending by cellNumber. Only returned records are rendered, including empty zones/levels. Cells have no booking links or actions. The existing Customer layout, navigation, authentication, animations and Self Storage booking entry remain in use.

## B. Files changed

Modified:

- `src/components/customer/PublicFacilityCatalog.jsx`: add View Warehouse Map only when the existing public detail's serviceTypes array contains MANAGED_INVENTORY; preserve Choose a storage unit and all original content/loaders.
- `src/routes/AppRoutes.jsx`: add two nested Customer routes; no existing route paths, guards or other-role workspaces changed.
- `src/api/confirmedContract.js`: allow only GET warehouse-map and GET racks/{24-hex-ID}/detail-map, confirmed by the supplied collection and local Backend routes. Existing client/interceptors/token handling remain unchanged.

Created:

- `src/api/warehouseMapApi.js`: two abortable, authenticated GET operations through the existing axiosClient; explicit unavailable message for Backend 409.
- `src/lib/warehouseMap.js`: response/context validation, sparse grid axes and weight/dimension formatting.
- `src/pages/customer/WarehouseMapPage.jsx`: overview and Rack Detail, shared shadcn Card/Button/Badge, existing CustomerScreen/Details/useBackend/loading/error utilities.
- `.design-reference/check-warehouse-map.cjs`: isolated fixture browser validation; fixtures are test-only and never imported by production pages/services.
- `.design-reference/mi01-map-desktop.png`: fixture desktop visual verification.
- `.design-reference/mi01-rack-mobile.png`: fixture mobile visual verification.
- `docs/CustomerWarehouseMapIntegration.md`: this report.

No dependencies, package scripts, environment variables, API client architecture, Backend, or non-Customer frontend files were changed by this task.

## C. API integration and contracts

Sources: supplied `WDP_MI01_Postman_Acceptance.postman_collection.json` and acceptance guide, plus current Backend warehouse-map routes/controller/service and validation. The guide's setup/negative-validation write instructions were treated as reference material, not authorization to create or modify database records.

| Operation | Method and endpoint | Response used |
| --- | --- | --- |
| Overview | GET `/api/v1/warehouse-map?facilityId={facilityId}` | `{success:true,data:{facilityId,zones:[{_id,code,name,aisles:[{aisleCode,racks:[]}]}]}}` |
| Rack detail | GET `/api/v1/racks/{rackId}/detail-map` | `{success:true,data:{rack,capacity,levels}}` |
| Facility name/context | Existing public GET `/api/v1/public/facilities/{facilityId}` | Existing public facility record; no management endpoint |

Overview rack capacity comes from utilization.ratedCapacityKg and utilization.allocatableCapacityKg; availableCellCount is shown only when returned. Detail capacity comes from capacity and cell maxWeightKg/dimensions directly. No fallback default level/cell counts, fabricated records or mock production responses are used, including when VITE_USE_MOCK is enabled.

Existing axiosClient attaches the current Bearer token to the two warehouse requests. Existing useBackend cancels requests and prevents obsolete Facility/Rack/session responses from appearing. The existing interceptor clears a current expired session on 401; CustomerGate then uses the existing login route. 403/404/network/server errors show the shared error and Retry UI; 409 gives an unavailable facility/zone/service message. Invalid URL IDs are rejected before API requests. Rack identity and facility ownership in the returned sanitized DTO must match the URL context before details render.

## D. UI navigation and coordinate interpretation

The existing Facility Detail route is `/facilities/:facilityId`; there is no separate Customer-only Facility Detail route. The added action on that existing shared Customer-facing detail opens `/portal/warehouse-map/:facilityId`. Rack links open `/portal/warehouse-map/:facilityId/racks/:rackId`. Both routes are children of the existing guarded Customer layout, support direct navigation/refresh, and provide explicit back links retaining facilityId.

X increases rightward and Y downward. Array order never determines physical position. Each Zone uses a shared CSS grid across its aisles, translated by its smallest returned coordinates. Non-zero coordinates remain printed on cards. Ordinary sparse gaps are retained. Empty gaps greater than eight grid positions are condensed to eight with an explicit notice, preserving order and exact labels while avoiding 100,000-track layouts allowed by Backend validation. This is a structural coordinate diagram, not a meter-scale floorplan.

The rack symbol and arrow rotate through 0/90/180/270 degrees; text stays upright for readability. The map region scrolls horizontally without expanding the page; rack links and scroll regions are keyboard-focusable. Rack cells use responsive columns without clipping, status text in addition to color, and no interactive booking affordance. Nominal rack height is explicitly distinguished from usable cell clearance; absent usableHeightM is not inferred.

## E. Validation results

| Check | Result |
| --- | --- |
| `npm run build` | PASS; pre-existing main-chunk >500 kB warning remains |
| Lint/package test script | Not configured in package.json; no script or dependency added |
| `.design-reference/check-warehouse-map.cjs` | PASS using isolated Backend fixtures |
| `.design-reference/check-profile-avatar.cjs` | PASS, existing profile/contact/password/identity/avatar tests with fixtures |
| `.design-reference/check-rental-period.cjs` | PASS, existing pricing-term/date/resolver/review tests with fixtures; no reservation POST |
| Live GET `/api/v1/health` | HTTP 200, database connected |
| Live GET public facility list | HTTP 200; five returned facilities, three supporting Managed Inventory |
| Live browser Facility Detail at 127.0.0.1:5173 | PASS for all five real facilities: conditional map button, correct IDs, existing Self Storage booking links preserved |
| Live overview and rack detail without token | Both HTTP 401; no bypass attempted |
| Real authenticated Customer map/detail | NOT RUN: no usable Customer token/credentials/facilityId supplied in collection |

The warehouse browser suite checks login/catalog/detail regression, managed versus self-storage-only entry, correct Bearer/query/ID, three Zones and multiple aisles, non-zero/sparse coordinates independent of array order, all orientations, dynamic sorted levels/cells, direct capacities/Blocked/Maintenance/baseline labels, keyboard selection, refresh/back navigation, empty overview/zones/detail, malformed response, missing Rack, invalid IDs, 403/404/409/500/network/retry/401, cross-facility response rejection, stale facility requests, large coordinate gaps, and 1440/1024/768/390/320 widths without page overflow or JavaScript errors. Feature requests are asserted GET-only and no management endpoints are called. Desktop/mobile screenshots were visually reviewed.

These fixture tests establish Frontend behavior, not real database dataset or authenticated E2E acceptance. No Postman Setup, Negative Validation, management list/create/update, inventory, Cell reservation or payment operation was executed.

## F. Backend dependencies

Both required read APIs exist in current Backend source and the acceptance collection. No missing endpoint/DTO was invented. To finish real Customer E2E acceptance, supply a test Customer session and an existing eligible facility/layout in the approved development database; run only overview/detail reads. The supplied collection can be used by the Backend team to prepare data under its separate development/database authorization process. This task did not initialize indexes, create demo records, or modify database configuration.

## G. Remaining limitations

MI-01 is read-only structure, not inventory tracking or Self Storage booking. MI_01_EMPTY and usedWeightKg=0 are a technical baseline, not a statement that the physical warehouse is empty. No actual stock, physical occupancy, real weight aggregation, Cell reservation, checkout or payment was implemented. Very large empty coordinate spans are deliberately condensed and labeled; precise coordinates remain visible on each rack.
