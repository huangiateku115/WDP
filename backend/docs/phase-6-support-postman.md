# Phase 6 Support API (Postman)

All routes require `Authorization: Bearer {{accessToken}}`. Base URL: `{{baseUrl}}/api/v1/support-requests`.

## Create and browse

`POST /` as CUSTOMER:

```json
{
  "facilityId": "{{facilityId}}",
  "category": "ACCESS",
  "subject": "Gate access issue",
  "description": "The access code is not working.",
  "priority": "MEDIUM",
  "relatedEntity": { "type": "FACILITY", "id": "{{facilityId}}" }
}
```

`customerId` comes from the authenticated user and must not be sent by customers. Management-created requests must provide an existing active CUSTOMER `customerId`. Facility is optional; when supplied it must exist and not be soft-deleted. `GET /?page=1&limit=20&facilityId={{facilityId}}&category=ACCESS&priority=HIGH&status=OPEN&isEscalated=false&search=gate` lists permitted requests; filters include `customerId` and `assignedTo` as well. `GET /{{requestId}}` returns one visible request. A CUSTOMER may `PATCH /{{requestId}}` with `subject` and/or `description` only for their own OPEN request; after work starts they should use messages. Management roles may update `subject`, `description`, `category`, and `priority`. Customers cannot change category, priority, owner, assignment, or lifecycle fields.

## Assignment and lifecycle

`POST /{{requestId}}/assign` with `{ "staffId": "{{staffId}}" }` assigns active `FACILITY_STAFF` in the request facility and changes OPEN to ASSIGNED. A request already ASSIGNED may be reassigned. `POST /{{requestId}}/unassign` changes ASSIGNED back to OPEN.

`PATCH /{{requestId}}/status` bodies:

```json
{ "status": "IN_PROGRESS" }
{ "status": "RESOLVED", "resolutionNote": "Access reader reset and tested." }
{ "status": "CLOSED" }
```

Supported transitions are OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED. Assignment must be completed before the ASSIGNED state; resolution requires a non-empty note. Lifecycle dates are set by the server.

## Messages and escalation

`POST /{{requestId}}/messages` with `{ "message": "I can access the facility now." }` adds a public message. Staff may set `"isInternal": true` for a private note. `GET /{{requestId}}/messages` returns public messages to customers and all messages to authorized staff/management.

`POST /{{requestId}}/escalate` is a manual action for management. It records the active Facility Manager assigned to the request's facility. It does not calculate an SLA deadline or start a scheduled escalation. Requests without a facility or without an active assigned Facility Manager fail safely with 409.

## Soft delete and restore

Management only: `DELETE /{{requestId}}` soft-deletes OPEN requests. `POST /{{requestId}}/restore` restores the original request and validates that its attached facility is still active. No route physically deletes requests or messages.

Suggested checks: create as two customers and verify each can only list/get their own requests; attempt internal message as a customer (403) and confirm the note is absent from customer message reads; test same-facility and wrong-facility assignment; test every valid and invalid lifecycle transition; escalate with and without an active facility manager; delete an OPEN request and verify it disappears from list/get before restoring it.

`relatedEntity.type` is limited to `FACILITY`, `STORAGE_UNIT`, `RENTAL`, `PAYMENT`, `ITEM`, `LOCATION`, or `OTHER`. Rental, Payment, Item, and Location IDs are retained as generic metadata because those models are not part of this phase. Existence validation currently applies only to Facility and StorageUnit.
