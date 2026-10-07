# Phase 5 / BE-12 Maintenance tickets (Postman)

Set `baseUrl` to `http://localhost:3000/api/v1`. All routes require
`Authorization: Bearer {{accessToken}}`. No physical delete is provided.

## Create and read

`POST {{baseUrl}}/maintenance-tickets` (ADMIN, BOM, FACILITY_MANAGER, FACILITY_STAFF)

```json
{
  "facilityId": "{{facilityId}}",
  "storageUnitId": "{{storageUnitId}}",
  "title": "Entry door does not close",
  "description": "The latch sticks when the door is closed.",
  "category": "ACCESS",
  "priority": "HIGH"
}
```

Omit `storageUnitId` for a facility-only ticket. `reportedBy` is derived from
the token and must not be sent. The facility must exist and not be soft-deleted;
an optional unit must also be live and belong to that facility.

`GET {{baseUrl}}/maintenance-tickets?page=1&limit=20&facilityId={{facilityId}}&status=OPEN&priority=HIGH&category=ACCESS&assignedTo={{staffId}}&search=door`

`GET {{baseUrl}}/maintenance-tickets/{{ticketId}}`

ADMIN/BOM can read across facilities. Facility managers are scoped to their
assigned facility. Facility staff see only tickets assigned to themselves.
Deleted tickets are omitted from list and detail.

## Management and transitions

Metadata update (ADMIN/BOM/FACILITY_MANAGER, scoped):
`PATCH {{baseUrl}}/maintenance-tickets/{{ticketId}}`

```json
{ "priority": "URGENT", "title": "Urgent: entry door does not close" }
```

Assign (ADMIN/BOM/FACILITY_MANAGER, scoped):
`POST {{baseUrl}}/maintenance-tickets/{{ticketId}}/assign`

```json
{ "assignedTo": "{{staffId}}" }
```

The assignee must be an active FACILITY_STAFF user assigned to the same facility.
Unassign an ASSIGNED ticket with:
`POST {{baseUrl}}/maintenance-tickets/{{ticketId}}/unassign` (no body).

Status changes use `PATCH {{baseUrl}}/maintenance-tickets/{{ticketId}}/status`:

| From | To | Required body fields | Who |
| --- | --- | --- | --- |
| OPEN | ASSIGNED | `status` (must already be assigned) | ADMIN/BOM/Facility Manager |
| ASSIGNED | IN_PROGRESS | `status` | ADMIN/BOM/Facility Manager or assigned staff |
| IN_PROGRESS | RESOLVED | `status`, non-empty `resolutionNote` | ADMIN/BOM/Facility Manager or assigned staff |
| RESOLVED | CLOSED | `status` | ADMIN/BOM/Facility Manager or assigned staff |

Example resolve body: `{ "status": "RESOLVED", "resolutionNote": "Latch replaced and tested" }`.
Lifecycle timestamps are server-managed. Arbitrary transitions return 409.

## Soft delete and restore

ADMIN/BOM/FACILITY_MANAGER (facility-scoped):

- `DELETE {{baseUrl}}/maintenance-tickets/{{ticketId}}` soft-deletes an OPEN ticket.
- `POST {{baseUrl}}/maintenance-tickets/{{ticketId}}/restore` restores it if its parent Facility still exists and is not deleted.

Tickets in ASSIGNED or later states cannot be deleted. Restore keeps the ticket
ID and lifecycle history. Neither operation changes StorageUnit status.

Expected errors: 400 invalid input, 401 missing/invalid authentication, 403 role
or facility scope denied, 404 missing/deleted resource, 409 invalid transition or
resource conflict. Tests mock MongoDB; verify the workflow in a development
environment with your authorized bearer token and development database.
