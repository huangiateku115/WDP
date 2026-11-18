# Mobile Visit Success Navigation R4

Checkpoint: `WDP_MOBILE_VISIT_SUCCESS_NAVIGATION_R4`

## Root cause

After `createVisit` returned a DTO accepted by the adapter, the form set `success=true` (which disabled the confirm button) and called `Alert.alert`. That alert only offered a manual Back action; it never navigated to the Visit list. On platforms where the native alert is unavailable or not presented, the form remained locked with no visible confirmation.

## Changes

- Kept the existing API and its response validation. Create is considered successful only after the adapter validates the returned Visit DTO and confirms the requested purpose/time and `SCHEDULED` status.
- While submitting, the fixed footer now shows a spinner and `Đang đặt lịch...`; the synchronous busy guard and disabled UI prevent duplicate submission.
- After confirmed creation, the form clears the attempt journal, publishes an in-memory success event, and calls `router.replace` to `/managed/reservations/${reservationObjectId}/visits`. It does not push another form/list history entry.
- The Activity screen consumes the success event reactively and keeps a success banner visible until dismissed. It reports whether the list has synchronized, is loading, or does not yet contain the Visit. It does not fabricate a list row. The existing focus-based Backend read refreshes the list when the destination becomes active.
- Unknown outcomes retain the original idempotency journal. Mobile checks the Backend Visit list first; an exact matching `SCHEDULED` Visit confirms the operation. If no match exists, it keeps the request and only offers an explicit same-key retry after that check. A list-read failure does not trigger a POST retry. Idempotency conflicts remain blocked from replay.
- Validation and access errors remain on the form. 401/403 are explicit; 409 messages use Backend codes such as `VISIT_SLOT_UNAVAILABLE`, `RESERVATION_NOT_VISIT_READY`, and `IDEMPOTENCY_CONFLICT`.

## Files changed

- `src/screens/ManagedVisitForm.tsx`
- `src/screens/ManagedVisitActivityScreen.tsx`
- `src/state/visitSuccessFeedback.ts` (new in-memory navigation feedback)
- `tests/managed-visit-success-navigation.test.tsx` (new)

No route file was added or changed. `visits/index.tsx` and `visits/new.tsx` remain the official routes; no `visits.tsx` alias exists.

## Verification

- `npm run typecheck` — PASS.
- Focused Jest — 6 suites, 33 tests PASS. Covers success and replace navigation, destination banner with syncing then Backend list state, double-submit, 409/403 errors, timeout reconciliation without automatic retry, and route collision regression. Payment/contract regression is included.
- Expo Web export — PASS (`artifacts/web-r4`).
- Expo Android/iOS export — PASS (`artifacts/native-r4`).
- Tests use isolated mocks; no live API, MongoDB writes, or IT01–IT10 were run.

Physical Android/iOS behavior and a live signed-in Customer session were not tested in this run.
