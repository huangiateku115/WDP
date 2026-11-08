# Frontend adjustment plan — review required, not executed

This is a dependency-aware implementation plan, **not permission for a project-wide refactor**. Preserve frontend/AGENTS.md, route paths, one website Axios client, all working integrations/animations and isolated demo data. No Backend edits are proposed as Frontend work. Backend dependencies require a separate owner/task. See exact current files/functions in WEBSITE_FRONTEND_IMPACT.csv and all23 designs in MOBILE_FRONTEND_IMPACT.csv.

## R1 — Contract alignment and narrow website transport repair

**Entry:** independent review of this audit; current route source retained; installation blocker R12 diagnosed without version changes. Existing tests can be run selectively without qrcode if no package installation has yet been approved.

**Small first implementation task:** repair only the **11 Staff MI06 allowlist method/path combinations** already used by existing helpers/UI. Expected application change: `frontend/src/api/confirmedContract.js`. Add focused fixture regression under `frontend/tests/` that invokes the existing `inventoryApi` helpers through the shared Axios request interceptor/fake adapter. Existing helpers/components do not require a rewrite to prove this defect.

Exact allowlist candidates (prefix `/api/v1` comes from shared client):

| Method | Path |
| --- | --- |
| GET | /inbound-requests/receiving-queue |
| GET | /inbound-requests/:requestId/receiving |
| POST | /inbound-requests/:requestId/evidence-uploads |
| POST | /inbound-requests/:requestId/inspection |
| POST | /inbound-requests/:requestId/return-completed |
| POST | /inbound-requests/:requestId/confirm |
| GET | /outbound-requests/staff-queue |
| GET | /outbound-requests/:requestId/staff-detail |
| POST | /outbound-requests/:requestId/confirm |
| GET | /inventory-items/:id/relocate-canonical/context |
| POST | /inventory-items/:id/relocate-canonical |

Backend role/ownership/gates remain authoritative; the allowlist itself is not a role guard. Require24hex IDs for resource positions, exact methods/suffixes, unchanged Customer paths, unknown/wrong methods blocked. Preserve header Idempotency-Key/If-Match and repeated Staff body keys (`inspectionKey` / `idempotencyKey`). Backend-disabled404/503 must remain explicit; no fake success or legacy fallback. Tests must not stub away `assertConfirmedRequest`, the defect under investigation.

**Other R1 tasks, separate commits:** typed per-family DTO/error inventory and contract tests; no generic envelope decoder. Proposed native DTO/mappers under `customer-mobile/src/api/contracts/` and `src/api/mappers/` are **new planned files**, not created. Don't port browser auth storage. `src/api/inventoryApi.js` only changes if required by a confirmed mapper bug; helpers' method/path currently correct.

**Dependencies:** R13 narrow fix independent of unsafe contract print/inspection APIs. Production rollout of MI06 remains R10 blocked. Separate task must verify/restore website node_modules from existing package/lock before full build; no install/lock changes in this audit.

**Tests/exit:** eleven helper calls reach fixture adapter, wrong methods/paths blocked, auth header preserved, key/version intact, errors not swallowed, no live request. Website existing Customer/Staff regressions preserved. Risk M; rollback allowlist additions only, never bypass guard.

## R2 — Authentication and ownership

**Entry:** approved test deployment/revision, auth contract and expiry policy; Backend security issues R04/R05/R08 addressed or explicit read-only/re-login scope accepted.

**Expected files:** native `src/api/client.ts` only in a future approved integration task; new `src/api/auth.ts`, DTO/session helpers, approved OS secure storage adapter; existing `src/state/useCustomerStore.ts`, `useCareSessionStore.ts`; `src/screens/LoginScreen.tsx`, RegisterScreen.tsx, ProfileScreen.tsx, forms/auth.ts; existing auth/root Expo route files from design-map. Website `src/api/axiosClient.js` and `src/lib/authSession.js` remain stable unless a separate confirmed defect requires change.

**Proposed behavior:** Bearer auth/current-user role check; map displayName not fixture name; Customer-only native entry; access token memory, credential persistence only approved secure store; session epoch/abort to prevent account-A data appearing under B; clear caches/drafts on account change. No refresh endpoint means re-login on expiry unless Backend adds reviewed contract. No provider confidential secret, token query string or browser localStorage copied into native.

**Tests/exit:** malformed login/user, non-Customer role, inactive account,401 logout/expiry, missing secure store, duplicate login, stale responses/account switch, no refresh storm. Android/iOS actual persistence/background/kill/relaunch tests. Risk H; fail closed real mode on auth failure, fixtures clearly separate, no mixed data fallback.

## R3 — Customer read-only feature cutover

**Entry:** R2 session/owner boundary; DTO runtime validation and source/deployment evidence. Treat profile GET/payment-status GET side effects explicitly; never use them for unapproved live audit.

**Expected files/modules:** native screens01–03,09–10,13–14,18–21 (exact26 unique screen files across total23 designs in CSV), `src/domain/models.ts`, `inventory.ts`, `rentalDocuments.ts`, `customerCare.ts`, appropriate existing state stores, new catalogue/reservation/inventory/notification/support read adapters. Website `customerReservationService.js` lifecycle copy, CustomerSupportIntegration only for private-link containment. Stable notifications/A4/PayOS history source stays intact.

**Behavior:** paginated owner reads, Self/Managed family selection, nullable stock/readiness, exact errors, real images without fixture substitution, no unsupported notification navigation. Support public conversations are real source APIs; internal notes never Customer data. Native profile separates User and identity verification.

**Optional closure diagnostic subtask:** new helper in managedReservationApi plus matching allowlist/detail UI only after explicit scope approval. Staff is not authorized; Customer/FM/Admin/BOM may read source-scoped result. No close/release buttons. Existing frontend readiness absence is not a bug requiring immediate new UI.

**Tests/exit:** empty/error/loading/malformed/foreign resource; complete-page vs partial-page search, cancelled/stale loads, unknown stock preserved, current/legacy movement schema, read-only mode no POST. Real-device list performance/accessibility and font scaling. Risk M; whole-feature data-source selection, no array merging demo+real.

## R4 — Booking and lifecycle alignment

**Entry:** R2/R3, pricing scope/short-term R06 resolved, interval endpoint deployed/capability verified; approved write test environment. Managed V2 production remains disabled absent rollout.

**Expected files:** native UnitSelectionScreen, BookingReviewScreen, BookingConfirmationScreen, WarehouseMapScreen, ManagedBookingReviewScreen, RentalDetailScreen; domain/booking.ts/managedBooking.ts; state/useBookingStore.ts/useManagedBookingStore.ts; future typed booking adapters. Website SelfStorageReservationReview suggestion rendering, customerReservationService Self lifecycle text, manager ReservationApiView copy. Preserve existing SelfStorageAvailability/calendar, strict selfStorageCreation and new PayOS redirect.

**Contract changes:** Self interval list/date-only availability; current create CONTRACTED+DRAFT;409 top-level suggestedUnits. Managed strict UTC term/Cell IDs/server capacity/quote remain independent. Don't synthesize full Zone floorplan geometry; periodStatus and isBookable separate from ownership/physical usage. Source availability is not a promise against concurrent create.

**Tests/exit:** dates today/future/past, UTC/local boundary/leap/month/year clamp, end-exclusive adjacency, expired holds vs committed deposit/checkin states, max500 UNKNOWN, unexpected Unit/month payload, quote invalidation, explicit alternative choice, owner/profile/state conflict and unknown create no duplicate retry. Staff approval only legacy RESERVED, no routine approve on new Self. Risk H; disabled create on unavailable capability/validation, no legacy fallback.

## R5 — Inventory mutations and lifecycle fencing

**Entry:** R2/R3 authoritative stock/ownership; real gates+approved test writes, R14 closure semantics accepted. No canonical mutation production enabling from client flags.

**Expected files:** website InventoryItemForm, managedInventoryContext, RepeatedInboundRequests; Staff RepeatedInboundQueuePage, CanonicalRelocationPage, CanonicalOutboundQueuePage, ManagedReceivingQueue; customerRepeatedInbound and inventoryRegistration helpers if capability mapping requires. Native InventoryFormScreen, InventoryRequestScreen (designs16/17 share), forms/inventory.ts, domain/inventoryRequests.ts, state/useInventoryDraftStore.ts/useRequestDraftStore.ts, future Item/request adapters. Existing image components/lifecycle preserved.

**Changes:** required itemCode and exact quantity/unit/dimension DTOs; real image upload ownership/keys; REGISTERED unplaced edit/rejected V2 exception; closure marker and409 CAS refresh preserving form; create/amend inbound blocked, read/cancel/return cleanup separate. Canonical requestedQuantity only; held/onHand/batches authoritative; partial fulfillment terminal semantics; no amend or legacy fallback. Staff selection sequence cancellation and persistent uncertain return key. Do not disable valid outbound merely due pending closure; no new overdue permission.

**Tests/exit:** Item missing/loading/error; owner A/B; key/version replay/conflict/428; unknown503 same key/payload; gate off preserves reads/cleanup; pending closure register/edit/inbound/move blocked; eligible outbound/resolution remains; ledger arithmetic/schema/quantity unknown; images upload/retry/remove/reorder/save/refresh preserved; rapid selection and session changes. Physical confirmations only Staff. Risk H; wrong schema/capability disables writes, never defaults stock to zero.

## R6 — Contract and payment

**Entry:** server print/scope fixes R01/R08, reviewed hash/version compare-and-sign R03, Self pricing and production activation policy R06/R33, provider/test-environment approval R11. Owner reads may precede commands.

**Expected files:** native ContractReviewScreen, PaymentDetailScreen, domain/rentalDocuments.ts, future contract/PayOS adapters and approved return navigation handler. Website ManagedContractReview/ManagedContractLookup containment; FacilityHandoverPanel/facilityHandoverApi safe print/proof guards. Preserve current website SelfStoragePayosCheckout, payosPaymentClient, selfStoragePayos/polling/QR, PaymentHistoryPage and Customer A4 unless focused test reveals a bug. Restore declared qrcode install in separate approved environment task first.

**Contracts:** GET snapshot as truth; only valid current signatures determine signed progress. Do not invent review version fields absent server support. Generic Self DRAFT sign is not proof of deposit eligibility; paper proof is distinct. Keep unsafe raw print disabled; use authorized detail for readable A4.

**Payments:** Self-only PayOS purpose+header key<=120; distinguish checkout state/status/verified settlement/application; per-reservation history cursors and server QR; same-intent unknown retry; actual Callback is provider-owned. Managed MOCK body key<=160 and zero-balance branch different. Native return HTTP(S) web path dependency; no invented app scheme or success-from-redirect. Refund/adjustment and Managed provider remain unsupported. Production handover unavailable cannot be bypassed to mark ACTIVE.

**Tests/exit:** DRAFT/partial/current fully signed/stale hash/version/wrong owner; refreshed Facility countersign; no duplicate POST. Pending/failed/verified-but-unapplied/manual review, conflicting capture/late receipt, history across sessions, checkout hidden when no longer eligible, provider URL/QR validation, zero Self review vs Managed zero completion, expiry/unknown state. Browser fixture first; provider sandbox/live test only with separate authorization; Android/iOS return/resume proof. Risk H; signing/payment commands remain disabled until all prerequisites met.

## R7 — Staff, Manager, Admin and BOM alignment

**Entry:** R1 transport repair; server scoped inspection/paper/contract reads and production activation dependencies closed; explicit role capabilities.

**Expected files:** FacilityHandoverPanel, facilityHandoverApi, Staff InspectionApiView/CheckoutApiView/HandoverApiView, ManagedReceivingQueue, Manager ReservationApiView, BOM OversightLivePage. Existing StaffRoutes real pages already mounted; Admin UsersLivePage, bomApi facility/pricing/policy/structure helpers need **NO_CHANGE** from this diff. Preserve demo/local stores and label them explicitly.

**Behavior:** PAID Self does not imply production activation available; no extra approve for new CONTRACTED; align Manager/Staff assigned facility and Backend role restrictions (ADMIN handover also requires assignment, Staff cannot closure-readiness). Closure diagnostics never settle charges or release allocations. Generic CHECK_OUT must remain blocked until server scope/linkage/atomicity fixed; don't rely on client facility filters.

**Tests/exit:** every route action exercised as permitted and denied roles/facilities via fixtures then authorized Backend tests; safe local demo separation; no physical confirmation by Customer/BOM where service rejects. No generic roles-to-global-access mapping. Risk H; disable unsafe commands pending server dependency, preserve read-only views only with scoped data.

## R8 — Security, device acceptance and regression

**Entry:** reviewed changes in small batches, approved deployment/test accounts and write scope, no unresolved P0 in release features.

**Expected files:** test suites under website/tests and customer-mobile/tests, contract fixtures, reports; dependency manifests only in separately approved remediation task. No forced audit fix or library replacement.

**Verification:** website production build/full tests/Warehouse Map, Customer booking/inventory/image/sign/payment, Staff/FM and Admin/BOM scope tests; native typecheck/375 existing tests plus new DTO/session/contract tests. Review historical19 advisories against actual lockfile/runtime reachability separately. Android/iOS real device/simulator: keyboard/safe area/font scaling/screen reader/hardware Back, app kill/resume/background/network loss, deep links/provider return, session logout/rotation policy, memory/performance.

**Exit:** source and deployed revision recorded, exact gates verified, no unsafe fallback, owner negative tests, retries/unknown outcomes and transaction acceptance, no demo data in real caches. Export/RN Web/unit PASS alone never equals device/live payment E2E. Roll back one feature adapter/capability at a time to explicit unavailable, not mixed demo-success.

## Review boundary

No phases above executed. No next implementation prompt generated. Recommended next task is the narrow R1 Staff allowlist repair with shared-interceptor fixtures, **after independent review**. Website dependency environment repair is a separate prerequisite for a full-build PASS, not a reason to change Backend or expand that first task.
