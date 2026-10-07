# Phase 3.5 Postman requests

Use `{{baseUrl}} = http://localhost:3000/api/v1`. Public catalog reads need no
Authorization header. Facility/Storage Unit management requests use a Keycloak
Bearer token with an allowed management role. No request in this guide physically
deletes a record.

## Public catalog (no token)

| Method | URL | Behavior |
| --- | --- | --- |
| GET | `{{baseUrl}}/public/facilities?page=1&limit=20&serviceType=SELF_STORAGE&search=HCM` | ACTIVE facilities only |
| GET | `{{baseUrl}}/public/facilities/{{facilityId}}` | Public Facility DTO; inactive/deleted is 404 |
| GET | `{{baseUrl}}/public/facilities/{{facilityId}}/storage-options` | Available, non-deleted unit counts by size; informational only |
| GET | `{{baseUrl}}/public/facilities/{{facilityId}}/pricing` | Currently effective active rules for offered services |

Public DTOs omit audit fields, soft-delete fields, internal metadata and policy
configuration. Storage availability is a snapshot, not a reservation. Public pricing
omits future, inactive and expired rules and does not expose version/creator data.

## Facility soft delete and restore

All routes below use `Authorization: Bearer {{accessToken}}` and require ADMIN or BOM.

| Method | URL | Behavior |
| --- | --- | --- |
| DELETE | `{{baseUrl}}/facilities/{{facilityId}}` | Soft-deletes the Facility; does not cascade |
| POST | `{{baseUrl}}/facilities/{{facilityId}}/restore` | Clears `deletedAt`/`deletedBy` |
| GET | `{{baseUrl}}/facilities?includeDeleted=true` | Management list including deleted rows |

Regular Facility list/detail omit deleted rows. Facility code remains reserved while
deleted. Creating child Storage Units or pricing/policies under a deleted Facility is
rejected. Existing child records are not changed when their parent is deleted.

## Storage Unit soft delete and restore

Use an ADMIN/BOM/FACILITY_MANAGER bearer token (managers are restricted to assigned
facilities by the existing service scope).

| Method | URL | Behavior |
| --- | --- | --- |
| DELETE | `{{baseUrl}}/storage-units/{{unitId}}` | Soft-deletes AVAILABLE/MAINTENANCE/INACTIVE units |
| POST | `{{baseUrl}}/storage-units/{{unitId}}/restore` | Restores if parent exists, is not deleted and supports SELF_STORAGE |
| GET | `{{baseUrl}}/storage-units/{{unitId}}` | Deleted units are hidden (404) |
| GET | `{{baseUrl}}/facilities/{{facilityId}}/storage-units` | Deleted units are excluded |

HELD/OCCUPIED units cannot be soft-deleted. Unit code remains reserved while deleted.
Restore does not require an ACTIVE parent, but the parent must support SELF_STORAGE.
There is no cascading delete, and no PricingRule/Policy soft-delete endpoint.

Successful mutations return `{ "success": true, "data": ... }`. Validation errors
return 400, missing/hidden records 404, disallowed role 403, and lifecycle conflicts 409.

These endpoints do not implement later reservation, payment, inventory or policy
modules. In particular, a public availability count must never be treated as a hold.
