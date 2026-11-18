# Customer Mobile Renewal UI & Payment History Fix

**Task:** `WDP_MOBILE_RENEWAL_UI_PAYMENT_HISTORY_FIX`  
**Checkpoint:** `MOBILE_RENEWAL_UI_PAYMENT_HISTORY_FIXED`

## Root cause

Mobile reads `GET /reservations/:reservationId/payments/payos` through `mobileRepo.payments()` and `mapPaymentHistory()`. The Backend customer-scoped history query includes all PayOS payment purposes for the owned reservation. Its payment DTO includes `purpose` and `extensionId` for renewal payments. The Mobile `paymentDto` accepted only `DEPOSIT`, `BALANCE`, and `FULL_RENT`; a valid `RENEWAL` row therefore failed Zod parsing, surfaced as a history-load error, and caused `RentalProgress` to replace the entire progress section with “Chưa thể xác minh tiến độ.”

This was a Mobile response-contract mismatch, not evidence of a failed Backend payment request. Renewal payments are now parsed as their own purpose and retain the optional `extensionId`. The generic renewal status/reconciliation flow remains in `selfStorageRenewal.ts` and is unchanged.

Customer Web’s payment client was also inspected read-only. Its purpose validator currently accepts only the same three original purposes, so mixed history containing Renewal may also fail there. Customer Web was outside this task’s edit scope and was not changed; its rendered behavior was not separately exercised against live customer data.

## Behavior and UI changes

- Renewal payments appear as “Gia hạn hợp đồng” in payment history, with their extension code labeled “Mã gia hạn.” They are not labeled as remaining rent.
- Deposit, balance, and full-rent decisions continue to filter by their exact purpose. The checkout purpose type explicitly excludes `RENEWAL`.
- A history request failure now returns a separate `historyError`; rental and contract data and the progress tracker remain available. The history area has its own retry state.
- If history is unavailable, an otherwise-new original-rent payment intent is held at `REVIEW`; the app will not create an intent using incomplete payment history.
- Extension history now uses customer-facing Vietnamese labels and clearer fields for term, fee, previous/new expiry, confirmation date, and extension code. The Renewal subtitle no longer describes internal server implementation. Active extensions are presented as completed renewals.
- No payment is marked paid or applied by the UI. Existing backend settlement, verification, application, and reconciliation states remain authoritative.

## Files changed

| File | Change |
|---|---|
| `src/api/contracts/documents.ts` | Accept `RENEWAL` in payment responses and preserve optional `extensionId`. |
| `src/domain/livePayment.ts` | Keep checkout purposes narrowed to `DEPOSIT`, `BALANCE`, and `FULL_RENT`. |
| `src/api/selfStoragePayment.ts` | Isolate history-read failure and fail safely to review rather than create on incomplete history. |
| `src/screens/LiveRental.tsx` | Keep progress visible on payment-history errors; distinguish renewal payment/history and improve labels. |
| `src/screens/RentalRenewalScreen.tsx` | Remove developer-oriented copy and present renewal history in customer-friendly terms. |
| `tests/backend-contracts.test.ts` | Cover mixed full-rent and multiple Renewal payment history with distinct extension IDs. |
| `tests/live-api.test.ts` | Cover isolated history failure and the safe no-new-checkout decision. |

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| Focused Jest: backend contracts, live API, renewal, PayOS return, full-rent checkout, Self Storage checkout | PASS — 6 suites, 164 tests |
| Full Jest | PARTIAL — 36/37 suites and 684/685 tests pass. One unrelated failure remains in `tests/customer-web-containment.test.ts`: `TypeError: (0, _react.useMemo) is not a function` in `InventoryItemForm`. This Mobile task did not modify that test or component. |
| Expo Web export | PASS — `npx expo export --platform web --max-workers 2 --output-dir artifacts/web` |
| Expo Android/iOS export | PASS — `npm run export:native` |
| Live PayOS / customer transaction | NOT_RUN |

Git baseline/status could not be verified in this checkout (`git` reported it could not change to the WDP repository path); no reset, stash, clean, or commit was performed.

## Manual Mobile check

1. Sign in as the reservation’s owner and open an ACTIVE Self Storage rental.
2. Confirm the rental progress and extension history remain visible.
3. Open payment history and verify original rent and Renewal entries have distinct labels; Renewal rows show their extension code.
4. Open the Renewal screen and check an ACTIVE extension shows its term, fee, previous/new expiry, and confirmation date without raw status codes.
5. To validate the recovery path, use a controlled non-production API response containing a Renewal row; do not perform a live payment. If the history endpoint fails, only the payment-history section should show an error and retry action.

No physical Android/iOS device session or live customer API was used during verification.
