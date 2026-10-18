# MI-02C Backend Integration Audit — Restored BE-REF

Audit date: 2026-10-13. **Audit only; no implementation.** This supersedes the missing-reference audit.

Evidence roots: **BE** = `C:/Users/laptop/Desktop/WDP/BE-REF/`; **FE** = `C:/Users/laptop/Desktop/WDP/frontend/`; **PM** = `C:/Users/laptop/Downloads/WDP-Backend-Full-MI02C-Manual.postman_collection.json`. Paths and line numbers below resolve against these absolute roots.

## A. Executive Summary

**READY WITH LIMITATIONS** for implementing Customer MI-02C against the restored reference. Exclusive allocation and essential ownership/facility authorization are established in source. This is source readiness, not proof of deployed API behavior or live contention safety.

Verified workspace root: `C:/Users/laptop/Desktop/WDP`; cwd is `frontend/`. BE-REF exists and was successfully inspected. Top level: src/, docs/, tests/, package.json/package-lock.json, tsconfig.json, README.md, docker-compose.yml, .env/.env.example/.gitignore. Environment values were not read. Framework: Express4 + TypeScript + Mongoose/MongoDB; routers organized by feature and mounted through src/routes/index.ts. `BE src/app.ts:33` mounts `/api/v1`.

The explicitly supplied collection without `(1)` exists; the Downloads filename-pattern lookup found no `(1)` variant. Title: **WDP Backend API — Full + MI-02C Multi-Cell Reservation & My Inventory**. PM:4 disclaims previous backend verification; this re-audit uses implementation rather than its descriptions. No original backend/ file was accessed.

Critical findings:

- Backend supports **1–100 unique Cells**, including one Cell and selections across racks/zones in the same facility. Volume is recomputed for validation; tolerance1e-6 m³.
- **Create now requires cellIds. Legacy capacity-only CREATE is rejected400.** Quote still accepts capacity-only. Current frontend drops IDs, so its existing create is incompatible with this backend.
- Transactional quota/zone/rack/Cell write tokens + overlap checks + persistent HOLD inserts establish source-level allocation protection. The unique reservation+Cell index alone is not global overlap protection. Live database acceptance remains untested.
- Map accepts paired dates and defaults to a short current-time interval. Postman future booking-map assertions omit those dates; a future hold need not appear reserved on the current map.
- Allocation lifecycle HOLD→RESERVED at payment→OCCUPIED at Staff inbound; public bookingStatus hides HOLD as RESERVED. Customer map booleans/counters do not expose private identities.
- Approval, owned contract signing, guarded Managed mock payment, activation, registration, Customer inbound request, assigned Staff confirmation and own movement history are implemented.
- Limitations: no Managed checkout/outbound/occupied-release workflow or expiry worker; preferred placement does not check allocation membership; create does not check parent rack operationalStatus while inbound does.

Direct evidence: [mandatory Cell create](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:272), [transaction and write locks](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/reservations/managed-reservation.service.ts:170), [date-aware map projection](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/warehouse-map/warehouse-map.service.ts:189), [Customer item privacy](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:201), [inbound allocation validation](C:/Users/laptop/Desktop/WDP/BE-REF/src/services/inventory-items/inventory-item.service.ts:377).

| Workflow step | Backend classification | Evidence / current FE |
|---|---|---|
| Browse facility / map / structure | SUPPORTED | BE warehouse-map.service:35–57,644–783; existing FE map. |
| Single/multi-Cell reservation | SUPPORTED | BE managed-reservation.service:55–79,190–229,269–311; FE multi-select absent. |
| Selected capacity / price / date term | SUPPORTED | BE managed-reservation.service:43–79,136–168,246–267. |
| Buy / popup | Backend APIs SUPPORTED; existing FE UI NOT SUPPORTED | FE Dashboard:41,72–99; presentation work needed. |
| Hold / approval / contract / signing | SUPPORTED | BE managed-reservation.service:269–311,376–404; contract.controller:49–79. |
| Mock payment / activation | SUPPORTED for development | BE managed-reservation.service:446–485. |
| Registration / inbound / My Inventory | SUPPORTED with limitations | BE inventory-item.service:224–259,323–469,493–615; no server reservation/Cell list filters. |
| Date-aware empty-Cell reuse | SUPPORTED in source | BE managed-reservation.service:220–229; map:189–215. Runtime acceptance unverified. |
| Managed checkout / physical release | NOT SUPPORTED | Managed route/service absent; inspection.controller:44–48 rejects Managed completion. |
| Live contention / deployed indexes | UNKNOWN / NEEDS VERIFICATION | Transaction design verified; mocked tests cannot prove deployment. |

## B. Verified Backend API Contracts

All endpoints have **`/api/v1`** prefix. C=CUSTOMER, FM=FACILITY_MANAGER, FS=FACILITY_STAFF, A=ADMIN, B=BOM. Bearer auth verifies JWT, active local user and assigns req.user (`BE middlewares/auth/requireAuth.ts:20–61`); role gates `requireRole.ts:8–25`. FM/FS facility scopes are checked in services. Missing/invalid token401, inactive user403.

| Endpoint | Request | Roles/eligibility | Success response/effect |
|---|---|---|---|
| GET `/warehouse-map` | facilityId; optional paired startDate/endDate | C/A/B/assigned FM/FS; active Managed facility |200 `{success:true,data:{facilityId,zones}}`. |
| GET `/racks/:id/detail-map` | Rack ID; optional paired dates | Same read roles; live rack/active zone |200 `{success:true,data:{rack,capacity,levels}}`. |
| GET `/reservations/managed/capacity/:facilityId` | Required startDate/endDate ISO UTC | C/A/B/assigned FM/FS |200 data `{facilityId,sellableCapacityM3,committedPeakCapacityM3,unresolvedOverdueObligationM3,availableCapacityM3,interval:{startDate,endDate}}`. |
| POST `/reservations/managed/quote` | facilityId,allocatedCapacityM3,startDate,term; optional cellIds | C; future date/effective quote |200 data quote; no hold/write. |
| POST `/reservations/managed` | Same fields **plus mandatory cellIds** | C VERIFIED profile; quota/Cell checks |201 data `{reservation,quote}`; RESERVED/HOLD. |
| GET `/reservations/managed/:id` | ID | Own C, assigned FM, A/B |200 data **flat reservation**. |
| PATCH `/reservations/managed/:id/approve` | No consumed body; `{}` allowed | Assigned FM/A; live RESERVED; verified customer/active facility |200 data `{reservation,contract}`; CONTRACTED+DRAFT. |
| PATCH `/reservations/managed/:id/reject` | `{reason}` trimmed1–500 chars | Assigned FM/A; RESERVED |200 data reservation; CANCELLED/release empty holds. |
| PATCH `/reservations/managed/:id/cancel` | No consumed body; `{}` allowed | Own C; RESERVED/CONTRACTED only |200 data reservation; CANCELLED; paid cancel409. |
| POST `/reservations/managed/:id/mock-pay` | No consumed body; `{}` allowed | Own C or A/B test role; SIGNED/time/live CONTRACTED; flags |200 data reservation; PAID/HOLD→RESERVED. |
| PATCH `/reservations/managed/:id/activate` | No consumed body; `{}` allowed | Assigned FM/A; PAID+SIGNED; active facility; in term |200 data reservation; ACTIVE, no physical occupancy. |

Evidence: BE routes/reservation.routes.ts:14–25; warehouse-map.routes.ts:11–12; routes/index.ts:33–55; controllers/reservations/managed-reservation.controller.ts:4–22; warehouse-map.controller.ts:67–73; services/reservations/managed-reservation.service.ts:258–488; warehouse-map.service.ts:189–238,644–783.

### Quote / create request and money

```json
{
  "facilityId":"<24-hex ObjectId>",
  "cellIds":["<24-hex Cell ObjectId>"],
  "allocatedCapacityM3":0.12,
  "startDate":"2030-01-01T00:00:00.000Z",
  "term":{"value":1,"unit":"MONTH"}
}
```

Illustration only: actual m³ must match selected configured dimensions. cellIds optional for quote/mandatory create. No endDate request field. Unknown fields, malformed IDs, empty/>100/duplicate IDs, invalid dates/term/capacity400. Strict finite positive numeric capacity; positive safe-integer DAY/MONTH/YEAR term. Calendar month/year end clamps to last day. Start must be future. Reservation parser accepts ISO UTC with seconds or milliseconds (`BE managed-reservation.service:31–79,260,272–275`).

Quote with IDs verifies nondeleted Cells in supplied facility and volume equality but **does not check operational availability, physical counters, parent availability or conflicting allocation**. Capacity-only quote skips Cells entirely. Both variants only read (`258–267`). Successful quote is not a hold.

Exact quote data (`246–254`):

```text
facilityId, allocatedCapacityM3, startDate, endDate, term
sellableCapacityM3, committedPeakCapacityM3, availableCapacityM3
pricing: {ruleId,version,billingBasis,ratePerM3,currency,estimatedRent}
deposit: {policyId,version,calculation,percentage,amount}
taxAmount: 0
```

**No top-level totalDue or discountAmount in quote.** Rent=capacity×matching term-specific price; deposit=rent×percentage/100. No additional per-day multiplier. Exactly one active PER_M3 Managed rule matching facility+term at startDate and one active DEPOSIT policy; effectiveFrom<=start and absent/effectiveTo>start. Deposit config only calculation/percentage, PERCENT_OF_RENT and finite percentage>=0. Missing/ambiguous/configuration/over-capacity errors409; active Managed facility absent404 (`136–168`). FE can explicitly label returned-field arithmetic as a derived quote total.

Create stores allocatedCellIds and allocatedCapacity (not document allocatedCapacityM3), dates, RESERVED, hold expiry, monetary fields, statusHistory and managedPricingSnapshot. Snapshot: quotaM3/term/dates/pricingRule/depositPolicy/amountBreakdown including totalDue/capacityBookingVersion/selectedCells `[{cellId,volumeM3}]`. It returns reservation+quote. Detail flat document includes IDs/snapshot, **not populated live Cell codes/dimensions/allocation rows** (`269–311,368–374`; BE reservation.model:12–54).

### Contracts and errors

GET `/contracts/me`: C-owned array including draft/signed; populated reservation relation. GET `/contracts/:id`: C owner/A/B/assigned FM; foreign Customer403. PATCH `/contracts/:id/sign`: C owner, Managed branch locks quota and checks own DRAFT+live CONTRACTED, transaction sets SIGNED/signedByCustomerAt; failure409. Body unused. `BE routes/contract.routes.ts:9–13`; contract.controller.ts:13–79. Contract model uses **termsVersion**, default1.0, and unique reservationId (`BE models/contracts/contract.model.ts:4–23`). Existing recordId accepts populated or ID relations.

Managed typed400/403/404/409 errors return `{success:false,message}`; unknown500 Internal Server Error. Duplicate-key/VersionError409, ValidationError/CastError400 (`managed-reservation.service:170–179`; controller:4–10). Transient/deployment exceptions may500: reconcile uncertain mutations, do not automatically resend. Map invalid range/ID400, scope403, missing404, inactive409, invalid counters500. Inventory uses typed errors + error middleware; production can substitute HTTP status text (`BE middlewares/error.middleware.ts:9–20`), so exact development-message matching is unreliable.

## C. Multi-Cell Reservation Rules

| Rule | Verified implementation | Evidence: BE managed-reservation.service.ts |
|---|---|---|
| Count/duplicates/ID |1–100, single allowed, normalized duplicate IDs400 |35–37,74–77,272. |
| Cross rack/zone |Allowed; distinct parent IDs independently locked |197–209. |
| Same facility |Required on Cell/parent queries |193–207. |
| Active parents |Active live zone; live rack in hierarchy |199–208; **rack operationalStatus not checked in create**. |
| Operational/physical vacancy |AVAILABLE Cell; nondeleted; usedWeightKg=usedVolumeM3=0 |212–215. |
| Existing booking |OCCUPIED always blocks; RESERVED overlap blocks; live HOLD overlap blocks |220–229. |
| Own rebooking |No ownership exemption |222–228. |
| Capacity |width×depth×usableHeight; finite positive configured height; stored positive width/depth schema |186–188; warehouse-cell.model:4–9. |
| Client m³ |Difference>1e-6 rejects400; accepted input still stored/priced |281–295. Recomputed validation, not unconditional overwrite. |
| Persistent rows |CellAllocation with reservation/customer/facility/interval/HOLD/deadline |302–306; cell-allocation.model:4–17. |
| Commercial quota |Separate interval quota check |136–147,278–283. |
| Legacy create |Without Cells400 before transaction |272. Capacity-only quote/read and old records remain. |

### Concurrency evidence and boundaries

withTransaction snapshot readConcern/majority writeConcern (`170–179`). Create locks quota bookingVersion (`181–184`), sorted zones/racks and Cell allocationVersion; conditional Cell writes; overlap reads and all reservation/allocation/audit writes share session. One selected unavailable Cell throws and aborts the entire transaction (`190–229,269–311`). This is atomic-write evidence beyond sequential checks.

Unique `{reservationId,cellId}` (`BE cell-allocation.model:15`) prevents duplicates inside a reservation, **not** two different overlapping reservations. Interval exclusion relies on shared transactional Cell/quota writes. No global unique Cell constraint, intentionally allowing nonoverlapping rentals. Live topology/index installation/contention/retry behavior **UNVERIFIED**. Mocked source tests at BE tests/managed-reservation.test.cjs:207–269 were inspected, not run. Lock orders differ between create (quota→zones→racks→Cells) and inbound (item→zone→reservation→rack→Cell); test cross-path conflicts/retries before production.

### Date availability

Half-open `[start,end)` overlap: existing.start<requested.end && existing.end>requested.start. Empty Cells can be allocated to nonoverlapping rentals; OCCUPIED rows and physical counters block globally (`212–228`). Commercial quota conservatively counts OVERDUE/ended ACTIVE obligations (`88–134`).

Both map GETs accept paired canonical Date.toISOString() startDate/endDate; omitted dates use current-time ~1ms interval (`BE warehouse-map.service:189–201`). Explicit map requires milliseconds, stricter than reservation parser's seconds option. Map projects overlapping HOLD/RESERVED plus all OCCUPIED (`204–215`). Future holds will not necessarily show on no-date map; request selected rental interval. No push/live lock at selection. Quote does not guarantee Cell availability. Future-date logic is implemented in source, though runtime acceptance remains unknown and later physical occupancy may prevent future reuse.

## D. Warehouse Map Status and Ownership

Source: BE warehouse-map.service:204–238,644–783; types/warehouse-map.type:3–14,42–46,92–123.

| Actual field | Type | Meaning / FE use |
|---|---|---|
| `_id` |ObjectId serialized string |Persisted Cell selection identity; not named cellId in detail DTO. |
| code/cellNumber |string/number |Human label and position; enclosing level contains levelNumber. |
| dimensions |object |widthM/depthM numbers; usableHeightM optional; use measured geometric volume. |
| operationalStatus |string |AVAILABLE/BLOCKED/MAINTENANCE independent of booking. |
| bookingStatus |string |AVAILABLE/RESERVED/OCCUPIED. HOLD publicly RESERVED; RELEASED not active. |
| displayStatus |string |MAINTENANCE overrides, then BLOCKED, otherwise bookingStatus. |
| isMine |boolean |Authenticated Customer owns any active projected allocation in requested range. Not permission to rebook. |
| hasMyInventory |boolean |Own nondeleted IN_STORAGE item currently in Cell; independent of range. |
| usedWeightKg/usedVolumeM3 |number |Real physical counters, not commercial allocated volume. |
| maxWeightKg/remainingWeightKg |number |Configured cap/max(0,cap-used). |
| maxVolumeM3/remainingVolumeM3 |number or null |Measured geometric capacity/remaining; null if missing usable height. |
| utilizationStatus |string |EMPTY/PARTIAL/NEAR_FULL/FULL based on weight; not bookability. |

bookingStatus OCCUPIED if nonzero counters or chosen allocation OCCUPIED; otherwise RESERVED if active allocation, else AVAILABLE. Public display doesn't incorporate parent rack state; create also lacks rack operation predicate, while inbound enforces it. Report backend gap; future FE can conservatively disable purchase under a non-AVAILABLE rack without claiming server enforcement.

Overview: facilityId/zones/aisles/racks, rack identity/grid/dimensions/operationalStatus, utilization actual kg/m³+source WAREHOUSE_CELL_COUNTERS+rated/allocatable/remaining/ratio/status, counts total/available/reserved/occupied/blocked/maintenance/myCellCount. No embedded Cell/item list (`644–712`). Detail: rack hierarchy/grid, capacity aggregate, descending levels with Cell allowlist (`716–783`). Rated weight remains distinct from summed allocatable caps.

Customer may browse active Managed facilities without a reservation. FM/FS assigned only, A/B broader. Internal allocation queries include customer/reservation IDs but outgoing DTO only exposes booleans/aggregates; no ownerId/customerId/reservationId/private item data. hasMyInventory query strictly own Customer+IN_STORAGE (`218–221`). Foreign Customer can see aggregate occupancy but no private identities. Essential privacy is source-enforced, not frontend dimming.

Projection limitation: allocation query unsorted; bookingStatus selects first active row, isMine means any matching own row. Wide date range spanning different customers' nonoverlapping allocations must not be presented as one owner for the whole interval. Actual usage still forces OCCUPIED.

## E. Reservation and Cell Lifecycle

| Event | Reservation/contract | Allocation/public booking | Item/usage | Authorization / evidence |
|---|---|---|---|---|
| Create |RESERVED, expiresAt facility hold duration; no contract |HOLD/public RESERVED for overlapping range |None |C VERIFIED; managed service:269–311. |
| Approve |CONTRACTED+DRAFT; deadline unchanged |HOLD unchanged |None |Assigned FM/A; :376–404; contract model:6,9–12. |
| Sign |CONTRACTED+SIGNED/time |HOLD unchanged |None |C owner; contract.controller:49–79. |
| Mock pay |PAID+SIGNED; expiresAt unset, paymentSimulation MOCK |HOLD→RESERVED/deadline unset |No physical counters |Own C/A/B; nonproduction+MI_MOCK_PAYMENT_ENABLED=true; managed service:446–465. |
| Activate |ACTIVE; SIGNED |RESERVED unchanged |No occupancy |Assigned FM/A; now in [start,end), active facility; :467–485. |
| Register |ACTIVE guard |No allocation write |REGISTERED/unplaced/preferred optional |C owner; inventory service:224–245. |
| Request inbound |ACTIVE/in-term checked |No physical write |PENDING_INBOUND/currentCell null |C owner; inventory service:323–345. |
| Confirm inbound |ACTIVE/in-term; usedCapacityM3 increment |Target OCCUPIED |IN_STORAGE + actual Cell; kg/m³/movement |Assigned FS only; inventory service:348–469. |
| Reject inbound |Rental/contract unchanged |No physical write |REGISTERED+reason |Assigned FS; :473–489. |
| Manager reject |RESERVED→CANCELLED |Empty HOLD/RESERVED→RELEASED; preserve occupied counters |No physical release |Assigned FM/A; managed service:406–425,231–238. |
| Customer cancel |RESERVED/CONTRACTED→CANCELLED; contract not invalidated |Same release |Paid/active cancellation forbidden |Own C; :427–444. |
| Hold expiry |Stored status/contract not auto-transitioned |Expired HOLD ignored by deadline; rows retained |No automatic effect |Managed service:91,225; map:213; no worker. |
| Term end/overdue |No automatic Managed status/contract expiry found |Empty RESERVED no longer overlaps after end; OCCUPIED always blocks |Stock retained |Managed service:88–134,220–228; server.ts. |
| Managed checkout/outbound |Not implemented |No occupied release |No outbound/relocation/disposition operation |No managed routes/service; inspections.controller:44–48 rejects Managed completion. |

Reservation enum RESERVED/CONTRACTED/PAID/ACTIVE/OVERDUE/CHECKED_OUT/CLOSED/CANCELLED (`BE types/reservation.type:4–12`). No Reservation EXPIRED enum; elapsed hold is a derived deadline state, not fabricated stored EXPIRED. Allocation history retained. Expired contracts/rentals never imply physical stock cleared. Managed mock pay is distinct from Self Storage `/reservations/:id/mock-pay`; preserve current separate Self implementation.

### MI-02B.1 / My Inventory contracts

All paths under /api/v1; routes/inventory-item.routes.ts:8–24.

| API | Contract / permission |
|---|---|
| POST `/inventory-items` |C; owns ACTIVE Managed rental at active facility; required managedReservationId/itemCode/name/category/quantity/quantityUnit/unitWeightKg/unitDimensionsM; optional description/preferredCellId/images;201 DTO. |
| GET `/inventory-items/me` |C-own history; page1..1e6,limit1..100 defaults1/20;200 `{success:true,data:[DTO],pagination:{page,limit,total,totalPages}}`. |
| GET `/inventory-items/:id` |Own C or A/B/assigned FM/FS; foreign C404;200 DTO. |
| PATCH `/inventory-items/:id` |Owning C,ACTIVE rental,REGISTERED/unplaced; at least one allowed metadata field; immutable owner/facility/rental/code/location rejected400; stored/pending409. |
| GET `/inventory-items/:id/placement-preview` |Scoped readers;ACTIVE rental; cellId query or preferred fallback; advisory/no write/no membership check. |
| POST `/inventory-items/:id/inbound-request` |Own C;REGISTERED/unplaced;ACTIVE in-term/active facility/no other overdue customer-facility rental; body ignored,{};200 pending DTO. |
| POST `/inventory-items/:id/confirm-inbound` |Assigned FS only; measured body;ACTIVE in-term; Cell allocated RESERVED/OCCUPIED to same rental/customer;200 `{item,movement,idempotentReplay}`. |
| GET `/inventory-items/:id/movements` |Own C/scoped staff-management;200 `{success:true,data:[movementDTO]}`; foreign404. |

DTO (`BE inventory-item.service:46–75`): _id/facilityId/managedReservationId/itemCode/name/category/description?/quantity/quantityUnit/unitWeightKg/unitDimensionsM/unitVolumeM3/totalWeightKg/totalVolumeM3/preferredCellId?/currentCellId/status/inbound timestamps/rejection?/images/createdAt/updatedAt; management customerId only. Item enums REGISTERED/PENDING_INBOUND/IN_STORAGE. Required quantity positive safe integer, weight/dimensions finite positive; field limits/name160/category80/unit32/code48/description2000/images10 HTTP(S); server derives totals (`validation:59–118`; service:80–91).

Registration/update/preview ACTIVE guard **does not check now in term** (`BE managed-inventory-reservation.guard:20–45`), unlike inbound (`inventory service:112–131`). Stale ACTIVE-ended rentals may register but inbound409. PreferredCell validation checks same facility, AVAILABLE operation, active zone/AVAILABLE rack, **not allocation membership** (`211–220`). Actual confirm enforces own reservation allocation (`377–379`). Preference/preview success is not physical placement permission.

Staff payload: cellId,verifiedQuantity,actualUnitWeightKg,actualUnitDimensionsM{widthM,depthM,heightM},physicalPackingConfirmed(boolean),inspectionNote(1–1000),idempotencyKey(1–128 restricted charset). Quantity must match registered lot; weight rounding3/dimensions6; multi-unit packing needs true. Horizontal rotation allowed; height fit; Cell kg/m³,level/rack weight,rental quota,effective CATEGORY policy checks; atomic conditional Cell increment plus rental/movement/allocation/item in one transaction (`348–469`). Destination Cell can already contain same-rental stock if all limits permit; not globally free for rebooking.

Idempotency: same item+key INBOUND replay checks destination/quantity/rounded measurements/note/packing before prior result (`169–178,357–360`); differing replay409. Unique itemId+key and append-only model hooks (`item-movement.model:30–39`). Scope checked before replay. Customer movement DTO omits customerId/performedBy/key; management retains identity, key still omitted (`181–192,493–500`). Runtime retries remain unverified.

Preview response: itemId/cellId/advisory=true/advisoryStatus ESTIMATED_FIT/NEEDS_MEASUREMENT/NOT_FIT,estimatedFit(boolean/null),allocationConfirmed=false,reservationCreated=false,stockWritten=false,staffConfirmationRequired=true,actualUsageKnown=true,itemEstimate,cellCapacity,structuralCapacity,rentalQuota,checks,uncertainty (`503–615`). It neither locks nor authorizes inbound/category approval.

Customer list **does not support reservation/Cell filters** (validation:126–140 rejects those keys). It parses category/status/search but listMine ignores them; facilityId/customerId rejected400, owner-only pagination filter (`248–259`). Management list applies category/status/search and assignment (`263–285`). Future Customer filtering must be local over explicit complete pagination, or clearly limited to loaded items; never send faux server filters.

## F. Postman vs Backend Comparison

All **45 MI-02C requests** were parsed/inspected. Repeated reads and role variants are grouped below; comparison is static source checking, not executed HTTP. PM examples require correctly resolved variables/prerequisites. Collection is unchanged.

| API | Postman contract | Backend contract | Result |
|---|---|---|---|
| Warehouse Map |GET facilityId, sanitized overview (PM:6311) |Same; optional date range also supported |MATCH path/base DTO; date coverage incomplete. |
| Rack detail |GET no dates; future holds/payment RESERVED+isMine expected (6777,7077) |Default now-range excludes nonoverlapping future allocations |**MISMATCH future-status assertions**; URL/method match. Explicit selected rental dates needed. |
| Managed quote |Scalar capacity/no IDs (6591) |Same accepted; optional IDs validate selected volume |MATCH valid request. Prose saying IDs only used at creation is incomplete. |
| Managed create |cellIds+volume/date/term,201 (6680) |Same; mandatory1..100, `{reservation,quote}` |MATCH. Walkthrough>=2/same rack does not define server rules. |
| Managed detail |data.reservation||data fallback (6830) |Flat data reservation |MATCH flat branch; earlier FE nested-response risk resolved. |
| Approval |PATCH {},contract captured (6871) |200 `{reservation,contract}`,CONTRACTED+DRAFT |MATCH; assigned FM/A only. |
| Contract read/sign |GET and PATCH {} (6928,6967) |Owned/scoped read,own DRAFT/live hold signing |MATCH; foreign Customer contract403,not inventory404. |
| Managed payment |POST {},dev flags,accept200/201 (7021) |200 only,live CONTRACTED+SIGNED;owner/A/B |MATCH permissive success assertion;201 not emitted. Map-after-pay assertion separately mismatches future range. |
| Activation |PATCH {},wait until start (7132) |200 ACTIVE for in-term PAID+SIGNED |MATCH; no physical occupancy write. |
| Inventory create/read/preview |ACTIVE/register/advisory examples (7235–7341) |Same valid fields;preference not allocation permission |MATCH. |
| Inbound request |POST {},PENDING,no usage (7432,7487) |Same transactional state effect |MATCH. |
| Staff confirm/replay |Measured body,stock,IN_STORAGE/idempotentReplay (7535,7783) |Same plus scope/allocation/policy/limits |MATCH; writes not executed. |
| My Inventory |GET inventory-items/me pagination (7880) |Same owned list; no reservation/Cell filters |MATCH; FE filtering not tested by Postman. |
| Movements |Owned array,no key (7741) |Same sanitized history array |MATCH; exactly-one assertion depends on isolated initial item. |
| Owner/foreign privacy |Flags,foreign item/history404,Customer stock403 (7929–8219) |Same source scope/allowlist |MATCH when range overlaps;future ownership flags interval-dependent. |
| Bad selected m³ |Accept400/409 (8265) |400 mismatch,earlier availability can409 |MATCH weak assertion; use free Cells to prove specific cause. |
| Unallocated confirm |409 (8319) |409 after pending/scoped/in-term guards |MATCH; use separate pending item. |
| Alternate cancel/map |Accept200/204,release expected (8374,8430) |200 CANCELLED + empty release |MATCH permissive status;204 not emitted;following map test only checks200. |
| Other-facility Staff |403 (8471) |403 before confirmation/replay |MATCH. |

### Complete request coverage

PM groups under line6208; group/step numbers below cover all45 requests.

- **00/01–08 (8 requests):** health,public facilities,public pricing,overview,rack detail,local-volume validation,commercial interval capacity,CATEGORY policy resolver. BE routes/index:24–30,public.routes:5–8,pricing-policy.routes:9–20; public-catalog.service:37–64,90–98; rule.service:14–18,117–124; Managed/map sources in B. Health200 depends on actual connected DB,otherwise503. Local min2/same-rack/six-decimal cached-volume guards are scenario restrictions.
- **01/01–11 (11):** quote,create,hold map,detail,approve,contract read,sign,pay,paid map,activate,ACTIVE detail. Managed service:246–311,368–488; contract.controller:13–79; map:189–238. Only no-date future map assertions inconsistent. All write requests are manual;none executed.
- **02/01–14 (14):** register,item read,preview,physical baseline,request inbound,unchanged pending counters,confirm,occupied/rest-reserved map,overview,rental usage,movements,replay,unchanged replay counters,own item list. Inventory service:224–259,323–469,493–615; map:644–783. Second Cell RESERVED assertion valid during active term,not forever;baseline assumes no unrelated usage mutation.
- **03/01–07 (7):** own flags,foreign flags/no identity,foreign item404,foreign patch404,stored patch409,Customer confirm403,foreign history404. Map:218–238 and DTO allowlist;inventory service:201–208,298–319,348–355,493–500;inventory routes. Own allocation flag tied to chosen range.
- **04/01–05 (5):** bad-volume create,unallocated confirm,alternate cancel,cancel map,wrong-facility Staff. Managed service:281–282,427–444,231–238;inventory service:355,377–379. Isolate prerequisites to prove intended errors,not preceding guard failures.

Confirmed collection differences/coverage limits:

1. PM6777/7077 expected future-hold/payment ownership without dates; server default is current interval. Create requires future start, so these tests may fail even though allocation succeeded. Supply actual reservation interval in a future reviewed collection revision; don't modify it here.
2. Local>=2/same-rack walkthrough stricter than server1..100/cross-rack/zone; not API requirements.
3. Quote accepts optional IDs in source; existing scalar-only collection body valid,description incomplete.
4. Broad payment200/201 and cancel200/204 assertions accept codes implementation doesn't emit; not alternative response contracts.
5. PM4 deferred date awareness now resolved in source; live date/race acceptance still unverified.
6. No assertion validates actual Customer browser filtering/dimming,installed indexes or transaction runtime safety.
7. Cached-catalog prerequest computes volume before following GET updates catalog;stale dimensions still possible. Server volume comparison is authoritative.

## G. Frontend Compatibility Assessment

Current application was reviewed without edits. Existing routes: map facility/rack, `/portal/rent?service=managed`,owned reservation/contracts/payments,inventory list/register/detail/inbound/history (`FE routes/AppRoutes.jsx:29,64–76,92–93`). Reuse routes;no new routing architecture.

| File/area | Reuse | Required change / confirmed compatibility issue |
|---|---|---|
| src/api/warehouseMapApi.js:9–10 |Existing client,read/error handling |Add optional paired dates. Overview currently overwrites config.params with facilityId;no explicit range argument. |
| src/lib/warehouseMap.js:6–38 |Structure/ID validation,extra fields retained |Validate booking/display/ownership/capacity when enabling booking;unknown state cannot purchase. |
| warehouse/DigitalWarehouseDashboard.jsx:41,44–50,65,69,95 |Responsive map,cache,inspector,session boundary,refresh |Single Cell inspection only;clears on rack/detail/refresh. Separate booking basket;cache key must include facility/rack/range/session,not rackId only. |
| warehouse/CellInformation.jsx:5–9,28–30 |Accessible Cell buttons,tooltip/detail |Only operation-based colors/labels and baseline kg;add display/booking/ownership/actual m³ fields. |
| pages/customer/WarehouseMapPage.jsx |Facility context/deep links |Pass chosen range through overview and detail;keep current-time browse. |
| src/lib/customerReservationService.js:31–39 |Dates/terms/create response checks |managedRequest drops cellIds. Separate quote vs mandatory Cell-create validation;no invented quota-only fallback. |
| src/api/managedReservationApi.js:6–11 |Exact existing endpoints/Axios |create must preserve IDs;currently legacy builder removes them. Quote can keep scalar or optional IDs. |
| ManagedReservationBooking.jsx:32–46 |Date/term/quote/confirmation/uncertain-create controls |Existing form quotes but create400. Text 'No ... cell is booked' stale for updated create. Reuse form controls in selection popup. |
| ManagedReservationBooking.jsx:40,46 |Checks valid quote/rent/deposit/currency |Quote loads;top-level totalDue missing so display omits total. Use explicit returned-field arithmetic,not invented field. |
| src/api/reservationApi.js:37–81 |Own list + flat detail + metadata merge |New flat DTO compatible;allocatedCellIds/snapshot pass through but not rendered. |
| RentalLifecycleIntegration.jsx:51–69,369–591 |Own contract linking,Managed sign/pay guards |Reuse statuses/live hold/flag checks;add Cell summary and fresh map links. Preserve separate SelfStorageMockPayment branch. |
| RentalBackendUI.jsx:179–224 |Status/money/summary components |Display IDs/snapshot volume;Managed ACTIVE narrative at lifecycle:77 wrongly says no Cell assigned. Allocation differs from actual stock. |
| src/api/inventoryApi.js:7–11 |Real paginated read/create/edit/preview |Missing inbound-request/movements adapters. Staff confirm separate authorized role work. |
| src/api/confirmedContract.js:7 |Central confirmed endpoint gate |Inbound-request/movements/confirm-inbound blocked;add exact permitted operations only after implementation approval. |
| inventory/InventoryIntegration.jsx:9–22 |Active real owned list/detail/location distinction |Add owned reservation/Cell local filters with pagination caveat and real inbound/history interactions. |
| inventory/InventoryMapPreference.jsx:11–31 |Advisory preview/preference,fresh item context |Only operation/facility checks;preferred selection need not be own allocation. Guide to actual rental allocation and explain advisory semantics. |
| inventory/InventoryItemForm.jsx:12–23 |Lot form/metadata/response validation |Keep preferred vs actual location;offer confirmed own allocation choices where data permits. |
| pages/customer/InventoryMovementRequestPage.jsx:2–12 / InventoryHistoryPage.jsx:2–8 |Existing route/layout patterns |Demo store only;real ID can show Item not found. Integrate real Customer inbound/history explicitly;outbound unsupported. |
| pages/customer/MyInventoryPage.jsx:last line |Default export InventoryListIntegration |Old demo function declaration is not active page;don't replace functioning integration by mistake. |

Search across src finds no handling for cellIds/bookingStatus/displayStatus/isMine/hasMyInventory. Structural map validators retain new fields but don't render/use them. Baseline notices claiming MI_01_EMPTY/no physical usage are stale against WAREHOUSE_CELL_COUNTERS. Revise narrowly during approved implementation.

**Legacy compatibility:** source has removed capacity-only create at BE managed service:272. Preserve old records,quota reads/quotes,current routes;full quota-only CREATE cannot be preserved with these confirmed APIs. If exact legacy creation remains a product requirement,backend contract decision is required. Do not restore backend,auto-select Cells,create fake reservations or invent legacy endpoint. This is a real contract incompatibility,not permission to change frontend business rules during audit.

Self Storage uses its own paths and payment component;Managed remains separately flagged. Authentication/token/Axios/dependencies/other roles unchanged.

## H. Missing Backend Features and Remaining Risks

| Finding | Priority | Evidence / required handling |
|---|---|---|
| Legacy quota-only create removed |P0 compatibility |Managed service:272;new create must select Cells or obtain explicit BE contract decision. |
| Future map Postman assertions inconsistent |P0 acceptance |Map:189–215;use rental range. |
| Runtime contention safety unproven |P0 before production |Verified transactional locks;mocked tests not DB,index/topology/retries unverified. |
| Parent Rack non-AVAILABLE can book |P1 backend gap |Create:206–208 lacks operation;inbound:385–388 requires AVAILABLE. Conservatively disable FE selection;report gap. |
| No Managed outbound/checkout release |P1 lifecycle |No routes/service;inspection controller rejects Managed;occupied allocations persist. |
| No expired-hold cleanup/status worker |P1 interpretation |Deadlines ignored for availability;stored statuses/history retained. Never fabricate EXPIRED. |
| Preference/preview lacks allocation membership |P1 usability |Inventory:211–220,503–521 vs confirm:377–379. Advisory fit is not placement permission. |
| Registration ACTIVE guard lacks dates |P1 consistency |Guard:20–45 vs inbound:112–131;registration may succeed where inbound409. |
| Customer list ignores parsed filters |P1 API limitation |Validation:126–140;listMine:254–259;no reservation/Cell server filters. |
| Quote no top-level totalDue |P1 amount display |publicQuote:246–254;FE reads absent field;derive labeled amount. |
| Wide-range allocation projection |P2 interpretation |Unsorted first allocation/status and any-owned flag;no single inferred owner for entire range. |
| Cross-lifecycle lock conflicts |P1 runtime |Different lock orders;Managed transient exceptions can500;reconcile uncertain POST. |
| Later physical occupancy blocks future plans |P1 future use |Date logic supports empty intervals;no authorized outbound release guarantee. |

Remaining unknowns:actual deployed source version/live DTOs,fixtures/dimensions/policy availability,transaction-capable DB topology,installed indexes,contention/rollback/retries between create/pay/cancel/inbound,live date boundaries/precision,real token/facility assignments. These aren't evidence core source is missing. No live requests executed.

## I. Recommended Frontend Implementation Plan

Proposal only;no implementation in this task. Keep existing React/shadcn/Axios/routing/session/green-orange design;React Bits isolated presentation only.

1. **P0 contract alignment:** acknowledge mandatory Cells and removed legacy CREATE;keep existing records/quotes readable. If unchanged quota-only creation is required,get backend contract decision rather than invent fallback. Update reviewed acceptance range expectations separately;collection unchanged here.
2. **P0 foundation:** focused changes to warehouseMapApi/date params,warehouseMap parser,customerReservationService separate quote/create payload,managedReservationApi ID preservation. Same Axios/base/auth/endpoints;flat DTO mappings already compatible.
3. **P0 selection state:** isolated basket/dialog integrated into Dashboard;separate inspection;unique1..100/same facility/cross-rack-zone;clear on session/facility;canonical chosen interval;refresh when dates change. Unknown states,nonzero usage,missing positive measured dimensions,conflicts/non-AVAILABLE parent disable purchase.
4. **P0 Buy popup:** reuse date/term/quote/checkbox controls. Show code/rack/level/dimensions/m³/total selected capacity. Quote optionally with IDs for early volume validation;still no hold. Show returned rent/deposit/currency and explicitly derived total. Any selection/date/term change invalidates quote/consent.
5. **P0 creation/recovery:**refresh selected racks for chosen interval;submit exact payload once,Busy ref double-click guard.400 volume needs refresh/requote;409 conflict refresh selection;403 profile/role;404 configuration/resource. Unknown network/5xx reconcile own reservation collection/detail before manual retry;no duplicate auto-POST/fake hold.
6. **P1 lifecycle:** extend RentalBackendUI/lifecycle with allocatedCellIds/snapshot volume (labels only from actual matching data). Preserve owned Managed contract/pay guards and Self branch. Existing map deep link carries confirmed range;refresh cache after create/cancel/pay/activation/inbound. Customer never invokes approval/activation/physical confirm.
7. **P1 map semantics:**display operation/booking/ownership/counters separately;update source notices;range/session-aware cache. Current-time browse remains explicitly current-time. Paid doesn't mean occupied.
8. **P1 MI-02B.1/My Inventory:**add exact Customer inbound-request/movements API+allowlist;reuse real inbound/history routes;separate demo records. Success PENDING no stock. Local owned filters across explicit pagination;no invented query. Staff confirmation UI is separate scoped implementation,not a Customer permission.
9. **P1 placement guidance:**InventoryMapPreference/ItemForm guide toward own rental allocations;preference advisory. Additional stock within own occupied allocation only after real fit/capacity/policy/Staff checks.
10. **P1 validation/regression:**preserve Self payment/auth/old Managed history/MI-01/MI-02A/Manager/Staff. No unrelated route/dependency/config/refactor changes.

### Test plan (not executed)

- Unit:count1/100/>100,case-normalized duplicates,measured m³ tolerance,canonical paired dates/calendar term,unknown statuses/display precedence,own booked not rebookable,quote invalidation/total arithmetic.
- Intercepted FE:cross-rack/zone basket,range/cache invalidation,exact IDs/body,flat detail/populated contract relation,400/409,duplicate click,uncertain create reconciliation,hold expiry,separate Managed/Self flags,no Customer management/stock writes.
- Inventory:own list/detail,foreign404,assigned Staff scope,preferred outside allocation advisory,request no counters,stale ACTIVE registration versus inbound409,stored edit409,movement privacy,real/demo route separation,pagination filters.
- Separately authorized isolated DB acceptance:two clients same Cell/overlap,nonoverlap,stale selection whole transaction rollback,indexes/topology/retries,pay/cancel/inbound contention,same-key and mismatched replay,exactly-once counters,all role/facility combinations,policies/usable clearance/date boundaries. No writes during audit.
- Regression:Self create/sign/mock pay,old Managed history/quote,new mandatory selected-create behavior,MI-01 navigation/preview,MI-02A,Customer login/logout,Manager/Staff. Old capacity-only-create expectation must reflect server rejection,not be disguised as preserved.
- Responsive/accessibility:1440/1024/768/390/320,keyboard multi-selection/dialog/focus return,ownership labels/contrast,basket overflow.

Actual checks:source/document reads/searches;JSON parse and syntax-only compilation of **227 request-level scripts across211 requests**,including45 MI-02C requests;zero syntax errors. Scripts compiled via new Function,not executed. No npm build,backend runtime tests,frontend integration suite,browser/Postman/HTTP requests,migrations/seeds/DB writes. Reading mocked test source is not a pass result.

## J. Final Readiness Decision

**READY WITH LIMITATIONS.** Restored source establishes persistent multi-Cell allocation,source-level exclusive overlap protection,scoped ownership,contract/payment/activation and real inbound. Missing-BE BLOCKED classification withdrawn. Date-awareness is source-confirmed;runtime concurrency/future acceptance remains outstanding.

This isn't completed frontend implementation or production acceptance. Mandatory Cell creation is a breaking change for the current capacity-only FE;its compatibility must be explicitly handled. Managed outbound/occupied release remains unsupported. Implement only verified subset after audit review;no implementation approval inferred from this audit request.

### Inspection register and preservation

Only updated file: `C:/Users/laptop/Desktop/WDP/frontend/docs/MI02CBackendIntegrationAudit.md`.

Relevant BE files inspected (prefix absolute BE root above;targeted reads/searches distinguished from runtime execution):

- package.json;src/app.ts;src/server.ts;src/routes/index.ts.
- src/routes/reservation.routes.ts;warehouse-map.routes.ts;inventory-item.routes.ts;contract.routes.ts;public.routes.ts;pricing-policy.routes.ts.
- src/middlewares/auth/requireAuth.ts;requireRole.ts;src/middlewares/error.middleware.ts.
- src/controllers/reservations/managed-reservation.controller.ts;reservation.controller.ts.
- src/controllers/warehouse-map/warehouse-map.controller.ts;inventory-items/inventory-item.controller.ts;contracts/contract.controller.ts;inspections/inspection.controller.ts;public/public-catalog.controller.ts;pricing-policy/rule.controller.ts.
- src/services/reservations/managed-reservation.service.ts;managed-inventory-reservation.guard.ts;reservation.service.ts(targeted expiry/lifecycle search).
- src/services/warehouse-map/warehouse-map.service.ts;warehouse-map.validation.ts.
- src/services/inventory-items/inventory-item.service.ts;inventory-item.validation.ts.
- src/services/public/public-catalog.service.ts;src/services/pricing-policy/rule.service.ts.
- src/models/warehouse-map/cell-allocation.model.ts;warehouse-cell.model.ts;warehouse-rack.model.ts.
- src/models/reservations/reservation.model.ts;src/models/contracts/contract.model.ts.
- src/models/inventory-items/item-movement.model.ts;inventory-item.model.ts.
- src/types/warehouse-map.type.ts;reservation.type.ts;inventory-item.type.ts.
- tests/managed-reservation.test.cjs;managed-inbound.test.cjs;warehouse-map.test.cjs(source only).
- docs/MI_02C_CELL_RESERVATION.md(cross-checked,not sole authority).

Relevant FE files inspected (prefix absolute FE root above):

- AGENTS.md;previous docs/MI02CBackendIntegrationAudit.md.
- src/api/warehouseMapApi.js;managedReservationApi.js;reservationApi.js;inventoryApi.js;contractApi.js;paymentApi.js;confirmedContract.js.
- src/lib/customerReservationService.js;warehouseMap.js;inventoryRegistration.js.
- src/routes/AppRoutes.jsx;src/pages/customer/WarehouseMapPage.jsx;MyInventoryPage.jsx;InventoryMovementRequestPage.jsx;InventoryHistoryPage.jsx.
- src/components/customer/ManagedReservationBooking.jsx;RentalLifecycleIntegration.jsx.
- src/components/customer/warehouse/DigitalWarehouseDashboard.jsx;CellInformation.jsx.
- src/components/customer/inventory/InventoryIntegration.jsx;InventoryBackendUI.jsx;InventoryMapPreference.jsx;InventoryItemForm.jsx.
- src/components/customer/RentalBackendUI.jsx.

Request attachment and actual Postman file read. Collection unchanged. Final before/after SHA-256 comparison checked **378 existing files**, including **164 BE-REF files**: exactly this report changed, zero files added or removed, all BE-REF hashes unchanged. No application changes,original backend/ access or Backend requests of any method. No runtime guarantees beyond source findings are asserted.
