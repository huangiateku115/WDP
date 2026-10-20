# Customer Warehouse Map — Drill-down & Search Fix

## Source files modified
- `src/components/customer/warehouse/DigitalWarehouseDashboard.jsx`: explicit floorplan/rack-detail state; existing WarehouseCells moved inside exclusive detail view; zone/rack selection, multi-rack chooser, Back, scroll reset, stale-data presentation guard, saved pan offsets. Existing API/cache/booking functions and payloads retained.
- `src/layouts/customer-warehouse.css`: icon-centered search with scoped padding override; exclusive hidden floorplan; scrollable central Rack area and compact rack chooser.

Added validation runners `.design-reference/check-map-drilldown.cjs` and `check-map-drilldown-regression.cjs`, screenshots and this report.

## Search root cause
Customer compact input rule has multiple :not selectors and overrides previous left padding. Scoped `padding-inline:34px 8px !important` overrides only the map search. Icon remains positioned 10px from left and vertically centered, with pointer-events:none. Original search state/filter matching/focus rules remain.

## View architecture
Initial main URL shows floorplan; existing Rack deep link opens rack-detail. The central panel displays one primary view. Floorplan stays mounted but hidden (display:none), preserving geometry/zoom/pan state; hidden geometry is not measured. Back restores floorplan and saved scroll offsets without changing rack/period/basket or invoking new API requests.
Zone title and sidebar buttons open its Rack view. Single Rack opens immediately. Multiple Racks show a selector from existing zone.aisles.racks; no automatic first-Rack assumption. Empty Zones have explicit message. Sidebar Zone switch works directly from detail; original search behavior clears a search when switching to a Zone absent from filtered results. Mobile sidebar collapses after Zone/Rack choice to expose the content.
Existing detail loader/cache still keys facility/rack/period/token and handles aborts/session changes. Cells/right detail are rendered only when data belongs to the current rack and loading has finished. Switching to a multi/empty Zone clears rack presentation, not booking basket. Back stays outside internal scrolling; selected Rack Cells scroll inside the center panel, not below a second floorplan.

## Verification
- Syntax parse 219 sources PASS.
- Production build PASS. Existing chunk >500 kB warning remains.
- npm test 6/6 PASS; managed warehouse booking tests 3/3 PASS.
- New drill-down browser fixture PASS: floorplan initial, Zone/Rack in-place, multi-Rack chooser, one-Rack auto-open, empty Zone, Back/cache reuse, zoom preserved, direct sidebar switching, delayed old response during rapid switch, no stale Cells, 6 responsive widths, no document overflow, text starts after search icon.
- Existing Cell status fixtures: 14 cases PASS; unavailable/unknown/reserved booking remains fail-closed and available selection works.
- Existing filter fixtures PASS: 5 badges, clear/toggle/search, selected state, unchanged grid ordering/offsets and eligibility, six widths. GET fixtures only.
- Existing map regression adapted for drill-down PASS: Back before Floorplan-only zoom/reset; explicit blur/focus in tooltip test; hidden floorplan Rack clicks in some legacy cache/stale fixtures use programmatic events (new test above covers visible user navigation). On-demand/cache/no duplicate, ordered Cells, hover/focus/Escape/selection, tooltip bounds, search, error/retry/refresh, stale/facility/session invalidation and responsive drawer PASS. Removed Fullscreen UI assertions skipped as authorized previously; no claim of restored fullscreen UI.
- Tests used intercepted fixtures only; no live mutation/API data writes.

## Screenshots
`.design-reference/drilldown-{320,390,768,1024,1440,1920}.png` (central Rack mode)
`.design-reference/drilldown-search-{320,390,768,1024,1440,1920}.png` (sidebar/search)

## Limits
No live authenticated Backend E2E. Existing lazy loading/search covers loaded Rack data, not an invented facility-wide Cell API. Mobile sidebar retains its toggle layout; desktop sidebar remains visible. No API/auth/status derivation/Cell booking/routing changes. No Backend or BE-REF access. No other roles modified. Generated dist remains build output.
