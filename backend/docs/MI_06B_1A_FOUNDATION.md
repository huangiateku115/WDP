# MI-06B.1A — Non-operational repeated-inbound foundation

This phase adds only a disabled feature gate, request schema/type, pure lifecycle validation, isolated tests and this design record. It does not add routes, write receipt requests, create movements or StockBalance rows, or change any existing Managed Inventory operation.

## Receipt request lifecycle

There is at most one unresolved request per Item. States are `PENDING_INSPECTION`, `DISCREPANCY`, `ACCEPTED_PENDING_CONFIRMATION`, `RETURN_PENDING`, `REJECTED`, `CONFIRMED` and `CANCELLED`. Acceptance requires custody. Accepted physical quantity must exactly equal requested quantity. A discrepancy is preserved as an inspection attempt and may be reinspected; if custody is taken during that discrepancy event, the request records `IN_CUSTODY`, and prior custody is never cleared by a later inspection event. Request amendments are permitted only before the first inspection and before custody. Rejection checks both pre-existing custody and custody taken during the rejection event: either case enters `RETURN_PENDING`; only explicit return completion closes it as `REJECTED`. Cancellation requires an explicit confirmation that no inspection attempt exists, in addition to pending state and no custody; missing/unknown history fails closed. Confirmation of accepted goods leads to `CONFIRMED`.

Request creation identity, idempotency key and creation payload hash are immutable. Request state, current attempt and evidence/movement references are request-scoped. Version/CAS support is represented by `version` and Mongoose optimistic concurrency. The unresolved-request partial unique index covers all nonterminal request states.

## First versus repeated inbound

MI-03B first inbound remains on its existing `CHECKIN_READY` contract/payment/activation path. Repeated inbound is a separate future request flow for an already ACTIVE, in-term Managed Inventory reservation. It must not create contract versions, signatures or payment records. `InventoryItem.quantity` remains its registration value. No operational repeated-receipt path is enabled in this phase.

## Feature gates and cutover

`MI06_STOCK_LEDGER_WRITES_ENABLED` remains independent. `MI06_REPEATED_INBOUND_ENABLED` defaults to false and is forced false when `NODE_ENV=production`. No facility cutover state is persisted or activated; the following are design labels only: `LEGACY_ACTIVE_WRITER`, `DRAINING_LEGACY_WRITER`, `CANONICAL_RECEIPTS_ENABLED`, and `CANONICAL_RECEIPTS_PAUSED`.

The existing ACTIVE subsequent-inbound handler remains unchanged while the new gate is off. The old v2 ACTIVE handler must not write alongside canonical receipt writers after any facility cutover. A future approved cutover needs a drain/reconciliation boundary and a compatibility dispatch decision. Turning off canonical writes pauses new receipts; it does not erase committed v2 movements or make it safe to resume a v1 writer that cannot update the projection.

## Why operational writes remain blocked

This foundation does not wire an endpoint or service caller to the new schema. It performs no request creation, inspection, confirmation, ItemMovement append, StockBalance write, counter update or allocation change. Existing first inbound, ACTIVE subsequent inbound, inspection, outbound, relocation, capacity and contract/payment behavior are untouched. No automatic cutover occurs.

## Integration prerequisite

Transaction rollback, unique-index races and shared-cell concurrency require an explicitly authorized local/test MongoDB replica set with a disposable test database. Never use Atlas, production, or an unknown configured URI. This phase’s tests validate model and pure helper behavior only; it does not claim database index creation or transaction integration.
