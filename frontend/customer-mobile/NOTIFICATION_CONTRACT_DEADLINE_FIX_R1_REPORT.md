# WDP Customer Mobile Notification and Contract Deadline Fix R1

**TASK_ID:** `WDP_CUSTOMER_MOBILE_NOTIFICATION_CONTRACT_DEADLINE_FIX_R1`  
**STATE:** PARTIAL

## A. Backend notification audit

The backend exposes customer notifications at `GET /api/v1/notifications/me` (API v1 prefix plus `/notifications/me`). The route requires authentication and queries by `req.user._id`; read updates also scope by both notification ID and authenticated user ID. The response is an array in the standard success envelope. The mobile repository targets `/notifications/me`, expects an array, and maps ownership/read state without a DTO mismatch. The inbox has no hidden unread-only, channel, archive, or pagination filter. The current model stores `userId`, type, title, content, read state, channel, and timestamps.

Before this fix, source search found no production notification producer for customer lifecycle events. The only producer located was the development/demo seed. A read endpoint existing therefore did not establish that real notifications were persisted. No live database, customer token, or event history was available, so the cause for any particular account cannot be distinguished among `PRODUCER_MISSING`, `NO_EVENTS_FOR_USER`, or environment mismatch from source alone.

## B. Notification event findings

| Event | Finding |
|---|---|
| Reservation created | No customer producer found |
| Verified payment | Added below for verified full-rent payment |
| Awaiting contract / deadline reminder | No producer or scheduler found; timing policy not established for reminders |
| Contract signed | No customer producer found |
| Handover, renewal, expiry, checkout | No in-app customer producer found |
| Managed Inventory inbound/outbound | No customer notification producer found in the audited paths |

## C. Backend changes

On a successfully verified and applied PayOS `FULL_RENT` webhook, the backend now persists a `PAYMENT_CONFIRMED` in-app notification for `reservation.customerId` in the same transaction. The message identifies the reservation and directs the customer to the rental detail for next steps. Existing webhook event deduplication prevents replayed payment events from creating another notification. No client redirect is used as proof of payment. The notification type enum and verified payment tests were extended. No payment amount/status, cancellation, refund, or policy calculation was changed.

## D. Mobile notification changes

The Notifications screen now separates loading, genuine empty, authorization failure, network failure, and other API failures. It retains retry behavior and offers explicit mark-as-read per item; opening the screen does not mark all items read. Cards display type-appropriate icons, time, and unread state. Home's existing unread badge and focus refresh remain the source for badge synchronization. No unsupported mark-all, pagination, or target navigation was invented.

## E. Contract deadline source of truth

The canonical persisted field is `Reservation.signingDeadline`, already present in the reservation response consumed by the mobile mapper. The contract controller enforces expiry against this timestamp. Existing Self Storage code documented a three-day signing window in development/mock setup and model/job comments; production verified Self Storage full-rent apply previously could leave the field unset. The payment apply path now preserves an existing deadline and, only when missing, sets it to 72 hours after verified payment time. Managed Inventory retains its separate existing calendar-based deadline rule. No deadline is fabricated on mobile when the backend field is absent.

The existing expiry job treats `FULL_UPFRONT_V1` as requiring manual review; mobile therefore reports that the timestamp has passed without claiming the reservation was cancelled.

## F. Mobile contract UI

Added a shared signing notice to the Home rental card and Rental Detail for paid Self Storage `FULL_UPFRONT_V1` reservations. It names the facility when supplied, explains that the customer must visit to sign, displays the backend deadline in `Asia/Ho_Chi_Minh`, and updates the remaining time. Missing/invalid deadline displays an explicit unavailable message. Expiry copy does not claim cancellation.

## G. Verification status

- Backend `npm run build`: PASS.
- Backend targeted notification/payment/deadline suites: PASS, 122 tests.
- Mobile focused Jest tests: PASS, 13 tests across 2 suites.
- Mobile full Jest suite: interrupted after prolonged no-output execution; NOT VERIFIED.
- Mobile typecheck: BLOCKED by pre-existing missing `src/screens/ManagedDashboard.tsx` and references/exports from `LiveAccount.tsx` and managed-inventory tests. The missing module is outside this task's requested scope; no restoration or unrelated rewrite was made.
- Expo native export: NOT RUN.
- Live API/database end-to-end: NOT AVAILABLE; persistence/read behavior is verified through controlled unit tests, not a live customer account.
- Git branch/status could not be read because the configured Git directory redirect points to a missing `C:\Users\laptop\Desktop\WDP` path. No commit, push, reset, or discard was performed.

## H. Files changed

Backend:

- `src/types/notification.type.ts`
- `src/services/payments/payos-payment.service.ts`
- `src/utils/self-storage-signing-deadline.ts` (new)
- `tests/notification-controller.test.cjs` (new)
- `tests/payos-payment.test.cjs`
- `tests/self-storage-signing-deadline.test.cjs` (new)

Customer Mobile:

- `src/domain/contractSigning.ts` (new)
- `src/components/ContractSigningNotice.tsx` (new)
- `src/screens/LiveAccount.tsx`
- `src/screens/LiveRental.tsx`
- `tests/contract-signing-deadline.test.ts` (new)
- `tests/customer-home-parity.test.tsx`
- This report.

## I. Manual QA checklist

1. Sign in as a customer with an existing notification; compare Home unread badge to the inbox, mark one item read, return Home, and verify refresh updates the badge.
2. Sign in as a customer with no notifications; verify the empty state appears only after a successful empty response.
3. Simulate 401/403, offline, and server error; verify each error state and retry affordance.
4. Use a paid Self Storage `FULL_UPFRONT_V1` reservation; compare facility/deadline/countdown on Home and Rental Detail.
5. Check a missing deadline, a near deadline, and an elapsed deadline; confirm elapsed copy does not imply cancellation.
6. Check signed, active, cancelled, and Managed Inventory reservations to confirm the signing panel only appears where applicable.
7. Verify a real successful full-rent webhook creates one notification and retrying the same webhook does not duplicate it in a connected test environment.

## J. Remaining blockers and risks

The source-level audit cannot establish why an individual live customer's inbox is empty without their event and database state. No verified end-to-end live PayOS event was generated. Notification producers for the other lifecycle events and scheduled reminders remain absent or unverified. Full Mobile suite/typecheck and native export remain unverified due the pre-existing missing managed dashboard module and the prolonged Jest run. The newly applied 72-hour fallback follows the existing codebase's documented Self Storage policy; confirm that operational configuration has not intentionally diverged before production rollout.
