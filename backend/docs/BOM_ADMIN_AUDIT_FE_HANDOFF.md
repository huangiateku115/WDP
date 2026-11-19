# BOM/Admin Audit API Handoff

Base path: `/api/v1/audit`. All endpoints require a valid Bearer token. This handoff describes the API implemented against the existing `AuditLog` and `LoginHistory` sources; it does not imply that an event exists when no writer recorded it.

## Endpoint catalog

| Method and path | Roles | Purpose |
|---|---|---|
| `GET /api/v1/audit/logs` | ADMIN, BOM | Global business AuditLog search |
| `GET /api/v1/audit/admin/subjects` | ADMIN | Paginated subject directory |
| `GET /api/v1/audit/bom/subjects` | BOM | Paginated directory excluding ADMIN/BOM |
| `GET /api/v1/audit/admin/audit-logs/:userId` | ADMIN | Existing per-actor log read |
| `GET /api/v1/audit/admin/login-history/:userId` | ADMIN | Existing per-user LoginHistory read |
| `GET /api/v1/audit/bom/audit-logs/:userId` | BOM | Existing per-actor log read, ADMIN/BOM targets blocked |
| `GET /api/v1/audit/bom/login-history/:userId` | BOM | Existing per-user LoginHistory read, ADMIN/BOM targets blocked |

ADMIN and BOM continue to use separate routes. CUSTOMER, FACILITY_STAFF, and FACILITY_MANAGER do not receive global Audit access. Route middleware enforces roles; service methods also reject roles outside ADMIN/BOM.

## Global AuditLog search

Example:

```http
GET /api/v1/audit/logs?action=UPDATE_PROFILE&entityType=User&facilityId=64f000000000000000000001&from=2026-11-01&to=2026-11-18&page=1&limit=20&sortOrder=desc
Authorization: Bearer {{accessToken}}
```

Supported parameters:

| Parameter | Meaning |
|---|---|
| `action` | Exact existing `ActionType` enum value |
| `entityType` | Exact stored string, 1–100 letters/numbers/dot/underscore/hyphen |
| `actorId` | Exact 24-character User ObjectId |
| `facilityId` | Exact stored Facility ObjectId; events with null facility are not included |
| `from`, `to` | Date-only `YYYY-MM-DD`, interpreted in `Asia/Ho_Chi_Minh` |
| `page` | 1–1,000,000; default 1 |
| `limit` | 1–100; default 20 |
| `sortOrder` | `asc` or `desc`; default `desc` |

The date interval is `[from local midnight, midnight after to)`, so `to` includes the full named day. Either bound may be omitted. When both are supplied, the range cannot exceed 366 days. Results are ordered by `createdAt` and `_id` in the selected direction. Total is an exact database count. Filters are applied in the database before pagination.

Response envelope:

```json
{
  "success": true,
  "data": {
    "items": [{
      "_id": "audit-id",
      "actorId": "user-id",
      "actorRole": "CUSTOMER",
      "action": "UPDATE_PROFILE",
      "entityType": "User",
      "entityId": "entity-id",
      "facilityId": null,
      "createdAt": "2026-11-18T01:00:00.000Z"
    }],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

The list DTO intentionally omits `before`, `after`, and free-text `reason`. `eventType` and `subjectId` are not fields in `AuditLog`; sending either returns `400 AUDIT_FILTER_UNAVAILABLE`. Login events use the separate `LoginHistory` collection, whose fields include `eventType`, `status`, `failureReason`, `userId`, `attemptedEmail`, `ip`, and `device`. The global business log does not merge LoginHistory because that would mix schemas and permission semantics.

## Subject directory

Examples:

```http
GET /api/v1/audit/admin/subjects?role=FACILITY_MANAGER&search=Lan&page=1&limit=20
GET /api/v1/audit/bom/subjects?role=CUSTOMER&facilityId=64f000000000000000000001&status=ACTIVE&search=lan&page=1&limit=20
```

Both endpoints support `role`, `facilityId`, `search`, `status` (`ACTIVE` or `DISABLED`), `page`, and `limit`. Search is a literal, case-insensitive substring over display name and email. The directory returns only `_id`, `displayName`, `email`, `role`, assigned Facility `{_id,name,code}` or null, and `isActive`; it does not return phone, Keycloak subject, password fields, or tokens.

ADMIN can query all current User roles. BOM can query CUSTOMER, FACILITY_STAFF, and FACILITY_MANAGER only; the role exclusion is applied in the database and in the service. BOM cannot request ADMIN/BOM roles. The existing BOM log policy has no Facility restriction, so the directory remains global for those permitted roles; `facilityId` narrows the results but does not define an authorization boundary. When BOM filters global logs by `actorId`, the service checks the actor's current role and uses a database lookup to exclude ADMIN/BOM audit subjects. An actor who no longer exists is excluded.

The directory returns only `_id`, `displayName`, `email`, `role`, assigned Facility `{_id,name,code}` or null, and `isActive`; it does not return phone, Keycloak subject, password fields, or tokens. Email is available only in this directory DTO for subject lookup under the route policy; it is never copied from Audit snapshots.

## Errors and security

| HTTP | Code | Meaning |
|---|---|---|
| 401 | existing auth envelope | Missing/invalid authentication |
| 403 | `AUDIT_FORBIDDEN` / `AUDIT_SUBJECT_FORBIDDEN` | Role or subject is outside policy |
| 400 | `INVALID_QUERY`, `INVALID_FILTER`, `INVALID_DATE`, `INVALID_PAGINATION`, etc. | Invalid, repeated/array, unsupported, or malformed query value |
| 400 | `AUDIT_FILTER_UNAVAILABLE` | Filter has no source field (`eventType`, `subjectId`) |

Global list results use an explicit summary allowlist (`_id`, `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `facilityId`, `createdAt`) and never select or serialize `before`/`after`, populated actor, or free-text `reason`. Existing per-user AuditLog reads retain their response envelope and before/after keys, but payload values are allowlisted recursively: only reviewed business fields are included; unknown keys and scalar values are redacted, and credentials, contact details, identity, and arbitrary mixed payloads do not pass through. Missing snapshots remain `null`. No raw login token or secret fields exist in the LoginHistory schema; its existing per-user endpoint contract remains unchanged.

## Audit source and limitations

- Business events are in Mongo collection `auditlogs` (`AuditLog` model): `actorId`, event-time `actorRole`, `action`, `entityType`, `entityId`, optional `facilityId`, `before`, `after`, optional `reason`, timestamps.
- Login events are in `loginhistories` (`LoginHistory` model), separate from business AuditLog.
- Existing writers cover User, Facility, StorageUnit, PricingRule, FacilityAssignment, MaintenanceTicket, and SupportRequest actions. This API does not create events for operations that have no writer.
- `subjectId` is not a first-class field. FacilityAssignment writes may include `targetUserId` inside before/after, but that does not make it a reliable cross-event subject filter.
- Many historical business events have no `facilityId`; they cannot be assigned to a Facility by inference and do not match a Facility filter.
- AuditLog has no declared compound query indexes in the current model. Exact counts and sorts may scan. Global queries have bounded page size, date range, and page number and apply filters before pagination, but that does not cap the database scan. Review query plans and collection size in a representative non-production environment before release. Candidate patterns to evaluate include `{createdAt: -1, _id: -1}`, `{action: 1, createdAt: -1, _id: -1}`, `{facilityId: 1, createdAt: -1, _id: -1}`, and `{actorId: 1, createdAt: -1, _id: -1}`. No index or migration was introduced here. Production performance has not been verified.
- Historical AuditLog snapshots may contain values stored under unexpected keys. The global endpoint does not expose snapshots; the legacy detail allowlist excludes unreviewed fields and non-object scalar payloads. Values under approved keys still require source-level care when adding new Audit writers.
- BOM access is role-wide under the existing policy, not Facility-scoped. Missing `facilityId` is not treated as proof of Facility access; exact Facility filters narrow results but do not authorize access. Historical records without Facility metadata cannot be safely assigned to a Facility, and records whose actor no longer exists are excluded from BOM global search.
- Audit Export is deferred (P2). Statistics exports have report-specific schemas, permissions, and resource limits; no safe shared Audit export path was established in this phase.

## FE integration notes

- Use `action` (not `eventType`) for the business Audit filter menu; accepted values are the existing `ActionType` values from the backend.
- Use the `/admin/subjects` or `/bom/subjects` endpoint matching the signed-in role. Do not call `/users` to build the selector.
- Use `actorId` when the selected subject is the actor. There is no general subject filter in the source schema.
- Keep the selected `facilityId` as a filter only; existing BOM access is role-wide, not facility-scoped.
- Date-only filters are Vietnam local dates and include the whole `to` date.
- The list DTO is suitable for the table. Existing per-user audit endpoints may supply sanitized before/after detail; `reason` is omitted from that response.
