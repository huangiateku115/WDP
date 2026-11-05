# MI-07 Managed Inventory Closure — MVP Business Contract

**Status:** business-contract plus staged D08 decision record. The Product Owner conditionally approved the lifecycle-fence architecture and authorized MI-07C.1 only; this document does not authorize closure writers, allocation release, or production activation.

## Purpose and boundaries

This contract records the Product Owner's selected MVP decisions alongside source-confirmed behavior and unresolved policy. The existing `GET /api/v1/reservations/managed/:id/closure-readiness` is a point-in-time diagnostic. It is neither a lock nor a closure authorization. A future closure command must re-read and validate every prerequisite in its own transaction.

This scope is Managed Inventory only. Self-Storage checkout behavior is not a substitute for Managed Inventory rental closure.

## Approval register

| ID | Status | Decision / exact meaning |
|---|---|---|
| D01 | `MVP_SCOPE_SELECTED` | A Customer may request closure before `endDate`. Final closure is allowed only at or after `endDate`. No approved early-finalization exception is implied. |
| D02 | `MVP_SCOPE_SELECTED` | Assigned Facility Staff confirms physical handover. Facility Manager provides final approval. Exact permission details for exceptional roles still require route-level approval. |
| D03 | `MVP_SCOPE_SELECTED` | New Item registration and new inbound must be blocked while an active closure request is being processed. Eligible outbound remains permitted subject to existing authorization and rental-term rules. This decision does not itself implement the required shared lifecycle fence. |
| D04 | `MVP_SCOPE_SELECTED` | Registered-but-never-received Items retain their identity/history; closure must check every custody and request obligation. It does not authorize deleting or fabricating a movement for an unreceived Item. |
| D05 | `APPROVED_PRINCIPLE` | Concrete handover evidence is required. Customer acknowledgement applies if needed, but mandatory conditions and evidence format are not finalized. The detailed acceptance table below remains proposed. |
| D06 | `APPROVED_PRINCIPLE` | The authoritative financial source and final-settlement criteria must be identified. This approves only the requirement to define them; no particular source, balance rule, refund, waiver, or settlement condition is approved. |
| D07 | `APPROVED_PRINCIPLE` | The exact closure rule for expired `ACTIVE` and `OVERDUE` Reservations must be determined. This approves only the requirement to define the rule; the revised timing scenarios below remain proposed, not approved transitions. |
| D08 | `APPROVED_CONDITIONALLY` | Product Owner approved reuse of `Reservation.inventoryVersion` with explicit CAS/revalidation/bounded retries, optional `activeClosureRequestId`, the listed writer compatibility scope, existing Item-first/Facility/Zone/Reservation/Rack/Cell ordering, and the pending-closure policy. MI-07C.1 registration/fence foundation is authorized; other writer integrations and closure writers require separate authorization. This does not approve D05/D07 details or resolve D06 final settlement. |

The register vocabulary is used as follows: `SOURCE_CONFIRMED` means directly enforced by current code or an existing project document; `MVP_SCOPE_SELECTED` records the explicit Product Owner choice; `APPROVED_PRINCIPLE` approves a principle but not its detailed rules; `PROPOSED_REQUIRES_APPROVAL` is a design suggestion only; `UNRESOLVED_BLOCKED` means the implementation decision is missing or explicitly gated.

## Source-confirmed rules

- Managed rental dates are explicit UTC timestamps and use the half-open interval `[startDate, endDate)`. This defines the current rental eligibility boundary, not a grace period.
- Normal outbound request and confirmation require a current, in-term `ACTIVE` Managed Inventory Reservation. `OVERDUE` and expired `ACTIVE` records are not eligible for the ordinary outbound path.
- A pending outbound request retains physical stock and placement until Staff confirmation. Physical counters and reservation usage change only upon a confirmed movement.
- First inbound, repeated inbound, outbound and relocation have distinct existing workflows. This contract does not alter them.
- The readiness endpoint reconciles stock from movement history, checks holds, requests, custody, allocations and counters, and never returns overall `READY` while financial/disposition policy is unresolved.
- A zero-stock Item does not by itself release its Cell allocation or contracted Facility quota. Existing documentation requires an independently authorized lifecycle transition and evidence of no remaining stock before contractual quota release.
- Existing database transactions require a MongoDB deployment that supports multi-document transactions. Real replica-set verification has not been reported as run.

## Approved MVP workflow direction

The selected direction is:

```text
Customer closure request
  → Staff physical handover / clearance
  → financial and contractual review
  → Facility Manager final approval
  → atomic final closure and eligible allocation/quota release
```

This is a business workflow direction, not authorization for any writer. Exact states, cancellation timing, evidence format, financial conditions, expired-rental eligibility, and the atomic release protocol remain subject to the approvals in this document.

## D03 and end-date interaction

“Eligible outbound remains permitted” preserves current outbound eligibility; it does not extend it. The legacy guard in `inventory-item.service.ts` and canonical guard in `managed-outbound-request.service.ts` require `status: ACTIVE`, `startDate <= now`, and `endDate > now`. Therefore, when stock remains after `endDate`, the current ordinary outbound path is still unavailable. No overdue outbound exception is authorized here. D07 must be resolved before that case can be implemented safely.

## Never-received Items

Registered-but-never-received Items retain identity and history. A closure assessment must not count `InventoryItem.quantity` as physical stock; physical stock is established through movement reconciliation. The exact customer attestation, cancellation of outstanding registration/inbound intent, and whether such Items need explicit disposition evidence are unresolved (D04 plus approval item 5 in the API design).

## Financial boundary

Current reservation payment records and contract signatures are not, by themselves, an approved final-settlement oracle. The repository documentation says additional charges, waivers, refunds, proration and settlement policy are not defined. D06 requires a future decision identifying the source of truth and exact criteria. Until then, final closure cannot be authorized based on the readiness endpoint.

## D05 — physical clearance and acknowledgement decision register

The following are **proposals requiring Product Owner approval**. D05 approves that concrete handover evidence is required; it does not approve these detailed acceptance rules.

| Proposed rule | Status | Source relationship / limitation |
|---|---|---|
| Assigned Staff performs final physical clearance. | `PROPOSED_REQUIRES_APPROVAL` | Consistent with D02, which selects Staff physical handover, but the full checklist and workflow are not implemented. |
| Every Item must reconcile to on-hand quantity zero and held quantity zero. | `PROPOSED_REQUIRES_APPROVAL` | Readiness already blocks positive stock/holds; closure-grade verification still needs an in-transaction recheck. |
| All inbound/outbound requests and custody/return obligations must be terminal. | `PROPOSED_REQUIRES_APPROVAL` | Readiness treats unresolved requests/custody as blockers; the exact terminal-state set needs approval. |
| For each physically received Item, evidence references the committed outbound movement that establishes zero stock. | `PROPOSED_REQUIRES_APPROVAL` | Movement ledger is immutable and authoritative for stock; evidence-to-movement cardinality and exceptions are not defined. |
| A registered-never-received Item has explicit no-custody verification and no inbound movement/current placement. | `PROPOSED_REQUIRES_APPROVAL` | D04 preserves identity/history and requires obligation checks; explicit attestation format is not yet approved. |
| Staff records checklist, actor identity, timestamp, note and a reconciliation snapshot/reference. | `PROPOSED_REQUIRES_APPROVAL` | Minimal auditable evidence proposal; snapshot format, retention, access, and hash/signature policy remain open. |
| Customer acknowledges final return/receipt after the last physical handover. | `PROPOSED_REQUIRES_APPROVAL` | D05 says acknowledgement applies if needed; mandatory cases and proof form are undecided. |
| Missing acknowledgement or Customer refusal blocks normal automatic finalization. | `PROPOSED_REQUIRES_APPROVAL` | Conservative rule; alternate proof and escalation remain open. |
| Normal, undisputed cases do not require duplicate photo uploads. | `PROPOSED_REQUIRES_APPROVAL` | Existing receiving evidence may be retained; no closure-specific photo requirement is implemented. |
| Damage, discrepancy, custody mismatch or dispute blocks automated closure and goes to manual handling. | `PROPOSED_REQUIRES_APPROVAL` | Safe fail-closed proposal; escalation role and resolution states require definition. |
| Evidence and acknowledgement are append-only, immutable, and version-linked. | `PROPOSED_REQUIRES_APPROVAL` | Aligns with existing immutable receiving evidence patterns; closure persistence does not exist. |

### Proposed physical-clearance preconditions

Before a Staff clearance could be accepted, a future implementation should re-read and prove within its transaction: exact Managed Reservation/Customer/Facility scope; full Item set within a hard scan bound; complete movement reconciliation for each Item; `CurrentQty = 0` and `HeldQty = 0`; no active receipt/outbound/custody request; no current placement for a zero-stock Item; allocation and physical counters reconcile; every received Item's final committed OUT movement is linked; and every never-received Item has no inbound movement, no current Cell, no custody, and approved no-custody evidence. Any missing, corrupt, disputed, or out-of-bound record must remain blocked/unknown. These are proposed closure criteria, not current endpoint guarantees.

The client must never supply authoritative event time. The service records immutable Staff clearance time and exact reconciliation references. For a proposed on-time case, each required committed outbound movement and the committed Staff clearance event must be timestamped by the server strictly before `endDate`; Manager approval may occur later. Whether application-server time or database commit-time proof is required must be settled in D08 verification criteria.

## D06 — finance source-of-truth matrix

No inspected record currently provides a complete, trusted final-settlement decision. The following source uses are distinguished deliberately:

| Data source | Current semantics confirmed in source | Closure use / authority status |
|---|---|---|
| `ReservationPayment` | Immutable reservation/customer/facility/service type, purpose, amount, currency, idempotency key, provider and optional provider reference; status and outcome timestamps are stored. Purposes are `DEPOSIT` and `BALANCE`; statuses include `PENDING`, `SUCCEEDED`, `FAILED`, and `RECONCILIATION_REQUIRED`. | Candidate evidence for the original rental payment only. Does not record all additional charges, waivers, disputes, or refunds. Not an approved final-settlement ledger. |
| `DEPOSIT` payment | Type comment and MI-R01 define this as advance rent, not automatically a refundable security deposit. | Must not be treated as a refundable security deposit without separate policy. |
| `PaymentProvider.MOCK` | Development simulation; MI-R01 requires non-production plus an explicit mock-payment flag. Reservation records simulated provider/paid metadata. | Never production proof of funds or a real settlement. |
| `PaymentProvider.PAYOS` and `providerReference` | Enum and optional immutable reference fields exist. The inspected backend contains no matching PayOS webhook/signature-verification settlement path. | Provider enum/reference alone do not prove provider-verified settlement. Any production use needs a verified external event/ledger that is not present in this inspected flow. |
| `Contract` | One Contract per Reservation; pricing snapshot; status; current content version; versioned content/signature entries with version and content hash; signature timestamps/roles. | Candidate for original contract terms. Clearance must verify both signatures match the current content version/hash, not just `status === SIGNED`. It cannot prove all later debts are settled. |
| `Reservation.balanceSettledAt` / `balanceSettledBy` | Used by check-in flow to record successful full balance or explicit zero-balance settlement before first inbound. | Evidence for initial balance processing only; not a closure settlement record. |
| Additional charges / refund / waiver / dispute records | No complete Managed closure finance source/ledger was found in the inspected models/docs. | **BLOCKED**: no trustworthy source of truth or complete obligation calculation is available. |

### Proposed two-stage financial review (not approved)

**A. Baseline rental-payment verification** should check reservation and contract identity; current contract version and hash; both Customer and Facility signatures on that same version; signed pricing snapshot; expected `DEPOSIT` amount/currency and successful provider outcome; `BALANCE` amount/currency and successful settlement, or an explicit zero-balance settlement recorded by the authorized flow; and all `PENDING`/`RECONCILIATION_REQUIRED` payments. A historic `FAILED` attempt alone must not be interpreted as current unpaid debt if an authoritative successful payment for the same purpose exists; the applicable rule still needs approval. Reservation `PAID`/`ACTIVE` status alone is insufficient.

Proposed result distinctions (not current persisted enums): `INITIAL_RENT_VERIFIED` means the original contract and rental-payment evidence is consistent; `FINAL_SETTLEMENT_VERIFIED` means all approved closure obligations are settled/waived/refunded; `FINANCIAL_UNKNOWN` means source/evidence is missing or inconsistent; `FINANCIAL_BLOCKED` means a known obligation remains. Current sources can at most support baseline review after an authoritative provider source is approved; they cannot establish complete final settlement.

For production baseline verification, `MOCK` is not acceptable as proof of received funds. A `PAYOS` enum value or provider reference without verified settlement evidence is also insufficient. The app currently lacks an inspected verified PayOS webhook path, so production verification remains **BLOCKED** until the authoritative source is selected and implemented under a separate approved scope.

**B. Final financial clearance** proposal: Manager reviews remaining contractual debt, known additional charges, disputes, refunds/waivers and supporting settlement evidence. Only cases with no unresolved charges, refunds, waivers or disputes proceed. Manager attestation must cite verifiable evidence and must not mutate `PaymentStatus` or fabricate a receipt. If authoritative financial evidence is absent, the result stays `UNKNOWN`/`BLOCKED`; a checkbox is not proof of settlement.

## D07 — revised closure timing proposal (replaces the narrow-window proposal)

The prior `endDate <= now < Overdue Day 0` proposal is withdrawn because it can leave only a few hours for normal closure. The revised proposal lets the Customer request closure before `endDate`; final closure occurs only at/after `endDate`. Staff may complete clearance before `endDate`, and Manager delay alone does not invalidate that evidence. Any stock or custody remaining at `endDate` goes to manual overdue/disposition handling. No grace duration, fee, automatic status transition, disposal, allocation release or controlled-outbound exception is introduced. These details remain `PROPOSED_REQUIRES_APPROVAL`.

Prove timely physical clearance with immutable server-created committed OUT movement and Staff clearance records, not a client timestamp. The finalizer must revalidate lineage and ensure no later inbound, hold, custody or other invalidating event exists. For the proposed normal case, required movement and clearance event times are strictly before `endDate`; final closure must be at or after `endDate`. Whether database commit-time proof is required in addition to server event time remains a D08 acceptance decision.

| Scenario | Proposed outcome | Status |
|---|---|---|
| One second before `endDate` | `NOT_YET_ELIGIBLE` for finalization; request may already exist. | D01; classification name proposed |
| Exactly at `endDate`, on-time clearance and finance verified | Candidate `NORMAL_CLOSURE_ELIGIBLE`. | Subject to D05/D06/D08 approval and final revalidation |
| Clearance before `endDate`, Manager approves days later | Manager delay alone does not invalidate the evidence; recheck current finance and later events. | `PROPOSED_REQUIRES_APPROVAL` |
| Pending inbound/outbound or hold at `endDate` | `OVERDUE_MANUAL_REVIEW` or `UNKNOWN`. | `PROPOSED_REQUIRES_APPROVAL` |
| Stock/custody remains at `endDate` | `OVERDUE_MANUAL_REVIEW`; normal finalization blocked. | Manual disposition policy required |
| ACTIVE status at/after approved Overdue Day 0 | `OVERDUE_MANUAL_REVIEW`; stale status cannot bypass policy. | `PROPOSED_REQUIRES_APPROVAL` |
| OVERDUE, zero stock, proven on-time clearance | Normal path only if approved overdue and financial rules permit; otherwise manual review. | `PROPOSED_REQUIRES_APPROVAL` |
| OVERDUE, late clearance or remaining stock | `OVERDUE_MANUAL_REVIEW`. | `PROPOSED_REQUIRES_APPROVAL` |
| Missing historic custody/clearance records | `UNKNOWN`; do not infer timely clearance. | `PROPOSED_REQUIRES_APPROVAL` |

The SRS context summary says Overdue Day 0 is the first calendar day after `current_end_date`; the original SRS document is absent, so its UTC mapping must be confirmed. The SRS summary mentions controlled outbound and force termination under policy, but current MI-04 permits ordinary outbound only for in-term ACTIVE. This proposal does not override either fact.

`NORMAL_CLOSURE_ELIGIBLE`, `OVERDUE_MANUAL_REVIEW`, `NOT_YET_ELIGIBLE`, and `UNKNOWN` are proposed decision values, not current APIs or schema enums.

## Unsupported and disputed cases

- No verified production PayOS settlement source or full debt/refund/waiver/dispute ledger was found in the inspected backend scope.
- No closure-specific immutable Staff clearance or Customer acknowledgement model exists.
- Readiness reads payments/contracts but deliberately reports financial/disposition `UNKNOWN`; it is not final financial verification.
- SRS context contains broader overdue, force-termination and disposition requirements, while MI-R01/MI-04 defer their exact Managed roles, evidence and API. The original SRS is not in the repo; decisions must be checked against the authoritative document before approval.
- Registered-never-received Items retain identity/history by D04, but exact cancellation/no-custody attestation remains unresolved.

## Dependency and acceptance checklist

Before any operational closure phase can be approved:

1. Product Owner explicitly accepts or revises every `PROPOSED_REQUIRES_APPROVAL` row for D05 and D07, including the revised on-time clearance / delayed Manager approval scenario.
2. D06 names an authoritative financial source, production settlement evidence, zero-balance rule, historical-failure treatment, and charge/refund/waiver/dispute policy.
3. D08 lifecycle fence and compatible lock order are approved; all affected registration and MI-06B writers are included in the plan.
4. Cancellation timing, pending inbound/MOVE/outbound behavior, never-received handling, and final allocation/quota release semantics are decided.
5. Tests cover owner/Facility isolation, immutable evidence, all state boundaries, reconciliation failure, and source-of-truth financial cases.
6. Real MongoDB replica-set tests prove concurrent registration/stock operations vs closure, rollback, retries, and exactly-once release. Mock tests alone are insufficient.

## Implementation gates

| Phase | Status |
|---|---|
| MI-07 Phase 1 read-only readiness | Implemented; diagnostic only |
| MI-07B business/API documentation | Authorized documentation work |
| MI-07C lifecycle fence compatibility changes | **NOT AUTHORIZED; D08 unresolved** |
| MI-07D closure request writers | **NOT AUTHORIZED** |
| MI-07E Staff clearance/evidence writers | **NOT AUTHORIZED** |
| MI-07F final closure/allocation/quota release | **NOT AUTHORIZED** |

