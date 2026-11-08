# Current security, ownership and feature gates

7/11/2026. Static source review only. Evidence IDs in [SOURCE_EVIDENCE](SOURCE_EVIDENCE.md), exact route/controller middleware in [API_CHANGE_MATRIX](API_CHANGE_MATRIX.csv). Local code fixes are **DEPLOYMENT_UNVERIFIED**. No unauthorized-access experiment performed.

## Critical boundaries

| Resource | Current enforcement and limitations | Frontend rule |
| --- | --- | --- |
| Login/registration | Keycloak Bearer grant server-side; User isActive; CUSTOMER registration forced; no app refresh route; no audience in jwtVerify options; OTP/email verification issues remain | Native secret-free session; supported re-login policy, partition cache by account and session epoch |
| User/profile | User current identity vs Customer identity profile separate; profile GET creates missing record | Do not treat every GET as side-effect-free; don't send fixture identity |
| Public catalogue | Sanitized public fields; no Customer owner requirement | Don't invent amenities or quote from fixture |
| Self availability | Customer-only exact calendar; no private booking identity returned; UNKNOWN on bounds | Never green/bookable on UNKNOWN; preserve date-only UTC semantics |
| Self reservation | Owner create/cancel/list; detail populated-owner comparison suspect; Staff detail now facility-scoped | Keep read failure explicit, don't bypass owner checks or use management path for Customer |
| Managed reservation/capacity | Customer owner detail, FM scope; management roles differ per operation; strict Cell/volume/period create | Use correct family; no legacy fallback if V2 unavailable |
| Contract safe detail | Customer owner; getById Staff/FM facility check | Customer A4 already uses safe detail; preserve |
| Contract by reservation | Customer owner; privileged branch lacks same Staff facility restriction | Don't use lookup as proof of cross-facility authority |
| Contract print | Auth/role only; getContractPrintData returns populated private contract without owner/facility guard | **P0 SECURITY_BLOCKED**. Customer safe A4 path okay; Staff print helper should be removed/redirected only in approved implementation |
| Managed signature | Owner/facility, current hash/version and order checks; no reviewed-version input, ensureVersion inside signing | **P1 review-bound consent blocker**; read/progress/GET refresh okay; no frontend GET-then-sign workaround |
| Self signature/proof | Generic owned DRAFT sign lacks reservation deposit-state check; Self proof branch lacks scope/state/atomic checks unlike Managed branch | Frontend eligibility guard is not sufficient security. Server dependency before release |
| PayOS Self | Owner + service + purpose/economic/facility immutable identity; signed webhook, mismatch/late capture manual review | No provider keys; client never calls webhook; success requires authoritative application, no URL callback success |
| Managed MOCK | Owner/purpose/amount checks and dev-only gates; legacy paths hardened separately | No production mock; no provider-style badge for MOCK |
| Inventory Item | Customer ownership; Staff assigned facility; registration/edit now transactional lifecycle fence | Respect REGISTERED/unplaced/closure, no fake Cell placement |
| Stock/movement | Customer parent ownership; ledger projection/batches/currentCell not fixture quantity; some privileged stock read scope needs separate assignment review | No frontend stock recomputation; scope cache to owner; don't expose performedBy/internal fields absent Customer DTO |
| Repeated requests | Customer owner; Staff assigned facility; key/version/custody rules; gate per operation | Preserve exact intent on503, refresh conflict, no Customer physical receipt |
| Canonical outbound/relocation | Customer requests owner; Staff physical confirmation/move scope and immutable ledger; gates/closure fences | No generic fallback, relocation only Staff; outbound may continue during closure within term |
| Closure readiness | Customer owner404; FM scope403; ADMIN/BOM; Staff not allowed | Diagnostic only, preserve nullable unknown and readonly, no close/release button |
| Notifications | userId scoped list and atomic read-one | No untrusted content-to-route parsing; no fake bulk/push |
| Support | Owner ticket/public message filtering; private related IDs not fully validated | Unlinked/text-only until verified private associations; no internal Customer notes |
| Inspections | create body spread/list generic; CHECK_IN hardened; CHECK_OUT lacks equivalent facility/linkage/transaction controls | **P0 Staff scope/closure blocker**, do not rely on client list filters or expose live close until server fixed |
| Admin/BOM management | Role routers plus service-specific facility/assignment/effective pricing guards, unchanged APIs | Preserve existing CRUD; API allowlist is not authorization |

## Gates verified from current source — no environment values read

| Capability | Source gate | Current behavior | Interpretation |
| --- | --- | --- | --- |
| Managed V2 deposit/check-in/balance | managed-reservation.service:29; managed-checkin.service:32 | NODE_ENV exactly development AND MI_MANAGED_DEPOSIT_FLOW_ENABLED exactly true | Not production rollout; do not assume legacy output is V2 |
| Managed legacy mock pay | managed-reservation.service mockPay | not production + MI_MOCK_PAYMENT_ENABLED=true | Distinct from V2 and PayOS |
| Repeated Customer create/amend | config/mi06b-feature-gate.ts; managed-inbound-request.service assertEnabled | opt-in MI06_REPEATED_INBOUND_ENABLED, forced off production, failure404 in Customer service | History/detail/cancel not all behind create gate |
| Repeated Staff inspect/confirm/evidence | repeated-inbound-operations assertGate/ledger checks | feature opt-in, evidence delivery development/test, ledger writes nonproduction opt-in | Return-completed removed main gate; scope/version/key remain; don't strand custody |
| Canonical outbound create | config/mi06-canonical-outbound-gate.ts + service assertCreateGate | REQUESTS opt-in + ledger true, production forced off;503 disabled | Read/cancel separate; no legacy fallback |
| Canonical outbound Staff confirm | separate CONFIRMATIONS gate + ledger | nonproduction opt-in;503 | Not Customer command |
| Canonical relocation | config/mi06-canonical-relocation-gate.ts + service | RELOCATIONS opt-in + nonprod ledger gate, closure marker null | Existing source, not new route; no production move |
| Ledger writes | managed-stock-ledger canWrite + operation checks | MI06_STOCK_LEDGER_WRITES_ENABLED opt-in, production false | Read projection availability does not prove write capability |
| Self mock-pay | reservation.controller:431+ | development or test only | Code-level production block fixed |
| Self mock-confirm deposit | reservation.controller:549+ | Self production denied; not positive dev/test allowlist; legacy timestamp key/multiwrites remain | PARTIALLY_FIXED; keep Frontend fail-closed lock |
| Self mock-confirm balance | reservation.controller:715+ | production denied; Managed branch has additional gate/version guard | Not evidence of safe universal simulation environment |
| Self handover | reservation.controller:796+ | development or test only; all actors assigned facility required | Production activation still disabled, despite real PayOS |
| Self CHECK_IN complete | inspection.controller:66+ | development or test only; scope/linkage/PAID/transaction CAS | CHECK_OUT does not inherit these protections |
| PayOS checkout create | payos-payment.service enabledByEnvironment/assertConfiguration | PAYOS_ENABLED trimmed/lowercase true; valid server keys/Customer origin/webhook URL, HTTPS production | Opt-in may run in production in code; actual config and provider setup unknown |
| PayOS status/history | getCustomerStatus/listCustomerPayments | owner-scoped, not gated by checkout create flag | Reads remain for old intents; status can reconcile/write metadata |
| PayOS webhook | handleWebhook | SDK signature verification; callback remains available independently of create gate | Provider-only; preserving late settlement evidence matters |
| Closure diagnostic | managed-closure-readiness | no close capability; overall UNKNOWN/BLOCKED; snapshot/scan bound | Not approval to release Cells or quota |

Cloudinary upload delivery restrictions and ownership attachment remain; don't assume public evidence is production-ready. No gate is enabled by this audit. Frontend DEV flags cannot substitute for server capability or authorization.

## Retry, concurrency and cache safety

- PayOS key belongs to one immutable owner/reservation/purpose;503 must preserve key, purpose and tracked intent; status/history determine whether checkout still presentable. POST outcomes CREATED/REPLAYED are not payment success.
- Repeated/canonical request headers remain exact Idempotency-Key and quoted If-Match version (missing428, stale409). Staff inspect/confirm repeated use operation keys in body rather than copying Customer headers; keep family-specific DTOs. No auto-mint after unknown commit.
- Registration/edit new CAS can conflict independently of form validation. Refresh reservation+Item+stock/request while retaining form and intent; do not blindly resubmit changed payload.
- Closure markers block selected write paths even when feature creation disabled. Don't suppress safe outbound or custody cleanup by one global flag.
- Abort/cancel requests and ignore older sequence/session results. Website Staff repeated selected-request loading only compares session token; rapid selection can replace a new selection with old details. Correct this in a later UI task.
- Website shared interceptor blocks 11 existing Staff MI06 method/path combinations (queue/detail/evidence/inspection/return/confirm, outbound queue/detail/confirm, canonical relocation context/command). `WEBSITE_ALLOWLIST_PROBE.json` is a local predicate evaluation, **no HTTP**. Broad regex changes are unsafe; tests must pass helpers through the real interceptor with fake adapters.

## Native and dependency release boundaries

Axios PHASE1_OFFLINE guard remains unchanged; no token store/base URL/API adapter installed. Five tabs and screens untouched. Native authentication needs approved secure credential storage and supported expiry/refresh policy; browser storage is not a native solution. Native checkout return is a Backend/product dependency because return URLs are web-only.

Historical 19 dependency findings (13 Low/6 High) are **not a new scan**. No npm audit/install/update or lockfile modification. Current website's declared qrcode dependency is unavailable in local node_modules and blocks build/test import. Resolve environment in a separate task, using existing lockfile and compatibility checks; do not externalize QR import to hide failure.

Release still requires Android/iOS device acceptance: hardware Back, keyboard, safe area, font scaling/accessibility, session persistence/logout, deep links, network loss, background/resume/stale state, memory/performance. Existing RN Web/unit results do not establish those properties. No production readiness claim.
