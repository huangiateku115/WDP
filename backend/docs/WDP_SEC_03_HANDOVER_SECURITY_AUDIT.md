# WDP-SEC-03A — Self-Storage Handover Security & Payment Trust Boundary Audit

**Mode:** Read-only source audit.  
**Date:** 2026-10-28.  
**Branch / HEAD:** `feat/mi07-managed-rental-closure` / `7a5cd84b7f1ba7e5076f268276fc49dbee0b138e`.  
**SEC-03A audit changes:** Documentation only; no runtime/test changes were made during the read-only audit. The separately authorized SEC-03B.1 follow-up is recorded at the end of this document. Existing dirty MI-06B/MI-07 and SEC-01/02 work was preserved. No database, payment provider, Docker, migration, seed, commit, push, or deployment operation was performed.

## A. Current authorization matrix

Route `POST /api/v1/reservations/:id/handover` is registered in `src/routes/reservation.routes.ts:49`, after the router-wide `requireAuth` at line 14, with allowed roles `FACILITY_STAFF`, `FACILITY_MANAGER`, and `ADMIN`. `requireRole` (`src/middlewares/auth/requireRole.ts`) checks only the role; it does not verify an assigned Facility.

| Actor | Route can pass role middleware | Handler verifies assigned Facility? | Source conclusion |
|---|---:|---:|---|
| Facility Staff | Yes | No | A Staff member assigned to Facility A can reach a paid Reservation for Facility B if they know its ID. |
| Facility Manager | Yes | No | Same cross-Facility gap. |
| Admin | Yes | No | Admin is allowed across Facilities by route shape, but no explicit policy or source-level scope rule states whether this is intended. Product Owner decision required. |
| Customer / other roles | No | Not applicable | Rejected by middleware. |

The handler (`src/controllers/reservations/reservation.controller.ts:771-805`) loads only by Reservation `_id`. It does not check `serviceType`, `facilityId`, StorageUnit existence/status, or that `StorageUnit.facilityId` equals `Reservation.facilityId`. It therefore also permits a Managed Inventory `PAID` Reservation to enter the generic handover method; this can bypass the dedicated Managed `activate` validations described below.

## B. Self-Storage versus Managed route reachability

The generic route has no Self-Storage service-type condition at route or handler entry. It checks only `Reservation.status === PAID` before setting `ACTIVE`. A Managed Inventory Reservation in `PAID` can therefore be changed to `ACTIVE` through generic handover without the checks in `ManagedReservationService.activate`.

The dedicated Managed activation method (`src/services/reservations/managed-reservation.service.ts:596-619`) requires a Manager/Admin, queries `serviceType=MANAGED_INVENTORY` and `status=PAID`, checks assigned Facility scope, current rental interval, positive allocated quota, signed Contract and customer signature, and active Managed Facility, then saves the state transition and audit event in a transaction. Generic handover does not repeat these checks and does not write the Managed audit event. This is a confirmed route-level bypass possibility, not evidence that it has been exercised.

A second legacy activation path exists: `PATCH /api/v1/inspections/:id/complete` is allowed to Staff/Manager/Admin/BOM (`src/routes/inspection.routes.ts`). `InspectionController.completeInspection` explicitly rejects Managed Inventory, but on a Self-Storage `CHECK_IN` it unconditionally updates the linked Reservation to `ACTIVE` and separately sets the inspection's StorageUnit to `OCCUPIED` (`src/controllers/inspections/inspection.controller.ts:45-94`). It does not check the Reservation's prior status, linked payment records, Facility assignment, or that inspection Facility/StorageUnit match the Reservation. This is an adjacent activation bypass candidate that must be included in a future Self-Storage activation remediation review. `createInspection` also spreads request body fields into a new Inspection and has no visible Facility authorization in this controller; record this as an adjacent authorization/input-integrity finding.

## C. Payment trust-boundary matrix

`ReservationPayment` (`src/models/payments/reservation-payment.model.ts`) records immutable Reservation/customer/Facility/service/purpose/amount/currency/idempotency/provider/reference attributes and a mutable status. Providers are `PAYOS` and `MOCK`; statuses include `PENDING`, `SUCCEEDED`, `FAILED`, and `RECONCILIATION_REQUIRED` (`src/types/payment.type.ts`). `providerReference` is optional and uniqueness is enforced when it is a string. These fields are evidence records, but this audit did not find a provider verification callback in the Reservation routes that establishes that an arbitrary `SUCCEEDED` record was externally settled.

| Evidence / path | Current source behavior | Is this authoritative real settlement evidence? |
|---|---|---|
| Self-Storage deposit via generic `confirmMockDeposit` | For Self-Storage, production is rejected by SEC-01 before payment/Reservation/Contract writes; non-production creates `provider=MOCK`, `status=SUCCEEDED`, updates Reservation to `DEPOSIT_PAID`, and may create a DRAFT Contract. See `reservation.controller.ts:525-628` and SEC-01 docs. | No. MOCK is simulation. The guard is production-only, so unset/nonstandard environments are not explicitly denied. |
| Self-Storage balance via generic `confirmMockBalance` | Production is rejected before Reservation lookup (`reservation.controller.ts:691+`). In non-production it requires signed Contract proof and records MOCK success before setting Reservation `PAID`. | No. Signed proof establishes contract evidence, not provider settlement. The guard is production-only, not a strict development/test allowlist. |
| Legacy generic `mock-pay` | SEC-02 now limits it to exact `development`/`test`, retains Customer/owner/SELF_STORAGE/CONTRACTED predicates, and transitions directly to `PAID` without a Payment record or provider call (`reservation.controller.ts:407-446`). | No. It is explicitly simulation-only. |
| Legacy CHECK_IN inspection completion | `InspectionController.completeInspection` transitions a Self-Storage Reservation directly to `ACTIVE` and the unit to `OCCUPIED`; it does not require `PAID` or linked payment evidence. | No. It is a separate activation-bypass candidate. |
| PAYOS | `PAYOS` is an allowed provider enum and `providerReference` exists, but this targeted route audit found no Reservation provider callback/webhook that verifies external settlement. | Not established by the inspected evidence. Exact missing dependency: trusted provider callback/verification logic that validates provider reference, amount, currency, purpose, Reservation identity, and final settlement before setting payment `SUCCEEDED` / Reservation paid. |
| Contract | Contract model stores signatures, content versions, proof URL, verifier and timestamps. `handoverReservation` does not query the Contract or require `SIGNED`, signatures, or proof. | No payment evidence; contract validity is a separate missing handover precondition unless Product Owner confirms it is not required for Self-Storage. |

`PAID` is therefore not a sufficient proof of real settlement in this source state: it can be produced by simulation paths, including direct `mock-pay` in allowed development/test. SEC-01/02 containment is not deployed, and no historical payment records were accessed. No real settlement was verified in this audit.

## D. Reservation / StorageUnit consistency risks

The handover method currently:

1. Reads Reservation by ID.
2. Checks only `PAID`.
3. Mutates Reservation to `ACTIVE`, sets `handoverByStaffId`/`handoverAt`, appends status history, and calls `reservation.save()`.
4. Separately calls `StorageUnitModel.findByIdAndUpdate(storageUnitId, { status: OCCUPIED })` without session, Facility predicate, expected prior status, or booking-version increment.

There is no shared transaction. If Reservation save succeeds and the StorageUnit update fails, the Reservation remains ACTIVE while the unit may not be OCCUPIED. Conversely the code does not verify the StorageUnit update matched a document. A missing `storageUnitId` also does not prevent activation. The PIN response is the fixed literal `1234`, so it is not a per-handover secret.

Reservation schema has no `optimisticConcurrency: true` option (`src/models/reservations/reservation.model.ts`); handover does not issue an explicit conditional status/version update. StorageUnit schema has `optimisticConcurrency: true`, but the handover uses query-style `findByIdAndUpdate`, which does not apply document `save()` optimistic concurrency semantics. The unit update is ID-only and sets OCCUPIED without a status/CAS predicate.

Reservation creation in `ReservationService.createReservation` starts a transaction, first increments the StorageUnit `bookingVersion` using a Facility-scoped conditional update, then checks overlapping Reservations, then inserts the Reservation (`src/services/reservations/reservation.service.ts:142-210`). Handover does not participate in this StorageUnit serialization point. Current create overlap logic treats RESERVED, CONTRACTED, PAID, ACTIVE and OVERDUE as occupying; it is interval-based rather than unit-status-only.

## E. Concurrency and transaction requirements

Handover should atomically commit the Reservation transition/history and the corresponding StorageUnit occupancy mutation (if that remains the approved Self-Storage model). Otherwise failures can leave cross-document state inconsistent.

Minimum compatible lock protocol for a future patch, subject to replica-set validation:

1. Read Reservation only to discover the referenced StorageUnit and Facility; do not mutate.
2. Begin transaction and acquire the StorageUnit booking serialization token first, scoped by both `_id` and `facilityId` (consistent with ReservationService booking's StorageUnit-first order).
3. Conditionally transition Reservation from `PAID` to `ACTIVE` using `_id`, `serviceType=SELF_STORAGE`, exact `facilityId`, exact `storageUnitId`, and expected version/status predicates; include owner/scope facts already verified.
4. Conditionally update StorageUnit state in the same session and verify a match. The exact allowed prior status and interval semantics require Product Owner decision because the current booking code permits future overlapping intervals while the status is a single current-state field.
5. Commit both writes and history atomically. A repeated request should return a stable conflict or verified idempotent result without appending duplicate handover history or changing unit state again.

This ordering is a design proposal, not proven safe. It must be checked against all writers touching StorageUnit/Reservation, including booking, contract-related bookingVersion updates, inspection transitions, cancellation, and the final handover, using a disposable authorized MongoDB replica set. Unknown commit results must be resolved by reading durable Reservation and StorageUnit state; never report success from the pre-commit in-memory document.

Cancellation only accepts RESERVED/CONTRACTED in the current controller (`reservation.controller.ts:374-405`), so it does not directly cancel a PAID Reservation. A race between balance settlement and cancellation still needs transaction/write-conflict testing because those flows conditionally update the same Reservation. Competing handovers have no explicit CAS in the current method. Partial failure and unknown-commit behavior have no handover-specific handling.

## F. Existing tests and missing coverage

`tests/reservation.test.cjs` currently has a mock-based happy-path handover test for PAID → ACTIVE plus OCCUPIED, and a test rejecting a non-PAID handover (around lines 1308-1358). These tests do not prove route-level facility authorization, payment evidence, service-type isolation, atomicity, or concurrency.

Missing focused coverage includes:

- Facility Staff/Manager from Facility A cannot hand over Facility B; Admin cross-Facility behavior matches an explicit policy.
- Generic handover rejects Managed Inventory and directs it through dedicated activation.
- Legacy CHECK_IN completion cannot activate an unpaid or cross-Facility Self-Storage Reservation; Managed rejection remains effective.
- Reservation Facility equals StorageUnit Facility and the unit exists and is eligible.
- No activation when deposit/balance evidence is missing, failed, mismatched, MOCK, or unverified PAYOS.
- Contract signature/proof requirements, after policy decision.
- Handover does not mutate Reservation if StorageUnit write fails, and does not occupy a different/mismatched unit.
- Repeated handover, two Staff concurrently, concurrent cancellation/payment transition, stale status/version, and unknown commit outcome.
- Existing SEC-01/02 behavior remains intact; Managed activation still enforces its own path.

Existing SEC-01/02 and Managed tests are mock/unit tests. No tests were run for this read-only audit; no claim is made that source review or mocks prove MongoDB transaction behavior.

## G. Recommended minimum SEC-03B patch

Approval-ready scope should be split so policy blockers do not get hidden inside a code patch:

1. **Mandatory service isolation:** require `SELF_STORAGE` in generic handover; reject Managed Inventory before any mutation. Preserve the dedicated Managed activation path unchanged.
2. **Mandatory Facility authorization:** for Staff/Manager, require assigned Facility to match Reservation Facility; verify referenced StorageUnit belongs to that same Facility. Confirm Admin cross-Facility permission explicitly before retaining it. Add Reservation/Facility/StorageUnit linkage checks to inspection completion.
3. **Mandatory atomicity/CAS:** transact Reservation and StorageUnit changes; use StorageUnit-first serialization consistent with booking; conditionally transition only a Self-Storage PAID Reservation once; verify both writes matched and keep history atomic. Add a prior-state and eligibility CAS to inspection-driven CHECK_IN activation too.
4. **Payment trust dependency:** before authorizing production activation, require authoritative settled deposit and balance evidence. Current source has no demonstrated real-provider verification path and allows MOCK workflows in non-production; do not treat `MOCK/SUCCEEDED` as settlement. Implementing a provider callback or deciding historical reconciliation is out of this audit and needs separate authorization.
5. **Contract and unit semantics:** define required signed-contract evidence and valid pre-handover StorageUnit state before implementation; avoid hardcoding these policy decisions.
6. **PIN:** replace static `1234` only with an approved secure handover credential design; this audit does not prescribe a new flow.

## H. Product Owner decisions required

- Is Admin explicitly allowed to hand over across Facilities?
- Must handover and legacy CHECK_IN completion require a signed Contract, and which signatures/proof fields are authoritative?
- What payment evidence qualifies as settled deposit and balance? Is verified PAYOS mandatory for production? What exact provider verification/callback is trusted?
- What is the allowed StorageUnit state before handover (`AVAILABLE`, `HELD`, or another state), and how should a single unit status represent interval-based bookings?
- Should the fixed PIN be removed, generated, or retained only in simulation? A real credential policy needs separate approval.
- What is the remediation process for historical `PAID`/`MOCK` Reservations with no trustworthy settlement linkage? No historical record inspection or mutation was authorized.
- Should generic Self-Storage deposit/balance simulation use the same strict development/test allowlist as SEC-02, or is a production-only rejection an intentional policy?

## I. Production exposure limitations

SEC-01/02 changes are not deployed. The source audit cannot establish what version is currently running, whether production configuration is correct, whether any historical mock transition occurred, or whether any real provider settlement exists. No database, provider, or production access was used. A `PAID` status without linked and independently verified settlement evidence must be treated as unverified for this audit; no payment settlement is certified here.

## J. Recommendation

**REVISE / BLOCKED for SEC-03B production activation implementation.** Generic handover has a confirmed Managed Inventory bypass possibility and missing Facility-scope checks for Staff/Manager. The separate CHECK_IN completion route can activate Self-Storage without checking PAID or payment evidence and also lacks visible Facility binding. Reservation and StorageUnit writes are non-atomic, with no explicit handover CAS. More fundamentally, the inspected source does not establish authoritative real payment settlement for production Self-Storage. Obtain the Product Owner decisions above and identify/authorize a real settlement-verification dependency before enabling a production handover patch. A narrower patch for service isolation, Facility scoping, and atomic state mutation can be separately approved, but it cannot make MOCK/unsupported `PAID` evidence trustworthy.

## SEC-03B.1 containment implementation follow-up (2026-10-28)

The Product Owner subsequently authorized a narrow fail-closed containment patch. The following implementation was applied without changing CHECK_OUT or Managed activation:

- Generic Self-Storage handover and legacy Self-Storage CHECK_IN completion now return HTTP 404 outside exact `development`/`test`, before their activation writes. This intentionally blocks legitimate production handovers and CHECK_IN activation until authoritative settlement verification and an operational continuity plan are approved.
- Generic handover requires `SELF_STORAGE`, an exact assigned Facility match for the authenticated actor, a `PAID` Reservation, and a non-deleted StorageUnit linked to the same Facility. Reservation activation is now a conditional update requiring the same service, Facility, StorageUnit and PAID state. The StorageUnit update is Facility-scoped.
- CHECK_IN requires a `PAID` Self-Storage Reservation; exact Inspection-to-Reservation Facility and StorageUnit linkage; an existing, non-deleted StorageUnit at that Facility; and actor assigned-Facility equality. Inspection completion is conditional on its original DRAFT/type/link fields, and Reservation activation is conditional on PAID/service/Facility/StorageUnit identity.
- Admin/BOM have no cross-Facility bypass: these paths require their `assignedFacilityId` to match the linked Facility. An unassigned Admin/BOM is denied. Managed Inventory remains rejected by generic handover and by legacy inspection activation; its dedicated activation was not changed. CHECK_OUT logic was left unchanged.
- Tests cover production/unknown rejection before writes, Managed handover denial, cross-Facility denial, missing/mismatched unit rejection, exact links, eligible development CHECK_IN, and existing Reservation handover behavior. The focused backend suite passed 114/114; tests are mocked and no replica-set test was run.

**Residual limitation:** Reservation/Inspection/StorageUnit writes are still not one transaction. A race or late database failure can leave an Inspection marked completed without activation, or can leave Reservation ACTIVE if a later StorageUnit update fails. Adding atomic multi-document session semantics and verifying its deployment topology is outside this restricted containment patch and requires separately approved hardening. The static `1234` response remains unchanged. No payment verification was added; MOCK/PAID remains non-authoritative. Production containment is not deployment.

Final patch assessment: **PARTIAL containment**—the approved environment, service, Facility, status, and linkage guards are implemented and covered by mocks; production activation is deliberately unavailable, and transaction atomicity/provider settlement remain unresolved.

The detailed SEC-03B.1 implementation/blocker report is `WDP_SEC_03B_1_ACTIVATION_CONTAINMENT.md`. It records that late-write failures can still leave partial state; SEC-03B.2 transaction/CAS work remains blocked pending separate authorization.
