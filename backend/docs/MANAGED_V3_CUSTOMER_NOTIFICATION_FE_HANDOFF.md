# Managed V3 Customer Notification FE Handoff — N2 Review Fix R1

## Existing API

All endpoints require authentication (`requireAuth`) and operate on the authenticated user's notifications:

- `GET /api/v1/notifications/me?page=1&limit=20&read=unread|read` — newest first; page metadata includes `total` and `unreadCount`; `limit` is 1–100.
- `GET /api/v1/notifications/me/unread-count` — returns `{ unreadCount }`.
- `PATCH /api/v1/notifications/:id/read` — only updates a record owned by the authenticated user; another user's record returns 404.

The response follows the current schema: `type`, `title`, `content`, `isRead`, `sentVia`, optional `serviceType`, `facilityId`, and `relatedEntityId`. `eventKey` and `correlationId` are hidden. There is no navigation metadata contract; FE should not infer a route from IDs.

## Event handoff

`Implemented` means a post-commit producer exists. `Recovery` refers to the bounded backend recovery service; it is not a cron. All customer Managed events require `MANAGED_V3_CUSTOMER_NOTIFICATIONS_ENABLED=true` and the existing verified partial unique index. The gate remains OFF by default.

| Event | Business source | Implemented | Recovery | Runtime gate | Customer content | FE target | Limitations |
|---|---|---|---|---|---|---|---|
| `MANAGED_VISIT_CREATED` | `ManagedAccessVisit` create transaction | IMPLEMENTED_OFFLINE | Bounded Visit audit scan | OFF | Vietnamese title, Facility, scheduled time, Visit reference | No route contract | Legacy create audit without time snapshot is deferred if a later reschedule exists |
| `MANAGED_VISIT_RESCHEDULED` | Visit amendment audit, revision and schedule snapshot | IMPLEMENTED_OFFLINE | Bounded Visit audit scan | OFF | Updated schedule and Visit reference | No route contract | Old amendment records without schedule/revision snapshot are deferred |
| `MANAGED_VISIT_CANCELLED` | Persisted CANCELLED transition and revision | IMPLEMENTED_OFFLINE | Bounded Visit audit scan | OFF | Cancel state and Visit reference | No route contract | — |
| `MANAGED_VISIT_NO_SHOW` | Persisted MISSED transition and `VISIT_MARKED_MISSED` audit | IMPLEMENTED_OFFLINE | Bounded Visit audit scan | OFF | Missed visit state and Visit reference | No route contract | Emitted only after MISSED is stored; recurring reminders remain N4 |
| `MANAGED_VISIT_CHECKED_IN` | Visit audit written in Session issue transaction | IMPLEMENTED_OFFLINE | Bounded Visit audit scan | OFF | Check-in state, time and Visit reference | No route contract | Legacy audit without event revision is deferred |
| `MANAGED_VISIT_COMPLETED` | Visit completion written with Session checkout/revoke/expiry | IMPLEMENTED_OFFLINE | Bounded Visit audit scan | OFF | Completed state and Visit reference | No route contract | Expiry-driven delivery occurs only through recovery |
| `MANAGED_ACCESS_SESSION_ISSUED` | Persisted `SESSION_ACTIVATED` audit | IMPLEMENTED_OFFLINE | Bounded Session audit scan | OFF | Facility, expiry time and Session reference | No route contract | No PIN/token/credential is included |
| `MANAGED_ACCESS_SESSION_REVOKED` | Persisted REVOKED state and audit | IMPLEMENTED_OFFLINE | Bounded Session audit scan | OFF | Revoked state and Session reference | No route contract | — |
| `MANAGED_ACCESS_SESSION_EXPIRED` | Persisted EXPIRED transition/audit | IMPLEMENTED_OFFLINE | Bounded Session audit scan | OFF | Expired state and Session reference | No route contract | Not inferred from a frontend countdown |
| `MANAGED_FULL_PAYMENT_VERIFIED` | Verified and applied PayOS capture | Already implemented | Existing bounded payment recovery | Existing payment-only gate | Verified payment summary | No route contract | Kept separate from contract status |
| `MANAGED_CONTRACT_SIGNED` | ManagedReservationAudit plus matching customer and Facility signatures for same version/hash | IMPLEMENTED_OFFLINE | Bounded contract-audit scan | OFF | Facility and Reservation reference | No route contract | Signature/content/proof data is omitted; pending-signature event not added because payment event already covers initial handoff |
| `MANAGED_CHECKIN_READY` | Verified signed-paper Contract and CHECKIN_READY history in same transaction | IMPLEMENTED_OFFLINE | Bounded contract-audit scan | OFF | Ready-to-handover status and Reservation reference | No route contract | Combined with paper Contract verification to avoid duplicate adjacent messages |
| `MANAGED_INBOUND_CONFIRMED` | V4 ADD Movement committed by Managed V3 Inbound Confirm | IMPLEMENTED_OFFLINE | Bounded Movement scan | OFF | Facility, Reservation, quantity and Movement reference | No route contract | Service still rejects Confirm in production; no ready/failed event is fabricated |
| `MANAGED_OUTBOUND_PARTIAL_CONFIRMED` | V4 REMOVE Movement and replay through its ledger revision | IMPLEMENTED_OFFLINE | Bounded ledger-prefix replay | OFF | Facility, Reservation, quantity and Movement reference | No route contract | Partial/full is derived from the canonical stock state immediately after that movement |
| `MANAGED_OUTBOUND_FULL_CONFIRMED` | V4 REMOVE Movement and replay through its ledger revision | IMPLEMENTED_OFFLINE | Bounded ledger-prefix replay | OFF | Facility, Reservation, quantity and Movement reference | No route contract | Mixed/invalid ledger history is deferred |
| `MANAGED_RELOCATION_CONFIRMED` | Customer V3 relocation V4 RELOCATION/MOVE Movement | IMPLEMENTED_OFFLINE | Bounded Movement scan | OFF | Facility, Reservation, quantity and Movement reference | No route contract | Route source has no MI06 gate; the separate legacy canonical relocation service is not this route |
| Reservation created/cancelled/expired | Managed Reservation state/history and ManagedReservationAudit | NOT_IMPLEMENTED | Source audit needed for owner-facing semantics | OFF | — | — | No N2 producer; do not confuse legacy approval actions with the V3 flow |
| Payment pending/failure/cancel | Reservation Payment lifecycle | NOT_IMPLEMENTED | Payment event history needs review | OFF | — | — | No new Payment lifecycle hook in R1 |
| No-show / Visit reminder | Time-window reconciliation | DEFERRED_TO_N4 | Scheduler policy required | OFF | — | — | No new cron or timing policy |
| Renewal / overdue / closure / Cell release | No verified current Managed V3 transition established | BUSINESS_SOURCE_GAP | — | OFF | — | — | No success event without a durable completion transition |

## Delivery behavior

New producers persist through the shared Notification service, which fails closed if the unique `{ userId, eventKey }` index is unavailable. Recovery pages require that index and the new gate; no index is created by application startup. Producer errors are isolated after the business transition commits.

Recovery services are bounded by batch size and ObjectId cursor. They can be invoked by an operator or a later administrative job; N2 registers no scheduler. Notification delivery remains disabled until index readiness, recovery behavior, and operational activation are approved separately.
