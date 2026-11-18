# Customer Mobile Routing Fix R3

Checkpoint: `WDP_MOBILE_VISIT_ROUTING_FIX_R3`

## Root causes

- **BUG-M02:** Reservation Detail targeted `/managed/reservations/[reservationId]/visits/index`. The activity page existed as `visits/index.tsx`, but the intended Expo Router canonical URL is `/managed/reservations/[reservationId]/visits`. The generated route table had the explicit `/visits/index` entry and no canonical alias, leaving navigation dependent on the noncanonical path. Added a route file at `visits.tsx`, retained the explicit `visits/index.tsx` entry, and switched navigation to `/visits`.
- **BUG-M03:** The earlier Reservation Detail operation card had been reduced to one activity-list button. “Đặt lịch đến kho” was only reachable from the activity page, so it disappeared from Detail. Restored it as the primary action.

## Changes

- Reservation Detail now always renders both Visit actions. The create action is enabled only after the Backend availability endpoint accepts the Reservation; a 409 explains that the Reservation is not ready, and other failures offer retry. Visit/Session list errors do not control whether the booking action is shown.
- Eligibility request uses the Reservation ObjectId, not its display code. The `/visits/new` route still receives `reservationId`; the activity and form read it from Expo Router.
- Added a canonical `/visits` route alias to `ManagedVisitActivityScreen`. The original `/visits/index` and `/visits/new` routes remain.
- Activity screen retains the two real API-backed tabs, “Lịch đến kho” and “Phiên truy cập”, the new Visit action, error/empty states and Back navigation.

## Files changed

- `src/components/ManagedReservationOperations.tsx`
- `src/api/managedReservationReads.ts`
- `app/managed/reservations/[reservationId]/visits.tsx` (new canonical alias)
- `tests/managed-mobile-form-navigation.test.tsx`
- `tests/managed-visit-routing.test.tsx` (new)
- `tests/managed-v3-visits.test.ts`

The existing `visits/index.tsx` and `visits/new.tsx` route modules were checked and kept. Generated Expo route types now include `/visits`, `/visits/index`, and `/visits/new`.

## Verification

- `npm run typecheck` — PASS.
- Focused Jest: routing, Visit API, date picker, SKU, payment/contract — 5 suites, 26 tests PASS, including allowed and denied Backend eligibility cases.
- Expo Web export — PASS (`artifacts/web-r3`); generated Web bundle contains the `visits` route chunk.
- Expo Android and iOS export — PASS (`artifacts/native-r3`).
- No backend, Web customer source, `.env`, PayOS, MongoDB or IT01–IT10 changes/runs.

The route modules and generated route table were verified in build output. Actual device deep-link launch and browser/server refresh were not exercised on a signed-in device/session; rebuild/reload the current app bundle before the UI review.
