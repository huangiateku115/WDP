# MI-07 Managed Inventory Closure — MVP API Design

**Status:** proposed API/state design only. No routes, models, controllers, services, UI or feature gates are implemented by this document. All route paths and state names below are placeholders requiring API review.

## Workflow proposal

```text
Customer Request
  → Physical Clearance by assigned Facility Staff
  → Financial/Contractual Review
  → Facility Manager Approval
  → Atomic Closure and Allocation Release
```

Suggested request-state vocabulary, **proposed and not approved as a final enum**:

```text
REQUESTED → PHYSICAL_CLEARANCE → FINANCIAL_REVIEW → MANAGER_APPROVAL → CLOSED
    ├──────────────────────────────→ CANCELLED (rules unresolved)
    └──────────────────────────────→ REJECTED (reason required; resubmission rules unresolved)
```

No transition may mutate stock or movements. Final `CLOSED` and release must occur together only after the unresolved D06, D07 and D08 decisions are resolved.

## Permission matrix (proposed)

| Action | Customer owner | Assigned Facility Staff | Assigned Facility Manager | Admin/BOM |
|---|---:|---:|---:|---:|
| Create closure request | Yes | No | No | No by default |
| Read own request/history | Yes | No | No | No by default |
| Read facility queue/detail | No | Yes | Yes | Cross-Facility only if separately approved |
| Cancel request | Proposed; timing/policy unresolved | No | No | No by default |
| Record physical clearance/handover | No | Yes | No by default | No by default |
| Record financial review | No | Not implied | Role unresolved pending D06 | Not implied |
| Final approval | No | No | Yes | No by default |
| Atomic finalization | No | No | Authorized finalizer; proposed Manager | No by default |

Non-owner and out-of-Facility resources should be concealed with 404, following existing Managed resource conventions. Exact Admin/BOM access is intentionally not inherited without an explicit policy decision.

## Candidate endpoints — not implemented

These are design placeholders, not claims about existing API conventions. Confirm path naming and controller organization before implementation.

| Method/path | Actor | Payload/headers | Intended result |
|---|---|---|---|
| `POST /api/v1/reservations/managed/:id/closure-requests` | Owning Customer | Optional reason/effective request date only after schema approval; `Idempotency-Key` | Create one unresolved request; 201 new, 200 replay, 409 unresolved duplicate or conflicting key |
| `GET /api/v1/reservations/managed/:id/closure-requests` | Owner; scoped Manager/Staff for operational view | Cursor/page and limit | Stable `(createdAt, _id)` order; owner history retained after Reservation closure |
| `GET /api/v1/reservations/managed/closure-requests/:requestId` | Owner or assigned Facility operator | None | Scoped details, current version/ETag |
| `POST /api/v1/managed-closure-requests/:requestId/cancel` | Owner Customer | `If-Match`, `Idempotency-Key`, cancellation reason if approved | Cancellation subject to yet-unapproved timing and clearance rules |
| `POST /api/v1/managed-closure-requests/:requestId/physical-clearance` | Assigned Facility Staff | `If-Match`, `Idempotency-Key`, per-Item findings, evidence references | Immutable clearance event; no stock or allocation mutation |
| `POST /api/v1/managed-closure-requests/:requestId/acknowledgement` | Owning Customer | `If-Match`, `Idempotency-Key`, acknowledgement decision and exact clearance evidence ID | Immutable acknowledgement/dispute event; missing/refused acknowledgement blocks normal finalization under proposal |
| `POST /api/v1/managed-closure-requests/:requestId/financial-review` | Authorized finance/Manager role TBD | `If-Match`, `Idempotency-Key`, settlement source/reference | Record review against approved D06 source and criteria |
| `POST /api/v1/managed-closure-requests/:requestId/approve` | Assigned Facility Manager | `If-Match`, `Idempotency-Key` | Final authorization only; actual atomic close/release remains a separate gated command or same transaction after D08 approval |

Do not add these paths until the existing router conventions, role guards and API envelope are reviewed for each operation.

## Request creation and cancellation

- Require authenticated Customer ownership of the Managed Reservation.
- D01 permits request submission before `endDate`, but final closure is ineligible until `now >= endDate`.
- Enforce at most one active closure request per Reservation in the eventual database contract. Duplicate behavior (return existing request versus 409) is unresolved; proposed default is 409 with a stable code and no cross-owner detail.
- Use operation-scoped idempotency keys and a canonical payload hash. Same key and same payload must replay the original committed event result even if the request later advances. Same key and different payload returns 409.
- Cancellation timing, whether Staff work has begun, custody status, and whether cancellation needs Manager approval are unresolved. Do not enable cancellation until explicitly specified.

## Readiness versus authorization

The existing readiness endpoint remains unchanged and read-only. It returns a diagnostic snapshot, is not a lock, is not an authorization token, and can become stale immediately after it is read. Closure commands must independently reconcile movement history, StockBalance, holds, requests, custody, allocations, Cell/Rack/Zone counters, contract and financial records inside the command transaction. Missing, inconsistent, unsupported or incomplete evidence must fail closed.

Overall closure must not be reported/committed as ready while any mandatory physical, custody, financial, contractual or disposition requirement is unresolved. Because D06/D07 are open, final closure remains blocked.

## Versioning, events and idempotency (proposal)

- Mutable closure request carries a monotonically increasing version exposed as an ETag; mutating endpoints require `If-Match`.
- Each operation has a unique `(requestId, operation, actorId, idempotencyKey)` event identity and immutable input/result snapshots.
- Save the state transition and event in one MongoDB transaction. Event snapshots record the exact resulting request version.
- Duplicate key + identical payload returns the original committed snapshot (200); changed payload returns 409.
- Stale ETag/version returns 409 with a stable version-conflict code.
- On duplicate-key/write conflict, perform bounded event recovery. Unknown commit outcome must never be called success without finding the committed event. Exhausted recovery returns a retryable/uncertain error, not a fabricated result.
- Finalization must atomically update Reservation status, allocation and Facility capacity/quota records, and append audit/event records exactly once. Any failure aborts all of those writes.

## Feature-gate proposal

Use an independent closure feature gate, default OFF and forced OFF in production until explicit rollout approval. Gate OFF must not change current read-only readiness behavior or existing first inbound/outbound paths. Existing unresolved closure requests, once such writers are authorized, must remain readable and protected from unsafe competing operations when the gate is later disabled. Gate lifecycle semantics require implementation review; this document does not add or enable a gate.

## Error contract (proposed stable codes)

Use the repository's standard error envelope; do not weaken authorization or hide uncertainty.

| HTTP | Candidate code | Meaning |
|---:|---|---|
| 400 | `CLOSURE_REQUEST_INVALID` | Malformed input, header or identifier |
| 404 | `MANAGED_RESERVATION_NOT_FOUND` | Missing, non-Managed, non-owned or out-of-scope resource |
| 409 | `CLOSURE_REQUEST_ALREADY_OPEN` | An unresolved request already exists |
| 409 | `CLOSURE_VERSION_CONFLICT` | Stale `If-Match` / CAS |
| 409 | `CLOSURE_NOT_ELIGIBLE` | Term or lifecycle precondition not met |
| 409 | `CLOSURE_STOCK_REMAINS` | Movement-reconciled stock or held quantity remains |
| 409 | `CLOSURE_CUSTODY_UNRESOLVED` | Physical custody or handover is unresolved |
| 409 | `CLOSURE_EVIDENCE_INCOMPLETE` | Required immutable evidence is absent/inconsistent |
| 409 | `CLOSURE_FINANCIAL_REVIEW_UNRESOLVED` | Approved financial oracle/criteria not satisfied |
| 409 | `CLOSURE_ALLOCATION_INCONSISTENT` | Allocation ownership/counter state cannot be proven |
| 503 | `CLOSURE_FEATURE_DISABLED` | New closure operations are disabled |
| 503 | `CLOSURE_OUTCOME_UNCERTAIN` | Bounded transaction/event recovery cannot establish outcome |

Codes and exact status mappings are proposals and must align with the eventual error middleware/controller contract.

## Concurrency dependencies — D08 hard gate

The current physical writers commonly acquire an Item CAS token first, followed by Facility/Zone/Reservation/Rack/Cell resources in operation-specific order. Registration may check Reservation eligibility and insert a new Item without writing a shared lifecycle fence. Therefore, a closure transaction cannot safely rely on a readiness scan plus Reservation status update alone.

Before closure request processing can block registration/inbound as D03 requires, the system needs an approved shared lifecycle fence and a compatible change to every relevant writer. Registration must participate so a new Item cannot appear after closure's item scan. Repeated inbound, first inbound, canonical outbound, relocation, and closure must serialize under the same approved protocol. Outbound stays subject to existing term rules; D03 grants no expired-term bypass.

D08 is unresolved and MI-07C is not authorized. A detailed proposal, source CAS matrix, writer scope, lock order and replica-set proof obligations are in [MI_07_D08_LIFECYCLE_FENCE_REVIEW.md](MI_07_D08_LIFECYCLE_FENCE_REVIEW.md). Do not implement the proposal without a separate explicit approval.

## FE integration mapping (proposed)

| Actor/screen | API usage |
|---|---|
| Customer Managed Reservation detail | Read current closure readiness; create request when allowed; show request history/state; cancel only if policy allows |
| Staff Managed Receiving/Operations queue | Facility-scoped closure clearance queue, request detail, per-Item handover evidence |
| Manager Managed Reservation closure review | Financial/contractual review, readiness blockers, final approval |

No existing React closure consumer was found. Add UI only after endpoints, roles, states and evidence rules are approved. Preserve existing first inbound, MI-06B, Self-Storage and Contract Proof screens.

## Unresolved approval register

| Decision | Status | Required decision |
|---|---|---|
| Request cancellation and review timing | `UNRESOLVED_BLOCKED` | Allowed states, cutoff once Staff begins work, custody constraints, reason and approver |
| Handover evidence / Customer acknowledgement | `APPROVED_PRINCIPLE` | Evidence types, required fields, when Customer acknowledgement is mandatory, immutable storage/access policy |
| Financial source and settlement | `UNRESOLVED_BLOCKED` | Authoritative records, outstanding charge definition, refunds/waivers, balance and currency treatment |
| Expired ACTIVE / OVERDUE, zero stock | `UNRESOLVED_BLOCKED` | Eligibility, legal transition and evidence; no inferred exception |
| Never-received Items | `UNRESOLVED_BLOCKED` | Customer confirmation/disposition and treatment of pending inbound intent; history must remain |
| Lifecycle fence and lock order (D08) | `UNRESOLVED_BLOCKED` | Shared fencing field/protocol and all writer compatibility work; hard implementation gate |
| Pending inbound, MOVE, outbound during closure | `UNRESOLVED_BLOCKED` | Request/inspection/custody treatment; outbound remains only within current eligibility |
| Atomic release and replica-set proof | `UNRESOLVED_BLOCKED` | Exact release scope, once-only audit, rollback and real MongoDB replica-set integration criteria |

## D05 proposed evidence and acknowledgement contracts

Every field and rule in this section is a design proposal requiring Product Owner approval; the existing IMAGE-04 inbound evidence contract is not automatically reused as closure evidence.

### Staff physical-clearance evidence DTO

```json
{
  "requestId": "<closure-request-id>",
  "expectedVersion": 3,
  "checklist": {
    "allReceivedItemsReturned": true,
    "allNeverReceivedItemsVerifiedNoCustody": true,
    "allRequestsTerminal": true,
    "allHoldsZero": true,
    "damageOrDisputePresent": false
  },
  "items": [
    {
      "itemId": "<item-id>",
      "classification": "RECEIVED_AND_RETURNED",
      "reconciledOnHandQuantity": 0,
      "reconciledHeldQuantity": 0,
      "finalOutboundMovementId": "<committed-outbound-movement-id>",
      "terminalRequestIds": ["<terminal-outbound-request-id>"]
    },
    {
      "itemId": "<item-id>",
      "classification": "REGISTERED_NEVER_RECEIVED",
      "reconciledOnHandQuantity": 0,
      "reconciledHeldQuantity": 0,
      "noCustodyVerified": true,
      "terminalRequestIds": []
    }
  ],
  "note": "<required note when an exception is observed>",
  "idempotencyKey": "<operation-scoped-key>"
}
```

Server-owned immutable snapshot fields: evidence ID, closure request/Reservation/Customer/Facility IDs, Staff actor ID, recorded timestamp, request version before/after, canonical payload hash, per-Item movement/request references, the result of full reconciliation, checklist snapshot, and any approved attachment references. Client-supplied quantities are assertions to validate, never authority for stock. A received Item must reference a committed outbound movement and request lineage that reconcile to zero; a never-received Item must have no committed inbound, no current Cell/custody, and an approved no-custody assertion. Missing records, mismatched scope, nonterminal requests, positive holds/stock, or a dispute fail closed.

Normal cases do not upload duplicate photos under the proposal. If there is damage/discrepancy/dispute, return a blocked/manual-review result; do not accept a generic “clear” checkbox. Whether photographs are needed for exceptions and the storage/privacy policy remain unapproved.

### Customer final-handover acknowledgement DTO

```json
{
  "clearanceEvidenceId": "<immutable-staff-clearance-id>",
  "expectedVersion": 4,
  "acknowledgement": "ACKNOWLEDGE_RETURN",
  "note": "<optional bounded note>",
  "idempotencyKey": "<operation-scoped-key>"
}
```

The event should bind the Customer actor, exact closure request/Reservation, exact Staff clearance evidence ID and version, timestamp, request version, payload hash, and immutable result snapshot. Customer disagreement must block automated finalization and enter manual handling. Whether Customer acknowledgement is mandatory for all cases, only certain cases, or can be replaced by another delivery proof remains `PROPOSED_REQUIRES_APPROVAL`.

### Evidence integrity and scope

Before recording or reading evidence, validate exact Item→Reservation→Customer→Facility ownership. Every referenced movement must be committed, immutable, of type OUTBOUND, belong to the same Item/Reservation/Facility, and be part of the reconciled lineage; every request reference must be in the same scope and terminal. Reads for Staff require assigned Facility scope. Do not expose another Customer's Item details in queue aggregates. Snapshots/events are append-only; correction creates a new versioned event referencing the superseded event instead of editing old evidence.

Candidate errors: `CLOSURE_EVIDENCE_INCOMPLETE`, `CLOSURE_ITEM_SCOPE_MISMATCH`, `CLOSURE_MOVEMENT_NOT_COMMITTED`, `CLOSURE_REQUEST_NOT_TERMINAL`, `CLOSURE_STOCK_REMAINS`, `CLOSURE_CUSTODY_UNRESOLVED`, `CLOSURE_DISPUTE_REQUIRES_MANUAL_REVIEW`, and `CLOSURE_VERSION_CONFLICT` (all mappings proposed).

## D06 proposed settlement-review contract and source gap

No DTO may state that funds are received based only on a Manager checkbox, Reservation status, `providerReference`, or `PaymentProvider.PAYOS` enum. The current `ReservationPayment` model stores immutable purpose/amount/currency/provider/identity and mutable status/outcome timestamps. `DEPOSIT` is advance rent, not an automatically refundable security deposit. `Contract` stores `pricingSnapshot`, `currentContentVersion`, content hashes and signer records. `balanceSettledAt` records the check-in flow's initial balance/zero-balance event. None is a complete final settlement ledger. `MOCK` is test/development simulation, not production settlement evidence. No verified PayOS webhook/signature path or complete additional-charge/refund/waiver/dispute source was found in the inspected backend.

### Baseline verification (proposal)

Read-only verification should produce a versioned result—not alter payment state—with:

```json
{
  "reservationId": "<id>",
  "contractId": "<id>",
  "contractVersion": 2,
  "contractContentHash": "<hash>",
  "signaturesVerified": true,
  "deposit": { "purpose": "DEPOSIT", "expectedAmount": 100000, "currency": "VND", "settlementEvidenceId": "<verified-source-id>", "status": "VERIFIED" },
  "balance": { "expectedAmount": 0, "currency": "VND", "settlementEvidenceId": "<explicit-zero-settlement-id>", "status": "VERIFIED" },
  "unresolvedPaymentCount": 0,
  "assessment": "UNKNOWN"
}
```

`assessment` remains `UNKNOWN` until an authoritative production source and exact matching/zero-balance rules are approved. Baseline checks should bind both signatures to the current version/hash, compare expected contractual amounts/currency, distinguish an explicit zero-balance settlement from a missing payment, and treat `PENDING`/`RECONCILIATION_REQUIRED` as unresolved. A past `FAILED` attempt is not necessarily a debt if a verified success exists, but the precedence rule requires approval. A `PAID`/`ACTIVE` status is never sufficient by itself.

### Manager final financial-review DTO (proposal)

```json
{
  "requestId": "<closure-request-id>",
  "expectedVersion": 5,
  "baselineAssessmentId": "<immutable-baseline-review-id>",
  "unresolvedAdditionalCharges": [],
  "refundWaiverDisputeReferences": [],
  "decision": "CLEARED",
  "evidenceReference": "<verifiable-finance-evidence-reference>",
  "note": "<bounded review note>",
  "idempotencyKey": "<operation-scoped-key>"
}
```

Server event binds Manager identity and assigned Facility, source references and versions, exact request version, payload hash, timestamp and immutable result snapshot. This proposal permits `CLEARED` only if the approved financial source proves no unresolved rental debt, charges, refunds, waivers or disputes. The Manager attestation records a decision; it must not create/update `ReservationPayment`, change `PaymentStatus`, or fabricate funds. Since no authoritative source was found, this operation is blocked pending D06.

## D07 proposed UTC boundary examples

This replaces the prior narrow-window proposal and is still unapproved. Customer may request before `endDate`; final closure occurs only at/after `endDate`. Staff clearance completed before `endDate` remains valid if immutable server-created evidence proves it and no later event invalidates the snapshot. Manager approval delay alone does not invalidate physical completion. Stock/custody remaining at `endDate` requires manual overdue/disposition handling. No automatic status transition, grace duration, fee, disposal, allocation release or outbound exception is implied.

| Example | Proposed outcome |
|---|---|
| One second before `endDate` | `NOT_YET_ELIGIBLE` for final closure; request may already exist. |
| Exactly at `endDate`, timely clearance and approved finance evidence | Candidate `NORMAL_CLOSURE_ELIGIBLE`; final transaction revalidates. |
| Clearance before `endDate`, Manager approval days later | Approval delay alone does not invalidate clearance; revalidate finance and later events. |
| Pending inbound/outbound or hold at `endDate` | `OVERDUE_MANUAL_REVIEW` or `UNKNOWN`. |
| Stock/custody remains at `endDate` | `OVERDUE_MANUAL_REVIEW`; no normal finalization. |
| ACTIVE status but effectively overdue under approved rule | `OVERDUE_MANUAL_REVIEW`; stale status cannot bypass policy. |
| OVERDUE, zero stock, verified on-time clearance | Normal path only if approved overdue/finance rules allow; otherwise manual review. |
| OVERDUE, late clearance or stock remains | `OVERDUE_MANUAL_REVIEW`. |
| Missing historic custody/clearance evidence | `UNKNOWN`; never infer on-time clearance. |

The SRS context summary says Overdue starts on the first calendar day after `current_end_date`, but the original SRS is absent and UTC mapping needs confirmation. It also mentions controlled outbound and forced termination under policy; current MI-04 permits ordinary outbound only for in-term ACTIVE. This design creates no overdue writer, timer, automatic transition, allocation release or outbound bypass. The values `NORMAL_CLOSURE_ELIGIBLE`, `OVERDUE_MANUAL_REVIEW`, `NOT_YET_ELIGIBLE`, and `UNKNOWN` are proposed response classifications, not schema enums.

### Proof of pre-endDate clearance (proposal)

Client payloads may contain references, but never authoritative timestamps. Validate committed OUT movement IDs and terminal request/custody references against the exact Item, Reservation and Facility. Persist a Staff clearance event with server-generated immutable `recordedAt`, Staff actor, request version and reconciliation snapshot/hash. Require all evidence event times to be strictly before `endDate`; finalization re-reads the complete lineage and rejects later inbound, hold, custody or other invalidating activity. Whether server event time is sufficient or database commit-time proof is required must be decided and tested under D08; do not claim pre-endDate proof until then.

## D05 acknowledgement and manual-review refinements

Detailed rules remain `PROPOSED_REQUIRES_APPROVAL`: Staff clearance is mandatory; every Item reconciles to `CurrentQty = 0` and `HeldQty = 0`; all inbound/outbound/custody obligations are terminal; physically received Items reference committed OUT movements; never-received Items have explicit no-custody verification and retained history; immutable evidence records Staff actor/time, checklist, note, reconciliation references and version/hash; normal undisputed cases need no duplicate photos; damage/discrepancy/disputes go to manual review. Customer acknowledgement is an application event bound to the exact clearance evidence/version. Missing acknowledgement or refusal blocks normal automatic finalization; the exact cases and alternative evidence still need approval.

Candidate errors: `CLOSURE_EVIDENCE_INCOMPLETE`, `CLOSURE_CUSTOMER_ACK_REQUIRED`, `CLOSURE_CUSTOMER_DISPUTED`, `CLOSURE_STOCK_REMAINS`, `CLOSURE_CUSTODY_UNRESOLVED`, and `CLOSURE_EVIDENCE_CONFLICT`. These are proposed only. Existing ItemMovement/outbound request/events and receiving evidence provide immutable lineage references but do not constitute closure evidence or Customer acknowledgement. Enforce exact owner and Facility scope; cross-owner/out-of-scope reads return a concealed 404.

## D06 financial classifications and demo boundary

Proposed decision values (not persisted enums):

- `INITIAL_RENT_VERIFIED`: current Contract version/hash and original advance-rent/balance evidence match an approved authoritative source; not final closure settlement.
- `FINAL_SETTLEMENT_VERIFIED`: every approved debt, charge, refund, waiver and dispute obligation is resolved using the approved source. Current inspected sources cannot establish this.
- `FINANCIAL_UNKNOWN`: required source/evidence is absent, unsupported or inconsistent.
- `FINANCIAL_BLOCKED`: a known financial obligation remains.

Manager may attest that no additional charges/disputes were identified only if an approved evidentiary source proves completeness. A checkbox, Reservation status, `providerReference`, or `PAYOS` enum is not proof. A separate `DEMO_SIMULATED_SETTLEMENT` may be shown only in development/demo with `MOCK` provenance and must never be returned as production-verified. No payment status may be changed or fabricated by closure review. The authoritative additional-charge/refund/waiver/dispute ledger and verified production provider evidence remain **BLOCKED**.

## Screen dependencies

| Proposed screen | Needs |
|---|---|
| Customer Reservation closure panel | Read-only readiness, create/history/detail/cancel endpoints, request ETag, acknowledgement action after Staff clearance |
| Staff Facility closure queue/detail | Facility-scoped queue, immutable per-Item clearance evidence and movement/request validation |
| Manager closure review | Baseline finance assessment, final review event, unresolved-policy blockers, approval and finalization status |

No React or Flutter closure consumer was found. The project SRS context describes Flutter for Staff/Manager, but this repository audit did not identify a Flutter source tree; do not invent a mobile module. Confirm any separate mobile repository before assigning implementation work.

## Required verification before any closure-writer rollout

- Unit/API tests for owner and Facility isolation, state/version/idempotency rules, stock/custody blockers and financial-policy unknowns.
- Regression tests for MI-03B first inbound, MI-06B repeated inbound/outbound/relocation, image evidence, Contract Proof and Self-Storage separation.
- MongoDB replica-set tests for concurrent registration versus closure, inbound versus closure, MOVE/REMOVE versus closure, two finalizers, rollback, duplicate event recovery, and exact-once allocation/quota release.
- No mock-only result should be described as proof of transactional concurrency.

