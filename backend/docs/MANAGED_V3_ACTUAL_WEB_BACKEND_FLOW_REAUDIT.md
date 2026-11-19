# Managed Inventory V3 Actual Web → Backend Flow Re-Audit

**Task:** `WDP_MANAGED_V3_ACTUAL_WEB_BACKEND_FLOW_AUDIT`  
**Checkpoint:** `WDP_MANAGED_V3_ACTUAL_FLOW_REVIEW_REQUIRED`  
**Audit mode:** Read-only source review; no API writes, database access, deployment requests, or source changes.  
**Audit date:** 2026-11-18

## A. Executive Summary

- The current Customer SKU detail integration renders `ManagedUnifiedSelfInbound` for `inventorySchemaVersion === 3`. Its Confirm action calls `POST /api/v1/inventory-items/:skuId/v3/inbound` with an `Idempotency-Key`. It is the current Web V3 self-service inbound path found in source.
- This checkout’s matching backend route calls `ManagedUnifiedInboundService.confirm`. In `NODE_ENV=production` the service returns `503 INBOUND_CONFIRM_ENVIRONMENT_BLOCKED` before opening a database transaction. Therefore this checkout cannot confirm this Customer V3 endpoint successfully in production.
- The code contains transaction-backed ADD ledger writes for non-production execution, but there is no runtime request/response or persisted before/after evidence in the available workspace. **Conclusion: `INBOUND_SOURCE_CONFIRMED_RUNTIME_UNVERIFIED`**, with the reported successful Web run unresolved against this source. Do not label inbound runtime-confirmed from a toast or this source audit.
- A second Customer V3 component, `ManagedSelfInboundV3`, also calls the same guarded V3 preview/confirm endpoints and exposes A1/A2 choices in its own code. The current `InventoryIntegration.Detail` mounts `ManagedUnifiedSelfInbound`, not `ManagedSelfInboundV3`; the latter has no import/caller found in `src` (within the searched source tree). A1/A2 is therefore not the rendered current detail workflow found here.
- The `410 STOCK_WORKFLOW_NOT_AVAILABLE` physical-unit and legacy inbound routes are distinct from the V3 unified inbound route. They do not prove all inbound is blocked, but they block those particular HTTP paths. Conversely, the V3 route existing does not bypass its production service guard.
- Current booking/copy describes first physical inbound as Staff-confirmed, but this backend checkout maps `/inventory-items/:id/confirm-inbound` and receiving-inspection writes to 410. This is another version/workflow discrepancy requiring runtime request identification.
- Current Customer Web default API base is `https://wdp-m4ns.onrender.com/api/v1` (overridable by `VITE_API_BASE_URL`). The running frontend build’s effective value and the deployed backend commit/environment were not verifiable. Repository worktree metadata is malformed: frontend/backend `.git` files refer to missing `C:/Users/laptop/Desktop/WDP`, and Git commands fail with `fatal: cannot change to 'C:/Users/laptop/Desktop/WDP'`.
- Outbound and relocation Web components call V3 endpoints whose backend services read/write `ItemMovement`, `ManagedCellStock`, `ManagedItemInstance`, and V3 stock projection/ledger state. This is the same broad stock model used by unified inbound at source level. Runtime interoperability and successful replay are unverified.
- Customer Mobile should not treat inbound as production-ready based on this audit. It may implement the same contract only after the observed Web success is tied to a specific request URL, deployed backend commit, environment class, response, and read-after-write evidence.

## Phase 0. Workspace and Version

| Component | Source location | Branch/HEAD | Runtime target | Verified |
|---|---|---|---|---|
| Customer Web | `C:\Users\laptop\Desktop\WDP\frontend` | `UNVERIFIED` (Git fails due to broken worktree metadata) | Default source fallback `https://wdp-m4ns.onrender.com/api/v1`; effective build override `UNVERIFIED` | Source location yes; deployed version no |
| Backend | `C:\Users\laptop\Desktop\WDP\backend` | `UNVERIFIED` (same broken worktree metadata) | Remote Render target is configured by Web fallback; deployed backend identity/env `UNVERIFIED` | Source location yes; runtime identity no |
| Customer Mobile | Not present in audited workspace | `UNVERIFIED` | Not integrated | No |

Git metadata inspection was read-only. The root `WDP` directory has a `.git` directory, while `frontend` and `backend` have `.git` files pointing to a missing top-level worktree path. No Git configuration was changed. No safe evidence was available to establish `NODE_ENV` of the service Web actually reached.

## B. Actual Web → Backend Call Chains

### Customer V3 unified inbound (current mounted detail component)

```text
Component: frontend/src/components/customer/inventory/InventoryIntegration.jsx (Detail)
Mounted child: ManagedUnifiedSelfInbound when item.inventorySchemaVersion === 3
Event handler: ManagedUnifiedSelfInbound.confirm / reconcile
Frontend API: frontend/src/api/managedInventoryV3Api.js: confirmInbound
HTTP method: POST
Endpoint: /api/v1/inventory-items/:skuId/v3/inbound
Headers: Authorization from axios client; Idempotency-Key generated/persisted in sessionStorage
Body: unified inbound candidate (Access Session, session/SKU/spec revisions, lines with
      Item Specification, quantities and Cell placement/allocations; preview supplies proofs)
Route: backend/src/routes/inventory-item.routes.ts
  router.post('/:id/v3/inbound', customer, v3Controller.confirmInbound)
Controller: backend/src/controllers/inventory-items/managed-inventory-v3.controller.ts
  confirmInbound → ManagedUnifiedInboundService.confirm(...)
Service: backend/src/services/inventory-items/managed-unified-inbound.service.ts
Models touched in non-production transaction: InventoryItem, ItemSpecification, ManagedAccessSession
  (scope check), Cell, Rack, Reservation, Cell Allocation, ManagedCellStock,
  ManagedItemInstance and ItemMovement; read/reconcile also uses projection, physical-unit,
  batch-placement/footprint records and canonical prior movements as applicable.
Response: { success: true, data: {status:'COMMITTED', movementId, movementCode,
  quantity, totalWeightKg, totalVolumeM3, lineCount, sessionRevision} }
UI success: shows success notice, clears preview/pending intent, reloads stock/context/movements.
```

The button is disabled until form conditions and preview proof checks pass. The UI’s notice is shown after HTTP success, then it requests refreshed stock/history. Source contains no mock success in this mounted component. UI refresh is not evidence that a production write occurred absent the corresponding successful network response and read-back.

### Customer V3 legacy A1/A2 component (not mounted in current detail integration)

`ManagedSelfInboundV3.jsx` contains UI branching on `A1_PHYSICAL_UNIT` vs A2 and calls the same `previewInbound` and `confirmInbound` API methods above. No caller/import was found under `frontend/src`; classify as **unused/unmounted in inspected source**, not absolutely dead. Its A1 prerequisite API `/v3/physical-units` is 410 in the backend route. The current mounted unified form is specification/quantity/cell oriented and does not present A1/A2 selection.

### Staff first inbound (separate workflow)

```text
Component: frontend/src/pages/staff/ManagedReceivingQueue.jsx
Event: FirstInboundConfirmation.submit
Frontend API: frontend/src/api/managedIntakeApi.js: confirmFirstInbound
HTTP method: POST
Endpoint: /api/v1/inventory-items/:itemId/confirm-inbound
Route: backend/src/routes/inventory-item.routes.ts
  router.post('/:id/confirm-inbound', requireRole([FACILITY_STAFF]), phaseOneNoStockMutation)
Handler: unconditional route middleware → HTTP 410 STOCK_WORKFLOW_NOT_AVAILABLE
```

Staff receiving queue also saves receiving inspection through `POST /inventory-items/:itemId/receiving-inspection`, which is likewise 410 in this backend checkout. Evidence upload routes are separate; successful upload/inspection UI is not equivalent to stock confirmation.

### Outbound and relocation (source path summary)

Current `InventoryIntegration.Detail` mounts `ManagedSelfOutboundV3` and `ManagedSelfRelocationV3` for V3 SKU records. They call customer-scoped routes under `/inventory-items/:skuId/v3/outbound` and `/v3/relocation` (with context/preview/operation reads). Their service imports confirm they operate on canonical V3 movement and cell-stock/item-instance state. See Mobile contract table below; no runtime evidence was present.

## C. HTTP 410/503 Contradiction Resolution

| Error | Route | Web call chain | Web actually calls? | Runtime condition | Conclusion |
|---|---|---|---|---|---|
| 410 `STOCK_WORKFLOW_NOT_AVAILABLE` | `POST /inventory-items/:id/v3/physical-units` and GET counterpart | Only the unmounted `ManagedSelfInboundV3` A1 path uses prepare/list physical unit | No from the current mounted Detail path; yes if legacy component is enabled elsewhere | Unconditional route middleware | A1 physical-unit route disabled; not a blanket inbound conclusion |
| 410 `STOCK_WORKFLOW_NOT_AVAILABLE` | `POST /inventory-items/:id/inbound-request`, `POST /:id/confirm-inbound`, `POST /:itemId/receiving-inspection`, `/inbound-requests` create and related mutations | Older Customer request/Staff queue paths; current Staff queue uses confirm-first endpoint | Staff flow caller exists; current V3 Customer detail does not use them | Unconditional route middleware | Those legacy/first-inbound writes cannot succeed against this source |
| 503 `INBOUND_CONFIRM_ENVIRONMENT_BLOCKED` | `POST /inventory-items/:id/v3/inbound` | Current mounted Customer V3 unified form calls it directly | Yes | `NODE_ENV === 'production'`, checked after idempotency lookup and before transaction start | Production Customer V3 confirm is blocked in this source |
| 503 `LEDGER_REPLAY_UNKNOWN` | Same V3 confirm preflight | Same caller | Yes, if replay throws on preflight | Any caught replay error; sanitized server log `MANAGED_LEDGER_REPLAY_FAILED` | Fail-closed condition exists; no evidence it occurred or was repaired at runtime |

The reported successful Web Inbound cannot be explained by this exact source running as production through this exact endpoint: its guard is unconditional for `NODE_ENV=production`. Plausible explanations include the Web called a different endpoint, the contacted backend ran non-production or different code, the success was observed in a demo/local flow, or the UI action was not the confirm represented here. These are hypotheses, not findings. **`INBOUND_CONTRADICTION_UNRESOLVED`** until runtime evidence identifies the request and backend version/environment.

## D. Current Managed Inventory Business Model (source)

Web’s V3 Customer detail treats the Inventory Item as a SKU/group and exposes Item Specifications, stock, movements, and self-service operations. Inbound form is unified around quantities/specifications and Cell placement under an active INBOUND Access Session. Backend source keeps storage internals such as lots, physical-unit instances, footprints, batch placements and canonical movement effects. Those internal representations do not establish separate customer-facing A1/A2 workflows.

Backend unified confirm source, when environment permits, checks SKU ownership, active reservation, revisions, preview candidate, access-session purpose/scope, capacity, placement/topology, and replay/reconciliation state. Within one MongoDB transaction it fences Cell/Rack/Reservation/Specification/SKU revisions and counters, creates Cell Stock/Item Instance records as selected by normalized placement, saves one schemaVersion 4 `INBOUND` Movement with `stockEffect.action: ADD`, promotes matching Cell allocations from RESERVED to OCCUPIED, and updates reservation used capacity/revisions. Transaction failure should roll back the writes; source handles duplicate-key idempotency, unknown commit outcome and unavailable transactions explicitly. This is code behavior, not E2E proof.

Inbound quantity in the unified form is line/Item Specification quantity. Source supports multiple lines/cells as normalized candidate data subject to service checks. Partial inbound and repeat receipts in a business sense are not established by a successful runtime; repeated-inbound APIs are separate and their create/confirm mutation paths are guarded 410 here. Reservation capacity is updated from physical stock volume, not merely registration.

## E. Stock & Ledger Consistency

- Unified inbound preflight replays canonical `ItemMovement` records and checks replayed lots/instances against `ManagedCellStock`, allocation rows, Cell physical counters, Reservation counters and projection state. Unknown or mismatched legacy data fails closed with 503 rather than claiming a balance.
- ADD is represented by schemaVersion 4 Movement `stockEffect` including request hash, ledger revision, access session and destination lineage. Depending on normalized placement, the destination is represented by lot/batch Cell quantities or Item Instance placements; CellStock and reservation/cell counters are updated in the same transaction.
- V3 outbound imports `readManagedFacilityStockState` from unified inbound service and uses the V3 ItemMovement, CellStock and ItemInstance models. V3 relocation imports the same stock-state reader and canonical movement/cell-stock/item-instance models. This supports source-level model alignment, not runtime compatibility proof.
- Tests named `managed-unified-inbound-domain`, `managed-inventory-v3-ledger`, `managed-stock-ledger`, outbound/relocation suites exist. No tests were run in this audit. Test file presence is not a test pass.
- `LEDGER_REPLAY_UNKNOWN` remains a source guard. Current source has replay logic for canonical ADD/REMOVE/MOVE via shared ledger domain; no log or production data was inspected, so no statement is made that existing data is replayable or that the prior error was fixed.

## F. Customer Mobile API Contract (source-only unless marked)

Prefix: `/api/v1`; protected calls require the existing Customer auth mechanism. Backend remains authoritative for ownership, role, facility, reservation, session, revision, capacity, idempotency and stock validation.

| Feature | Method | Endpoint | Web caller | Backend handler | Required inputs / response | Status |
|---|---|---|---|---|---|---|
| Inventory list/register/detail | GET/POST/GET | `/inventory-items/me`, `/inventory-items/`, `/inventory-items/:id` | `InventoryIntegration` and `InventoryItemForm` | SKU controller/service | SKU DTO; list pagination/detail | `SOURCE_CONFIRMED` |
| Item Specifications | GET/POST/PATCH/DELETE | `/inventory-items/:skuId/specifications[/... ]` | `ItemSpecifications` | SKU controller/service | SKU ownership; spec measurements/unit/revision | `SOURCE_CONFIRMED` |
| Inbound context | GET | `/inventory-items/:id/v3/inbound/context` | `ManagedUnifiedSelfInbound.reload` | V3 controller → unified service | SKU ID → session/cells/reservation context | `SOURCE_CONFIRMED`; runtime unverified |
| Inbound preview | POST | `/inventory-items/:id/v3/inbound/preview` | `ManagedUnifiedSelfInbound.preview` | V3 controller → unified service | spec/quantity/cell/session/revisions → advisory candidate proof | `SOURCE_CONFIRMED`; runtime unverified |
| Inbound confirm | POST | `/inventory-items/:id/v3/inbound` | `ManagedUnifiedSelfInbound.confirm/reconcile` | V3 controller → unified service | preview candidate + `Idempotency-Key`; committed movement DTO | `BLOCKED` when production; otherwise `SOURCE_CONFIRMED`; runtime unverified |
| Physical Unit legacy prep | GET/POST | `/inventory-items/:id/v3/physical-units` | unmounted `ManagedSelfInboundV3` | unconditional route 410 | A1 physical unit body | `LEGACY` / `BLOCKED` |
| Stock and history | GET | `/inventory-items/:id/v3/stock`, `/v3/cell-stock`, `/v3/specifications/:specId/cell-stock`, `/v3/movements` | Unified inbound loads SKU stock/movements; detail/history components | cell-stock read service / controller | owner-scoped SKU/spec IDs → customer-safe DTO/list | `SOURCE_CONFIRMED`; runtime unverified |
| Outbound | GET/POST | `/inventory-items/:skuId/v3/outbound/context`, `/operations`, `/preview`, `/outbound` | `ManagedSelfOutboundV3` | V3 outbound controller/service | active OUTBOUND session, quantity/receipt/cell, revisions; confirm idempotency/fencing | `SOURCE_CONFIRMED`; runtime unverified |
| Relocation | GET/POST | `/inventory-items/:id/v3/relocation/context`, `/operations`, `/preview`, `/relocation` | `ManagedSelfRelocationV3` | V3 relocation controller/service | source/destination, quantity/placement, session/revisions; confirm idempotency/fencing | `SOURCE_CONFIRMED`; runtime unverified |
| Staff first inbound | POST | `/inventory-items/:itemId/confirm-inbound` | Staff `ManagedReceivingQueue` | unconditional 410 handler | legacy item/cell/quantity body | `BLOCKED` in this source; not a Customer Mobile API |
| Renewal | — | No Managed V3 Customer renewal route found | No matching V3 caller found | No Managed V3 renewal writer identified in audited sources | — | `MISSING` in inspected source |
| Closure readiness | GET | `/reservations/managed/:id/closure-readiness` | caller not confirmed in current Customer page scan | readiness service | reservation ID → diagnostic | `SOURCE_CONFIRMED`; runtime unverified |
| Closure / release | — | No Managed V3 close/release writer found in inspected source | — | — | — | `MISSING` |

Mobile should not use the old inbound request/physical-unit paths for V3. It should preserve the server error status/code distinctions, persist and reuse an idempotency key for uncertain outcomes, reconcile via `/v3/operations?key=...`, and refresh stock/movement after a confirmed response. Do not surface success until the confirm response is accepted; a lost response requires reconciliation before a changed payload.

## G. Blockers & Risks

- **P0 – Runtime contradiction unresolved:** user-observed success is not tied to request/response or deployed backend identity. Current source plus production environment implies 503 on V3 confirm.
- **P1 – Production inbound guard:** current customer V3 confirm fails closed for `NODE_ENV=production` before writes.
- **P1 – Legacy first-inbound mismatch:** current Customer lifecycle copy/Staff screen indicates Staff first inbound, but its confirm/inspection mutations are 410 in this backend source.
- **P1 – Runtime Stock/Ledger not verified:** no read-after-write stock and movement evidence, no runtime log, no deployed commit/environment proof.
- **P2 – Worktree/version auditability:** malformed Git worktree metadata prevents branch/HEAD confirmation from supplied paths.
- **P2 – A1/A2 confusion:** stale/unmounted component retains A1/A2 language; mobile should follow mounted unified SKU/specification/quantity model after confirming deployment contract.

No production database, API write, Payment Intent, PayOS, migration, environment file, Git configuration, or source file was touched. No secrets were read or emitted.

## H. Tests & Runtime Evidence

| Evidence | Result | Limit |
|---|---|---|
| Source route/controller/service trace | Completed | Source only; deployed version unknown |
| Frontend default API URL inspection | Completed | `VITE_API_BASE_URL` build override/runtime target unknown |
| Existing request/response logs | Not found in inspected workspace paths | No runtime request evidence |
| Stock/movement before-after read | Not performed | No database access; read-back evidence unavailable |
| Backend build/tests | Not run | Audit request prioritizes read-only source/runtime evidence; source test files were only identified |

To resolve runtime contradiction safely, provide/redact an existing browser Network entry (URL, method, status, request body shape, response body shape), backend server commit/version and environment class, plus already-existing before/after SKU stock and Movement read evidence. Do not send tokens, cookies, payment keys, or database URIs. No new write request is required for this audit checkpoint.

## I. Mobile Readiness

| Business flow | Web working? | Backend source | Runtime verified? | Mobile ready? |
|---|---|---|---|---|
| Booking | Current Web source has booking UI/calls | Booking quote/create source exists | No evidence in this audit | Source contract only; validate deployment |
| Payment | Current Web source has PayOS flow | Payment source exists; environment/provider gates apply | No evidence in this audit | Partial; must confirm deployed flow/runtime |
| Contract | Customer Web has contract pages; lifecycle also has Staff proof flow | Contract routes/source exist | No evidence in this audit | Partial; follow V3 paper-proof rules |
| Inbound | Current V3 detail mounts unified form | Production confirm guard; non-production transactional writer | No; contradiction unresolved | No, until runtime endpoint/version and persistence verified |
| Outbound | V3 component mounted for V3 SKU | V3 source path exists | No evidence | Source contract only |
| Relocation | V3 component mounted for V3 SKU | V3 source path exists | No evidence | Source contract only |
| Stock | V3 detail reads stock | Scoped stock reader/source exists | No evidence | Source contract only |
| Movement | V3 detail/history reads movements | Owner-scoped V3 reader/source exists | No evidence | Source contract only |
| Renewal | No V3 Web caller found | No V3 route/writer found in inspected source | No | No |
| Closure | No V3 completion caller found | Readiness source; no close/release writer found | No | Read-only readiness at most |

## J. Recommendations

1. Resolve the contradiction using an already-observed Web Network request and its server commit/environment; do not infer from the success toast.
2. If that request was the V3 unified endpoint, verify whether its target was non-production or a different backend version. Confirm existing stock and Movement by read-only evidence.
3. Agree the intended first-inbound lifecycle: current Customer V3 self-service path versus Staff-confirmed first inbound. The checked-out backend has the latter write routes disabled and the former production guard enabled.
4. Once the deployed contract is verified, implement Mobile in dependency order: auth/facility and booking → payment/contract/handover state → SKU/specifications → Access Visit/Session → inbound with idempotency/reconciliation → stock/history → outbound → relocation → renewal/closure only after backend support exists.
5. Keep A1/A2 and Physical Unit as internal/legacy implementation detail unless deployed Web UI and backend contract demonstrate they are current customer concepts.

**FINAL CHECKPOINT:** `WDP_MANAGED_V3_ACTUAL_FLOW_REVIEW_REQUIRED` — stop for review before implementation.
