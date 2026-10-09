# Facility Manager Priority 2

Implemented as an isolated Facility Manager workspace. Existing Public, Customer, API, authentication and configuration files are preserved; the only existing source change is the additive `/manager/*` entry in AppRoutes.jsx. No packages were added or replaced.

## Files created

Production source files (16):

- `src/mocks/managerData.js` — assigned facility, demo UI permissions, operational seed records.
- `src/lib/managerDemoStore.js` — scoped demo adapter, persistence, calculations and action guards.
- `src/components/manager/ManagerUI.jsx` — reusable shadcn-based panels/buttons/inputs/badges, filters, tables, native modal dialogs, timelines, progress indicators and decision forms.
- `src/layouts/ManagerLayout.jsx` — Manager topbar and desktop sidebar, mobile horizontal navigation.
- `src/layouts/manager.css` — Manager-only responsive green/orange presentation.
- `src/routes/ManagerRoutes.jsx` — isolated Manager route subtree.
- `src/pages/manager/DashboardPage.jsx`
- `src/pages/manager/ReservationsPage.jsx`
- `src/pages/manager/CustomersPage.jsx`
- `src/pages/manager/StorageUnitsPage.jsx`
- `src/pages/manager/StorageLocationsPage.jsx`
- `src/pages/manager/OperationsPage.jsx`
- `src/pages/manager/ExtensionsPage.jsx`
- `src/pages/manager/ServiceDeskPage.jsx`
- `src/pages/manager/FinancePage.jsx`
- `src/pages/manager/ReportsPage.jsx`

Documentation: `docs/ManagerPriority2.md`.

Validation artifacts: `.design-reference/check-priority2.cjs`, `.design-reference/check-p2-interactions.cjs`, `.design-reference/check-p2-live-and-guards.cjs`, and `p2-*.png` screenshots. Implementation helper scripts are also retained in `.design-reference/`.

## Files modified

- `src/routes/AppRoutes.jsx` — adds a lazy-loaded `/manager/*` route and its loading fallback. All pre-existing route paths and elements are retained. The Manager subtree uses the existing React Router architecture.

## Routes and requirement mapping

`/manager` redirects to `/manager/dashboard`.

| Requirement | Routes | Implemented UI |
|---|---|---|
| P046 | `/manager/dashboard` | Eight facility KPIs, today’s operations, recent reservations, approval counts, alerts and capacity indicators |
| P013 / P014 | `/manager/reservations`, `/manager/reservations/:id` | Status/service/move-in filters; customer, facility, dates; exact selected private unit or requested managed capacity; availability; approve/reject dialog with required rejection reason; timeline |
| P010 / P011 | `/manager/customers`, `/manager/customers/:id` | Searchable facility customers; profile and verification review; active rentals/history, payment summary and support history |
| P008 | `/manager/storage-units`, `/manager/storage-units/:id` | Small/Medium/Large private units, statuses, facility, pricing references, current rental and maintenance; create/edit dialogs with protected occupied/reserved unit states |
| P077 | `/manager/storage-locations`, `/manager/storage-locations/zones/:id`, `/manager/storage-locations/racks/:id`, `/manager/storage-locations/shelves/:id` | Facility → Zone → Rack → Shelf navigation; usable dimensions; max/used/remaining volume; max/used weight; status, current items and progress indicators. No Bin hierarchy |
| P045 | `/manager/operations` | Board for check-in, checkout, inspection, handover, support, maintenance, inbound, relocation and outbound; date/type/status/staff filters |
| P044 | `/manager/tasks` | Unassigned tasks, facility staff workload, qualification-aware assignment/reassignment and closed-task guards |
| P029 | `/manager/extensions` | Self-Storage time, Managed Inventory time and capacity upgrade requests; rental/change, availability, charge formula, approve/reject and timeline |
| P025 / P026 / P030 / P039 | `/manager/operations/:id` | Typed manager-accessible operational detail: exact private unit with inspection/handover checklist; managed rental with allocated capacity and staff handling checklist. Managed check-in uses capacity activation, with no private unit handover or customer location credentials |
| P031 | `/manager/maintenance`, `/manager/maintenance/:id` | Unit/Zone/Rack/Shelf target filters; issue, resource, priority, staff, notes, status and timeline |
| P038 | `/manager/support`, `/manager/support/:id` | Rental, Unit Access, Payment, Inventory Item, Storage Location, Other categories; assignment, local conversation, response, resolution notes, status and timeline |
| P043 | `/manager/refunds`, `/manager/refunds/:id` | Original payment, reason, unused-day policy, calculated refund, permission-aware review and approval timeline |
| P064 | `/manager/charges` | Customer/rental charge ledger, amount, reason, calculation/policy and payment state |
| P047 | `/manager/reports/revenue` | Period/payment-status filters, collected rental revenue, outstanding invoices, collected extra charges, method breakdown and payment ledger |
| P048 | `/manager/reports/utilization` | Current occupancy by Small/Medium/Large; physical and allocated managed capacity; shelf status/volume/weight |
| P049 | `/manager/reports/rentals` | Period/customer/status filters; rental history and lifecycle timelines; customer activity summary |

There are 25 named route templates plus the `/manager` entry. Unknown Manager paths and foreign/missing record IDs show an in-workspace unavailable state.

## Demo and API integration boundary

- The assigned preview facility is `FAC001` (SelfStorage Central Saigon). Every collection is filtered to that facility on load and cross-tab refresh; actions also require a scoped record. Staff selections use only that facility and appropriate qualifications.
- `VITE_USE_MOCK !== 'false'` enables the isolated demo. The localStorage key is `VaultSpace_manager_priority2_demo_v1`; existing Customer booking and Priority 1 stores are not read or modified.
- Approval/rejection, customer verification, unit create/edit, task assignment, extension calculation/approval, maintenance/support updates, refund decisions and checklist records persist locally. They do not perform real approvals, messages, payments, access activation or inventory movement.
- Approved demo extensions update the demo rental period/capacity, preserve the calculated charge, add a local pending charge and append a rental timeline event. Managed pricing is explicitly a demo tariff of 200,000 VND/m³/month; time extensions use the current demo monthly rental rate.
- Reservation availability is a conservative demo check: an available exact private unit without overlapping approved reservations, or sufficient aggregate operational managed capacity after current allocations and approved requests. Production availability and pricing must be calculated by the backend.
- Refunds use the displayed demo unused-day policy, are capped at the original paid amount, and cannot collectively exceed that payment. Approval does not initiate payout or change the original payment status.
- Support/maintenance assignments and status changes synchronize their linked operation tasks. Resolving maintenance does not automatically release a resource; an explicit allowed unit edit follows the repair review.
- Operation completion requires an assigned qualified staff member, notes and every checklist item. Checklists persist on reload. Operational detail pages record demo oversight; they do not implement the Staff role workspace.
- UI permissions in `managerData.js` are preview capabilities, not authentication or security enforcement. Existing authentication is unchanged. A production adapter must obtain authenticated assigned-facility scope and permissions from the backend and enforce them server-side.
- With `VITE_USE_MOCK=false`, saved demo data is ignored, lists are empty and unsupported actions are disabled. No Manager endpoints, request DTOs or API responses have been invented. The domain/action adapter in `managerDemoStore.js` is the future integration seam; an authenticated Manager API is still required.
- Report exports remain visibly disabled while the API is unavailable. No fake downloaded backend reports are generated.
- Existing shadcn/ui components and React Bits FadeContent are reused. Motion is limited to short page headers, with reduced-motion support; functional tables and forms remain independent of animation.

## Validation

- `npm run build`: successful. Manager JS/CSS are lazy-loaded separately. Vite still reports the pre-existing main application chunk above 500 kB; it is a warning, not a build error.
- Route/browser checks: 35 representative URLs at 1440px and 390px (70 route/viewport checks), including private/managed operational detail and support/maintenance task context; no JavaScript errors or document-wide horizontal overflow. Tables and navigation scroll within their containers.
- Interaction checks: reservation approval/rejection and reload persistence; managed reservation without preassigned shelf; verification; unit creation; qualified assignment and required checklist; managed capacity activation UI; capacity and both time extension calculations; repair closure and explicit unit release; local support response/resolution and linked task completion; refund policy decision without payment mutation; report filter/disabled export; shelf progress.
- Guard/live-mode checks: out-of-facility records and staff, unavailable capacity, whitespace rejection reasons, occupied units, open-maintenance availability, incomplete checklist, closed decisions and disabled role permissions. Live mode ignores persisted demo data, disables writes and makes no invented API requests.
- Existing `.design-reference/check-persistence.cjs`: passed Customer selection/date/duration/pricing, confirmation gating, submission, contract persistence, failed-sign recovery, successful confirmation removal and cross-tab synchronization.

Scope ends at Facility Manager UI. No BOM, Admin or Staff role workspace has been implemented.
