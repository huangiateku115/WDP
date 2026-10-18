# Managed Inventory V2 — Phase 4 implementation and blockers

Date: 2026-10-17. Scope: Staff receiving inspection, intake contract creation/review and two-party signatures only.

**Overall status: PARTIAL / BLOCKED, not FE COMPLETE.** Confirmed contract creation and signing integrations are implemented and fixture-tested. Staff inventory queue/result reads work. Inspection submission and Staff contract creation remain deliberately blocked because the Backend grants Staff the mutations but does not grant the reservation reads needed to verify their context. No Phase 5 work or live Backend write was performed.

## 1. References audited before code changes

Read-only Backend sources, under `C:/Users/laptop/Desktop/WDP/BE-REF/`:

- `src/routes/inventory-item.routes.ts` and `src/controllers/inventory-items/inventory-item.controller.ts`.
- `src/services/inventory-items/inventory-item.service.ts` and `inventory-item.validation.ts`.
- `src/routes/reservation.routes.ts`, `src/controllers/reservations/managed-checkin.controller.ts`, `src/services/reservations/managed-checkin.service.ts`.
- `src/services/reservations/managed-reservation.service.ts` (`get` and management scope).
- `src/routes/contract.routes.ts`, `src/controllers/contracts/contract.controller.ts`, `src/types/contract.type.ts`.

Postman: `C:/Users/laptop/Downloads/WDP-Managed-Inventory-v2-Deposit-Checkin-Inbound.postman_collection.json`, receiving inspection, contract creation, contract GET, Customer sign and Facility sign requests. Collection requests were inspected, not executed.

SRS: `C:/Users/laptop/Downloads/SRS_Self-Storage.docx`, physical intake / CF-02 / CF-13 and P018 two-party frozen-contract requirements. The SRS describes independent signatures on one version; the current Backend is more restrictive and requires Customer first. This FE follows that confirmed Backend order rather than inventing independent Facility-first signing.

Existing Customer contract context/ownership flow, Phase 3 inventory APIs, Staff operational routes/demo features, Manager reservation views, shared UI, API allowlist and auth architecture were inspected. No new Axios instance, session storage, role redirect or route definition was introduced.

## 2. Confirmed contracts and permissions

Paths below are relative to `/api/v1`.

| API | Confirmed permission / body / response | Implementation |
| --- | --- | --- |
| GET `/inventory-items` | ADMIN/BOM/FM/STAFF; Staff/FM scope forcibly derives from assignedFacilityId. Optional facilityId/customerId/category/status/search/page/limit, limit 1–100. `{success:true,data:items,pagination}` | Integrated for scoped Staff queue and Manager intake verification |
| GET `/inventory-items/:id` | Customer owner or authorized operational reader; Staff/FM Facility-scoped. `{success:true,data:item}` | Reuse existing client for item measurements and actual receiving result |
| POST `/inventory-items/:itemId/receiving-inspection` | FACILITY_STAFF only; assigned Facility. Strict top-level inspection DTO; HTTP 200 `{success:true,data:rawItem}` | **BLOCKED**, no wrapper/allowlist/mutation exposed |
| POST `/reservations/managed/:id/contract` | Assigned FACILITY_STAFF or FACILITY_MANAGER; no body fields consumed, Postman `{}`; HTTP 201 `{success:true,data:contract}` | Manager integrated; Staff entry blocked without reservation read |
| GET `/contracts/:id` | Customer owner, scoped STAFF/FM, ADMIN/BOM; populated reservation subset | Integrated for current snapshot/version/signatures and GET recovery |
| PATCH `/contracts/:id/sign` | CUSTOMER owner; no body fields consumed, Postman `{}`; HTTP 200 `{success:true,data:contract}` | V2-specific wrapper; existing legacy client behavior untouched |
| PATCH `/contracts/:id/sign/facility` | Assigned FACILITY_STAFF or FACILITY_MANAGER; `{}`; same response | Integrated for both confirmed Facility roles |
| GET `/contracts/me` | Customer only | Existing owned discovery, no Facility misuse |
| GET `/reservations/managed/:id` | CUSTOMER owner, FM, ADMIN, BOM — **no STAFF** | Reuse for Customer and Manager only |
| GET `/reservations/:id`, GET `/reservations/facility/:facilityId`, GET `/reservations/me` | None grants FACILITY_STAFF reservation read | Not used as a Staff workaround |

All new operational paths are constrained by the existing request allowlist. Receiving-inspection, balance and confirm-inbound requests remain unavailable in that allowlist. API authorization remains authoritative; the allowlist itself is not a role guard.

### Feature gate and failures

Managed check-in mutations require `NODE_ENV === 'development'` and `MI_MANAGED_DEPOSIT_FLOW_ENABLED === 'true'` in Backend. A disabled flow returns 404. No environment value was changed or secret read/displayed; no live feature-gate setting was assumed.

400: invalid IDs/inspection fields; 401: authentication; 403: wrong role or Facility scope; 404: missing/foreign-owned record or disabled flow; 409: lifecycle, inspection, ledger, version/concurrency or capacity conflict. Backend transactions use snapshot reads and majority writes. No transaction-capable live deployment was tested. FE messages use existing sanitized inventory errors and never report success for an invalid/unverified response.

## 3. Receiving inspection contract and blocker

Required DTO:

```json
{
  "decision": "ACCEPTED",
  "observedQuantity": 2,
  "observedUnitWeightKg": 20,
  "observedUnitDimensionsM": {"widthM": 0.3, "depthM": 0.25, "heightM": 0.2},
  "compatibleCellIds": ["<allocated-cell-id>"],
  "packingLayoutVerified": true,
  "note": "Physical inspection findings",
  "custodyTaken": true
}
```

`decision`: ACCEPTED / DISCREPANCY / REJECTED. Quantity is a positive safe integer; weight/dimensions finite and strictly positive. Note is nonblank, maximum 1000 original characters. Both flags must be booleans; compatibleCellIds must be an array of valid IDs. FE pure DTO validation also rejects duplicate IDs, rejection with custody, and acceptance without compatible Cells or verified multi-unit packing.

Backend additionally verifies:

- Actual actor is assigned FACILITY_STAFF; Manager cannot inspect instead.
- V2 reservation is DEPOSIT_PAID and balance is not settled.
- Item is PENDING_INBOUND or RECEIVED_PENDING_ACCEPTANCE.
- Compatible Cells belong to allocatedCellIds and RESERVED allocations for this owner; same active Facility, active Zone and available Rack/Cell; physical counters explicitly known and zero.
- ACCEPTED measurements match registered values using Backend rounding (kg 3 decimals; dimensions 6); geometry, total weight/volume and multi-unit packing fit every selected compatible Cell.
- REJECTED goods cannot remain in custody; rejection returns item to REGISTERED/RETURNED. Custody on accepted/discrepant goods yields RECEIVED_PENDING_ACCEPTANCE; otherwise item remains PENDING_INBOUND. No IN_STORAGE or activation occurs.
- Existing contracts may receive a new content version when an inspection changes; current signatures then no longer count.

**Why mutation is blocked:** Staff item/list DTOs contain managedReservationId, but not reservation bookingFlowVersion, DEPOSIT_PAID/balance lock or authoritative allocatedCellIds. All available reservation reads exclude Staff. Item identity or a manual Cell ID cannot substitute for that missing context. The UI therefore shows real queue/detail/results and a disabled inspection action with the exact blocker. No unsafe manual-ID form or synthetic V2 reservation is supplied. The DTO validator is preparatory/testable code, not an enabled inspection submission feature.

There is no inspection idempotency key. Backend can re-inspect PENDING_INBOUND/RECEIVED_PENDING_ACCEPTANCE and update inspectedAt/content versions. Duplicate/timeout mutation acceptance for inspection is **BLOCKED**, not claimed PASS.

## 4. Manager contract creation

Existing Manager Managed-reservation detail now embeds an intake panel for numeric bookingFlowVersion 2 only; Self Storage/legacy decision panels remain.

The panel re-reads the assigned V2 reservation and all pages of inventory for its Facility/Customer, then filters the exact reservation. It fails closed on invalid response scope, IDs, duplicate items or unverified pagination. Creation eligibility mirrors `currentContent.ready`: DEPOSIT_PAID, at least one ACCEPTED inspection, no unresolved PENDING_INBOUND item and no DISCREPANCY or REJECTED inspection.

Backend further verifies the successful matching deposit ledger, active Facility, Customer/profile and capacity lock; no FE payment success is manufactured. After explicit confirmation, FE re-reads and compares the reviewed intake data before sending `{}`. Double clicks are blocked. Response must have a valid current contract snapshot and match reservation, Facility and owner. The resulting real Contract ID opens the shared GET review.

The endpoint is create-or-refresh: it reuses the reservation's existing contract. Changed content creates a new version and resets legacy signature timestamps/current status; identical content can preserve an existing contract. UI explicitly describes refresh and signature invalidation. No contract is created on page opening or by GET.

If create times out/returns an unverified result, submission remains locked even after intake GET refresh. There is no confirmed Facility contract list or reservation-to-contract GET; use the real Contract ID from an authorized Backend operator and the GET lookup. No invented discovery endpoint or automatic repeat POST is used.

## 5. Customer and Facility review/signing

The shared view renders Backend customer snapshot and the current content version: reservation/Facility/Cells, original pricing and inspected handover data. Legal terms or amounts are not generated/recalculated. It shows current version/hash, signer role/identity/time and signature progress.

Backend signature representation:

```text
{ version, contentHash, signerId, signerRole, signedAt }
```

Only signatures matching both currentContentVersion and that version's contentHash count. Old signatures do not sign changed content. The stored Backend enum has DRAFT, SIGNED, TERMINATED, EXPIRED. DRAFT with a current signature is displayed as PARTIALLY_SIGNED; this value is never submitted as a mutation.

Customer review uses existing `/contracts/me` plus owned reservation lookup and contract detail. Signing requires matching Customer identity/owner, V2 reservation DEPOSIT_PAID or CHECKIN_READY, valid version data and no current Customer signature. Staff/Manager signing requires matching assigned Facility, populated Managed reservation context, Customer already signed and no current Facility signature. Both Facility roles were fixture-tested; ADMIN/BOM are not offered signing controls.

Confirmation describes direct physical intake. No signature image upload, OTP, advanced e-signature, signing-as-another-role or remote-signing mechanism is added. Signer identity/role comes from the authenticated Backend actor, never the request body. The Backend currently has no separate physical-presence attestation; the local acknowledgement does not prove attendance.

Before PATCH, FE performs a fresh GET, compares version/hash/current signatures and rechecks permission/state. Stale reviewed data blocks the PATCH. Response must confirm the same reviewed version/hash, correct actor signature and consistent stored status. Double clicks/duplicate signatures are disabled. Timeout, 5xx and invalid success responses lock the action and direct users to GET-only refresh; no automatic PATCH retry or payment redirect occurs.

**Concurrency limitation:** sign requests accept no expectedVersion/contentHash precondition. Backend `ensureVersion` may refresh content inside the sign transaction. FE preflight cannot atomically prevent a change after GET. A mismatched returned version is treated as unknown rather than claimed success, but FE cannot undo or prevent a signature already recorded by Backend. An atomic reviewed-version guarantee requires a Backend contract update; no unsupported field or Backend change was introduced here. This remains a readiness gap for strict frozen-version acceptance.

## 6. Screens and entry points

Route definitions are unchanged.

- `/staff/inventory/inbound`: real scoped queue in API mode; `?flow=managed-v2` explicitly opens it while the existing demo workspace is enabled. Demo inbound screen links to this entry.
- `/staff/inventory/inbound/:itemId?flow=managed-v2`: real item and receiving result, blocked inspection explanation.
- `/staff/inventory/inbound?flow=managed-v2&contractId=:contractId`: Facility GET lookup/review/countersign for a known contract. It does not create a contract.
- `/manager/reservations?service=managed&flow=managed-v2`: existing ID lookup, reachable from the demo reservation directory's Backend Managed V2 intake link.
- `/manager/reservations/:reservationId?service=managed&flow=managed-v2`: V2 creation/refresh, GET lookup and Manager countersign. API-mode existing routes continue to work without the explicit flow parameter.
- `/portal/reservations/:id`: V2-only Review intake contract link.
- `/portal/contracts` and `/portal/contracts/:reservationId`: existing owned discovery and V2-specific review/signing branch. Legacy/Self Storage signing/payment branch remains intact.

Query parameters select a view; they do not change auth, Backend roles or the global demo setting. Demo operational data is not substituted into the V2 intake view. Existing Staff dashboard and unrelated operations retain their behavior.

## 7. Changed files

14 files, all under `C:/Users/laptop/Desktop/WDP/frontend/`:

| File | Change |
| --- | --- |
| `src/api/managedIntakeApi.js` (new) | Exact operational inventory read, contract create and Customer/Facility sign wrappers using existing Axios |
| `src/api/confirmedContract.js` | Add only confirmed operational inventory GET, contract POST and Facility-sign PATCH |
| `src/lib/managedIntake.js` (new) | DTO validation, readiness, current-version signature parsing and signing permission helpers |
| `src/components/customer/inventory/ManagedContractReview.jsx` (new) | Shared snapshot, progress, direct-intake confirmation, fresh checks and safe mutation handling |
| `src/components/manager/ManagedContractCreation.jsx` (new) | Manager intake verification and explicit create/refresh |
| `src/components/manager/ManagedContractLookup.jsx` (new) | Scoped Facility GET lookup and shared review |
| `src/pages/staff/ManagedReceivingQueue.jsx` (new) | Real scoped queue/detail/results and explicit inspection blocker |
| `src/pages/staff/StaffPages.jsx` | Existing inbound view delegates to V2 queue in API/explicit-flow mode; demo link retained |
| `src/pages/manager/ReservationsPage.jsx` | Explicit V2 API entry alongside preserved demo directory |
| `src/pages/manager/ReservationApiView.jsx` | V2 intake panel and matching descriptions; existing legacy/Self decisions retained |
| `src/components/customer/RentalLifecycleIntegration.jsx` | V2-only contract review/signing branch, reservation link, updated descriptive text |
| `.design-reference/check-customer-v2-phase4.cjs` (new) | Isolated DTO/API/browser acceptance fixtures |
| `.design-reference/check-inventory-contract.cjs` | Remove obsolete assertion forbidding operational inventory GET; new Phase 4 suite positively tests the exact added paths and continued mutation exclusions |
| `docs/CustomerV2Phase4Implementation.md` (new) | This report |

No package/dependency/configuration/environment/auth/route-definition/CSS file was modified. Existing shadcn components, Manager tables/cards/fields, allocated Cell summary, green/orange tokens and existing motion wrapper are reused. Backend reference files remain read-only.

## 8. Verification results

All browser suites blocked external traffic before installing local API fixtures. No test called live Backend POST/PATCH/DELETE or any payment/database operation. Screenshot-producing legacy suites were run through an in-memory wrapper that disabled screenshot writes and pointed them to the isolated Vite server; source suites were not rewritten for that purpose.

| Check | Result |
| --- | --- |
| Parse all 196 source JS/JSX/TS/TSX files | PASS |
| `npm run build` | PASS; existing large-chunk warning remains |
| `check-customer-v2-phase4.cjs` | PASS for implemented/blocked-boundary behavior; 113 fixture requests, 0 live requests |
| `check-customer-v2-phase3.cjs` | PASS, 106 fixture requests |
| `check-customer-v2-phase1.cjs` | PASS, 8 tests |
| `check-customer-v2-phase1-ui.cjs` | PASS, 50 fixture requests, including missing V2 snapshot/sign guard and legacy signing |
| `check-inventory-contract.cjs` | PASS |
| `check-inventory-mi02a.cjs` | PASS, 72 fixture requests |
| `check-managed-contract.cjs` | PASS |
| `check-mi02c-contract.cjs` | PASS |
| `check-mi02c-phase1.cjs` | PASS, 203 fixture requests; includes Phase 1.1 booking entry |
| `check-self-storage-contract.cjs`, `check-self-payment-contract.cjs` | PASS |
| `check-self-storage-completion.cjs` | PASS, 227 fixture requests |
| `check-staff-guards.cjs` | PASS, 17 atomic demo business guards |
| `check-staff-extra.cjs` | PASS, 20 responsive support/maintenance/refund routes and cross-tab synchronization |
| `check-staff.cjs` | **FAIL at existing checkout assertion** after 56 route/viewport checks and inspection/handover/check-in/inbound/relocation/outbound paths passed; see below |
| Staff receiving inspection submission / duplicate / timeout acceptance | **BLOCKED** by missing Staff reservation read; not represented as implemented/PASS |
| Live Backend/database E2E | **NOT RUN / BLOCKED** pending approved test environment |

Phase 4 fixtures cover scoped queue and result reads, Customer/wrong-Facility rejection, no writes on page opening, invalid inspection DTOs, RESERVED/discrepancy create blocking, explicit single create, DRAFT, Customer → PARTIALLY_SIGNED, both Staff and Manager → SIGNED, duplicate actions, wrong role/owner, stale version preflight, HTTP 400/401/403/404/409, signature and creation timeout recovery. They explicitly assert no receiving-inspection, balance, deposit, physical inbound or activation call occurs.

The new intake content fits 1440/1024/768/390/320px. With the deliberately long fixture name `Fixture FACILITY_MANAGER`, the **existing Manager header** overflows the full document at 390/320px, while the Phase 4 main content fits. The header/layout CSS was not changed; this remains an existing workspace limitation, not a claim of full-shell mobile acceptance.

Existing Staff-suite failure: `.design-reference/check-staff.cjs:14` expects UNIT-A203 to become MAINTENANCE immediately after proposing a 50000 VND charge. The unchanged `src/lib/staffDemoStore.js` `closeRental` deliberately sets it back to OCCUPIED/IN_PROGRESS while charge settlement is pending. Source/hash review confirms this function and Staff seed were not changed by Phase 4. The old assertion conflicts with that existing rule. No checkout rule or unrelated test expectation was changed to hide the failure.

## 9. Manual acceptance

Use only an approved writable test environment for steps that submit data. Fixture command: start the existing dev server on `127.0.0.1:5189`, then `node .design-reference/check-customer-v2-phase4.cjs`; every API response is intercepted locally.

1. Sign in as assigned Staff; open the V2 receiving queue and item detail. Verify quantities, weight/dimensions, preferred Cell, reservation ID and actual inspection result. Inspection submit must be disabled with the Staff reservation-read blocker. No fake values or forbidden reservation GET should appear.
2. Sign in as assigned Manager. Open a real V2 reservation ID via the intake entry. RESERVED, unresolved requested goods, discrepancies and rejected inspections must block contract creation.
3. Use a pre-existing, Backend-confirmed DEPOSIT_PAID reservation with accepted inspected goods. Confirm create/refresh once. Verify real Contract ID, server snapshot, content version/hash, DRAFT and unsigned progress. Opening/refreshing the page alone must not create anything.
4. Customer opens their own `/portal/contracts/:reservationId`, reviews the current content at direct intake, confirms and signs once. Verify own actor/version/hash and displayed PARTIALLY_SIGNED while stored status remains DRAFT. No payment redirect.
5. Assigned Staff or Manager opens the same real Contract ID. Before Customer signs, countersign is unavailable. After Customer signs the current version, explicitly confirm and countersign. Verify SIGNED and both authenticated identities/timestamps for the same version/hash.
6. Re-inspection/content change must require fresh review; old signatures must not count. Simulate timeout only through an approved fixture: GET refresh reconciles signatures; ambiguous create remains locked pending known-ID lookup. Never blindly repeat a write.
7. Check existing Self Storage, legacy Managed and Phase 3 entry/registration/inbound. No balance, placement, activation or access issuance is part of this screen.

## 10. Blockers and prerequisites before later phases

1. Backend must provide/authorize a Facility-scoped Staff reservation read containing V2 version, owner/Facility, state, balance lock and allocated Cells. Then inspection UI/mutation and Staff create verification can be implemented and tested without role workarounds. This task did not change Backend.
2. A Facility contract-list or reservation-to-contract GET is needed for complete discovery and recovery after an unknown creation result. Current known-ID GET lookup is available.
3. Strict frozen-version signing needs an atomic expected-version/hash precondition in Backend; fresh FE GET alone cannot close that race. Physical-presence attestation, if required, also needs a confirmed contract rather than a fabricated field.
4. Live acceptance needs an approved separate writable test database, scoped Customer/Staff/Manager accounts, eligible reservations/Cells and successful deposit/accepted-inspection fixtures, MongoDB transaction support, feature-gate confirmation and approved retention/cleanup procedures. No database environment was created or modified here.
5. Resolve/approve the existing Staff checkout test mismatch and Manager long-name header issue separately. Neither was changed outside this phase's scope.
6. Before Phase 5, complete the blocked inspection acceptance and strict signing/version requirements; separately audit/approve balance settlement and first physical inbound APIs. This implementation provides neither payment nor placement/activation controls and does not advance reservations automatically.

Final preservation check: SHA-256 snapshot comparison covers all 174 BE-REF files and confirms no changes. The original `backend/` directory was never accessed. Changes are limited to the 14 Frontend files listed above; build-generated `dist/` is not committed. Phase 4 remains PARTIAL/BLOCKED; Phase 5 was not started.
