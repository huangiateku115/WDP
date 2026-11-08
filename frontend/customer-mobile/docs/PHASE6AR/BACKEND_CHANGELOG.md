# Backend changelog — verified 7a5cd84 content baseline to current source

See [baseline](BACKEND_CURRENT_BASELINE.md), [API matrix](API_CHANGE_MATRIX.csv) and [current evidence](SOURCE_EVIDENCE.md). `FIXED` below means **FIXED_IN_SOURCE — DEPLOYMENT_UNVERIFIED**. No result is a live regression or security test.

## Actual API additions

| Method | Full new path | Current implementation |
| --- | --- | --- |
| GET | /api/v1/storage-units/:id/availability | StorageUnitController.getUnitAvailability → StorageUnitService.getUnitAvailability, UTC calendar/range read |
| GET | /api/v1/reservations/managed/:id/closure-readiness | ManagedClosureReadinessService.get, snapshot diagnostic only |
| POST | /api/v1/reservations/:id/payments/payos | PayosPaymentService.createCheckout, Customer Self only |
| GET | /api/v1/reservations/:id/payments/payos | listCustomerPayments, bounded owner-scoped cursor history |
| GET | /api/v1/reservations/:id/payments/:paymentId | getCustomerStatus, owner-scoped status with reconciliation |
| POST | /api/v1/payments/payos/webhook | SDK-verified provider callback; never a Customer operation |

**6 NEW, 0 REMOVED, 0 RENAMED** relative to the verified old route inventory. Existing routes remain mounted; some now reject states/environments they formerly accepted. No endpoint rename is inferred from a service refactor.

Primary classification totals across 184 rows: NEW 6; REQUEST_CHANGED 1; BEHAVIOR_CHANGED 19; SECURITY_CHANGED 7; UNCHANGED 151. The 27 changed existing operations may have multiple effects; primary counts are mutually exclusive. Unit list also changes response decoration; Self create also changes response/lifecycle. The matrix summary and narrative record secondary effects rather than inflating route totals. `UNCHANGED` means no external difference established in the compared source, **not secure, enabled, deployed or exhaustively runtime tested**. Whole-file service changes alone were not counted as behavioral differences for every read method.

## Business changes with concrete consequences

| Area | Previous verified behavior | Current verified behavior | Evidence / impact |
| --- | --- | --- | --- |
| Self overlap | Committed DEPOSIT_PAID/CHECKIN_READY absent | Shared buildOverlapFilter includes both, committed states unaffected by hold expiry; temporary RESERVED/CONTRACTED require expiresAt>now | R17; reservation.service buildOverlapFilter. Keep end-exclusive adjacency tests. |
| Self discovery | Unit list rejected interval fields; no calendar route | list accepts startDate/endDate/availableOnly, annotates isAvailableInRange; exact availability returns UTC month intervals and nullable rangeAvailability, UNKNOWN scan bound | R18; storage-unit.service getUnitAvailability/list and validation.parseList. Website already has calendar; native outdated. |
| Self create | RESERVED, contract later at approval | CONTRACTED + DRAFT contract in same transaction, profile revalidated;409 top-level suggestedUnits max5 with same-size preference | R19; reservation.service createReservation/findAvailableAlternatives; controller createReservation. No blanket removal of legacy approval routes. |
| Self payments | No provider implementation in old source | Real PayOS SDK intent/link, signed callback, immutable owner/economic identity, status + bounded per-reservation history | R11; payos-payment.service. **Self only**, not Managed provider readiness. |
| Payment state | One payment status insufficient for provider | status, providerSettlementStatus and applicationStatus distinct; verified funds can remain MANUAL_REVIEW, history visible without reusable checkout | PayOS statusDto/currentIntentIssue/handleWebhook; payment model/type. Mobile must not mark paid from redirect or SUCCEEDED alone. |
| Self mocks | No environment guard | Legacy mock-pay dev/test only; Self mock-confirm production denied but not uniformly positive dev/test opt-in; old multiwrite paths remain | R07; reservation.controller mocks. PARTIALLY_FIXED, keep disabled. |
| Self activation | Loose handover writes; CHECK_IN weak linkage | Handover/CHECK_IN dev/test-only, exact scope/linkage, CAS and atomic updates, unknown-commit recovery; narrow handover replay | R33; reservation.controller handoverReservation, inspection.controller completeInspection. Production activation remains blocked even with PayOS. |
| Managed v1 paper/mocks | Generic writes could bypass V2 | Managed paper rejects V2, requires scope/preactivation/no closure, atomic proof and lifecycle; Managed legacy mock deposit/balance transactional/replay-aware | R08/R07; contract.controller and reservation.controller. Self branch not equivalently fixed. |
| Inventory creation/edit | Unimaged registration/metadata could write outside shared transaction | Every create/edit acquires reservation lifecycle fence/CAS, rechecks scope, images and metadata atomically; registration has bounded retry window | R14/R35; inventory-item.service withRegistrationTransaction/lockReservationForRegistration/update.409 now expected during closure/lifecycle races. |
| Inbound vs closure | No common activeClosureRequestId fence | Register/edit/inbound create/amend/accept/physical confirm/relocation blocked by pending closure; reads/cancel/return resolution are different | R14; current inventory, repeated request, receiving and canonical relocation services. Do not globally disable outbound/cleanup. |
| Outbound vs closure | Reservation increment lacked matching observed lifecycle version | Observed-version fence; normal outbound still in-term ACTIVE, permitted during closure; cancellation/rejection release existing holds under resolution checks | R14; managed-outbound-request lockReservationFence; inventory-item lockReservationForOutboundResolution. No new overdue-outbound permission. |
| Return cleanup | Repeated return-completed asserted main gate | Return-completed no longer calls assertGate; Staff/scope/version/key/transition checks remain, now item/reservation fence | repeated-inbound-operations.completeReturn. Gate-off must not strand existing custody. |
| Closure | No readiness endpoint or marker | Optional activeClosureRequestId marker; GET diagnostic reconciles ledger/holds/physical/allocation in snapshot. No closure request/create/confirm/release endpoint | R20; managed-closure-readiness; reservation model/type. Overall UNKNOWN/BLOCKED, never approve close. |
| Transaction execution | Some Promise.all used one Mongo ClientSession | Sequential reads in Managed contract and approval internals | managed-checkin/currentContent/createContract, managed-reservation.approve diff. Reliability correction; not a new DTO or lifecycle. |

## Historical findings re-verification

All **29 entries** from the previous Gap Register map to current evidence in [HISTORICAL_FINDING_RESOLUTION.csv](HISTORICAL_FINDING_RESOLUTION.csv). They are not copied forward as facts without rechecking. Main outcomes:

- FIXED: Self overlap, interval availability.
- PARTIALLY_FIXED: real provider (Self only), legacy Self mock restrictions, Staff scope/activation hardening, metadata transaction safety, source revision identity.
- STILL_PRESENT: no refresh; audience/OTP concerns; Managed V2/MI06 production gates; unsafe print; Managed review-bound signing gap; Self pricing binding; private support reference validation; no typed notification target; fixture/domain drift and missing native acceptance.
- REPLACED_BY_NEW_BEHAVIOR: Self initial lifecycle; inventory closure fencing; diagnostic closure read. These are not production closure capabilities.
- CANNOT_VERIFY: current advisory scan/runtime reachability; deployment settings. Expanded inspection-scope/allowlist/dependency findings have no demonstrated old audit conclusion and are not labelled regressions without evidence.

No production fix claim; no invented history for files outside the baseline. Existing website PayOS/calendar work is current source evidence, not work performed by this audit.
