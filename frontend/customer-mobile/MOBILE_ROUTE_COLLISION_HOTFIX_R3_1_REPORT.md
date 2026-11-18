# Mobile Route Collision Hotfix R3.1

Checkpoint: `WDP_MOBILE_VISIT_ROUTE_COLLISION_HOTFIX_R3_1`

## Fix

- Removed the single R3 alias `app/managed/reservations/[reservationId]/visits.tsx`.
- Kept `app/managed/reservations/[reservationId]/visits/index.tsx` as the Visit/Session screen and `visits/new.tsx` as the form route.
- Reservation Detail now navigates to the canonical URL `/managed/reservations/${reservationObjectId}/visits`. Its test checks the exact URL and actual Reservation ObjectId.
- Expo Router's generated type table lists the physical `visits/index` file path but omits its canonical parent URL. The navigation uses Expo's `Href` type for that canonical URL; no route alias was added.

## Collision audit

- Added a filesystem-based regression test that canonicalizes a trailing `index` route and checks for duplicate patterns within route groups. It would fail if a sibling `visits.tsx` alias reappeared beside `visits/index.tsx`.
- The scan found no same-group duplicate route patterns after removal. The app has the existing root and `(tabs)` home entries in separate route groups; both are retained as existing grouped navigation.
- Expo Web export completed without the prior “conflicting screens” error, which also validates the complete Expo route tree.

## Verification

- `npm run typecheck` — PASS.
- Focused Jest — 4 suites, 26 tests PASS, including route collision detection, Detail actions, ObjectId navigation, activity tabs/Back, Visit API, payment and contract regression.
- `npx expo export --platform web --max-workers 2 --output-dir artifacts/web-r3-1-final` — PASS.
- `npx expo export --platform android --platform ios --max-workers 2 --output-dir artifacts/native-r3-1` — PASS.

Deep-link and browser refresh were verified through route registration/build, not by launching a signed-in physical device or serving the static export behind a web server.
