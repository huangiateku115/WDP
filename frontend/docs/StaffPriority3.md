# Priority 3 — Facility Staff Web UI

## Scope and implementation

Implemented from the Staff SRS requirements pasted in the supplied attachment. Read `AGENTS.md` and `docs/BackendApiAudit.md` before editing. Public, Customer and Manager workflows are preserved; no Admin workspace is added.

Staff operations are isolated browser demos. There are no Staff operational endpoints, HTTP calls, additional Axios clients or changes to token storage. Existing confirmed Auth/Profile integration remains in place. Login adds only the `FACILITY_STAFF` redirect to `/staff/dashboard`, using the existing login/profile response and session keys.

## Routes and SRS coverage

All record IDs below are assigned task IDs except refund IDs and item history IDs.

| Routes | Coverage |
| --- | --- |
| `/staff`, `/staff/dashboard` | Assigned tasks today; pending check-ins, checkouts, inbound, outbound, relocation, support and maintenance; priority, due time, facility and status |
| `/staff/tasks`, `/staff/tasks/:id` | Assigned task queue; type/status/priority/date filters; rental/task search; task details, start confirmation and timeline |
| `/staff/check-ins`, `/staff/check-ins/:id` | P025: Self-Storage only; Paid rental + successful payment + exact reserved unit + good inspection + confirmed handover before activation |
| `/staff/handovers`, `/staff/handovers/:id` | P039: private unit handover only; customer acknowledgement and physical checklist; no Managed Inventory handover |
| `/staff/inspections`, `/staff/inspections/:id` | P030: check-in/checkout inspection, four checks, condition, notes, damage observations and confirmation |
| `/staff/checkouts`, `/staff/checkouts/:id` | P026: empty Self-Storage unit, inspection, proposed damage charge and unit release; Managed closure blocked by InStorage or PendingOutbound items |
| `/staff/inventory/inbound`, `/staff/inventory/inbound/:id` | P073: physical receipt, measured/registered dimensions and weight comparison, rental allocation and eligible shelf placement |
| `/staff/inventory/relocation`, `/staff/inventory/relocation/:id` | P074: same-facility eligible destination, current shelf excluded, volume/weight/dimension checks and FROM/TO confirmation |
| `/staff/inventory/outbound`, `/staff/inventory/outbound/:id` | P075: exact current location, identification, customer handover, CheckedOut state and null current_location |
| `/staff/inventory/history`, `/staff/inventory/items/:id/history` | P076: read-only INBOUND/RELOCATION/OUTBOUND records with stable location snapshots, actor, timestamp and note |
| `/staff/support`, `/staff/support/:id` | Assigned support record, demo response and operational status; no reassignment or approval |
| `/staff/maintenance`, `/staff/maintenance/:id` | Assigned resource issue, notes and operational status; resource release remains a Manager operation |
| `/staff/refunds`, `/staff/refunds/:id` | P065: assigned authorized operator, existing Manager approval, original payment, fixed amount, method, reference and confirmation; no approval controls or real transfer |

Unknown, unassigned and unavailable records use the existing unavailable-state pattern. Live mode (`VITE_USE_MOCK=false`) exposes empty operational queues, disables the demo operator selector and rejects operational writes without HTTP requests.

## Files

New production files:
- `src/mocks/staffData.js`: isolated Staff fixtures, demo assignments and static Manager facility catalog reuse.
- `src/lib/staffDemoStore.js`: state/read/action boundary, scoped demo persistence, atomic business guards, capacity recalculation and append-only movement records.
- `src/components/common/OperationalTaskCard.jsx`: reusable operational card built from existing shadcn/Manager components.
- `src/components/common/ItemLocationDisplay.jsx`: reusable location breadcrumb display.
- `src/components/staff/StaffUI.jsx`: Staff notice, checklist, guarded confirmation and task context.
- `src/layouts/StaffLayout.jsx`: operational workspace using existing Manager layout patterns, shared branding, auth identity and logout.
- `src/layouts/staff.css`: Staff-only responsive styles and large actions.
- `src/pages/staff/StaffPages.jsx`: dashboard, queue/details, rental/inventory/desk workflows, history and refund pages.
- `src/routes/StaffRoutes.jsx`: Staff subtree.

Minimal existing-file edits:
- `src/routes/AppRoutes.jsx`: lazy `/staff/*` branch; existing routes preserved.
- `src/pages/auth/LoginPage.jsx`: Staff role redirect only; requests, tokens and submission logic preserved.
- `src/components/manager/ManagerUI.jsx`: optional Screen notice and NotFound return URL with unchanged Manager defaults; additional Staff status badge values.

Reused Manager tables, filters, dialogs, fields, status badges, timelines, capacity meters and panels; reused shadcn Checkbox/Button/Input/Card. Existing React Bits FadeContent animates page headings and respects established reduced-motion styling. No packages or configuration were changed. There was no reusable standalone Manager task-card or location component to duplicate; the added components live under `common`.

## Explicit demo assumptions / integration boundary

- The named demo operator selector tests assigned operational scope; it is separate from authentication and does not represent confirmed backend permissions. Staff-002 has demo refund-processing permission; only a future confirmed backend permission may authorize real processing.
- Demo state uses `VaultSpace_staff_priority3_demo_v1`, separate from Customer/Manager stores and auth token keys. All fixtures belong to FAC001. Staff demo changes do not synchronize Manager records.
- Dimensions are meters and weight is kilograms per item; total volume/weight includes quantity. Fit checks use the listed axes without rotation. Measured values must exactly match registered values; discrepancies block inbound for registration review.
- Both InStorage and PendingOutbound consume capacity until outbound confirmation. Relocation changes shelf occupancy, not rental allocation or total used rental volume.
- Self-Storage checkout damage keeps the released unit under maintenance. Extra charges are proposals awaiting Manager review; no charge approval/payment occurs here.
- Refund processing records a local demo reference only. Manager approval and successful original payment are required, processing cannot repeat, and original payment records are unchanged.
- Movement snapshots have no editing/deletion controls or mutation methods. This is a UI demo invariant, not a backend audit-log security guarantee.
- The store exports the Staff read/action boundary so confirmed backend implementations can replace isolated mock operations later without redesigning forms. Backend authorization, concurrency and transactions must be enforced by those future APIs.

## Validation

- `npm run build`: passed. Existing main bundle warning above 500 kB remains non-fatal.
- `.design-reference/check-staff.cjs`: 56 desktop/mobile route checks; successful inspection → handover → paid activation; blocked unpaid check-in and stored-item checkout; inbound capacity accounting; relocation snapshots; outbound null location followed by managed closure; damage charge proposal; assigned support/maintenance; approved-only refund processing; persistence; zero page errors and operational HTTP requests.
- `.design-reference/check-staff-guards.cjs`: 17 atomic rejection checks covering unpaid/missing inspection, remaining managed items, unassigned/wrong workflow, measurements, unavailable/current/foreign shelves, rental/shelf volume, weight, dimensions, checklist, refund permission/approval/duplicate processing.
- `.design-reference/check-staff-extra.cjs`: 20 additional responsive Support/Maintenance/Refund route checks and cross-tab demo synchronization.
- `.design-reference/check-staff-live-auth.cjs`: live-mode empty state/disabled actions/no demo writes/no requests; Staff redirect through synthetic responses matching the existing confirmed Auth contract and unchanged token keys.
- Existing `.design-reference/check-confirmed-auth.cjs`, `check-persistence.cjs`, `check-p2-interactions.cjs`: passed Customer/Manager/Auth regression checks.

Auth tests intercept confirmed contracts using synthetic credentials/tokens. These do not claim real-backend operational verification. There are no confirmed Staff operational APIs to test.

Screenshots: `.design-reference/staff-dashboard-1440.png`, `staff-dashboard-390.png`, `staff-inbound-desktop.png`, `staff-relocation-desktop.png`.
