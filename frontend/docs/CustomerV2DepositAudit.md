# Customer V2 Deposit API Audit

Date: **16 October 2026**. CV2-004 Phase 2A: **read-only audit and implementation plan**.

Evidence roots: **FE** = C:/Users/laptop/Desktop/WDP/frontend/; **BE** = C:/Users/laptop/Desktop/WDP/BE-REF/; **PM** = C:/Users/laptop/Downloads/WDP-Managed-Inventory-v2-Deposit-Checkin-Inbound.postman_collection.json. File references below use these absolute roots plus one-based line ranges. Postman references use folder/request names. Embedded document scripts are contract evidence, not permission to execute them.

## 1. Executive summary

**Phase 2A status: BLOCKED for the complete Phase 2B deposit flow.**

Both mutation contracts exist and are sufficient for a bounded **development MOCK happy path**, but the complete recovery flow lacks a supported Customer **payment-status/history read contract**.

GET Managed reservation can confirm the aggregate transition to DEPOSIT_PAID. It cannot distinguish no payment, PENDING, FAILED or RECONCILIATION_REQUIRED while the reservation remains RESERVED, nor recover an unknown payment ID/provider/key after refresh. Retrying POST is not a read and has expiry/lifecycle-dependent behavior. No missing endpoint is invented. This is the task's stop condition for complete confirmation/reconciliation through supported reads.

Confirmed findings:
- Deposit routes require NODE_ENV exactly development and MI_MANAGED_DEPOSIT_FLOW_ENABLED exactly true.
- Both use provider MOCK, not PayOS.
- Initiation returns a DEPOSIT payment, normally PENDING, and leaves reservation RESERVED. Initiation is not payment success.
- Confirmation atomically settles payment SUCCEEDED, converts live Cell HOLDs to RESERVED and sets DEPOSIT_PAID, without physical stock or activation.
- Same-key replay is conditional, not valid indefinitely after future lifecycle transitions.
- Existing frontend wrappers are blocked by the client allowlist. Current V2 payment UI is intentionally read-only.
- Legacy Self Storage and Managed payment safeguards can remain isolated; no redesign is required.

Sources: BE services/reservations/managed-reservation.service.ts:29,415–422,514–595; BE routes/index.ts:1–57; FE api/confirmedContract.js:7; FE components/customer/RentalLifecycleIntegration.jsx:465–510.

The accepted Phase0/1/1.1 baseline is preserved. The older Phase1 report's quota blocker is historical; Phase1.1 fixed it and full MI-02C regression subsequently passed. This audit does not revert those implementations.

## 2. API contract table

Paths below are relative to the existing /api/v1 mount. Reuse the existing base normalization/client; do not append a second API prefix (FE api/confirmedContract.js:6; api/axiosClient.js:5–8).

| Method/path | Request/auth | Eligibility and actual response | Evidence |
|---|---|---|---|
| **POST /reservations/managed/:id/deposit** | Authorization: Bearer existing token; Content-Type: application/json; body **{idempotencyKey:string}** | CUSTOMER owner; MANAGED_INVENTORY, bookingFlowVersion2, RESERVED, expiresAt>now; positive advance, VND. **201** {success:true,data:{payment,reservationId,amount,currency,idempotent}}. Rental remains RESERVED | BE routes/reservation.routes.ts:15,26; controllers/reservations/managed-reservation.controller.ts:8–11,22; service:514–547; PM 02/04 INITIATE DEPOSIT |
| **POST /reservations/managed/:id/deposit/mock-confirm** | Same auth/JSON/body; payment located by key, not URL payment ID | CUSTOMER owner, V2 Managed; existing matching MOCK DEPOSIT, snapshot amount/currency; normally PENDING and live RESERVED/HOLD. **200** {success:true,data:{payment,reservation,idempotent}}; late confirmation can additionally return reconciliationRequired:true | BE reservation.routes.ts:27; controller:23; service:549–595; PM 02/05 MOCK CONFIRM DEPOSIT,05/01 replay |
| **GET /reservations/managed/:id** | Bearer, no body | CUSTOMER owner; management readers separately scoped. **200** data is the raw reservation document. No payment ledger is embedded; read not gated by MOCK flag | BE reservation.routes.ts:22; service:415–422; PM 02/06 |
| **GET /reservations/me** | Bearer, CUSTOMER | Own reservation array; populated Facility/Unit metadata, no DEPOSIT payment ledger | BE reservation.routes.ts:36; controllers/reservations/reservation.controller.ts:38–47 |
| Payment status/history/reconciliation GET | **No supported Customer route found** in supplied PM or mounted reference | Reservation status confirms aggregate paid stage only, not every payment outcome/receipt/provider/key | BE routes/index.ts:1–57; reservation.routes.ts:1–51; service get:415–422; types/reservation.type.ts/model |
| Generic FE /payments wrappers | paymentApi.js has /payments/payos/create and /payments/:id/status | Not confirmed mounted backend routes; existing demo wrappers are not a V2 read/provider contract | FE api/paymentApi.js:13–37; BE routes/index.ts:1–57 |

Both bodies are plain-object allowlists. Null/array/nonplain bodies, extra fields and dollar-prefixed keys are rejected400. ID must be a string of24 hexadecimal characters. Key is trimmed, nonempty, maximum160 characters. It is a **body field**, not a confirmed custom Idempotency-Key header. Do not send amount,customerId,provider,purpose or cellIds; server derives them.

Sources: BE service:35–41,518–520,553–555.

The relevant PM requests have **zero saved response examples**. Scripts accept alternative data.payment/data.depositPayment/data shapes, but actual service/controller return the structures above. Confirmation tests sometimes assert only if a payment/reservation object exists, so 2xx plus conditional PM assertions is not strict DTO evidence. Collection description disclaims live execution. PM folder05 replay occurs after first inbound and conflicts with the service's narrower replay window; see section7.

### Error contracts

Controller returns {success:false,message} for ManagedReservationError, generic500 for unexpected errors (BE managed-reservation.controller.ts:4–11).

| Status/result | Actual source behavior |
|---|---|
| 400 | Invalid ID/body/key; cast/validation or accounting value errors |
| 401 | Missing/malformed/expired token, missing subject or no matching local user |
| 403 | Wrong role or inactive account; service also requires CUSTOMER |
| 404 | Disabled development gate; missing/nonowned/non-V2/wrong-service reservation; confirmation payment missing or wrong key/record/owner |
| 409 | Initiation not live RESERVED; missing capacity lock; unsupported currency/nonpositive/mismatched money; idempotency economic/provider/owner mismatch; confirmation not PENDING; expired/changed allocation count; duplicate/write conflicts; advance exceeds total |
| 500 | Unexpected infrastructure/database failure; not proof a mutation did not commit |
| **200 success=true, reconciliationRequired=true** | Payment becomes RECONCILIATION_REQUIRED after hold expiry/state change. Reservation is not advanced; expired Cells are not reclaimed. Must not display paid success |
| Timeout/network loss/no response | Unknown outcome, not a confirmed FAILED payment; do not auto retry/new key |

Sources: BE middlewares/auth/requireAuth.ts:20–66; requireRole.ts:8–25; service:188–204,514–595; payments/payment-accounting.ts:26–53. Accounting errors are converted to ManagedReservationError at service:529,566.

## 3. Backend guards and environment restrictions

Both routes use **process.env.NODE_ENV === development AND MI_MANAGED_DEPOSIT_FLOW_ENABLED === true**. NODE_ENV=test, production or unset does not satisfy this explicit comparison, regardless of a default elsewhere in env.ts. A local URL or Vite flag does not establish the running backend gate.

Initiation explicitly creates provider MOCK and a generated MOCK-DEPOSIT reference. PAYOS is merely an enum supported by the model; these methods do not start a gateway checkout or require a PayOS callback.

Legacy Managed mock-pay uses a different gate: NODE_ENV!=production and MI_MOCK_PAYMENT_ENABLED=true, signed live CONTRACTED legacy record. FE legacy flag is DEV plus VITE_MI_MOCK_PAYMENT_ENABLED. The dormant V2 UI flag is DEV plus VITE_MI_MANAGED_DEPOSIT_FLOW_ENABLED. They must not be conflated.

Sources: BE service:29,493–502,515,539–541,550; BE types/payment.type.ts:17–20; FE lib/customerReservationService.js:26; FE RentalLifecycleIntegration.jsx:470–481.

| Environment | Required interpretation |
|---|---|
| Fixture-only | All API traffic intercepted; simulated states validate FE only, not backend capability, payment or DB transactions |
| Local development | Backend exact gate plus frontend explicit opt-in; real writes still require separately authorized isolated database/accounts/resources |
| Production / NODE_ENV=test | MOCK deposit routes return404. Hide both unsupported MOCK initiation and confirmation; no real PayOS capability exists here |
| Unknown runtime flags | Disabled/unavailable until deployment owner confirms capability; do not mutate as a probe |

No .env or secret values were read or changed. No real requests/payment tests/webhooks were executed.

Initiation checks role/owner/version/service/live hold/money and a Facility capacity lock. It does **not** freshly recheck VERIFIED profile or ACTIVE Facility in this method; booking checks are not proof of a fresh deposit validation. lockCapacity(...,false) permits an inactive quota record but requires that the lock document exists (BE service:201–203,521–531).

Transactions use snapshot reads and majority writes. Source index declarations and mocked tests do not prove runtime indexes/topology/rollback behavior (service:188–204; payment model:22–35).

## 4. Current frontend implementation and gaps

| Area | Current implementation | Gap/preservation |
|---|---|---|
| Wrappers | FE api/managedReservationApi.js:3,12–13: validated ID, exact body and optional config | Reuse; no second client; no payment DTO/attempt-state validation yet |
| Allowlist | api/confirmedContract.js:7 permits old mock-pay but neither deposit path | Pure non-network probe confirms both reject before HTTP. Add only confirmed paths in authorized Phase2B |
| Headers/session | api/axiosClient.js:5–15 adds JSON/current Bearer, timeout15000ms;20–28 handles matching-token401 | Preserve token storage/interceptors and special rejected PIN behavior; no payment auto retry |
| Owner read | api/reservationApi.js:53–85 loads own collection then Managed detail, checks ID/service | Reuse; server ownership remains authoritative, no body-supplied customerId |
| Version/legacy | lib/customerReservationService.js:6–26 exact Managed+numeric2; canSign/canMockPay exclude V2 | Do not infer V2 from status or route; Self Storage remains separate |
| Current V2 UI | RentalLifecycleIntegration.jsx:465–510 is read-only payment status and validated finances, no submit controls | New explicit actions need a scoped implementation; no revival of old unsafe flow |
| Dormant state | Same file:470–481 retains depositInitiated/depositKey/flag | Not evidence of integration; boolean and useRef key alone do not survive/identify session,record,reload safely |
| Read freshness | RentalBackendUI.jsx:93–144 keys by token/dependencies, aborts reads and discards stale results; resource.retry refreshes reservation | No payment-status loader exists; read of RESERVED cannot identify payment outcome |
| Double click | RentalBackendUI.jsx:228 onward ConfirmAction has explicit confirmation and per-instance busy ref | Needs one shared attempt lock across initiate/confirm/refresh/record changes |
| Errors | RentalBackendUI.jsx:56–90 provides HTTP/sanitized mostly legacy mapping | Need rejection vs transport-unknown vs FAILED vs reconciliation; no false paid or failed state |
| Legacy payment | paymentApi.js:10–12; SelfStorageMockPayment.jsx; lifecycle fresh owner/contract guard | Keep unchanged; no /managed/:id/mock-pay for V2 |
| History/status | PaymentHistoryPage.jsx:12–29 uses demo data; paymentApi.getStatus wrapper lacks backend mount | Neither is an authoritative live deposit read |

No build or regression suite was rerun during this audit: no application changes were made and build would emit artifacts outside the sole report write. Prior PASS is baseline context, not deposit acceptance.

## 5. Payment DTO and lifecycle mapping

BE types/payment.type.ts:22–39 and models/payments/reservation-payment.model.ts:5–20 define:
- _id,reservationId,customerId,facilityId,serviceType;
- purpose DEPOSIT/BALANCE;
- amount,currency,idempotencyKey;
- provider MOCK/PAYOS, optional providerReference;
- status PENDING/SUCCEEDED/FAILED/RECONCILIATION_REQUIRED;
- optional succeededAt,failedAt,reconciliationReason, timestamps.

Validate identity, purpose, provider, amounts and status together. No client amount or remembered key is payment proof.

| Stage | Payment evidence | Reservation/Cells | Correct UI meaning |
|---|---|---|---|
| Snapshot only | None | RESERVED/live HOLD | Scheduled advance required, not paid |
| Initiate201 | Normally PENDING MOCK DEPOSIT; same-key replay returns stored state | RESERVED/HOLD unchanged | Initiated/pending, never payment successful |
| Confirm200 committed | SUCCEEDED and succeededAt | DEPOSIT_PAID; live HOLDs become RESERVED; expiry removed | Deposit confirmed, no contract/physical occupancy/ACTIVE implied |
| Repeated confirm in postdeposit stage | Same SUCCEEDED,idempotent=true | DEPOSIT_PAID | No second settlement; still a mutation/capacity-lock write |
| Explicit FAILED | Enum exists, no deposit mock-failure endpoint/source transition | Not automatic activation | Show only if actual authoritative DTO/read supplies it; no known customer retry contract |
| Late confirmation | RECONCILIATION_REQUIRED | Rental unchanged, no hold reclamation | Needs reconciliation/support, not success/refund |
| No response | Unknown | May have committed or not | Read own rental; keep uncertain if still RESERVED/inaccessible |
| Later CHECKIN_READY/ACTIVE | Historical deposit inferred by aggregate progress | Separate later lifecycle | No fabricated payment receipt/provider/ID/history |

Atomic success includes payment,allocation count,reservation and audit; no physical counters or contract generation. Late confirmation returns success=true with an explicit reconciliation flag instead (BE service:568–594).

## 6. Financial invariants

- T comes from confirmed immutable managedPricingSnapshot.amountBreakdown.totalDue, consistent with explicit rent+tax−discount.
- Required D comes from depositAmount/depositCredit; reservation numeric fields must agree. Currency comes from pricingRule.currency.
- Snapshot balanceDue=T−scheduled D is a **plan**, not a payment record.
- Confirmed paid advance requires successful DEPOSIT evidence or an honest aggregate “backend reports deposit stage” read; do not fabricate ledger details from the latter.
- Remaining original rent after confirmed D is max(0,T−D). Deposit is never added to T.

FE lib/managedRentalPricing.js:3–25 already validates finite nonnegative safe values,D<=T,balance consistency,no missing-to-zero substitution and snapshot/top-level agreement. RESERVED displays confirmed credit0; DEPOSIT_PAID/CHECKIN_READY/ACTIVE carry aggregate lifecycle confirmation. This helper is not a payment receipt/parser/status API.

Backend uses reservation amounts, explicit VND and positive deposit. Tax/discount fallback0 in backend does not authorize frontend to invent missing display fields. V2 zero deposit is rejected even though general SRS invariant permits0; no zero-value deposit request. Do not re-resolve pricing to reprice an existing held snapshot.

Sources: BE service:171–180,527–531,565–567; payments/payment-accounting.ts:34–53; FE managedRentalPricing.js:3–25.

## 7. Idempotency and reconciliation strategy

### Actual backend semantics

1. Key identity includes reservationId,purpose,amount,currency,key. The key is globally unique; successful payment has a partial unique reservationId+purpose index; provider/reference has its own unique index (BE payment-accounting.ts:63–70; payment model:22–35).
2. Initiation validates live RESERVED **before** key lookup. Same key while eligible returns stored payment/idempotent=true, not necessarily PENDING. After DEPOSIT_PAID/expiry, even original-key initiate returns409 (service:525–537).
3. Different keys while RESERVED can create multiple PENDING payments. Source index protects one SUCCEEDED per purpose, subject to actual installation. Do not rotate keys after timeout.
4. Confirmation requires owned matching MOCK DEPOSIT/amount/currency. SUCCEEDED+DEPOSIT_PAID returns idempotent=true. PENDING+valid HOLD settles atomically.
5. FAILED/RECONCILIATION_REQUIRED repeat returns409. Successful deposit replay after CHECKIN_READY/ACTIVE also returns409 because only DEPOSIT_PAID is accepted by the idempotent branch (service:568–569).
6. Even business-idempotent replay acquires/increments Facility bookingVersion before returning. POST is not read-only status discovery.
7. Transactions internally retry; exhausted conflict/duplicate key becomes409. A409 does not prove an earlier attempt did not succeed.
8. BE tests/managed-reservation.test.cjs:302–404 mocks repeated init/confirm,concurrency,audit failure,late expiry,wrong amount/owner and dev gate. Tests were read, not run; no live guarantees.

PM folder05 puts optional deposit replay after ACTIVE and expects DEPOSIT_PAID. Current source rejects that replay. Backend/test owners must agree on the intended replay window; do not claim unrestricted idempotency.

### Proposed safe FE recovery, not implemented

- Bind one logical attempt/key to authenticated session/identity,reservationId,purpose,amount,currency,provider. Use a shared mutation lock and explicit confirmation.
- Never auto retry/new-key on timeout/network/500. Aborting client UI does not roll back server writes.
- Fresh owner read after init must not become paid merely because201 succeeded.
- After valid confirmation, refresh owned reservation; keep recovery required on read failure/mismatch and prevent another charge.
- DEPOSIT_PAID after lost response supports “backend confirms deposit stage” and blocks another deposit, but not a reconstructed receipt/provider/payment ID.
- RESERVED after lost response stays **unknown**: could be no ledger,PENDING,FAILED,reconciliation. Expiry is not permission to recreate allocation or retry.
- Known same-key explicit retries are only a possible separately approved limited MOCK scope, with source guards above; not complete read/reload reconciliation.
- Durable attempt metadata/privacy/account scoping requires a confirmed resume contract. Do not change token storage or persist secrets; local state is not evidence of payment.
- Complete recovery needs an owner-scoped backend payment read contract. Exact path/method/shape must be supplied; no hypothetical URL is presented as existing.

## 8. Security and ownership risks

- requireAuth validates issuer/JWKS,subject,active local user; requireRole and service require CUSTOMER. Ownership404 prevents foreign reservation/payment use (BE auth middleware:20–66; role middleware:8–25; service:516,521,551,556–564).
- Reuse FE detailForCustomer owner-first chain and ID validation; no generic detail bypass.
- Body does not accept owner,amount,provider,purpose or Cells; these are server-derived.
- Same key belonging to a different owner/provider/economic identity rejects. Operational key/reference is not an auth credential.
- Guard UI and fresh results by current token/record; clear/drop stale attempt state on logout or route changes. No second mutation after automatic reauth.
- Never infer backend MOCK support from Vite flag or provider enum; no production simulation.
- Never route Self Storage/legacy through V2 deposit, or V2 through old mockPayForService.
- Expired/reconciliation outcomes cannot auto-activate,reclaim Cells,refund or clear stock.
- Do not log bearer tokens,private DTOs,credentials,DB URI or another customer's identifiers.

## 9. Proposed exact Phase 2B files

**Plan only. No source implementation made. Complete integration waits for section11.**

| File | Minimal proposed work |
|---|---|
| FE src/api/confirmedContract.js | Add exactly two confirmed POST paths; read route only after approved contract |
| FE src/api/managedReservationApi.js | Reuse existing wrappers/config; only confirmed validation changes, no second client |
| FE src/lib/managedDeposit.js (new) | Pure eligibility/DTO/purpose/provider/key/attempt interpretation and recovery guards |
| FE src/components/customer/ManagedDeposit.jsx (new) | Isolated explicit actions,shared busy lock,sanitized error/recovery,read-only/unsupported states,existing shadcn styling |
| FE src/components/customer/RentalLifecycleIntegration.jsx | Delegate V2 branch and guarded existing detail→payment navigation; preserve legacy/Self code |
| FE src/components/customer/RentalBackendUI.jsx (only if needed) | Reuse useBackend/ConfirmAction/Message/ManagedFinancialSummary; narrow error labels only |
| FE .design-reference/check-managed-v2-deposit-contract.cjs (new) | Pure fixture contract/state/idempotency/flag tests |
| FE .design-reference/check-managed-v2-deposit-ui.cjs (new) | Intercepted UI scenarios; no real network fallthrough |
| FE docs/CustomerV2DepositImplementation.md (new) | Authorized implementation/verification record |

Keep existing Axios/authSession,legacy paymentApi/SelfStorageMockPayment,routes,.env,CSS/dependencies and immutable pricing behavior. Dormant useRef/boolean handlers must not simply be reactivated.

## 10. Fixture test matrix

This is a **plan**, not executed payment tests. Fixtures validate FE only.

| Case | FE fixture expectation | Isolated backend acceptance/dependency |
|---|---|---|
| Eligible V2 RESERVED/live hold | Correct record/key/body,explicit action | Actual owner,expiry,quota and transaction |
| Legacy Managed | No V2 action; old guards unchanged | Version-specific rejection |
| Self Storage | No Managed deposit call | Service boundary |
| Wrong Customer | Owner read404/unavailable,no mutation | Two authorized accounts/privacy |
| Missing/expired auth | Login/401/session cleanup,no auto retry | Real JWT/active-user enforcement |
| Invalid ID | Local rejection before HTTP | Backend400 |
| Initiation PENDING | Pending only; no paid state or activation | Persisted ledger/HOLD unchanged |
| Confirmed deposit | Validate MOCK/DEPOSIT/SUCCEEDED/association;fresh DEPOSIT_PAID | Atomic ledger,Cells,rental,audit |
| Double click | One POST,shared lock across actions | Concurrent uniqueness/rollback |
| Same-key repeated init | Same attempt,stored-state handling | One ledger while live RESERVED |
| Repeated confirm | Same-stage idempotent result;advanced-state409 handled | Exactly-once settlement and window |
| Different-key concurrent attempts | No automatic key rotation | Multiple pending/one successful-purpose |
| Timeout initiate | Unknown,no auto confirm/new key | Commit-before-loss;read contract blocker |
| Timeout confirm | Read rental;paid stage blocks charge;RESERVED uncertain | Ledger/read consistency |
| FAILED payment | Only from authoritative DTO/read,not network error | Failure origin/retry/read API missing |
| RECONCILIATION_REQUIRED200 | No paid toast/activation/refund;disable unsafe actions | Expired hold/late payment policy |
| Refresh after initiation | Do not infer PENDING from remembered key | Owner payment/resume read missing |
| Refresh after confirmation | Re-read rental,no duplicate POST | Persisted ledger verification |
| Missing/inconsistent snapshot | Unavailable,no initiate | Backend economic mismatch rejection |
| Wrong/missing purpose/provider | Fail closed;do not treat PAYOS as MOCK | Actual provider truth |
| Already paid | No initiate;no fabricated receipt | Initiate409,stage-limited confirm replay |
| Production/unknown flags | No MOCK action even accidental UI opt-in | Runtime disabled404 |
| Hold expires during dialog/request | Fresh checks;unknown/reconciliation if sent | Transactional expiry race |
| Session/record changes midrequest | Drop stale results/reset scoped UI | Owner isolation/no key leakage |
| Malformed success/mismatched ID/money | Unknown/error,never paid | Outcome/read reconciliation |
| Read fails after success | Preserve validated result separately;no new charge | Recovery contract |
| Advance equals total | T=D,plan balance0;no extra deposit | Positive deposit,subsequent zero-balance rules separate |

After authorized implementation, run unchanged lifecycle/financial/Cell,Self Storage/Managed and full MI-02C regressions. Live acceptance requires independently approved isolated DB,accounts,Facility/Cells,transaction/index evidence and retention policy. No live writes are authorized here.

## 11. Backend dependencies and blockers

**Blocking complete Phase2B:**
1. Supported owner read of DEPOSIT payment identity/status/history or reconciliation outcome; exact API contract must be provided. Current reservation read confirms aggregate success only.
2. Refresh/resume strategy for unknown initiation/confirmation without new key,POST probe or paid-snapshot inference.
3. Agreed post-DEPOSIT_PAID replay behavior and FAILED/RECONCILIATION_REQUIRED terminal recovery. PM optional post-ACTIVE replay conflicts with source.
4. Failure origin/retry and controlled reconciliation resolution. Enum alone is not an API; no invented refund/cancellation policy.

Before live acceptance: runtime dev gate/provider proof; authorized isolated DB/resources/accounts; installed indexes/transaction/rollback/concurrency evidence; retention/cleanup authorization.

Production payments require separate approved PayOS checkout/webhook/status/history contracts. These MOCK routes are not production payment support. No Backend modification or workaround was attempted.

## 12. Go/No-Go recommendation and audit verification

**NO-GO for the complete Phase2B experience. Phase2A: BLOCKED.**

A limited dev-only happy path using exact mutation responses plus fresh reservation success read is source-ready. It would need a separately narrowed request explicitly accepting unavailable ledger/reload recovery; it does not bypass the current task's stop condition and is not implemented automatically.

Keep existing read-only V2 status until the payment-read/recovery contract is supplied. Then implement only the approved scope and fixture matrix before separately authorized DB acceptance.

Verification:
- Current frontend wrappers,allowlist,headers,owner reads,read-only UI,legacy guards,error/loading/refresh and financial helpers were inspected.
- BE routes/controllers/auth/deposit service/accounting/model/read methods and relevant source-only tests were inspected read-only.
- PM deposit/init/detail/replay requests,JSON bodies,auth placeholders and assertions were read;no saved response examples or execution.
- Pure local allowlist probe confirmed both deposit wrappers currently reject. **Zero HTTP requests**.
- No build,frontend/backend test execution,dependency install,env change,seed,migration,payment or DB operation.
- Only new report: FE docs/CustomerV2DepositAudit.md.
- Final SHA-256 preservation comparison found no changed or missing existing files; exactly this report was added. All174 BE-REF files and all application source/tests,existing documentation,.env/configuration/dependency files and screenshots remain unchanged. Original backend/ was never accessed.

