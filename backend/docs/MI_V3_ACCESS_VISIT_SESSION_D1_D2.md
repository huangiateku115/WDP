# Managed Inventory V3 Access Visit / Session (D1–D2)

## Lifecycle

Customer creates a facility visit against their own V3 reservation with an idempotency key, purpose and UTC time window. `CHECKIN_READY` may schedule a visit; it cannot check in. A Facility Manager lists visits and active staff assigned to the same Facility, then assigns an escort using `If-Match`. A Customer amendment clears the escort and requires reassignment. At the visit, the assigned active Staff member verifies the active in-term V3 rental, full PayOS settlement, signed/verified current contract hash, handover and every allocated Cell. Staff records an attributable manual identity/presence/safety attestation. In one Mongo transaction, with revision write-fences on the Reservation, active Facility, Staff, payment, contract and allocations, the Visit transitions to `CHECKED_IN` and a persistent Session is created. Backend time sets `startedAt`; `expiresAt` is the earliest of 60 minutes, Rental end and Visit deadline. Allocations in `RESERVED` or `OCCUPIED` are eligible; `RELEASED` is never eligible. Customer operates inventory under that scope; this phase does not write inventory. Staff checks out; Staff or Manager can revoke for a required safety reason. Session end and Visit completion are transactionally consistent. Check-in reconciles only expired Sessions belonging to its own Reservation inside its transaction. The global worker scans bounded `_id` pages (up to 5,000 records per run), isolates each record in its own transaction, logs only Session ID and safe error code, continues after record failures, then reports the first error so the scheduled worker retries. Conditional ACTIVE-state updates make competing workers idempotent.

Manual Staff attestation is an auditable operator statement, not independent device-based presence proof. Do not describe it as biometric, geofenced or provider-verified evidence.

## API (mounted at `/api/v1/access/managed-v3`)

All endpoints require authenticated local user and role. Errors use `{ success:false, code, message }`.

Key conflicts and validation codes: `INVALID_INPUT`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_CONFLICT`, `INVALID_VISIT_WINDOW`, `INVALID_PURPOSE`, `RESERVATION_NOT_FOUND`, `RESERVATION_NOT_VISIT_READY`, `FACILITY_SCOPE_DENIED`, `VISIT_NOT_AMENDABLE`, `VISIT_NOT_CANCELLABLE`, `IF_MATCH_REQUIRED`, `STALE_REVISION`, `ASSIGNMENT_CONFLICT`, `STAFF_FACILITY_MISMATCH`, `ASSIGNMENT_REQUIRED`, `OUTSIDE_VISIT_WINDOW`, `ATTESTATION_REQUIRED`, `RENTAL_NOT_ACTIVE`, `PAYMENT_NOT_VERIFIED`, `HANDOVER_PREREQUISITES_MISSING`, `ALLOCATION_INVALID`, `ACTIVE_SESSION_EXISTS`, `SESSION_WINDOW_EXPIRED`, `CHECKIN_RESULT_NOT_ACTIVE`, `CONCURRENT_CHECKIN`, `STALE_OR_INACTIVE_SESSION`, and `ACCESS_SESSION_SCOPE_INVALID`. Non-owner Customer reads use 404 to avoid disclosing whether another account's record exists.

| Role | Method / path | Request / behavior |
|---|---|---|
| Customer | `POST /visits` | `{ reservationId, purpose, startsAt, endsAt, note? }`; `Idempotency-Key` required |
| Customer | `GET /visits/me` | Own visit list |
| Customer / assigned Staff / Manager | `GET /visits/:visitId` | Owner or facility/assignment-scoped detail; non-disclosing 404 |
| Customer | `PATCH /visits/:visitId` | `{ purpose?, startsAt?, endsAt?, note? }`; `If-Match` revision required; scheduled only |
| Customer | `POST /visits/:visitId/cancel` | Empty body; `If-Match` required; scheduled only |
| Manager | `GET /visits/facility` | Assigned Facility overview |
| Manager | `GET /visits/facility/staff` | Active Staff assigned to Manager's Facility |
| Manager | `PUT /visits/:visitId/assignment` | `{ staffId, reason }`; `If-Match` required; rejects cross-facility and overlapping schedules |
| Assigned Staff | `POST /visits/:visitId/check-in` | `{ identityVerified:true, customerPresent:true, safetyReviewed:true, safetyNotes }`; `Idempotency-Key` required |
| Customer | `GET /sessions/me` | Own session(s), effective expiry status and allowed Cells |
| Customer / assigned Staff / Manager | `GET /sessions/:sessionId` | Scoped detail |
| Staff / Manager | `GET /sessions/facility` | Facility sessions; Staff sees own assignments |
| Assigned Staff | `POST /sessions/:sessionId/check-out` | Empty body; `If-Match` required |
| Assigned Staff / Manager | `POST /sessions/:sessionId/revoke` | `{ reason }`; `If-Match` required; facility-scoped |

Session guard exported from `services/access/managed-access.service.ts` for later D3/D4 use: `assertManagedAccessSessionScope(...)`. It requires `cellIds` to contain every affected Cell (for relocation this is the union of source and destination footprint Cells), conditionally increments the session revision and appends an audit fence inside the caller's Mongo transaction. It uses Backend time internally and does not accept caller-supplied time. It revalidates session/customer/reservation/facility/purpose/revision/expiry, ACTIVE rental, handover, full-payment settlement, current signed contract hash, and all active allocations; reservation, facility, payment, contract and allocation write-fences serialize these checks with concurrent changes. If it throws, the caller must abort the entire transaction. No stock mutation is implemented here.

Create Visit and check-in idempotency keys are bound to canonical payload fingerprints. The original payload envelope is retained in browser `sessionStorage` for exact retries after navigation/reload; changed payloads cannot reuse a pending key, and the UI restores the original pending payload rather than replacing it. After uncertain responses, the UI reads server state before retrying. Terminal, expired or revoked Sessions are never presented as successful. Browser storage is retry support, not server truth; if it is cleared, reconcile through authenticated read APIs before a new operation.

## Persistence and operational limits

`ManagedAccessVisit` stores request hash/idempotency, schedule, assignment history, staff presence attestation, revisions and audit. `ManagedAccessSession` stores immutable scope, start/expiry, status/revision, check-in request hash and audit; a partial unique index allows at most one stored ACTIVE session per reservation. Exact active check-in replay returns the original Session; a different request under the same key conflicts, and expired/revoked replay is never reported as success. Check-in, check-out, revocation and expiry reconciliation use Mongo transactions and optimistic revision checks. Expiry reconciliation is idempotent, runs once after database startup and every minute, marks Session `EXPIRED`, completes its `CHECKED_IN` Visit at the stored expiry timestamp, and appends SYSTEM audit events; a conflict rolls back both records for retry. The feature does not inspect `NODE_ENV` or legacy MI06 flags and never uses the legacy PIN simulation route. MongoDB replica-set / transaction support, deployed indexes and write-fence behavior remain deployment-owner prerequisites and were not verified by connecting to a database.

Legacy `/access/simulate-unlock` remains for existing Self-Storage behavior and explicitly rejects Managed Inventory V3. No Staff/Manager access page simulates success; each new screen uses these Backend APIs.

## MongoDB integration verification plan (not run)

Requires an explicitly authorized disposable replica-set test database. Verify transaction support and deployed unique indexes first. Seed only synthetic Facility/Rental/Visit/Allocation/Payment/Contract/User records. Exercise concurrent check-in, revoke-versus-guard, two-worker expiry, and injected failures after Session and Visit updates; assert transaction-wide commit or rollback. Include an early repeatedly failing expired record followed by valid records, and exact 60-minute, Visit-end and Rental-end boundaries. No real database or Docker was used; status is `INTEGRATION_UNVERIFIED`.
