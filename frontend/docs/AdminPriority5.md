# Priority 5 — Admin Web UI / confirmed User APIs

## 1. Scope and routes

Read `AGENTS.md`, `docs/BackendApiAudit.md`, `docs/BomPriority4.md` and the supplied Priority 5 attachment before edits. Inspected the current Postman collection without printing/copying credentials or Bearer tokens. Scope ends at Admin; no backend code or existing role redesign was performed.

| Route | Purpose |
| --- | --- |
| `/admin`, `/admin/dashboard` | System dashboard; backend user metrics separately labeled from demo facility/login/audit data |
| `/admin/users` | Real collection, search, returned-role/status filters, refresh/loading/empty/error/retry |
| `/admin/users/new` | Real user creation; confirmed request fields, duplicate-submit guard and password clearing |
| `/admin/users/:id` | Resolve identity from real loaded/cached collection; supported role/deactivation actions |
| `/admin/login-history` | Filterable isolated Login History examples; no backend request |
| `/admin/audit` | Read-only isolated audit examples and filters |
| `/admin/audit/:id` | Read-only fixture detail with before/after values |
| `/admin/facilities` | Read-only independent facility snapshot, existing BOM calculations/comparison table |

Direct user-detail navigation loads the confirmed collection if needed. Missing/unsupported IDs produce a reload/unavailable state. **GET `/users/:id` is not implemented or called.** Unknown routes use the Admin unavailable state.

## 2. SRS coverage

- P050: real Admin User Management list/create/role change/account deactivation and collection-backed detail.
- P061: Login History demo/API-ready UI only; real history API is unavailable.
- P053: read-only Admin audit demo/API-ready UI only; real audit API/authorization remains unavailable.
- Requested Admin dashboard/layout and read-only facility oversight are included. No physical Staff handling, BOM pricing/policy editing, user reactivation or backend audit administration is added.

## 3. New production files (8)

- `src/lib/adminUsers.js`: real collection/action boundary, safe response extraction, memory-only session cache, request deduplication/cancellation and stale-response guards.
- `src/mocks/adminData.js`: clearly isolated login/audit examples and independent static facility snapshot.
- `src/components/admin/AdminUI.jsx`: data-source notice, loading/error/sign-in/retry state and async account confirmation dialog.
- `src/layouts/AdminLayout.jsx`: existing VaultSpace workspace pattern, shared Brand/auth identity/LogoutButton and Admin navigation.
- `src/layouts/admin.css`: Admin-only responsive forms/layout styles.
- `src/pages/admin/UsersPage.jsx`: real list/create/detail and supported account actions.
- `src/pages/admin/SystemPages.jsx`: dashboard, Login History, Audit and read-only facility oversight.
- `src/routes/AdminRoutes.jsx`: isolated lazy-loaded subtree.

New report: `docs/AdminPriority5.md`. Contract inspection/tests and screenshots are retained under `.design-reference/`.

## 4. Existing files modified

- `src/api/userApi.js`: append four confirmed Admin operations; existing Profile/Password methods are unchanged.
- `src/routes/AppRoutes.jsx`: add lazy Admin import and `/admin/*`; existing route branches preserved.
- `src/pages/bom/OverviewPages.jsx`: optional `readOnly=false` comparison-table prop; default BOM detail links remain unchanged, Admin can reuse the table without management/drill-down links.
- `docs/BackendApiAudit.md`: append Priority 5 usage/validation/limits; original audit remains historical context.

No LoginPage/authSession/Axios/interceptor/token-storage/dependency/configuration or existing business-store changes. No unrelated cleanup/refactor.

## 5. Real APIs integrated

All four call the **existing Axios client** and Bearer interceptor. They are always real integrations, independently of `VITE_USE_MOCK`.

| Method | Confirmed endpoint | Request body |
| --- | --- | --- |
| GET | `/api/v1/users` | None |
| POST | `/api/v1/users` | `email`, `password`, `displayName`, `phone`, `role` only |
| PATCH | `/api/v1/users/:id/role` | `role` only |
| DELETE | `/api/v1/users/:id` | None; labeled account deactivation according to Postman |

API methods: `getUsers`, `createUser`, `changeUserRole`, `deactivateUser`. IDs are encoded into relative API paths; no API URLs are embedded in React pages. No second Axios instance, copied token, hardcoded password or guessed endpoint was introduced. Existing central confirmed-request guard already allowed these four methods; no guard bypass was necessary.

## 6. Data/response and security behavior

- Users are never merged with fixtures. Failed real requests show API error/retry or signed-out state, not example accounts.
- The Postman collection has no saved response examples. The extractor supports an array directly under the response body, under `data`, under `data.users`, or under `users`; unsupported shapes fail visibly instead of fabricating data. Actual response DTO/completeness/pagination still require backend validation.
- Only returned string/boolean identity/status fields (`id`, `_id`, `displayName`, `email`, `phone`, `role`, `status`, `isActive`, `active`, `enabled`) are retained. Secrets/arbitrary response fields are excluded. Backend account IDs support `id`/`_id`; missing supported IDs cannot be changed through detail actions.
- Optional phone/role/status columns and filters appear only when corresponding fields are returned. Dashboard counts refer to the returned collection, not an invented global total. Role metrics are unavailable if roles are missing; Active Users is unavailable when a complete recognized active/inactive interpretation is unavailable. Boolean account flags can supply an observed active/inactive display.
- The user cache is in memory only and is scoped to the current existing access token. There is no new user-data/password localStorage/sessionStorage key. Session changes hide old records, cancel stale loads and discard late responses; logout/401 reuse existing auth cleanup.
- Role options default only to the two literal Postman examples: FACILITY_MANAGER and FACILITY_STAFF. Additional role strings are selectable only when observed in the loaded backend collection. Demo role labels never enter API role options. Unknown backend roles are displayed exactly as returned, including business roles if present; no BOM role name is invented.
- Real successful writes request the real collection again. No fake optimistic user/status is substituted. Successful mutation feedback remains distinct from a subsequent refresh failure.
- Create form uses required/basic email/name/phone/password inputs, exact payload fields and a synchronous duplicate-submit guard. Backend remains authoritative for password/phone/role validation. Password is cleared immediately after POST success and after a failed submission; never persisted/logged. Return to directory resets the create-view filter state so the new account can be visible.
- Role change/deactivation require a review dialog and explicit checkbox. Async duplicate click/pending guards and backend error/retry are included. Returned inactive accounts disable repeat deactivation. DELETE semantics beyond the Postman deactivation label are not claimed; no permanent deletion/revocation guarantee or reactivate API is invented.
- Server error text uses the existing bounded textual formatter and React escaping. Backend authorization is authoritative; new frontend role guards are not guessed.

## 7. Demo/API-ready features and reused components

Login History, Audit, Facility Oversight, failed-login/recent-sensitive-action examples and non-user dashboard metrics are isolated fixtures, clearly labeled. Demo audit events are static examples, **not logs of real create/role/deactivation API calls**. No fake security/audit HTTP requests or edit/delete/clear actions exist.

Facility snapshot clones the static BOM seed, not the mutable BOM store. Admin shares the existing BOM comparison table/calculation functions, with `readOnly` removing facility-management links. It cannot activate facilities, edit pricing/policies, assign Staff or execute physical operations. No user fixtures are mixed into real account data.

`VITE_USE_MOCK=false` disables these fixtures but **does not disable/mock Users APIs**.

Reused Manager Screen/FadeContent, Panel, Table/scrolling, Field/Input/Select, Status, Details, Dialog, Message, Button; BOM KPI/filter/read-only-value/comparison components; common Brand/LogoutButton/auth identity; existing shadcn Checkbox and green/orange typography/cards/responsive patterns. No table/form animations or new packages.

## 8. Missing backend contracts

Still unconfirmed: Login History; server Audit/read-only authorization; system/facility oversight and facility metrics; any reactivate operation; user-detail GET; collection pagination/response DTO where necessary. These were not replaced with invented URLs or mocked User operations.

A running backend with an authorized test account is required to verify actual response shapes, role enum, authorization, pagination/completeness and deactivation semantics.

## 9. Role-contract gaps

Current Postman inspection yielded only FACILITY_MANAGER and FACILITY_STAFF as literal role values. No ADMIN/BOM enum was confirmed by current project/backend artifacts. A clarification about the exact Admin role was requested; no unconfirmed string was submitted as a default or added to login redirect.

Login remains unchanged for Customer fallback, FACILITY_MANAGER, FACILITY_STAFF and the unconfirmed BOM case. Admin routes are ready for direct access with the existing session; the backend decides permission. ADMIN/CUSTOMER/business role values already present in actual returned user data can be displayed/selected as observed data, but real Admin authentication/redirect cannot be claimed without the role contract.

## 10. Responsive validation

`check-admin-ui.cjs`: 14 representative routes × 1440px/390px = 28 checks. No document-wide overflow or page errors. Mobile role dialog/forms fit; tables use existing controlled horizontal scrolling. Demo filters/read-only state, absent fields/status, unknown detail, signed-out no-network state and no Admin physical/BOM edit links passed.

Screenshots: `admin-dashboard-1440.png`, `admin-dashboard-390.png`, `admin-create-1440.png`, `admin-create-390.png`, `admin-role-dialog-390.png` under `.design-reference/`.

## 11. API contract / session / regression validation

- `check-admin-api.cjs`: exact GET/POST/PATCH/DELETE paths, Bearer header/body keys, Mongo `_id`/string-ID details from collection, client filters, cache detail navigation without GET-by-id; create failure/success, password clearing, duplicate guards, escaped errors; role/deactivation failure/retry and real list refresh; offline/403/unsupported/empty/401 states and no mock-user fallback.
- `check-admin-session-live.cjs`: cross-tab session switch while old request is pending; previous session records cannot appear; logout clears visible collection. With VITE_USE_MOCK=false, Users still issue confirmed requests and other Admin fixtures are absent.
- Public/Auth responsive regression: 14 route/viewport checks passed via `check-bom-live-public.cjs`; BOM live mode also passed.
- Customer `check-persistence.cjs`: booking/contract/persistence/cross-tab tests passed.
- Manager `check-p2-interactions.cjs`: existing management workflows/guards passed.
- Staff `check-staff.cjs`: 56 route/viewport checks plus workflows passed; `check-staff-guards.cjs`: 17 guards passed.
- BOM `check-bom.cjs`: 66 route/viewport checks plus business actions, reports, immutable snapshots and read-only audit passed. Existing default facility drill-down links preserved.
- Auth/Profile `check-confirmed-auth.cjs`: confirmed contracts, token keys, profile/password, logout, Manager navigation, 401 cleanup and unconfirmed-path rejection passed.

All intercepted responses use synthetic test data in validation helpers only. Production User operations call the real API.

Backend probe without credentials: localhost:5000 could not connect. **No real authenticated end-to-end backend verification, real user creation, role change or account deactivation was performed.**

## 12. Build

`npm run build`: passed after final changes. Existing main bundle warning above 500 kB remains non-fatal. No unrelated dependency/bundle refactor was performed.

Priority 5 ends here. Existing Customer/Manager/Staff/BOM features are preserved.
