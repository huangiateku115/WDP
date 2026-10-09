# Auth recovery and registration consent

## 1. Files created
- `src/pages/auth/ForgotPasswordPage.jsx`
- `src/pages/auth/ResetPasswordPage.jsx`
- `src/components/auth/TermsPrivacyDialog.jsx`
- `.design-reference/check-auth-recovery.cjs` (validation only)
- `docs/AuthRecoveryConsent.md`

## 2. Files modified
- `src/api/authApi.js`: two new public recovery methods using the existing client.
- `src/api/confirmedContract.js`: allow only the two newly supplied Auth controller contracts.
- `src/pages/auth/LoginPage.jsx`: recovery Link, accessible visibility button and exclusive success message.
- `src/pages/auth/RegisterPage.jsx`: explicit dialog consent; existing registration payload/API unchanged.
- `src/routes/AppRoutes.jsx`: two routes under existing AuthLayout.
- `.design-reference/check-confirmed-auth.cjs`: consent interaction updated for the existing Auth regression.
- `docs/BackendApiAudit.md`: appended recovery contract/consent addendum.

## 3. Routes added
`/forgot-password` and `/reset-password`. Existing Public, Customer, Manager, Staff, BOM and Admin routes are preserved.

## 4. API methods added
`authApi.forgotPassword({email})` and `authApi.resetPassword({email,otp,newPassword})`. Both use the existing Axios instance with `skipAuth:true`; no Bearer header is attached and a recovery 401 does not clear an existing session.

## 5. Forgot Password flow
Login Link opens the email form. Email is trimmed and required; browser email validation applies. Synchronous ref guards duplicate requests, inputs/button indicate pending state, backend errors use `apiErrorMessage`. A confirmed `success:true` response opens Reset Password with only email and an OTP-sent flag in Router state. No OTP is put in URL or storage.

## 6. Reset Password flow
Email is prefilled from Router state or entered manually on direct access. OTP and password are required. Minimum password length is 8, matching Register; confirmation must match before a request. Accessible independent visibility buttons never submit. Success clears OTP/password/confirmation and replaces the route with Login and `passwordReset:true`. Login displays the reset message with precedence over the preserved registration message.

## 7. Consent behavior
Initial acceptance is false and registration is disabled. Requesting agreement opens the dialog without checking the checkbox. Only I Agree accepts. Cancel, X, Escape and backdrop click dismiss without accepting; unchecking revokes acceptance. Terms/Privacy buttons open the corresponding scroll section without accepting. Reviewing policy after acceptance leaves the previous explicit choice unchanged unless unchecked.

Native modal follows the project's existing dialog pattern because shadcn Dialog/ScrollArea are not installed. Existing UI buttons and a keyboard-focusable scrolling body are reused. Modal focus returns to the opener, content scrolls, footer remains reachable. No dependency/configuration changes or page redesign.

Content covers account accuracy/responsibility, proper use, facility/prohibited-activity rules, rental/payment responsibilities, possible suspension, processed account/rental/payment/support/access records and legitimate service purposes. It states that raw credentials must not be exposed and final business policy governs handling; no certification, fixed retention/deletion or absolute sharing guarantee is claimed.

## 8. Real API contracts
Source: user-supplied newly confirmed backend Auth controller contract, not guessed Postman additions.

| Method | Endpoint | Exact request fields |
| --- | --- | --- |
| POST | `/api/v1/auth/forgot-password` | `email` |
| POST | `/api/v1/auth/reset-password` | `email`, `otp`, `newPassword` |

Both success responses provide `success:true` and a message. Registration remains POST `/api/v1/users/register` with only `email`, `password`, `displayName`, `phone`. Confirmation and policy acceptance are frontend validation only.

## 9. Remaining backend gaps
Consent persistence/versioning needs a future confirmed backend contract; no invented consent fields are sent. OTP expiry/rate limiting/delivery and backend password rules beyond existing FE minimum require server validation. Backend was reachable on 2026-10-06: unauthenticated GET `/api/v1/users` returned 401. No real recovery emails or real password changes were performed; actual email delivery/end-to-end recovery remains unverified.

Secrets stay in component memory only, never in URL/localStorage/sessionStorage/logs. Existing authentication/token handling and client remain unchanged.

## 10. Responsive result
Login/Register/Forgot/Reset plus policy dialog at 1440px and 390px: 10 views passed overflow/viewport checks. Dialog scroll and visible footer passed; mobile screenshot visually inspected. Screenshots: `.design-reference/auth-policy-1440.png` and `auth-policy-390.png`.

## 11. Regression result
New recovery test covers exact bodies, success/error/retry, duplicate guards, password mismatch, manual email, visibility, no secret persistence, preserved token/session including recovery 401, consent acceptance/dismissal/uncheck. Public/Customer/Manager/Staff/BOM/Admin entry routes smoke tested.

Existing `check-confirmed-auth.cjs` passed registration exact body/consent, login/tokens, error escaping, Profile read/edit, password change, logout failure/success, Manager redirect, unknown-endpoint blocking and protected 401 cleanup. Test responses are intercepted synthetic contract examples only; production uses real endpoints with no mock fallback.

## 12. Build result
`npm run build` passed. Non-fatal main bundle size warning above 500 kB remains. No backend files or dependencies changed.
