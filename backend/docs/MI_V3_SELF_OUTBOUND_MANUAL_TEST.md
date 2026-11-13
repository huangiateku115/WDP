# Managed Inventory V3 Customer Self-Outbound — Manual Verification

Run only against an authorized, disposable MongoDB replica-set test database after deploying the new outbound indexes to that test database. Do not use production inventory. The test database must contain certified topology, complete capacity counters, an ACTIVE V3 Reservation with completed handover, occupied Cell allocations, a checked-in OUTBOUND Visit, and an assigned active Staff account.

## A2 partial outbound

1. Create a V3 A2 SKU with a certified Cell placement and inbound receipt of 10 units. Verify replay, BatchPlacement and the stock projection each show 10; the receipt Movement is immutable.
2. Create an outbound request for 3. Verify the request is PENDING, the immutable CREATE event exists, stock remains on-hand 10, held is 3, available is 7, and no REMOVE Movement exists.
3. Create an OUTBOUND Access Visit for the Reservation, have the Facility Manager assign Staff, then have the assigned Staff check in. Verify the resulting Session allows OUTBOUND and every source Cell.
4. In the Customer Web, preview the exact request, physically remove the selected goods under Staff supervision, check the Customer attestation box, then confirm once. Verify one REMOVE Movement, stock 7, held 0, available 7, BatchPlacement 7, matching Cell and Reservation counters, CONFIRMED request and linked Movement ID.
5. Reload both Customer inventory and Manager/Staff monitoring. Verify the same Movement and event history remain visible.

## FIFO across receipts

1. Add an older receipt of 5 units and a newer receipt of 7 units, with authoritative receipt timestamps and distinct Movement IDs.
2. Request 8 units. Verify Preview allocates 5 from the older receipt then 3 from the newer receipt, preserving batch, Cell and receipt Movement lineage.
3. Cancel the request. Verify a CANCEL event, no REMOVE Movement, unchanged on-hand quantities and all holds released.
4. Create a new 8-unit request, complete the OUTBOUND Visit/Session flow, and verify the older receipt is depleted and the newer receipt has 4 units.

## A1 whole PhysicalUnit

1. In a certified single-Cell A1 fixture, create a request for one unit. Verify all of the unit's source footprint is held and quantity remains one regardless of footprint Cell count.
2. Confirm in an OUTBOUND Session. Verify one REMOVE Movement includes the complete footprint; PhysicalUnit becomes REMOVED and Footprint becomes RELEASED, retaining its original pose/certification history.
3. Verify that a multi-Cell A1 unit lacking certified load-sharing evidence is rejected before request creation.

## Recovery and safety checks

- Replay the same create/cancel/confirm request with the same key after a simulated lost response; verify one request/event transition and one REMOVE at most.
- Revoke/check out the Session, change its revision, or use a wrong purpose/Cell before confirmation; each must fail without changing Movement, placement, capacity, request state or holds.
- Race two requests, two confirms, and cancel against confirm. Verify one winner and that losers receive a conflict/stale response.
- Inject a failure after Movement creation inside the transaction; verify Movement, projections, placement docs, capacity counters and request/events all roll back.
- Change a Cell counter or projection without matching the canonical history; verify the service reports an unresolved reconciliation error and does not write.

Record database server version/topology, index list, test fixture IDs, request IDs, session ID, Movement IDs and assertions. Never copy production customer or payment data into the fixture.
