# BOM/Admin Backend Phase 5 Handoff

**TASK_ID:** `WDP_BOM_ADMIN_BE_PHASE5_OPERATIONS_STATS`  
**Scope:** B4 operational diagnostics, B5 Reservation read listing, B6 Statistics source audit. No Notification or Phase 3 image-upload work.

## B4 — operational error diagnostics

This Phase adds structured server-side error records to the existing application console stream; it does **not** add a persisted log collection or a log-reading API. Records include timestamp, generated correlation ID, operation, stage, provider, normalized error category, safe bounded provider code when available, retryable flag, and measured duration for Cloudinary provider calls. Entity IDs are included only when valid ObjectIds are explicitly supplied; the current email/Cloudinary call sites do not supply one.

Email inline template/payload construction failures (all 13 Reservation email methods and OTP), provider failures, invalid recipients, missing sender configuration, and email-context lookup errors are logged without raw recipient, subject, body, template variables, OTP, provider message, or credentials. Render errors are rethrown unchanged; existing semantics remain: safe email returns `false`, and OTP sending throws its existing public error. One correlation ID is carried from render through provider send for each operation. No retry mechanism exists in EmailService, and there is no standalone template lookup/render service.

Cloudinary upload/delete provider failures log normalized metadata and continue to reject or return the existing provider result to the caller. Cloudinary upload call sites in Managed Inventory image, receiving-evidence, and contract signed-paper confirmation flows also log `metadata_persistence` after provider success when their existing database persistence writes reject. Contract uploads pass one correlation ID through the Cloudinary upload, contract/reservation/audit persistence failures, and best-effort deletion after a confirmed transaction abort or replay. Contract data, signature evidence, provider payloads, and raw exceptions are not included in diagnostics. Receiving-evidence cleanup logs metadata persistence errors after Cloudinary deletion; Cloudinary delete errors are logged by the provider adapter. Existing bounded cleanup/retry behavior remains unchanged. Input image validation remains an existing request-validation path and is not logged as an operational provider failure.

These diagnostics are console-only; there is no persisted operational-log collection, viewing API, or Notification producer. Contract upload persistence coverage includes failures thrown by the existing Contract, Reservation, and Managed Reservation Audit writes; transaction conflicts returned as normal business errors and reads/validation are not classified as metadata failures. Contract metadata failure does not trigger additional cleanup beyond existing behavior; the existing provider cleanup adapter logs its own failure. Provider timeout is categorized when the existing adapter reports a recognized timeout error code; this change does not add a transport timeout or retry mechanism.

## B5 — Reservation listing

`GET /api/v1/reservations/admin-list` is a read-only paginated query over the single `Reservation` collection, which stores both `SELF_STORAGE` and `MANAGED_INVENTORY` service types.

Roles: ADMIN and BOM may query globally or narrow with `facilityId`; FACILITY_MANAGER and FACILITY_STAFF are forced to their assigned Facility, and a different requested Facility returns 403. CUSTOMER is denied. Existing `/reservations/me` and `/reservations/facility/:facilityId` remain unchanged.

Filters: `facilityId`, `serviceType`, `status`, `customerId`, `reservationCode` literal case-insensitive match, `fromDate`, `toDate`, `page`, `limit`, and `sortOrder`. Date filters apply to Reservation `createdAt`, are Vietnam local dates, and include the named `toDate`. Page defaults to 1, limit to 20, max limit 100. Count and filter use the same Mongo query before pagination; stable sort uses `createdAt` and `_id`.

Response item fields: `_id`, `reservationCode`, `serviceType`, `status`, customer `_id`/`displayName`, Facility `_id`/`name`/`code`, Storage Unit `_id`/`unitCode` when applicable, `startDate`, `endDate`, `createdAt`, and `allocatedCapacity` when stored. Payment credentials, payment records, contract proof, access PIN, arbitrary personal fields, and status history are excluded. No manager approval or lifecycle transition is exposed.

Known limitation: Facility Manager and Staff are restricted to their assigned Facility, matching the existing Facility-list behavior. Staff/customer display name and facility details are populated in one query per page, not N+1. This implementation does not add historical Reservation data or join a second collection.

Performance risk: Reservation has indexes for Facility/status and Facility/service/status/date overlap queries, but no explicit global `createdAt` sort index. Unfiltered Admin/BOM listing and exact counts may scan a large collection. Before production release, review representative query plans and evaluate `{createdAt: -1, _id: -1}` plus `{facilityId: 1, createdAt: -1, _id: -1}` (and filter-specific variants) against workload. No index or migration was added and production query plans were not checked.

## B6 — Statistics gap matrix

| FE requirement | Existing API | Role | Parameters / response | State |
|---|---|---|---|---|
| Revenue period and service trends | `GET /statistics/revenue` | ADMIN, BOM, FACILITY_MANAGER | dates, facility, service type, granularity; collected series and comparison | ALREADY_SUPPORTED |
| Growth comparison | revenue and financial analytics | ADMIN, BOM, FACILITY_MANAGER | `comparePrevious=true`; `growthPercent` with unavailable state when denominator is zero | ALREADY_SUPPORTED |
| Facility booking/revenue ranking | `GET /statistics/facilities-ranking` | ADMIN, BOM, FACILITY_MANAGER | period, facility/service filter, sort/page | ALREADY_SUPPORTED |
| Current Self Storage occupancy | `GET /statistics/utilization` | ADMIN, BOM, FACILITY_MANAGER | existing current capacity semantics | ALREADY_SUPPORTED; not historical |
| Current Managed Inventory capacity | `GET /statistics/managed-capacity` | ADMIN, BOM, FACILITY_MANAGER | V4 snapshot and reconciliation metadata | ALREADY_SUPPORTED; not historical |
| Payment status and pending intent count | `GET /statistics/payments-analysis` | ADMIN, BOM, FACILITY_MANAGER | current PaymentStatus filters and `pendingPayments` intent count | ALREADY_SUPPORTED |
| Verified collected amount | `GET /statistics/financial-analytics` | ADMIN, BOM, FACILITY_MANAGER | successful verified PayOS captures; paymentStatus permits SUCCEEDED only | ALREADY_SUPPORTED |
| Incidents and maintenance | `GET /statistics/incidents`, `/statistics/facilities-kpi` | ADMIN, BOM, FACILITY_MANAGER | period/status/facility according to route contract | ALREADY_SUPPORTED |
| Historical utilization series | no historical capacity snapshot source | — | current capacity is explicitly a snapshot | HISTORICAL_DATA_GAP |
| Refund/net revenue/recognized accounting | no verified Refund Ledger/accounting source | — | must not infer from payment status or gross captures | BUSINESS_DECISION_REQUIRED / SOURCE_GAP |

Routes currently declare 19 JSON report/filter endpoints plus 3 export formats, for 22 HTTP endpoints total; each export format supports nine report types. This audit found no verified Phase 5 Statistics contract gap requiring code changes. The FE-specific matrix and limits are in `docs/STATISTICS_FE_API_HANDOFF.md`.

## Verification and environment

Offline tests use mocks only. No MongoDB, PayOS, Cloudinary, or email provider was contacted. The Postman collection contains no real token. Audit indexes and production query plans were not changed or verified.
