# Customer Login / Logout / Pricing fixes — 2026-10-09

## 1. Files
Modified production files:
- src/pages/auth/LoginPage.jsx
- src/components/common/LogoutButton.jsx
- src/layouts/CustomerLayout.jsx
- src/pages/public/PricingPage.jsx

Created: src/components/customer/CustomerUserMenu.jsx; this report; .design-reference/check-login-logout-pricing.cjs, check-pricing-live.cjs, check-auth-recovery-targeted.cjs; pricing screenshots at five widths and live mobile screenshots.

Existing check-confirmed-auth-core.cjs was executed unchanged; its existing profile screenshot was refreshed. The pre-existing edit to RentalLifecycleIntegration.jsx was preserved and not changed by this task. No API module, auth session/token storage, Axios client, route, dependency, backend or other role UI was changed.

## 2. Login
Removed Google, Apple, Zalo / OTP and OR SIGN IN WITH EMAIL. Added modest form top spacing. Branding, desktop two columns, facility image, existing fields/session checkbox, visibility, Forgot Password, registration link, request DTO/token mapping and redirects are unchanged.

The existing checkbox describes the current persistent session policy and remains checked/disabled; no new Remember Me/token-storage policy was introduced.

## 3. Logout / header
Profile continues to use the shared LogoutButton. Header now uses the same component in a click-open account popover containing My Profile and Sign Out. Native links/buttons support Tab, arrow navigation, Escape, focus return, outside dismissal and close on profile navigation. No dropdown package exists in current dependencies, so no additional library was installed. The popover remains open when disabling the pending logout button causes null focus, preserving pending/error visibility.

Shared logout deduplicates concurrent requests for the same current access/refresh session, including Header and Profile. Request remains POST /api/v1/auth/logout with only refreshToken and existing Bearer client. An explicit success:false response is treated as failure. Network/server failures preserve session and provide retry; protected 401 uses existing interceptor cleanup. Success clears only existing authentication keys and navigates to /login with replace. Late responses cannot clear a different current access token. Customer cache/draft visibility continues to be invalidated through existing token scoping, unmount and CustomerGate; unrelated browser preferences/demo storage are preserved.

Missing refresh credentials retain the existing error policy rather than claiming backend revocation. Other roles share the same component contract; no role-specific authentication policy was changed.

## 4. Pricing UI
Kept hero/location/plan cards/included services/FAQ/CTA structure. Both duration options have explicit readable backgrounds/text, aria-pressed states, focus styling and a stacked mobile layout. Removed SAVE 15% and the 0.85 promotional calculation. Supporting copy has readable light-on-dark contrast. A local dark-green hero substrate fixes blueprint CSS overriding the gradient background; global CSS is unchanged. Location and cards retain responsive wrapping/spacing and existing booking/facility links.

## 5. Pricing integrity
Previous PricingPage had no real pricing calls: it rendered static monthly values and a computed illustrative discount. Those values are no longer shown as offers. Current page reads real public facilities and selected-facility pricing using existing API methods and the existing client. Selection starts from an actual current rental draft/query ID when available, otherwise prompts for a facility; no hardcoded Ho Chi Minh City location.

Actual read-only response and backend public-catalog controller/service confirmed data.selfStorage and data.managedInventory arrays. Reader accepts this grouped DTO, validates returned price/currency/term fields, and shows exact term prices; it never computes discounted or per-month equivalents. Monthly filters the returned 1-MONTH term; long-term filters returned 6/12-MONTH terms. Unknown format, API error and empty results show clear states/retry, with no static fallback.

Storage category cards cannot be mapped safely to exact rate records, so they show a truthful facility-pricing prompt instead of fabricated amounts. Actual rates appear in the nearby facility rate panel. Booking links preserve the selected facility ID. Existing authenticated pricing/policy resolvers in the rental workflow are untouched; no deposit/total/promotion interpretation added.

## 6. Validation
Automated/synthetic:
- check-login-logout-pricing.cjs passed Login request/UI/visibility/session checkbox; Profile and Header logout success, HTTP failure, success:false, network failure, 401, cross-component dedup, exact request body/Bearer, auth-only cleanup, preserved unrelated storage and Back guard.
- Keyboard menu/focus/dismissal/profile navigation passed. Loading/error remains visible in the menu.
- Grouped pricing, exact monthly/6-month values, no 15% offer/static price, selected facility booking URL, empty/error/unsupported response and no fallback passed.
- Login/Profile/Pricing at 1440,1024,768,390,320: 15 viewport checks passed, including document overflow, dropdown bounds, duration visibility/colors and real dark hero substrate.
- Admin/BOM/Manager/Staff dashboard route smoke tests passed; their full business workflows were not rerun.
- check-confirmed-auth-core.cjs passed Register/consent, Login/token mapping, Profile read/edit, Change Password, Logout and protected 401/Manager redirect regression.
- check-auth-recovery-targeted.cjs passed Forgot/Reset exact contracts, validation/errors, secret/session isolation and Terms/Privacy consent.

Real backend, read-only:
- Health returned 200.
- GET public/facilities and public/facilities/:id/pricing returned 200; grouped pricing DTO was inspected without printing credentials.
- check-pricing-live.cjs passed real browser facility selection/pricing rendering at 390px on allowed origin 127.0.0.1:5173. The tested facility had no current rates; empty state was correct. Final mobile screenshot visually inspected.
- Temporary test origin 5189 was not allowed by existing CORS; actual browser check was run on 5173 without changing configuration.

**No real authenticated Login/Logout mutation was performed; real Logout success is not claimed.** Logout results above are intercepted contract tests. No real account credentials or tokens were logged/hardcoded.

## 7. Build
Final npm run build passed. Non-fatal existing main-bundle warning above 500 kB remains. No unrelated bundle refactor.

## 8. Remaining gaps
Actual facility rate availability depends on backend data. Category-to-rate mapping, approved long-term offers, deposit/total policies and the previously documented rental blockers require backend/business confirmation. A real authorized account is still needed for actual authenticated Logout E2E; frontend contract/error/session handling is validated synthetically. Existing token/session architecture was preserved.
