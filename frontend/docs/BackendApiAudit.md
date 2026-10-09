# Priority 1 + Priority 2 backend API audit

## Contract and scope

Source: `C:/Users/laptop/Downloads/WDP.postman_collection.json`, supplied by the backend team, plus the login token response nesting explicitly confirmed in the task. Request methods and JSON body keys were inspected without copying collection credentials or Bearer tokens.

Backend: `http://localhost:5000`; base API: `http://localhost:5000/api/v1`.

Only authentication, customer registration and current-user profile/password features are integrated. Existing Customer/Manager screens, routes, business demos, green/orange theme and components are preserved. No Priority 3 Staff or Admin workspace was created.

## Audit findings and changes

| Area | Before | After |
|---|---|---|
| Login/Register | UI buttons navigated without calling an API | Existing forms call the confirmed login/register APIs, with pending/success/error handling and duplicate-submit guards |
| Auth API | Mock login tokens; old `/auth/register` and `/auth/me` paths | Auth/profile always use the confirmed real API, independently of business-demo mode |
| Login response | Old adapter expected `data.token` | Access/refresh tokens read strictly from `response.data.data.accessToken` and `.refreshToken`; malformed responses do not create a session |
| Axios base | `/api` default and example | Existing environment base is reused; `/api` is normalized to `/api/v1`. Origin and explicit `/api/v1` values also work |
| Token storage | `SelfStorage_token`, `SelfStorage_user`; no refresh-token handling | Existing access/user keys retained; `SelfStorage_refreshToken` added. One shared session helper, no duplicate Axios client or auth provider |
| Protected requests | Access token interceptor existed | Confirmed protected requests use `Authorization: Bearer <accessToken>`. Login/registration bypass stale authorization headers |
| Profile | Priority 1 browser demo by default; live edit disabled | Signed-in account loaded via real GET, supported fields updated via PUT, then refreshed via GET. No mock profile fallback |
| Unsupported fields | Email/address/company could be edited in the demo | Profile edits send only `displayName` and `phone`; email/address/company stay display-only and are never written to the API |
| Password | Unavailable placeholder | Current/new/confirmation inputs; only `oldPassword` and `newPassword` sent; confirmation and duplicate checks; secret inputs cleared after success |
| Logout | No implementation/UI | Confirmed logout with stored refresh token; success clears auth state/tokens/user and navigates to existing `/login`; non-401 server failure leaves the session intact for retry |
| 401 handling | Cleared access/user keys only | Clears access, refresh and cached identity together. A late response for an older token does not invalidate a different current session |
| Role handling | Mock CUSTOMER value, no authenticated role routing | Known `FACILITY_MANAGER` from the returned user profile routes to existing Manager dashboard. Other roles retain existing `/portal` fallback. No new role names or Staff routes are invented |
| Route guards | No authentication/role guards | Existing route structure and accessible demo pages preserved. Frontend role redirects are not authorization; protected APIs must enforce backend authorization |
| Missing business APIs | Legacy modules had unconfirmed network branches | Existing mock implementations are unchanged. A central contract check rejects unconfirmed Axios requests before network dispatch; no fake backend endpoints are substituted |

The Postman collection also contains Admin user-management requests, a Keycloak token request and an auth-sync request. These are not needed for the requested direct API-login/current-profile flow. Admin users are not a confirmed facility-scoped Customer/Staff API, so Manager tables remain demos instead of incorrectly reading the global Admin user list. No unused Admin UI or Keycloak/sync flow was added.

The collection contains no saved response examples for the current-user DTO. The adapter accepts a user object either under `response.data.data` or directly under `response.data`; real-backend DTO verification remains necessary when the server is running. Login token nesting follows the explicit confirmed task contract.

## Files modified (8)

- `src/api/axiosClient.js` — environment-based v1 base normalization, confirmed-request check, shared token access and complete 401 session cleanup.
- `src/api/authApi.js` — corrected real login/register/me methods; real logout; existing method names retained.
- `src/pages/auth/LoginPage.jsx` — real form submission, nested token parsing, existing-route navigation, backend error/pending states. Unsupported social/OTP providers remain disabled; login is email-based according to Postman. The 30-day remember-device promise was replaced with an accurate existing-localStorage description.
- `src/pages/auth/RegisterPage.jsx` — supported registration body, consent and pending states; successful creation leads to existing sign-in route without inventing registration tokens.
- `src/pages/customer/ProfilePage.jsx` — real loading/edit/password/security interactions with unchanged card layout and styles.
- `src/components/common/CustomerScreen.jsx` — optional notice override so the real Profile screen is not incorrectly labeled a demo; other pages keep their existing notice behavior.
- `src/layouts/CustomerLayout.jsx` — authenticated cached display name in existing header.
- `src/layouts/ManagerLayout.jsx` — authenticated display name and compact logout control in existing header; business data/layout/navigation remain unchanged.

## Files created (5 production source)

- `src/api/userApi.js` — confirmed current-user profile/password methods, using the existing Axios instance.
- `src/api/confirmedContract.js` — base normalization and confirmed-request guard. The guard is a network integration constraint, not a security/role permission guard.
- `src/lib/authSession.js` — access/refresh/cached identity management and same-tab/cross-tab subscription using the existing token/user keys. Only identity fields are cached, not credentials or an arbitrary full backend DTO.
- `src/lib/apiError.js` — safe textual backend messages (including validation message arrays), connection errors and bounded output; no raw response serialization or HTML injection.
- `src/components/common/LogoutButton.jsx` — shared pending/error-aware real logout control.

Documentation: `docs/BackendApiAudit.md`.

Validation helpers/artifacts are retained under `.design-reference/`: `inspect-postman-contract.py`, `check-backend-reachability.py`, `check-confirmed-auth.cjs`, `check-auth-responsive.cjs`, responsive auth screenshots and implementation helpers. No Postman credentials/tokens were copied to project source.

No changes to AppRoutes, configuration files, package.json, dependencies, existing business API methods, Customer/Manager mock stores or business routes.

## APIs actually integrated

| Method | Endpoint | JSON request body |
|---|---|---|
| POST | `/api/v1/auth/login` | `email`, `password` |
| POST | `/api/v1/auth/logout` | `refreshToken` |
| POST | `/api/v1/users/register` | `email`, `password`, `displayName`, `phone` |
| GET | `/api/v1/users/me/` | None |
| PUT | `/api/v1/users/me/profile` | `displayName`, `phone` |
| PUT | `/api/v1/users/me/password` | `oldPassword`, `newPassword` |

Six endpoints are integrated. The central request check also recognizes the four confirmed Admin user-management endpoints, but no Customer/Manager screen calls them and no Admin feature was implemented.

## Real data and remaining demo/API-ready pages

Real API features: `/login`, `/register`, `/portal/profile` (load/update/password), authenticated identity labels, and logout from Profile/Manager header. Profile always requires actual authentication; business mock mode never substitutes a fake identity or fake successful profile/password operation.

Priority 1 business features still use the existing isolated `customerData.js` / `customerDemoStore.js`: rentals/access/extensions, inventory registration/detail/movement requests/history, payment history/refunds/charges and notifications. Existing reservation/contract demo adapters and workflows are preserved. Support, booking/public facility/pricing displays remain existing UI/demo or API-ready functionality.

Priority 2 Manager business features still use `managerData.js` / `managerDemoStore.js`: facility dashboard, reservations, customers/verification, private units, Zone/Rack/Shelf, operations, staff assignments, extensions, operational detail/checklists, maintenance, support, refunds/charges and reports. Current auth identity does not turn demo facility assignments or business approvals into real backend data. Report exports remain disabled without an export API.

`VITE_USE_MOCK=true` keeps business demos usable while authentication/profile continue to call the real confirmed API. `VITE_USE_MOCK=false` keeps unavailable business actions/data in their existing API-ready/disabled states; legacy network branches are blocked before any unconfirmed endpoint is sent.

Required future backend contracts: facilities/assigned-facility scope, storage units/locations, reservations/contracts, pricing/policies, rentals/extensions/access, payments/history, managed inventory/movements, notifications, support, maintenance, staff/tasks, check-in/checkout/inspection/handover, refunds/extra charges and reports/exports. Audit/login-history APIs are also not confirmed and were not added.

## Validation and practical limits

- Local backend reachability: GET `/api/v1/users/me/` without any collection credentials could not connect to localhost:5000. No live-user account was created, no real password changed and no real logout was attempted.
- Contract browser tests use intercepted responses solely in `.design-reference/check-confirmed-auth.cjs`. Production code calls the real confirmed endpoints; there is no mock auth/profile fallback.
- Contract checks cover registration body/consent/duplicate guard/success redirect; login error rendering without executing HTML, nested tokens, actual token keys; loading, editable-field restrictions, exact profile body, Bearer header and refreshed profile; password confirmation/body/array error/pending/secret-input clearing; failed/successful logout and refresh-token body; confirmed Manager-role redirect/header identity; protected 401 cleanup; rejection of unconfirmed paths before network dispatch.
- Regression checks cover existing Customer reservation/contract persistence and Manager demo interactions. Responsive checks cover retained Manager screens and auth/profile forms at 1440px and 390px with no document-wide horizontal overflow. Flat/unconfirmed login-token responses are rejected without creating a session; logout synchronizes between tabs.
- `npm run build`: passed. Vite’s main-chunk >500 kB warning remains non-fatal; no dependency/configuration changes were made to address an unrelated bundle refactor.

Live end-to-end verification is still required once the backend is running with an authorized test account. API integration is complete against the supplied request contracts; unavailable business APIs remain intentionally unintegrated.

## Priority 5 Admin addendum — 2026-10-05

This addendum updates current usage; earlier sections describe the historical Priority 1/2 audit. Priority 3 Staff and Priority 4 BOM demos subsequently exist, and Priority 5 now integrates confirmed Admin User APIs.

Real operations added to the existing `src/api/userApi.js`:

| Method | Confirmed endpoint | Body |
| --- | --- | --- |
| GET | `/api/v1/users` | None |
| POST | `/api/v1/users` | `email`, `password`, `displayName`, `phone`, `role` |
| PATCH | `/api/v1/users/:id/role` | `role` |
| DELETE | `/api/v1/users/:id` | None; account deactivation per Postman naming |

There are now ten used confirmed endpoint contracts including the original six Auth/Profile operations. Admin functions always use the existing Axios/Bearer/baseURL infrastructure, independently of business mock mode. No token/interceptor/baseURL changes or additional Axios instance were made. The existing confirmed-request guard already permitted these Admin operations.

`/admin/users` uses the real collection only. User detail resolves from that collection; no GET-by-id is invented. User creation/change/deactivation refresh GET Users after success. Passwords are cleared and never persisted/logged; returned account fields are sanitized into an in-memory session-scoped cache. Failed/offline/403/unsupported DTO responses never fall back to fixtures. Existing 401 session cleanup is reused.

Admin Login History/Audit/Facility Oversight remain explicitly isolated demo/API-ready modules; no missing endpoint is sent. Static audit examples do not claim to record actual User API mutations. Manager/Staff/BOM state remains separate and existing business rules are preserved.

Current Postman literal role examples are FACILITY_MANAGER and FACILITY_STAFF. Default Admin role options use these plus values actually observed in a backend collection. ADMIN/BOM role enums are not confirmed by saved contracts; login redirects remain unchanged pending confirmation. Frontend navigation is not a backend permission check.

The collection has no saved User-list response DTO example. The adapter supports common array/user collection wrappers and fails visibly for others; actual DTO, pagination, authorization and deactivation semantics need live verification. Backend probe to localhost:5000 without credentials was unavailable. No real Admin mutation was performed.

Validation: intercepted four-method contract tests, loading/errors/empty/retry/duplicate/password/401 behavior, session isolation/late response tests, VITE_USE_MOCK=false behavior and 28 Admin desktop/mobile route checks passed. Public/Customer/Manager/Staff/BOM/Auth regressions and npm run build passed. Existing non-fatal main-bundle >500 kB warning remains.

Full report: `docs/AdminPriority5.md`.

## Auth recovery / registration consent addendum — 2026-10-06

User-supplied Auth controller contract confirms POST `/api/v1/auth/forgot-password` with `{email}` and POST `/api/v1/auth/reset-password` with `{email,otp,newPassword}`. Both public methods now use the existing Axios client with skipAuth; confirmed-request allowlist extended only for these paths. No OTP/password/token storage changes and no invented endpoints.

Registration still sends only email/password/displayName/phone to `/users/register`. Terms/Privacy agreement is explicit frontend dialog consent only; server persistence/versioning requires a future contract. Existing Login/Profile/Logout integrations preserved.

Recovery/consent responsive tests and existing Auth/Profile contract regression passed; build passed. Backend localhost:5000 responds (unauthenticated Users probe: 401); real email delivery and password mutation were not performed. Full scope, gaps and validation: `docs/AuthRecoveryConsent.md`.

## Customer Core Rental addendum — 2026-10-08

Source: supplied Customer integration request, WDP.postman_collectionV2.json and docs_rental_workflow.md; local storage/pricing/facility backend source inspected read-only. Existing Auth/User integrations are preserved. Customer core reads and identity/access writes use the existing client/session without mock fallback. Existing Customer URLs are unchanged and now have an authenticated Customer gate.

Public facilities/options/pricing, authenticated units, pricing/policy resolve, reservations/me/detail, contracts/me, support list/detail, identity PUT and simulated-access POST are wired. Exact create-reservation and mock-pay request methods are API-ready but production UI remains disabled pending amount/policy and payment-eligibility contracts. Signing is not allowlisted or sent because V2 POST/body conflicts with workflow PATCH/no-body. Support creation/reply and message visibility remain contract-blocked. No Manager/Staff approval/inspection actions or invented payment/extension/cancellation APIs.

Strict new response reading requires success:true and data; unsupported envelopes fail visibly. Actual newer DTOs, DRAFT contracts, unlock outcome mapping, Customer verification retrieval and pricingPolicyId/deposit semantics still require backend confirmation. Existing checkout source lacks these new controllers; localhost:5000 public/health probes were unreachable. No real authenticated E2E/mutations were performed.

Executed: synthetic Customer contract/guard/lifecycle/security tests, 36 responsive views, other-role route smoke tests and Auth/Profile regression. Build passed. Full implementation matrix, changed files and blockers: docs/CustomerCoreRentalIntegration.md.
