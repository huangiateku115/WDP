# Priority 4 — Business Operations Manager Web UI

## Scope and evidence

Implemented only the BOM requirements in the user's pasted attachment. Read `AGENTS.md`, `docs/BackendApiAudit.md`, the existing Manager layout/dashboard/report components, shared UI, facility model and current pricing/policy examples before editing.

Existing Public, Customer, Manager, Staff and confirmed Auth/Profile code is preserved. No Admin, user/role administration, login-history administration, physical inbound/relocation/outbound, inspection execution or payment processing is added.

BOM business APIs remain unconfirmed. Production BOM code sends no HTTP requests for facilities, pricing, policies, reports or audit. No Axios instance, token change, dependency or configuration change was added.

## 1. Routes

| Route | Purpose |
| --- | --- |
| `/bom`, `/bom/dashboard` | Cross-facility KPIs, comparison, revenue/utilization/rental overview, alerts and recent business activity |
| `/bom/facilities` | Search, status and district/location filters, Manager visibility and both service summaries |
| `/bom/facilities/new` | Create existing facility-model fields |
| `/bom/facilities/:id` | Information/rules, assigned Manager, utilization, current rentals, alerts and activation/deactivation |
| `/bom/facilities/:id/edit` | Edit existing facility-model fields |
| `/bom/oversight` | Facility/service/status/period filters and business drill-down |
| `/bom/pricing`, `/bom/pricing/new`, `/bom/pricing/:id`, `/bom/pricing/:id/edit` | Private Unit size/billing prices and Managed capacity/billing rates, effective periods, statuses, guarded revisions and future quote illustration |
| `/bom/policies`, `/bom/policies/:id`, `/bom/policies/:id/edit` | Seven business policy types, current values, effective date, status, updates and guarded edits |
| `/bom/policies/discounts`, `/bom/policies/discounts/new`, `/bom/policies/discounts/:id`, `/bom/policies/discounts/:id/edit` | Promotional/loyalty/fee-waiver policy, percentage/fixed/undefined values, conditions, dates and status |
| `/bom/policies/item-categories`, `/bom/policies/item-categories/new`, `/bom/policies/item-categories/:id`, `/bom/policies/item-categories/:id/edit` | Managed business category acceptance, restrictions, handling notes, status and activation/deactivation |
| `/bom/reports` | Report navigation |
| `/bom/reports/revenue` | Collected revenue by facility, service and month; payment ledger/status summary |
| `/bom/reports/utilization` | Current Unit-size occupancy and volume-based physical/allocation utilization |
| `/bom/reports/rentals` | Filtered rental/customer lifecycle and payment history |
| `/bom/audit` | Read-only synthetic/local business changes and before/after values; real authorization pending |

Unknown records/routes show a BOM unavailable state. Existing routes are unchanged.

## 2. SRS P-IDs

P006/P007 facility management; P062 cross-facility oversight; P051 pricing; P052 business policies; P060 discount/fee waiver; P078 Managed Inventory category policy; P047 revenue, P048 utilization, P049 rental/customer reports.

P053 is represented by a read-only isolated demo/API-ready audit view. **Real BOM audit authorization is not confirmed and is not claimed to be implemented.** Live mode exposes no audit records. Demo permission applies only to local synthetic BOM data; backend permission enforcement is required before real audit access.

## 3. New production files (9)

- `src/mocks/bomData.js`
- `src/lib/bomDemoStore.js`
- `src/components/bom/BomUI.jsx`
- `src/layouts/BomLayout.jsx`
- `src/layouts/bom.css`
- `src/pages/bom/OverviewPages.jsx`
- `src/pages/bom/BusinessRecordsPage.jsx`
- `src/pages/bom/ReportsPages.jsx`
- `src/routes/BomRoutes.jsx`

New documentation: `docs/BomPriority4.md`. Validation helpers/screenshots are retained under `.design-reference/`.

## 4. Modified existing files

- `src/routes/AppRoutes.jsx`: add a lazy BOM import and `/bom/*` branch only.
- `.design-reference/check-persistence.cjs`: test-only wait for the contract link after navigation before asserting its count; no Customer implementation change.

No existing production file other than AppRoutes was modified for Priority 4. LoginPage, Manager/Staff components/stores, Customer code, API modules, token architecture, package.json and configuration are unchanged.

## 5. Reused components and design

Manager Screen (including React Bits FadeContent), Panel, Card/CardContent, Table, controlled scroll container, Filters pattern, Field/Input/Select/Textarea, Status, Details, Dialog, Message, Meter, Timeline, OpenLink, Button and money formatter.

Existing Manager workspace/sidebar/topbar CSS, KPI and revenue-bar patterns are reused without changing Manager. Existing common Brand, LogoutButton and auth identity helper are reused. Confirmation uses the existing shadcn Checkbox. No reusable standalone shared workspace shell existed; BOM composes the shared pieces and existing layout pattern without refactoring other roles.

Green/orange palette, typography, cards, spacing and responsive navigation remain consistent. Animation is limited to existing page-heading FadeContent; tables/forms are not animated.

## 6. Demo assumptions and state boundary

- Three facilities come from `mockFacilities`, using exactly its `id`, `name`, `district`, `address`, `openingHours`, `status` fields. Assigned Manager/rules/utilization are separate read-only records, not invented backend DTO fields. New facilities have no invented Manager or physical capacity.
- FAC003 is explicitly INACTIVE in the isolated BOM fixture to demonstrate status handling. Its existing rentals remain active. FAC001 Manager name is reused from existing source; other Manager names are explicitly unconfirmed.
- Cross-facility rental/unit/payment/customer fixtures clone static Manager demo source with distinct IDs. Managed allocations/used volumes for the additional facilities are illustrative, not actual backend data or synchronized Manager/Staff state.
- Storage key: `VaultSpace_bom_priority4_demo_v1`. It does not alter any other role's store or auth keys. State persists across reload/tabs and invalid collection structures fall back to the seed.
- SELF_STORAGE uses exact private Units, Small/Medium/Large. MANAGED_INVENTORY uses capacity in m³. No additional service type or Bin is added.
- Operational physical capacity is the sum of ACTIVE shelf volume from the existing catalog snapshot. Allocated capacity and used capacity are calculated from current ACTIVE/OVERDUE Managed rentals. Reports show physical capacity minus allocation, allocation minus use, used/physical and used/allocated with explicit labels; no occupied-shelf counts.
- Unit occupancy denominator includes maintenance units and available units, matching the current Manager report convention. Utilization is a current stock snapshot, not a historical time-series report. Period filters apply to revenue transaction dates and overlapping rental periods, not current stock.
- Collected revenue counts PAID ledger entries only; pending/failed totals are separate. Extra charges/refunds are not fabricated as additional revenue entries.
- Existing demo rates are reused: Unit prices from Manager, Managed 200,000 VND/m³/month from existing Manager extension pricing, commitment 5% for three months from booking.js. Deposit, refund and overdue illustrations reuse existing booking/Manager formulas. Other policy values, loyalty and fee waiver remain explicit undefined drafts until a user enters a demo rule. No default numeric business rules are invented.
- Item category names reuse `inventoryCategories`; acceptance/handling/restriction states are explicit business drafts. No Zone/Rack/Shelf assignment or credential fields exist on these pages.
- Audit is local demonstration data with demo permissions; this is not a backend security/audit log. Business writes preserve contractSnapshots, payments and existing rentals. Revisions capture immutable before/after copies in the local append-only audit collection.
- The store exposes read/filter/action functions and can later be replaced behind the same UI boundary. Future backend transactions/authorization remain required.

## 7. Business guards

Every write requires enabled demo mode, demo business permission, explicit confirmation and a nonblank change reason. UI uses a duplicate-click guard and review dialog; cancellation saves nothing. Rule edits display prior/proposed values.

Facility: required existing-model fields, unique name, supported ACTIVE/INACTIVE state, valid target and no duplicate status transition. `canReserve` returns false for an inactive/unknown BOM facility. Deactivation preserves existing rentals and explains both effects; separate Customer/Manager demo state is not changed.

Pricing: only two service types; valid Unit size only for Self-Storage; Managed rules remove Unit size; supported billing periods 1/3/6/12; positive finite rates; valid today/future effective dates; end on/after start; known facility or all-facility scope; no overlapping ACTIVE scope/service/size/billing/date rule. Pricing revisions never mutate historic contract/payment/rental snapshots.

Policy: supported seven policy types; required description/rule; effective date/status checks; undefined draft text cannot activate.

Discount: supported policy/value types; nonblank conditions; positive fixed amount or percentage up to 100; undefined value cannot activate; effective periods/status checks; no payment mutation.

Category: required description/handling/restrictions, unique name, supported ALLOWED/PROHIBITED and state values; only business fields are saved, no location assignments.

Reports: invalid date ranges return no transactional records, facility/service/rental/customer filters are applied, denominators are guarded against zero. Audit offers no edit/delete/clear method or UI. Export CSV/XLSX are clearly disabled pending a confirmed export API.

## 8. Backend contracts still required

- Confirmed BOM identity/role value and permission/scope response, including audit authorization.
- Cross-facility facility management/status/rules/Manager visibility, with new-reservation blocking and existing-rental preservation enforced by backend.
- Versioned pricing rules, effective scheduling, conflict validation and immutable contract pricing snapshots.
- Business/discount/fee-waiver/category policy management, effective dates and authorization.
- Cross-facility units, capacity snapshots/time series, rental/customer history and payment ledgers.
- Revenue/utilization/rental report contracts and CSV/XLSX export.
- Authorized business audit with server-generated immutable events.

No URL/method/request body is invented for these missing contracts.

## 9. Role contract

No confirmed BOM role value was found in current project source/docs or the supplied Postman collection. Collection inspection printed only role references, never credentials/tokens. Login redirect remains unchanged for CUSTOMER fallback, FACILITY_MANAGER and FACILITY_STAFF. `/bom/*` is ready as an accessible isolated demo; frontend routing is not backend authorization. No guessed BOM role string was introduced.

## 10. Responsive and BOM validation

- `check-bom.cjs`: 33 routes × 1440px/390px = 66 checks, no document-wide overflow/page errors. Facility create/edit/status, both pricing models, policies/discounts/categories, guarded dialogs, report filters, disabled exports, read-only audit, persistence and no BOM business HTTP requests.
- `check-bom-guards.cjs`: 24 atomic rejection cases; exact independent report aggregates; preserved pricing/payment/rental snapshots, older audit event copies and demo audit permission gate.
- `check-bom-state.cjs`: malformed-state recovery, cross-tab UI status update, reload persistence, cancellable before/after review on mobile.
- `check-bom-live-public.cjs`: live mode ignores persisted demo, displays empty records, blocks writes and emits zero business requests.
- Screenshots: `bom-dashboard-1440.png`, `bom-dashboard-390.png`, `bom-change-dialog-390.png`, `bom-utilization-390.png` under `.design-reference/`.

## 11. Regression

- Public/Auth screens: 14 route/viewport checks at 1440px/390px, no page errors/overflow.
- Customer `check-persistence.cjs`: booking/commitment/date/pricing/consent, reservation, contract signing failure/retry, persistence and cross-tab confirmation passed. A timing assertion was changed to wait for render before counting links; application code is unchanged.
- Manager `check-p2-interactions.cjs`: existing approval, verification, unit management, task qualification/assignment, extension calculations, maintenance/support, refund policy, reports and business guards passed.
- Staff `check-staff.cjs`: 56 route/viewport checks and all operational demo workflows passed; `check-staff-guards.cjs`: 17 business guards passed.
- Auth/Profile `check-confirmed-auth.cjs`: existing real-client contract tests, token keys, profile/password, logout, Manager redirect, 401 cleanup and rejection of unconfirmed requests passed. These use synthetic intercepted responses, not a real backend account.

## 12. Build / limits

`npm run build` passed. The existing main bundle warning above 500 kB remains non-fatal; no unrelated bundle/dependency refactor was made.

No real BOM backend verification is claimed. Scope stops at Priority 4 BOM; Priority 5 Admin is not implemented.

## 13. Live backend alignment (2026-10-19, frontend-only)

- Facility create/edit/status/restore use the confirmed ADMIN/BOM APIs. Facility images are **optional** URL fields (max 10, HTTP(S) only).
- `/bom/audit` is **blocked by design**: BOM audit APIs need a user id, BOM cannot call `GET /users`, and `GET /audit/bom/subjects` does not exist. The page sends no request, asks for no ObjectId and shows the missing contract instead of demo events.
- Contracts are discovered through a facility reservation: one `GET /reservations/facility/:facilityId`, then `GET /contracts/reservation/:reservationId` only for the row the user opens. No `GET /contracts` collection exists, so there is no contract-code search yet.
- Reservation oversight lists SELF_STORAGE reservations from the facility endpoint. Managed reservations cannot be listed because `GET /reservations/managed` does not exist; the page shows that limitation instead of typing an id or fanning out detail calls.
- Facility detail has no "Assigned people" panel: `GET /facilities/:id/assignments` does not exist.
- Movement rows map the full `from/to` location fields; item statuses include the dev lifecycle values.
- Remaining backend gaps: `GET /contracts`, `GET /reservations/managed`, `GET /audit/bom/subjects`, `GET /facilities/:id/assignments`, global audit, CSV/XLSX export, revenue report (payments API), `GET /users/staff`.
- Sections 1-12 remain historical demo/Priority 4 notes. Live routes never fall back to demo data.
