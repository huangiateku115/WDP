# Facility Assignment

This supplementary API manages the existing single `assignedFacilityId` on each user. Assignment is stored on the MongoDB User record; it does not add assignment history or multi-Facility access.

## Permission matrix

| Role | Assign/reassign | Unassign | Scope |
| --- | --- | --- | --- |
| ADMIN | Facility Manager or Staff | Facility Manager or Staff | Any existing non-deleted Facility; Admin's own assignment does not limit access |
| FACILITY_MANAGER | Facility Staff only | Facility Staff only | The Manager's current Facility; target Staff must be unassigned or already in that Facility |
| FACILITY_STAFF, BOM, CUSTOMER | No | No | — |

Managers must have an assigned Facility that still exists and is not soft-deleted. Managers cannot transfer Staff from another Facility or manage another Manager. Assignment requires an active target account; inactive accounts are rejected with `409`. Admin may still unassign an inactive account to clean up its scope. An inactive Facility is assignable by Admin because the rule requires an existing, non-deleted Facility; it may still be unavailable for operational use elsewhere.

## Endpoints

Both endpoints require authentication. Only ADMIN and FACILITY_MANAGER pass route middleware; the service repeats role and Facility-scope checks.

```http
PATCH /api/v1/users/{userId}/facility-assignment
Authorization: Bearer <access-token>
Content-Type: application/json

{ "facilityId": "<facility-object-id>" }
```

```http
DELETE /api/v1/users/{userId}/facility-assignment
Authorization: Bearer <access-token>
```

Successful responses contain only `_id`, `role`, and `assignedFacilityId`. The request accepts only `facilityId`; actor identity, role and Manager scope always come from the authenticated account.

Typical errors: `400` for invalid IDs/body, `401` for missing authentication, `403` for role or Manager-scope violations, `404` for a missing or soft-deleted Facility / missing user, and `409` for inactive accounts or concurrent assignment conflicts.

## Concurrency and audit

Assignment updates use a conditional `findOneAndUpdate` filter with the observed prior Facility. Manager writes additionally require that the target is still unassigned or in the Manager's Facility. This prevents a stale Manager request from overwriting a concurrent Admin transfer. Assignment and the `FACILITY_ASSIGNED`, `FACILITY_REASSIGNED`, or `FACILITY_UNASSIGNED` audit row are written in one MongoDB transaction. Transactional behavior requires a MongoDB deployment that supports transactions; this implementation was verified with deterministic mocks, not a live Atlas transaction.

Admin role changes to CUSTOMER or BOM clear `assignedFacilityId`; changing between Manager and Staff preserves the existing Facility assignment. Existing generic user update routes do not accept `assignedFacilityId` as an update field.

`requireAuth` loads the current MongoDB User on every request, so subsequent requests use the newly assigned Facility. No Keycloak role/group changes are made.

## Manual Postman sequence

1. Sign in as ADMIN; PATCH a Manager and a Staff user to Facility A.
2. Sign in as Manager A; assign an unassigned Staff account to A, then try Facility B (expect `403`).
3. Sign in as ADMIN; reassign the Staff account to Facility B.
4. Sign in as Manager A; try to reassign or unassign that Staff account (expect `403`).
5. Sign in as ADMIN; DELETE the Staff assignment and confirm the response has `assignedFacilityId: null`.
