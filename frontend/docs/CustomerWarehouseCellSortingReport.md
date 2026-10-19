# Customer Warehouse Map — Cell status sorting

## Supported statuses
Existing `cellPeriodStatus` is reused unchanged: AVAILABLE, RESERVED, OCCUPIED, UNAVAILABLE, UNKNOWN. The shared badge also styles BLOCKED and MAINTENANCE, but these operational states are not introduced as period-status outcomes. Raw `displayStatus` describes current time and does not override the existing interval-aware presentation.

## Modified source files
- src/components/customer/warehouse/CellInformation.jsx: import/render separate logical listing above unchanged physical levels/grid.
- src/components/customer/warehouse/warehouse-dashboard.css: Customer-scoped compact list, wrapping controls, focus and selected styles.
- src/components/customer/warehouse/CellStatusList.jsx (new): collapsible logical listing, labelled native sort/order controls, inspect actions reusing existing onSelect.
- src/components/customer/warehouse/cellListingSort.js (new): copied logical rows, physical ordering by level descending/Cell ascending; alphabetic status ascending/descending with stable physical secondary order.

No API, route, auth, booking helper or map geometry files changed. No Backend directory accessed or modified.

## Behavior
Default preserves original physical order. Display Status groups by existing displayed period-status labels A–Z or Z–A. Ties preserve physical order in both directions. Search uses the same rack/zone/aisle/Cell-code matching as the physical grid. Empty results have a clear message. Selecting a list row inspects the existing Cell; booking remains exclusively through existing controls/rules. No Availability First option added (optional requirement).

## Verification
- Syntax: 221 JS/JSX files PASS.
- Production build PASS, existing chunk >500 kB warning remains.
- npm test 6/6 PASS; managed warehouse booking tests 3/3 PASS.
- New browser fixtures PASS: default, ascending, descending, stable RESERVED ties, selected Cell retention, search/empty results, unchanged grid Cell offsets/order, responsive document overflow at 320/390/768/1024/1440/1920. Three intercepted GETs, no live API calls/writes.
- Existing Cell status fixtures: 14 cases PASS; UNKNOWN/unavailable/reserved remain fail-closed and booking selection remains working.
- Existing Digital Warehouse regression PASS: lazy loading/cache, tooltip, focus/Escape, selection, zoom/reset/fullscreen, search, refresh/retry/error preservation, stale/facility checks and mobile drawer. Existing fixture compatibility adjustments: UNKNOWN label and width-dependent zone scroll assertion as in dedicated-map validation.
- Browser test harness: .design-reference/check-cell-sorting.cjs. Screenshot set: .design-reference/cell-sort-{320,390,768,1024,1440,1920}.png.

## Limitations
Fixture validation only; no live Backend E2E claim. Listing covers returned Cells in the currently loaded Rack, not unloaded facility-wide Cells. Sort state is local to the existing Rack component lifecycle. Physical grid positions, status derivation and booking eligibility code are unchanged.
