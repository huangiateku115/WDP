# MI-06B Phase E — Backend and Frontend Handoff

## Scope and safety

This handoff wires the existing repeated-inbound workflow into Staff navigation, adds read-only Facility-scoped canonical outbound queue/detail APIs, and adds Customer outbound, Staff outbound and canonical relocation screens. It does not change Phase A–D movement, hold, counter, contract or payment writers. New canonical write gates remain independently controlled, default OFF and production-forced OFF.

All Staff routes remain inside the authenticated Staff workspace. With `VITE_USE_MOCK=false`, `RoleWorkspaceOutlet` verifies the session through `/users/me` and requires `FACILITY_STAFF`; each new Staff API also has `requireAuth` and `requireRole(FACILITY_STAFF)`. The Backend checks `assignedFacilityId` against each request/Item and returns 404 for a resource in another Facility.

## Staff routes

| Frontend path | Page | Backend use |
|---|---|---|
| `/staff/inventory/inbound` | `RepeatedInboundQueuePage` | Existing `/inbound-requests/receiving-queue`, `/:requestId/receiving`, evidence, inspection, return and confirm routes |
| `/staff/inventory/outbound` | `CanonicalOutboundQueuePage` | New Staff queue/detail reads and existing canonical confirmation |
| `/staff/inventory/relocation` | `CanonicalRelocationPage` | New read-only relocation context and existing canonical relocation writer |

Staff navigation exposes these links in live mode. The pages use the real API client and do not invoke demo Self-Storage operations.

## API contract additions

All paths are under `/api/v1`.

### Staff outbound queue

`GET /outbound-requests/staff-queue?state=PENDING&page=1&limit=20`

- Role: `FACILITY_STAFF`; Facility is taken from the authenticated Staff assignment, never a caller-supplied Facility ID.
- Supported state filters: `PENDING`, `CONFIRMED`, `PARTIALLY_FULFILLED`, `CANCELLED`. Default is `PENDING`.
- Stable order: `createdAt ASC, _id ASC`; page size 1–100.
- Response: `{ success: true, data: { data: [{...requestDto, item}], pagination } }`.
- Invalid filter/pagination: 400. Wrong role: 403. Missing Facility assignment: 403.
- Read-only: does not change holds, stock, movements, request state or counters.

### Staff outbound detail

`GET /outbound-requests/:requestId/staff-detail`

- Role/Facility scope as above; another Facility’s request returns 404.
- Response contains `request`, minimal `item`, minimal `customer` display identity, and `stock` (`currentQty`, `heldQty`, `availableQty`, current Cell, source and version). The request version is also returned as `ETag: "<version>"` for the existing `If-Match` confirm operation.
- Customer owner-only `GET /outbound-requests/:requestId` is unchanged.

### Customer stock balance read

`GET /inventory-items/:itemId/stock-balance`

- Authenticated inventory owner may read their own Item’s balance; existing authorized operational roles remain supported, with Facility Staff scoped to their assigned Facility.
- This permits the Customer UI to display authoritative on-hand/held values. It is read-only and does not enable a write gate.

### Relocation context

`GET /inventory-items/:itemId/relocate-canonical/context`

- Role: `FACILITY_STAFF`, exact assigned Facility scope.
- Requires an active in-term Managed Inventory reservation, stored positive stock, reconciled movement and StockBalance history, no unresolved inbound/outbound request, no active hold, and current allocated source Cell.
- Returns Item placement, current/held/available quantities, and active reservation-owned Cell allocations whose Cell is operationally available (plus the current source Cell for context).
- The list is advisory; `POST /inventory-items/:itemId/relocate-canonical` remains authoritative for final allocation dates, packing, lineage, geometry, capacity and counter checks.
- Read-only; it does not reserve or mutate Cells.

## Customer outbound behavior

The Customer Item detail selects the canonical UI only when Item movement history contains a schema-v2 or `CANONICAL_V1` movement. Otherwise it preserves the existing legacy outbound component. If movement history cannot be read or a canonical Item has no readable balance, the UI fails closed instead of falling back to the legacy whole-lot writer.

Canonical UI reads `CurrentQty = onHandQuantity`, `HeldQty = heldQuantity`, and `AvailableQty = onHandQuantity - heldQuantity`, then uses the existing create/history/detail/cancel APIs. While an outcome is uncertain, CREATE preserves its exact payload and key; CANCEL preserves its expected version and key. Staff confirmation preserves payload, key and `If-Match` version; relocation preserves its exact payload and key. Session storage is only retry state, never proof of a committed operation. The UI handles 201 creation, 200 replay, 409 conflict/stale state and 503 disabled/uncertain outcome, and refreshes balance/history after known results. The Backend remains final authority for quantity and lifecycle validation.

## Manual Postman verification

Import `backend/postman/WDP_MI06B_Repeated_Inbound.postman_collection.json` and the development environment template. Set the actual backend port, Customer/Staff/other-user tokens, target Facility and test IDs. Use only an authorized disposable development/test environment; no tests here connect to or write a database.

1. Establish the initial active reservation and first receipt using the existing MI-03B first-inbound procedure. Confirm reservation activation and initial movement. The collection begins after this prerequisite; it does not replace first-inbound requests.
2. In the repeated-inbound folder, create an additional receipt request, replay the same key, inspect, upload evidence, and confirm. Verify StockBalance and receipt movement lineage.
3. Create a quantity-aware partial outbound request. Verify CurrentQty is unchanged while HeldQty rises. Read Customer history/detail.
4. Use Staff Facility-scoped queue and detail GET requests. Confirm delivery with an actual quantity below the hold; verify one REMOVE movement, released unused hold, partial request state and refreshed stock.
5. In the Phase D folder, load relocation context and manually choose a currently allocated destination Cell. Confirm a MOVE with the existing endpoint; verify CurrentQty and HeldQty remain unchanged and the movement preserves each receipt-batch lineage.
6. Create a new outbound request for the remaining quantity, Staff-confirm to zero, verify Item/StockBalance placement is cleared and reservation allocations remain.
7. Create a new repeated receipt for the same Item and verify the new batch is attached to an eligible allocated Cell without changing legacy `InventoryItem.quantity` or creating a contract/payment event.
8. Run the included cross-Customer, cross-Facility, unresolved-request and gate-OFF cases with separate disposable requests/Items as their descriptions require.

Postman scripts capture request IDs/versions, confirmation IDs, relocation movement ID, destination Cell and operation keys. The collection JSON and environment JSON parse locally, but no manual workflow or Postman run has been performed. Mocks and builds do not establish MongoDB transaction/concurrency correctness.

## Verification limits

Frontend source-contract tests verify the route bindings and API usage. The repository does not include a DOM/browser test runtime (`jsdom`, Testing Library or React Test Renderer), so they do not simulate user clicks or prove rendered browser behavior. Real browser, Postman and MongoDB replica-set integration remain separate verification steps.
